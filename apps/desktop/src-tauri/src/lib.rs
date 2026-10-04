//! Jarvis Desktop — the thin Rust shell (ADR 0001/0002).
//!
//! Owns windows, tray, global shortcuts, deep links, keyring, audio I/O and on-device voice, and
//! supervises the TypeScript sidecar (`agent-host`) that holds all product logic.

pub mod audio;
mod commands;
pub mod deeplink;
mod focus;
mod host;
mod ipc;
pub mod oscmd;
pub mod paths;
pub mod secrets;
mod selftest;
mod shell;
mod shortcuts;
pub mod sidecar;
mod surfaces;
mod tray;
pub mod voice;

use deeplink::DeepLinkTarget;
use serde_json::json;
use shell::{Shell, ShellRef};
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use surfaces::Surface;
use tauri::{AppHandle, Manager, RunEvent};
use voice::{VoiceHandle, VoiceSink};

/// Bridges voice-engine events to the sidecar (notifications) and to the webviews (Tauri events).
struct Sink {
    app: AppHandle,
}

impl VoiceSink for Sink {
    fn notify(&self, method: &str, params: serde_json::Value) {
        if let Some(shell) = self.app.try_state::<ShellRef>() {
            shell.notify(method, params);
        }
    }
    fn mic_level(&self, level: f32) {
        use tauri::Emitter;
        let _ = self.app.emit("voice://level", json!({ "level": level }));
    }
    fn mic_open(&self, open: bool) {
        if let Some(shell) = self.app.try_state::<ShellRef>() {
            shell
                .mic_open
                .store(open, std::sync::atomic::Ordering::Relaxed);
        }
        use tauri::Emitter;
        let _ = self.app.emit("voice://mic", json!({ "open": open }));
    }
}

fn handle_deep_link(app: &AppHandle, raw: &str) {
    match deeplink::parse_deep_link(raw) {
        Some(DeepLinkTarget::ShowHome) => surfaces::show(app, Surface::Home, None),
        Some(DeepLinkTarget::ShowSessions) => surfaces::show(app, Surface::Sessions, None),
        Some(DeepLinkTarget::OpenSettings { tab }) => surfaces::show(app, Surface::Settings, tab),
        Some(DeepLinkTarget::Pair { code: _ }) => {
            // Pairing is confirmed by the user in Settings › Integrations; the code is never trusted.
            surfaces::show(app, Surface::Settings, Some("integrations"));
        }
        None => log::warn!("ignored deep link (inert by design)"),
    }
}

pub fn run() {
    if std::env::args().any(|a| a == "--self-test") {
        // Release builds use the GUI subsystem: attach to the parent console so the report is visible.
        #[cfg(windows)]
        // SAFETY: no pointers; failure (no parent console) is harmless.
        unsafe {
            let _ = windows::Win32::System::Console::AttachConsole(
                windows::Win32::System::Console::ATTACH_PARENT_PROCESS,
            );
        }
        std::process::exit(selftest::run());
    }

    let (endpoint_tx, endpoint_rx) = tokio::sync::watch::channel(None);
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let shutdown_tx = Mutex::new(Some(shutdown_tx));
    let endpoint_tx = Mutex::new(Some(endpoint_tx));
    let shutdown_rx = Mutex::new(Some(shutdown_rx));

    let app = tauri::Builder::default()
        // Must be first: a second launch focuses the running instance (and forwards deep links).
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            surfaces::show(app, Surface::Home, None);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcuts::handle)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(shortcuts::Registered::default())
        .invoke_handler(tauri::generate_handler![
            commands::sidecar_endpoint,
            commands::shell_info,
            commands::show_window,
            commands::open_external,
            commands::push_to_talk,
            commands::mic_monitor,
            commands::model_status,
            commands::download_models,
            commands::set_shortcuts,
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let data_dir = paths::data_dir();
            let models_root = paths::models_dir();

            let audio_app = handle.clone();
            let audio = audio::start(move |ev| {
                let Some(shell) = audio_app.try_state::<ShellRef>() else {
                    return;
                };
                match ev {
                    audio::AudioEvent::Level(level) => {
                        shell.notify("voice.playbackLevel", json!({ "level": level }))
                    }
                    audio::AudioEvent::Ended(id) => {
                        shell.notify("voice.playbackEnded", json!({ "utteranceId": id }))
                    }
                }
            });
            let voice = VoiceHandle::start(
                models_root.clone(),
                Arc::new(Sink {
                    app: handle.clone(),
                }),
            );

            let shell: ShellRef = Arc::new(Shell {
                app: handle.clone(),
                endpoint: endpoint_rx.clone(),
                out: Mutex::new(None),
                pending: Mutex::new(Default::default()),
                next_id: AtomicU64::new(1),
                audio,
                voice,
                secrets: secrets::Secrets::new(secrets::Chunked::new(secrets::KeyringStore, 1000)),
                settings: Mutex::new(serde_json::Value::Null),
                speak_child: Mutex::new(None),
                busy: AtomicBool::new(false),
                mic_open: AtomicBool::new(false),
                models_root,
                materials: Mutex::new(Default::default()),
                downloading: AtomicBool::new(false),
            });
            app.manage(shell.clone());

            // Windows that should exist from the start (hidden); the rest are created on demand.
            for s in [Surface::Pill, Surface::Home] {
                let _ = surfaces::get_or_create(&handle, s);
            }
            tray::create(&handle, &shell)?;
            let conflicts =
                shortcuts::register(&handle, shortcuts::DEFAULT_PTT, shortcuts::DEFAULT_SESSIONS);
            if !conflicts.is_empty() {
                log::warn!("shortcut conflicts: {conflicts:?}");
            }

            // Deep links (R3: inert, UI navigation only).
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                #[cfg(all(debug_assertions, any(windows, target_os = "linux")))]
                let _ = app.deep_link().register_all();
                let h = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link(&h, url.as_str());
                    }
                });
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    for url in urls {
                        handle_deep_link(&handle, url.as_str());
                    }
                }
            }

            // Sidecar supervision + shell connection + focus watcher.
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_default();
            let repo_override = sidecar::repo_override();
            let prefer_repo = repo_override.is_some();
            let repo_root = repo_override.or_else(sidecar::dev_repo_root);
            match sidecar::resolve_launch(&exe_dir, repo_root.as_deref(), prefer_repo) {
                Some(launch) => {
                    let tx = endpoint_tx
                        .lock()
                        .expect("poisoned")
                        .take()
                        .expect("setup runs once");
                    let rx = shutdown_rx
                        .lock()
                        .expect("poisoned")
                        .take()
                        .expect("setup runs once");
                    tauri::async_runtime::spawn(sidecar::supervise(launch, data_dir, tx, rx));
                }
                None => log::error!("agent-host binary not found next to the executable"),
            }
            tauri::async_runtime::spawn(ipc::run(shell.clone()));
            tauri::async_runtime::spawn(focus::watch(shell.clone()));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Jarvis");

    app.run(move |app, event| match event {
        // Tray app: closing the last window keeps Jarvis running.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            if let Some(tx) = shutdown_tx.lock().expect("poisoned").take() {
                let _ = tx.send(());
            }
            if let Some(shell) = app.try_state::<ShellRef>() {
                shell.audio.send(audio::AudioCmd::Stop);
            }
            // Give the supervisor a moment to kill the sidecar.
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        _ => {}
    });
}
