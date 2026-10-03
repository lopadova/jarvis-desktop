//! Data-dir conventions shared with `packages/core/src/paths.ts` (pure functions + one resolver).

use std::path::PathBuf;

pub const LAUNCH_TOKEN_ENV: &str = "JARVIS_LAUNCH_TOKEN";
pub const DATA_DIR_ENV: &str = "JARVIS_DATA_DIR";
pub const READY_PREFIX: &str = "JARVIS_READY";
pub const MODELS_DIR: &str = "models";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Mac,
    Windows,
    Linux,
}

impl Os {
    pub const fn current() -> Self {
        if cfg!(target_os = "macos") {
            Os::Mac
        } else if cfg!(windows) {
            Os::Windows
        } else {
            Os::Linux
        }
    }
}

/// Mirrors `dataDir()` in paths.ts: env override, then the per-OS default.
pub fn data_dir_for(os: Os, env: &dyn Fn(&str) -> Option<String>, home: &str) -> PathBuf {
    if let Some(d) = env(DATA_DIR_ENV).filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    match os {
        Os::Mac => PathBuf::from(format!("{home}/Library/Application Support/Jarvis")),
        Os::Windows => {
            let appdata = env("APPDATA").unwrap_or_else(|| format!("{home}\\AppData\\Roaming"));
            PathBuf::from(format!("{appdata}\\Jarvis"))
        }
        Os::Linux => {
            let xdg = env("XDG_DATA_HOME").unwrap_or_else(|| format!("{home}/.local/share"));
            PathBuf::from(format!("{xdg}/jarvis"))
        }
    }
}

fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into())
}

/// The data dir for this process, created with owner-only permissions on Unix (R6).
pub fn data_dir() -> PathBuf {
    let dir = data_dir_for(Os::current(), &|k| std::env::var(k).ok(), &home_dir());
    if std::fs::create_dir_all(&dir).is_ok() {
        restrict_permissions(&dir);
    }
    dir
}

pub fn models_dir() -> PathBuf {
    data_dir().join(MODELS_DIR)
}

#[cfg(unix)]
fn restrict_permissions(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn restrict_permissions(_dir: &std::path::Path) {
    // %APPDATA% is already per-user on Windows.
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_of(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |k| {
            pairs
                .iter()
                .find(|(n, _)| *n == k)
                .map(|(_, v)| v.to_string())
        }
    }

    #[test]
    fn matches_core_paths_ts() {
        let none = env_of(&[]);
        assert_eq!(
            data_dir_for(Os::Mac, &none, "/Users/a"),
            PathBuf::from("/Users/a/Library/Application Support/Jarvis")
        );
        assert_eq!(
            data_dir_for(Os::Linux, &none, "/home/a"),
            PathBuf::from("/home/a/.local/share/jarvis")
        );
        assert_eq!(
            data_dir_for(Os::Windows, &env_of(&[("APPDATA", "C:\\U\\R")]), "C:\\U"),
            PathBuf::from("C:\\U\\R\\Jarvis")
        );
        assert_eq!(
            data_dir_for(Os::Linux, &env_of(&[("XDG_DATA_HOME", "/x")]), "/home/a"),
            PathBuf::from("/x/jarvis")
        );
        assert_eq!(
            data_dir_for(
                Os::Mac,
                &env_of(&[("JARVIS_DATA_DIR", "/tmp/j")]),
                "/Users/a"
            ),
            PathBuf::from("/tmp/j")
        );
    }
}
