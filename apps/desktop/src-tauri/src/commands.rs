//! Tauri commands invoked by the webviews (see `src/lib/tauri.ts`).

use crate::shell::ShellRef;
use crate::sidecar::Endpoint;
use crate::surfaces::{self, Surface};
use crate::voice::VoiceCmd;
use crate::voice::models::{self, ModelStatus};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

/// The sidecar endpoint for the UI's own WebSocket connection (role `ui`). Waits up to 15 s for
/// the sidecar to become ready.
#[tauri::command]
pub async fn sidecar_endpoint(shell: State<'_, ShellRef>) -> Result<Endpoint, String> {
    let mut rx = shell.endpoint.clone();
    let wait = async {
        loop {
            if let Some(ep) = rx.borrow_and_update().clone() {
                return Ok(ep);
            }
            if rx.changed().await.is_err() {
                return Err("sidecar supervisor stopped".to_string());
            }
        }
    };
    tokio::time::timeout(std::time::Duration::from_secs(15), wait)
        .await
        .map_err(|_| "sidecar not ready".to_string())?
}

#[derive(Serialize)]
pub struct ShellInfo {
    platform: &'static str,
    material: &'static str,
    version: &'static str,
}

#[tauri::command]
pub fn shell_info(window: WebviewWindow, shell: State<'_, ShellRef>) -> ShellInfo {
    let material = shell
        .materials
        .lock()
        .expect("poisoned")
        .get(window.label())
        .copied()
        .unwrap_or("solid");
    ShellInfo {
        platform: if cfg!(target_os = "macos") {
            "mac"
        } else if cfg!(windows) {
            "win"
        } else {
            "linux"
        },
        material,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
pub fn show_window(app: AppHandle, label: String, tab: Option<String>) -> Result<(), String> {
    let s = Surface::parse(&label).ok_or("unknown window")?;
    surfaces::show(&app, s, tab.as_deref());
    Ok(())
}

/// Pages the UI may open in the system browser (About links, the extension download). Anything else is refused,
/// so a compromised page cannot use this command to open arbitrary URLs.
const OPENABLE_PREFIXES: &[&str] = &["https://github.com/lopadova/jarvis-desktop"];

pub fn is_openable_url(url: &str) -> bool {
    OPENABLE_PREFIXES.iter().any(|p| {
        url.strip_prefix(p)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/') || rest.starts_with('#'))
    })
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !is_openable_url(&url) {
        return Err("this link is not allowed".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn push_to_talk(app: AppHandle, shell: State<'_, ShellRef>, pressed: bool) {
    shell.voice.send(VoiceCmd::PushToTalk(pressed));
    let _ = app.emit("voice://ptt", serde_json::json!({ "pressed": pressed }));
}

#[tauri::command]
pub fn mic_monitor(shell: State<'_, ShellRef>, enabled: bool) {
    shell.voice.send(VoiceCmd::Monitor(enabled));
}

pub(crate) fn needed_models(shell: &ShellRef) -> Vec<&'static models::ModelSpec> {
    let settings: Value = shell.settings.lock().expect("poisoned").clone();
    let whisper = settings
        .get("whisperModel")
        .and_then(Value::as_str)
        .unwrap_or("small")
        .to_string();
    let v: crate::voice::VoiceSettings = serde_json::from_value(settings).unwrap_or_default();
    models::needed(&whisper, v.local_stt())
}

/// Pushes the current on-device model status to the webviews (after the selected models change).
pub(crate) fn emit_model_status(shell: &ShellRef) {
    let statuses: Vec<ModelStatus> = needed_models(shell)
        .into_iter()
        .map(|m| ModelStatus::of(&shell.models_root, m))
        .collect();
    let _ = shell.app.emit("voice://models", statuses);
}

#[tauri::command]
pub fn model_status(shell: State<'_, ShellRef>) -> Vec<ModelStatus> {
    needed_models(&shell)
        .into_iter()
        .map(|m| ModelStatus::of(&shell.models_root, m))
        .collect()
}

#[tauri::command]
pub async fn download_models(app: AppHandle, shell: State<'_, ShellRef>) -> Result<(), String> {
    if shell.downloading.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let shell = shell.inner().clone();
    let specs = needed_models(&shell);
    let root = shell.models_root.clone();
    tauri::async_runtime::spawn(async move {
        let mut statuses: Vec<ModelStatus> =
            specs.iter().map(|m| ModelStatus::of(&root, m)).collect();
        for (i, spec) in specs.iter().enumerate() {
            let emit = |s: &Vec<ModelStatus>| {
                let _ = app.emit("voice://models", s);
            };
            let progress = |received: u64, total: u64, state: &'static str| {
                let mut s = statuses.clone();
                s[i].received = received;
                s[i].total = total;
                s[i].state = state;
                emit(&s);
            };
            let res = models::download(&root, spec, progress).await;
            statuses[i] = ModelStatus::of(&root, spec);
            if let Err(e) = res {
                log::warn!("model {} download failed: {e}", spec.id);
                statuses[i].state = "error";
                statuses[i].error = Some(e);
            }
            emit(&statuses);
        }
        shell.voice.send(VoiceCmd::ModelsChanged);
        shell.downloading.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Re-registers global shortcuts; returns the accelerators that conflict.
#[tauri::command]
pub fn set_shortcuts(app: AppHandle, push_to_talk: String, toggle_sessions: String) -> Vec<String> {
    crate::shortcuts::register(&app, &push_to_talk, &toggle_sessions)
}

#[cfg(test)]
mod open_tests {
    use super::is_openable_url;

    #[test]
    fn only_project_pages_are_openable() {
        assert!(is_openable_url(
            "https://github.com/lopadova/jarvis-desktop"
        ));
        assert!(is_openable_url(
            "https://github.com/lopadova/jarvis-desktop/releases/latest/download/jarvis.mcpb"
        ));
        assert!(!is_openable_url(
            "https://github.com/lopadova/jarvis-desktop.evil.com/x"
        ));
        assert!(!is_openable_url(
            "https://github.com/lopadova/jarvis-desktop-evil"
        ));
        assert!(!is_openable_url(
            "http://github.com/lopadova/jarvis-desktop"
        ));
        assert!(!is_openable_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_openable_url("javascript:alert(1)"));
    }
}
