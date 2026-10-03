//! Sidecar (`agent-host`) supervision — ADR 0002.
//!
//! - A fresh 256-bit launch token per spawn, passed in the environment (`JARVIS_LAUNCH_TOKEN`),
//!   never in argv (R6).
//! - `JARVIS_DATA_DIR` points the sidecar at the shared data dir.
//! - stdout is read until `JARVIS_READY <port>`; the endpoint is then published on a watch channel.
//! - If the process dies it is restarted with capped exponential backoff; it is killed on exit.
//! - Unix: the sidecar gets its own process group (R7) so its agents can be signalled together.

use crate::paths::{DATA_DIR_ENV, LAUNCH_TOKEN_ENV, READY_PREFIX};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, watch};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Endpoint {
    pub port: u16,
    pub token: String,
}

/// 32 random bytes from the OS CSPRNG, hex encoded.
pub fn new_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    hex::encode(buf)
}

/// Parses the single readiness line `JARVIS_READY <port>`.
pub fn parse_ready_line(line: &str) -> Option<u16> {
    let rest = line.trim().strip_prefix(READY_PREFIX)?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    rest.trim().parse::<u16>().ok().filter(|p| *p != 0)
}

pub fn backoff(attempt: u32) -> Duration {
    let ms = 500u64.saturating_mul(1u64 << attempt.min(6));
    Duration::from_millis(ms.min(30_000))
}

/// How to launch the sidecar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

/// The bundled binary sits next to the app executable (Tauri `externalBin` strips the target
/// triple). Debug builds fall back to running the TypeScript entry point with Bun.
pub fn resolve_launch(exe_dir: &Path, repo_root: Option<&Path>) -> Option<Launch> {
    let bin = exe_dir.join(format!("agent-host{}", std::env::consts::EXE_SUFFIX));
    if bin.is_file() {
        return Some(Launch {
            program: bin,
            args: vec![],
            cwd: None,
        });
    }
    let root = repo_root?;
    let entry = root.join("packages/agent-host/src/main.ts");
    entry.is_file().then(|| Launch {
        program: PathBuf::from("bun"),
        args: vec!["run".into(), entry.to_string_lossy().into_owned()],
        cwd: Some(root.to_path_buf()),
    })
}

pub fn dev_repo_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        p.canonicalize().ok()
    } else {
        None
    }
}

fn spawn(launch: &Launch, token: &str, data_dir: &Path) -> std::io::Result<Child> {
    let mut cmd = Command::new(&launch.program);
    cmd.args(&launch.args)
        .env(LAUNCH_TOKEN_ENV, token)
        .env(DATA_DIR_ENV, data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    if let Some(cwd) = &launch.cwd {
        cmd.current_dir(cwd);
    }
    #[cfg(unix)]
    cmd.process_group(0);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

/// Runs forever (until `shutdown` fires): spawn → wait for ready → publish → wait for exit → backoff.
pub async fn supervise(
    launch: Launch,
    data_dir: PathBuf,
    endpoint_tx: watch::Sender<Option<Endpoint>>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut attempt: u32 = 0;
    loop {
        let token = new_token();
        let mut child = match spawn(&launch, &token, &data_dir) {
            Ok(c) => c,
            Err(e) => {
                log::error!("sidecar spawn failed ({}): {e}", launch.program.display());
                let wait = backoff(attempt);
                attempt = attempt.saturating_add(1);
                tokio::select! {
                    _ = tokio::time::sleep(wait) => continue,
                    _ = &mut shutdown => return,
                }
            }
        };
        let stdout = child.stdout.take();
        let ready = async {
            let mut lines = BufReader::new(stdout?).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(port) = parse_ready_line(&line) {
                    return Some((port, lines));
                }
                log::info!("[agent-host] {line}");
            }
            None
        };
        let started = std::time::Instant::now();
        tokio::select! {
            r = tokio::time::timeout(Duration::from_secs(30), ready) => {
                match r {
                    Ok(Some((port, mut lines))) => {
                        log::info!("sidecar ready on 127.0.0.1:{port}");
                        let _ = endpoint_tx.send(Some(Endpoint { port, token: token.clone() }));
                        // Keep draining stdout so the child never blocks on a full pipe.
                        tokio::spawn(async move {
                            while let Ok(Some(line)) = lines.next_line().await {
                                log::info!("[agent-host] {line}");
                            }
                        });
                    }
                    _ => log::error!("sidecar did not report readiness"),
                }
            }
            _ = &mut shutdown => {
                let _ = child.kill().await;
                return;
            }
        }
        tokio::select! {
            status = child.wait() => {
                log::warn!("sidecar exited: {status:?}");
                let _ = endpoint_tx.send(None);
            }
            _ = &mut shutdown => {
                let _ = endpoint_tx.send(None);
                let _ = child.kill().await;
                return;
            }
        }
        // A sidecar that ran for a while resets the backoff.
        if started.elapsed() > Duration::from_secs(60) {
            attempt = 0;
        }
        let wait = backoff(attempt);
        attempt = attempt.saturating_add(1);
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = &mut shutdown => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_256_bit_hex_and_fresh() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn ready_line() {
        assert_eq!(parse_ready_line("JARVIS_READY 41234"), Some(41234));
        assert_eq!(parse_ready_line("JARVIS_READY 41234\r\n"), Some(41234));
        assert_eq!(parse_ready_line("JARVIS_READY0"), None);
        assert_eq!(parse_ready_line("JARVIS_READY 0"), None);
        assert_eq!(parse_ready_line("JARVIS_READY 70000"), None);
        assert_eq!(parse_ready_line("hello JARVIS_READY 1"), None);
        assert_eq!(parse_ready_line("JARVIS_READYX 1"), None);
    }

    #[test]
    fn backoff_is_capped() {
        assert_eq!(backoff(0), Duration::from_millis(500));
        assert_eq!(backoff(1), Duration::from_millis(1000));
        assert_eq!(backoff(20), Duration::from_millis(30_000));
    }

    #[test]
    fn launch_falls_back_to_bun_only_with_a_repo() {
        let tmp = std::env::temp_dir().join(format!("jarvis-launch-{}", new_token()));
        std::fs::create_dir_all(tmp.join("packages/agent-host/src")).unwrap();
        assert_eq!(resolve_launch(&tmp, None), None);
        std::fs::write(tmp.join("packages/agent-host/src/main.ts"), "").unwrap();
        let l = resolve_launch(&tmp, Some(&tmp)).unwrap();
        assert_eq!(l.program, PathBuf::from("bun"));
        assert_eq!(l.args[0], "run");
        let bin = tmp.join(format!("agent-host{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&bin, "").unwrap();
        assert_eq!(resolve_launch(&tmp, Some(&tmp)).unwrap().program, bin);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
