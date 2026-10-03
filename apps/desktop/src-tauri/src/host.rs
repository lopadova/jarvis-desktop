//! `host.*` request handlers (HostMethods in packages/core/src/ipc.ts) and sidecar notifications.

use crate::audio::{self, AudioCmd};
use crate::oscmd::{self, OpenTarget, Platform};
use crate::shell::ShellRef;
use crate::voice::fsm::Mode;
use crate::voice::{VoiceCmd, VoiceSettings};
use crate::{shortcuts, surfaces, tray};
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Write;
use std::sync::atomic::Ordering;
use tauri::Manager;

pub struct HostError {
    pub code: i64,
    pub message: String,
}

const INVALID_PARAMS: i64 = -32602;
const METHOD_NOT_FOUND: i64 = -32601;
const INTERNAL: i64 = -32603;
const NOT_AVAILABLE: i64 = -32002;

fn bad(msg: impl Into<String>) -> HostError {
    HostError {
        code: INVALID_PARAMS,
        message: msg.into(),
    }
}
fn internal(msg: impl ToString) -> HostError {
    HostError {
        code: INTERNAL,
        message: msg.to_string(),
    }
}
fn ok() -> Result<Value, HostError> {
    Ok(json!({ "ok": true }))
}

fn parse<T: for<'de> Deserialize<'de>>(params: Value) -> Result<T, HostError> {
    serde_json::from_value(params).map_err(|e| bad(e.to_string()))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, HostError> + Send + 'static,
) -> Result<T, HostError> {
    tokio::task::spawn_blocking(f).await.map_err(internal)?
}

