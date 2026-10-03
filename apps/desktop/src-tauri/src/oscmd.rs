//! OS command construction — argument vectors only, never shell / AppleScript / PowerShell source
//! assembled from user data (security-model R8). Each builder returns a [`CommandSpec`] so the exact
//! program + argv can be unit-tested without spawning anything.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// Text fed to the child's stdin (keeps user content out of argv).
    pub stdin: Option<String>,
    /// Windows: open in a new console window (`CREATE_NEW_CONSOLE`).
    pub new_console: bool,
    /// Extra environment variables (validated values only).
    pub env: Vec<(String, String)>,
}

impl CommandSpec {
    fn new(program: &str, args: &[&str]) -> Self {
        Self {
            program: program.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: None,
            stdin: None,
            new_console: false,
            env: Vec::new(),
        }
    }

    pub fn to_command(&self) -> std::process::Command {
        let mut c = std::process::Command::new(&self.program);
        c.args(&self.args);
        c.envs(self.env.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        if let Some(d) = &self.cwd {
            c.current_dir(d);
        }
        #[cfg(windows)]
        if self.new_console {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            c.creation_flags(CREATE_NEW_CONSOLE);
        }
        c.stdin(if self.stdin.is_some() {
            std::process::Stdio::piped()
        } else {
            std::process::Stdio::null()
        });
        c
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CmdError {
    #[error("working directory must be an absolute, existing directory")]
    BadDirectory,
    #[error("program name is not allowed")]
    BadProgram,
    #[error("target not allowed")]
    BadTarget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Mac,
    Windows,
    Linux,
}

impl Platform {
    pub const fn current() -> Self {
        if cfg!(target_os = "macos") {
            Platform::Mac
        } else if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }
}

/// A program name for `openTerminal.program`: a bare executable name or an absolute path, nothing
/// that a shell would interpret.
fn valid_program(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 256
        && !p.chars().any(|c| {
            matches!(
                c,
                ';' | '&' | '|' | '`' | '$' | '<' | '>' | '\n' | '\r' | '"' | '\''
            )
        })
}

/// Terminal launch candidates, in order. The caller tries each until one spawns.
/// `program`/`args` (optional) are run inside the terminal as an argv, never as a shell string.
pub fn open_terminal_candidates(
    platform: Platform,
    cwd: &Path,
    program: Option<&str>,
    args: &[String],
) -> Result<Vec<CommandSpec>, CmdError> {
    if !is_local_path(cwd) {
        return Err(CmdError::BadDirectory);
    }
    if let Some(p) = program
        && !valid_program(p)
    {
        return Err(CmdError::BadProgram);
    }
    let dir = cwd.to_string_lossy().to_string();
    let mut out = Vec::new();
    match platform {
        Platform::Mac => {
            // `open -a Terminal <dir>` opens a new window in that directory. Running a program inside
            // Terminal.app would require AppleScript, which R8 forbids, so `program` opens the dir only.
            out.push(CommandSpec::new("open", &["-a", "Terminal", &dir]));
        }
        Platform::Windows => {
            // Windows Terminal treats `;` as its own command separator, so escape it (`\;`).
            let wt_escape = |s: &str| s.replace(';', "\\;");
            let mut wt = CommandSpec::new("wt", &["-d", &wt_escape(&dir)]);
            if let Some(p) = program {
                wt.args.push("--".into());
                wt.args.push(wt_escape(p));
                wt.args.extend(args.iter().map(|a| wt_escape(a)));
            }
            out.push(wt);
            // Fallback without any command-line parsing by cmd.exe: the directory is the child's
            // working directory (set through the API), and the program — if any — is started
            // directly in a new console. `cmd /K` only ever receives the constant `/K`.
            let mut fallback = match program {
                Some(p) => {
                    let mut s = CommandSpec::new(p, &[]);
                    s.args.extend(args.iter().cloned());
                    s
                }
                None => CommandSpec::new("cmd", &["/K"]),
            };
            fallback.cwd = Some(cwd.to_path_buf());
            fallback.new_console = true;
            out.push(fallback);
        }
        Platform::Linux => {
            let mut x = CommandSpec::new("x-terminal-emulator", &[]);
            x.cwd = Some(cwd.to_path_buf());
            if let Some(p) = program {
                x.args.push("-e".into());
                x.args.push(p.into());
                x.args.extend(args.iter().cloned());
            }
            out.push(x);
            let mut g =
                CommandSpec::new("gnome-terminal", &[&format!("--working-directory={dir}")]);
            if let Some(p) = program {
                g.args.push("--".into());
                g.args.push(p.into());
                g.args.extend(args.iter().cloned());
            }
            out.push(g);
        }
    }
    Ok(out)
}

/// OS text-to-speech. The text never appears in argv or in script source: it is written to stdin.
pub fn system_speak_candidates(
    platform: Platform,
    text: &str,
    locale: &str,
    rate: f32,
) -> Vec<CommandSpec> {
    let rate = rate.clamp(0.5, 2.0);
    let it = locale.starts_with("it");
    match platform {
        Platform::Mac => {
            // `say` reads from stdin when no text argument is given (`-f -`).
            let wpm = ((175.0 * rate).round() as i32).to_string();
            let mut say = CommandSpec::new("say", &["-r", &wpm, "-f", "-"]);
            if it {
                say.args
                    .splice(0..0, ["-v".to_string(), "Alice".to_string()]);
            }
            say.stdin = Some(text.into());
            vec![say]
        }
        Platform::Windows => {
            // A *constant* script reads the text from stdin; rate/culture are validated numbers/tags
            // passed through environment variables. No user data is ever interpolated into the script.
            const SCRIPT: &str = "Add-Type -AssemblyName System.Speech; \
                $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
                $s.Rate = [int]$env:JARVIS_TTS_RATE; \
                $c = [string]$env:JARVIS_TTS_CULTURE; \
                $v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like ($c + '*') } | Select-Object -First 1; \
                if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; \
                $t = [Console]::In.ReadToEnd(); \
                $s.Speak($t)";
            let sapi_rate = (((rate - 1.0) * 10.0).round() as i32)
                .clamp(-10, 10)
                .to_string();
            let culture = if it { "it" } else { "en" };
            let mut ps = CommandSpec::new(
                "powershell",
                &["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
            );
            ps.env = vec![
                ("JARVIS_TTS_RATE".into(), sapi_rate),
                ("JARVIS_TTS_CULTURE".into(), culture.into()),
            ];
            ps.stdin = Some(text.into());
            vec![ps]
        }
        Platform::Linux => {
            let lang = if it { "it" } else { "en" };
            let spd_rate = (((rate - 1.0) * 100.0).round() as i32)
                .clamp(-100, 100)
                .to_string();
            // spd-say reads stdin with `-e`; espeak-ng with `--stdin`.
            let mut spd = CommandSpec::new("spd-say", &["-w", "-e", "-l", lang, "-r", &spd_rate]);
            spd.stdin = Some(text.into());
            let wpm = ((175.0 * rate).round() as i32).to_string();
            let mut esp = CommandSpec::new("espeak-ng", &["-v", lang, "-s", &wpm, "--stdin"]);
            esp.stdin = Some(text.into());
            vec![spd, esp]
        }
    }
}

/// `host.open` target validation (defence in depth on top of the sidecar's own policy):
/// - http/https URLs are opened in the browser;
/// - local paths (and `file://` URLs) are canonicalised (symlinks resolved); an existing regular
///   file is opened only if its extension is a viewable document type; a directory is *revealed*
///   in the file manager, never "opened". Executables, scripts, shortcuts and bundles
///   (.exe, .bat, .lnk, .app, .command …) are therefore never launched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenTarget {
    Url(String),
    /// A viewable document (canonical path).
    File(PathBuf),
    /// A directory to show in the file manager (canonical path).
    Reveal(PathBuf),
}

pub const OPENABLE_EXTENSIONS: [&str; 13] = [
    "html", "htm", "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "json", "csv",
];

/// True for an absolute path on a *local* volume. Checked lexically, before any filesystem access:
/// on Windows, touching a UNC / device path (`\\host\share`, `\\?\UNC\…`, `\\.\pipe\…`) makes the OS
/// contact the remote host and can leak the user's NTLM hash.
pub fn is_local_path(p: &Path) -> bool {
    if !p.is_absolute() || p.to_string_lossy().contains('\0') {
        return false;
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        match p.components().next() {
            Some(Component::Prefix(pre)) => {
                matches!(pre.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
            }
            _ => false,
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// `file://` URLs must not name a remote host.
fn local_file_url(u: &url::Url) -> bool {
    matches!(u.host_str(), None | Some("") | Some("localhost"))
}

fn validate_local_path(p: &Path) -> Result<OpenTarget, CmdError> {
    if !is_local_path(p) {
        return Err(CmdError::BadTarget);
    }
    let canon = p.canonicalize().map_err(|_| CmdError::BadTarget)?;
    // A local-looking path can still resolve to a network location (mapped drive, symlink).
    if !is_local_path(&canon) {
        return Err(CmdError::BadTarget);
    }
    let meta = std::fs::metadata(&canon).map_err(|_| CmdError::BadTarget)?;
    if meta.is_dir() {
        // macOS bundles are directories too (`Foo.app`): revealing them is harmless, but never open.
        return Ok(OpenTarget::Reveal(canon));
    }
    if !meta.is_file() {
        return Err(CmdError::BadTarget);
    }
    let ext = canon
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(CmdError::BadTarget)?;
    if OPENABLE_EXTENSIONS.contains(&ext.as_str()) {
        Ok(OpenTarget::File(canon))
    } else {
        Err(CmdError::BadTarget)
    }
}

pub fn validate_open_target(target: &str, kind: &str) -> Result<OpenTarget, CmdError> {
    match kind {
        "url" => {
            let u = url::Url::parse(target).map_err(|_| CmdError::BadTarget)?;
            match u.scheme() {
                "http" | "https" => Ok(OpenTarget::Url(u.to_string())),
                "file" if local_file_url(&u) => {
                    validate_local_path(&u.to_file_path().map_err(|_| CmdError::BadTarget)?)
                }
                _ => Err(CmdError::BadTarget),
            }
        }
        "path" => validate_local_path(Path::new(target)),
        _ => Err(CmdError::BadTarget),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from("C:\\Users\\me\\My Project; rm -rf")
        } else {
            PathBuf::from("/home/me/My Project; rm -rf")
        }
    }

    #[test]
    fn terminal_uses_argv_with_the_directory_as_one_argument() {
        let dir = abs();
        let d = dir.to_string_lossy().to_string();
        let mac = open_terminal_candidates(Platform::Mac, &dir, None, &[]).unwrap();
        assert_eq!(mac[0].program, "open");
        assert_eq!(mac[0].args, vec!["-a", "Terminal", d.as_str()]);

        let win = open_terminal_candidates(Platform::Windows, &dir, None, &[]).unwrap();
        assert_eq!(win[0].program, "wt");
        assert_eq!(win[0].args, vec!["-d".to_string(), d.replace(';', "\\;")]);
        assert_eq!(win[1].program, "cmd");
        assert_eq!(
            win[1].args,
            vec!["/K"],
            "cmd.exe never parses the directory"
        );
        assert_eq!(win[1].cwd.as_deref(), Some(dir.as_path()));
        assert!(win[1].new_console);

        let lin = open_terminal_candidates(Platform::Linux, &dir, None, &[]).unwrap();
        assert_eq!(lin[0].program, "x-terminal-emulator");
        assert_eq!(lin[0].cwd.as_deref(), Some(dir.as_path()));
        assert_eq!(lin[1].args, vec![format!("--working-directory={d}")]);
    }

    #[test]
    fn terminal_program_and_args_stay_separate() {
        let dir = abs();
        let args = vec!["--resume".to_string(), "a b; c".to_string()];
        let win = open_terminal_candidates(Platform::Windows, &dir, Some("claude"), &args).unwrap();
        assert_eq!(&win[0].args[2..], &["--", "claude", "--resume", "a b\\; c"]);
        assert_eq!(win[1].program, "claude");
        assert_eq!(win[1].args, args, "fallback starts the program directly");
        let lin = open_terminal_candidates(Platform::Linux, &dir, Some("claude"), &args).unwrap();
        assert_eq!(&lin[0].args, &["-e", "claude", "--resume", "a b; c"]);
    }

    #[test]
    fn terminal_rejects_relative_dirs_and_shell_metachars_in_program() {
        assert_eq!(
            open_terminal_candidates(Platform::Linux, Path::new("relative"), None, &[]),
            Err(CmdError::BadDirectory)
        );
        for p in ["rm -rf /; x", "a|b", "$(id)", "`id`", "a&b"] {
            assert_eq!(
                open_terminal_candidates(Platform::Linux, &abs(), Some(p), &[]),
                Err(CmdError::BadProgram),
                "{p}"
            );
        }
    }

    #[test]
    fn speech_text_goes_to_stdin_never_argv() {
        let evil = "\"; Remove-Item -Recurse C:\\ ; $(whoami) `id`";
        for platform in [Platform::Mac, Platform::Windows, Platform::Linux] {
            for spec in system_speak_candidates(platform, evil, "it-IT", 1.3) {
                assert_eq!(spec.stdin.as_deref(), Some(evil));
                assert!(
                    spec.args.iter().all(|a| !a.contains("whoami")),
                    "{platform:?}: text leaked into argv"
                );
            }
        }
        let win = &system_speak_candidates(Platform::Windows, "x", "en", 1.0)[0];
        assert_eq!(win.args.len(), 4, "script is a constant; no extra argv");
        assert!(win.env.contains(&("JARVIS_TTS_RATE".into(), "0".into())));
        assert!(
            win.env
                .contains(&("JARVIS_TTS_CULTURE".into(), "en".into()))
        );
    }

    #[test]
    fn open_targets_are_restricted() {
        assert_eq!(
            validate_open_target("https://example.com/a?b=c", "url"),
            Ok(OpenTarget::Url("https://example.com/a?b=c".into()))
        );
        for bad in [
            "javascript:alert(1)",
            "smb://host/share",
            "ms-settings:",
            "not a url",
            "jarvis://home",
        ] {
            assert_eq!(
                validate_open_target(bad, "url"),
                Err(CmdError::BadTarget),
                "{bad}"
            );
        }
        assert_eq!(
            validate_open_target("relative/file", "path"),
            Err(CmdError::BadTarget)
        );
        assert_eq!(
            validate_open_target(&abs().to_string_lossy(), "path"),
            Err(CmdError::BadTarget),
            "non-existent path"
        );
        assert_eq!(validate_open_target("x", "exe"), Err(CmdError::BadTarget));
    }

    fn temp_dir() -> PathBuf {
        let mut b = [0u8; 8];
        getrandom::fill(&mut b).unwrap();
        let d = std::env::temp_dir().join(format!("jarvis-open-{}", hex::encode(b)));
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    #[test]
    fn local_files_only_open_viewable_documents() {
        let dir = temp_dir();
        let html = dir.join("Result Page.HTML");
        std::fs::write(&html, "<p>ok</p>").unwrap();
        assert_eq!(
            validate_open_target(&html.to_string_lossy(), "path"),
            Ok(OpenTarget::File(html.clone()))
        );
        let file_url = url::Url::from_file_path(&html).unwrap();
        assert_eq!(
            validate_open_target(file_url.as_str(), "url"),
            Ok(OpenTarget::File(html.clone()))
        );
        for name in [
            "run.exe",
            "x.bat",
            "x.cmd",
            "x.lnk",
            "x.command",
            "x.ps1",
            "x.sh",
            "noext",
        ] {
            let p = dir.join(name);
            std::fs::write(&p, "").unwrap();
            assert_eq!(
                validate_open_target(&p.to_string_lossy(), "path"),
                Err(CmdError::BadTarget),
                "{name}"
            );
            let u = url::Url::from_file_path(&p).unwrap();
            assert_eq!(
                validate_open_target(u.as_str(), "url"),
                Err(CmdError::BadTarget),
                "file:// {name}"
            );
        }
        // Directories (incl. .app bundles) are revealed, never opened.
        let app = dir.join("Evil.app");
        std::fs::create_dir_all(&app).unwrap();
        assert_eq!(
            validate_open_target(&app.to_string_lossy(), "path"),
            Ok(OpenTarget::Reveal(app.clone()))
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_a_disallowed_file_is_rejected() {
        let dir = temp_dir();
        let target = dir.join("payload.command");
        std::fs::write(&target, "").unwrap();
        let link = dir.join("innocent.html");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(
            validate_open_target(&link.to_string_lossy(), "path"),
            Err(CmdError::BadTarget)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_urls_with_a_remote_host_are_rejected() {
        for u in [
            "file://evil-host/share/report.html",
            "file://10.0.0.5/c$/x.pdf",
        ] {
            assert_eq!(
                validate_open_target(u, "url"),
                Err(CmdError::BadTarget),
                "{u}"
            );
        }
        assert!(local_file_url(
            &url::Url::parse("file:///tmp/x.html").unwrap()
        ));
        assert!(local_file_url(
            &url::Url::parse("file://localhost/tmp/x.html").unwrap()
        ));
    }

    #[cfg(windows)]
    #[test]
    fn windows_network_and_device_prefixes_are_rejected_lexically() {
        for p in [
            r"\\evil-host\share\report.html",
            r"\\?\UNC\evil-host\share\report.html",
            r"\\.\pipe\x",
            r"\\?\GLOBALROOT\Device\x",
        ] {
            assert!(!is_local_path(Path::new(p)), "{p}");
            assert_eq!(
                validate_open_target(p, "path"),
                Err(CmdError::BadTarget),
                "{p}"
            );
            assert_eq!(
                open_terminal_candidates(Platform::Windows, Path::new(p), None, &[]),
                Err(CmdError::BadDirectory),
                "{p}"
            );
        }
        assert!(is_local_path(Path::new(r"C:\Users\me")));
        assert!(is_local_path(Path::new(r"\\?\C:\Users\me")));
        assert!(
            !is_local_path(Path::new(r"\Users\me")),
            "drive-relative is not absolute"
        );
    }

    #[cfg(windows)]
    #[test]
    fn symlink_to_a_disallowed_file_is_rejected() {
        let dir = temp_dir();
        let target = dir.join("payload.exe");
        std::fs::write(&target, "").unwrap();
        let link = dir.join("innocent.html");
        // Creating symlinks needs Developer Mode or admin on Windows; skip when unavailable.
        if std::os::windows::fs::symlink_file(&target, &link).is_ok() {
            assert_eq!(
                validate_open_target(&link.to_string_lossy(), "path"),
                Err(CmdError::BadTarget)
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