#[derive(Deserialize)]
struct Key {
    key: String,
}
#[derive(Deserialize)]
struct KeyValue {
    key: String,
    value: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Begin {
    utterance_id: String,
    mime: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct End {
    utterance_id: String,
}
#[derive(Deserialize)]
struct Pause {
    paused: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Speak {
    text: String,
    locale: String,
    rate: f32,
    utterance_id: String,
}
#[derive(Deserialize)]
struct Open {
    target: String,
    kind: String,
}
#[derive(Deserialize)]
struct Terminal {
    cwd: String,
    program: Option<String>,
    #[serde(default)]
    args: Vec<String>,
}
#[derive(Deserialize)]
struct Notify {
    title: String,
    body: String,
}
#[derive(Deserialize)]
struct TypeText {
    text: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Listening {
    mode: String,
    conversation_ms: Option<u64>,
}
#[derive(Deserialize)]
struct ShowWindow {
    window: String,
    tab: Option<String>,
}

pub async fn dispatch(shell: &ShellRef, method: &str, params: Value) -> Result<Value, HostError> {
    match method {
        "host.secret.get" => {
            let p: Key = parse(params)?;
            let s = shell.clone();
            let v = blocking(move || s.secrets.get(&p.key).map_err(|e| bad(e.to_string()))).await?;
            Ok(json!({ "value": v }))
        }
        "host.secret.set" => {
            let p: KeyValue = parse(params)?;
            let s = shell.clone();
            blocking(move || {
                s.secrets
                    .set(&p.key, &p.value)
                    .map_err(|e| bad(e.to_string()))
            })
            .await?;
            ok()
        }
        "host.secret.delete" => {
            let p: Key = parse(params)?;
            let s = shell.clone();
            blocking(move || s.secrets.delete(&p.key).map_err(|e| bad(e.to_string()))).await?;
            ok()
        }
        "host.audio.begin" => {
            let p: Begin = parse(params)?;
            if p.utterance_id.len() != crate::ipc::UTTERANCE_ID_LEN {
                return Err(bad("utteranceId must be 16 characters"));
            }
            let format = audio::parse_mime(&p.mime).ok_or_else(|| bad("unsupported mime"))?;
            shell.audio.send(AudioCmd::Begin {
                id: p.utterance_id,
                format,
            });
            ok()
        }
        "host.audio.end" => {
            let p: End = parse(params)?;
            shell.audio.send(AudioCmd::End { id: p.utterance_id });
            ok()
        }
        "host.audio.stop" => {
            shell.audio.send(AudioCmd::Stop);
            stop_speaking(shell);
            ok()
        }
        "host.audio.pause" => {
            let p: Pause = parse(params)?;
            shell.audio.send(AudioCmd::Pause(p.paused));
            ok()
        }
        "host.systemSpeak" => {
            let p: Speak = parse(params)?;
            system_speak(shell, p)?;
            ok()
        }
        "host.open" => {
            let p: Open = parse(params)?;
            let target =
                oscmd::validate_open_target(&p.target, &p.kind).map_err(|e| bad(e.to_string()))?;
            use tauri_plugin_opener::OpenerExt;
            let opener = shell.app.opener();
            match target {
                OpenTarget::Url(u) => opener.open_url(u, None::<&str>).map_err(internal)?,
                OpenTarget::File(p) => opener
                    .open_path(p.to_string_lossy(), None::<&str>)
                    .map_err(internal)?,
                OpenTarget::Reveal(p) => opener.reveal_item_in_dir(p).map_err(internal)?,
            }
            ok()
        }
        "host.openTerminal" => {
            let p: Terminal = parse(params)?;
            let cwd = std::path::PathBuf::from(&p.cwd);
            let candidates = oscmd::open_terminal_candidates(
                Platform::current(),
                &cwd,
                p.program.as_deref(),
                &p.args,
            )
            .map_err(|e| bad(e.to_string()))?;
            if !cwd.is_dir() {
                return Err(bad("cwd is not a directory"));
            }
            blocking(move || {
                for spec in &candidates {
                    if spec.to_command().spawn().is_ok() {
                        return Ok(());
                    }
                }
                Err(HostError {
                    code: NOT_AVAILABLE,
                    message: "no terminal emulator found".into(),
                })
            })
            .await?;
            ok()
        }
        "host.notify" => {
            let p: Notify = parse(params)?;
            use tauri_plugin_notification::NotificationExt;
            shell
                .app
                .notification()
                .builder()
                .title(truncate(&p.title, 80))
                .body(truncate(&p.body, 300))
                .show()
                .map_err(internal)?;
            ok()
        }
        "host.clipboard.read" => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            let text = shell.app.clipboard().read_text().ok();
            Ok(json!({ "text": text }))
        }
        "host.clipboard.write" => {
            use tauri_plugin_clipboard_manager::ClipboardExt;
            let p: TypeText = parse(params)?;
            if p.text.len() > MAX_CLIPBOARD_WRITE {
                return Err(bad("text too long"));
            }
            shell.app.clipboard().write_text(p.text).map_err(internal)?;
            ok()
        }
        "host.screenshot" => {
            let png = blocking(|| screenshot_primary().map_err(internal)).await?;
            Ok(json!({ "pngBase64": base64::engine::general_purpose::STANDARD.encode(png) }))
        }
        "host.typeText" => {
            let p: TypeText = parse(params)?;
            if p.text.len() > 4000 {
                return Err(bad("text too long"));
            }
            blocking(move || {
                use enigo::{Enigo, Keyboard, Settings};
                let mut e = Enigo::new(&Settings::default()).map_err(internal)?;
                e.text(&p.text).map_err(internal)
            })
            .await?;
            ok()
        }
        "host.setListening" => {
            let p: Listening = parse(params)?;
            let mode = Mode::parse(&p.mode).ok_or_else(|| bad("unknown mode"))?;
            shell.voice.send(VoiceCmd::Mode {
                mode,
                conversation_ms: p.conversation_ms,
            });
            shell.busy.store(mode == Mode::Busy, Ordering::Relaxed);
            tray::refresh(shell);
            ok()
        }
        "host.showWindow" => {
            let p: ShowWindow = parse(params)?;
            let label = surfaces::Surface::parse(&p.window).ok_or_else(|| bad("unknown window"))?;
            surfaces::show(&shell.app, label, p.tab.as_deref());
            ok()
        }
        _ => Err(HostError {
            code: METHOD_NOT_FOUND,
            message: format!("unknown method {method}"),
        }),
    }
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

fn stop_speaking(shell: &ShellRef) {
    if let Some(mut c) = shell.speak_child.lock().expect("poisoned").take() {
        let _ = c.kill();
    }
}

fn system_speak(shell: &ShellRef, p: Speak) -> Result<(), HostError> {
    if p.text.chars().count() > 5000 {
        return Err(bad("text too long"));
    }
    stop_speaking(shell);
    let candidates =
        oscmd::system_speak_candidates(Platform::current(), &p.text, &p.locale, p.rate);
    let mut spawned = None;
    for spec in &candidates {
        let mut cmd = spec.to_command();
        cmd.stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        if let Ok(mut child) = cmd.spawn() {
            if let (Some(text), Some(mut stdin)) = (&spec.stdin, child.stdin.take()) {
                let _ = stdin.write_all(text.as_bytes());
            }
            spawned = Some(child);
            break;
        }
    }
    let Some(child) = spawned else {
        return Err(HostError {
            code: NOT_AVAILABLE,
            message: "no system speech engine".into(),
        });
    };
    *shell.speak_child.lock().expect("poisoned") = Some(child);
    let s = shell.clone();
    let id = p.utterance_id;
    std::thread::spawn(move || {
        loop {
            let done = {
                let mut guard = s.speak_child.lock().expect("poisoned");
                match guard.as_mut() {
                    Some(c) => match c.try_wait() {
                        Ok(Some(_)) | Err(_) => {
                            guard.take();
                            true
                        }
                        Ok(None) => false,
                    },
                    None => true, // stopped
                }
            };
            if done {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        s.notify("voice.playbackEnded", json!({ "utteranceId": id }));
    });
    Ok(())
}

/// Largest text `host.clipboard.write` accepts (bytes; matches the `clipboard.write` IPC limit).
const MAX_CLIPBOARD_WRITE: usize = 80_000;
/// Screenshots sent to a vision brain stay below this size (PNG bytes); larger captures are downscaled.
pub const MAX_SCREENSHOT_BYTES: usize = 2 * 1024 * 1024;

/// Captures the primary monitor in memory (never written to disk) and returns a PNG ≤ `MAX_SCREENSHOT_BYTES`.
fn screenshot_primary() -> anyhow::Result<Vec<u8>> {
    let monitors = xcap::Monitor::all()?;
    let m = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or(monitors.first())
        .ok_or_else(|| anyhow::anyhow!("no monitor"))?;
    let img = image::DynamicImage::ImageRgba8(m.capture_image()?);
    png_within(img, MAX_SCREENSHOT_BYTES)
}

/// Encodes `img` as PNG, halving its longest side (from at most 2560 px) until it fits in `max_bytes`.
pub fn png_within(img: image::DynamicImage, max_bytes: usize) -> anyhow::Result<Vec<u8>> {
    let encode = |i: &image::DynamicImage| -> anyhow::Result<Vec<u8>> {
        let mut png = Vec::new();
        i.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
        Ok(png)
    };
    let mut current = if img.width().max(img.height()) > 2560 {
        img.resize(2560, 2560, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    loop {
        let png = encode(&current)?;
        if png.len() <= max_bytes {
            return Ok(png);
        }
        let (w, h) = (current.width(), current.height());
        if w.max(h) <= 320 {
            anyhow::bail!("screenshot does not fit in {max_bytes} bytes");
        }
        current = current.resize(
            (w / 2).max(1),
            (h / 2).max(1),
            image::imageops::FilterType::Triangle,
        );
    }
}

/// Settings snapshot from the sidecar (`settings.get` or `ui.settings`).
pub fn apply_settings(shell: &ShellRef, settings: Value) {
    let prev = std::mem::replace(
        &mut *shell.settings.lock().expect("poisoned"),
        settings.clone(),
    );
    if let Ok(v) = serde_json::from_value::<VoiceSettings>(settings.clone()) {
        shell.voice.send(VoiceCmd::Settings(v));
    }
    let changed = |k: &str| prev.get(k) != settings.get(k);
    if changed("pushToTalk") || changed("toggleSessions") {
        let ptt = shell.setting_str("pushToTalk", shortcuts::DEFAULT_PTT);
        let sessions = shell.setting_str("toggleSessions", shortcuts::DEFAULT_SESSIONS);
        let _ = shortcuts::register(&shell.app, &ptt, &sessions);
    }
    if changed("launchAtLogin") {
        use tauri_plugin_autostart::ManagerExt;
        let al = shell.app.autolaunch();
        let want = shell.setting_bool("launchAtLogin", false);
        let r = if want { al.enable() } else { al.disable() };
        if let Err(e) = r {
            log::warn!("autostart: {e}");
        }
    }
    if changed("onboardingComplete")
        && settings.get("onboardingComplete") == Some(&Value::Bool(false))
    {
        surfaces::show(&shell.app, surfaces::Surface::Onboarding, None);
    }
    tray::refresh(shell);
}

pub fn on_notification(shell: &ShellRef, method: &str, params: Option<&Value>) {
    match method {
        "ui.settings" => {
            if let Some(s) = params.and_then(|p| p.get("settings")) {
                apply_settings(shell, s.clone());
            }
        }
        "ui.pill" => {
            // Show the pill whenever there is something to show; hide it when it goes idle.
            let kind = params
                .and_then(|p| p.pointer("/state/kind"))
                .and_then(Value::as_str)
                .unwrap_or("hidden");
            let app = shell.app.clone();
            if kind == "hidden" {
                if let Some(w) = app.get_webview_window(surfaces::Surface::Pill.label()) {
                    let _ = w.hide();
                }
            } else {
                surfaces::show_pill(&app);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncation_is_char_safe() {
        assert_eq!(truncate("héllo", 2), "hé");
    }

    fn noise(w: u32, h: u32) -> image::DynamicImage {
        // Pseudo-random pixels compress badly, like a busy screen.
        let mut seed: u32 = 0x9e37_79b9;
        let img = image::RgbaImage::from_fn(w, h, |_, _| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let [a, b, c, _] = seed.to_le_bytes();
            image::Rgba([a, b, c, 255])
        });
        image::DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn small_screenshots_are_kept_as_is() {
        let png = png_within(noise(64, 48), MAX_SCREENSHOT_BYTES).unwrap();
        let back = image::load_from_memory(&png).unwrap();
        assert_eq!((back.width(), back.height()), (64, 48));
    }

    #[test]
    fn large_screenshots_are_downscaled_below_the_limit() {
        let limit = 200 * 1024;
        let png = png_within(noise(1600, 1000), limit).unwrap();
        assert!(png.len() <= limit, "{} > {limit}", png.len());
        let back = image::load_from_memory(&png).unwrap();
        assert!(back.width() < 1600);
        assert_eq!(back.width() * 1000 / 1600, back.height());
    }

    #[test]
    fn impossible_limits_fail_instead_of_looping() {
        assert!(png_within(noise(800, 600), 10).is_err());
    }
}
