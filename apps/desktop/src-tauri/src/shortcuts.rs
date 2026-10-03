//! Global shortcuts: push-to-talk (press = start capture, release = send) and sessions toggle.

use crate::shell::ShellRef;
use crate::surfaces;
use crate::voice::VoiceCmd;
use serde_json::json;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

pub const DEFAULT_PTT: &str = "Alt+Space";
pub const DEFAULT_SESSIONS: &str = "CommandOrControl+Shift+J";

#[derive(Default)]
pub struct Registered {
    pub ptt: Mutex<Option<Shortcut>>,
    pub sessions: Mutex<Option<Shortcut>>,
}

/// The plugin handler: dispatches by comparing against the currently registered shortcuts.
pub fn handle<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    let Some(reg) = app.try_state::<Registered>() else {
        return;
    };
    let is_ptt = reg.ptt.lock().expect("poisoned").as_ref() == Some(shortcut);
    let is_sessions = reg.sessions.lock().expect("poisoned").as_ref() == Some(shortcut);
    let pressed = event.state() == ShortcutState::Pressed;
    if is_ptt {
        if let Some(shell) = app.try_state::<ShellRef>() {
            shell.voice.send(VoiceCmd::PushToTalk(pressed));
        }
        let _ = app.emit("voice://ptt", json!({ "pressed": pressed }));
        if pressed && let Some(shell) = app.try_state::<ShellRef>() {
            surfaces::show_pill(&shell.app);
        }
    } else if is_sessions
        && pressed
        && let Some(shell) = app.try_state::<ShellRef>()
    {
        surfaces::toggle_sessions(&shell.app);
    }
}

/// (Re)registers both shortcuts; returns the accelerators that could not be registered (conflicts).
pub fn register(app: &AppHandle, ptt: &str, sessions: &str) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let reg = app.state::<Registered>();
    let mut conflicts = vec![];
    let mut one = |accel: &str, slot: &Mutex<Option<Shortcut>>| match accel.parse::<Shortcut>() {
        Ok(s) => match gs.register(s) {
            Ok(()) => *slot.lock().expect("poisoned") = Some(s),
            Err(e) => {
                log::warn!("shortcut {accel} unavailable: {e}");
                *slot.lock().expect("poisoned") = None;
                conflicts.push(accel.to_string());
            }
        },
        Err(_) => conflicts.push(accel.to_string()),
    };
    one(ptt, &reg.ptt);
    one(sessions, &reg.sessions);
    conflicts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_parse() {
        assert!(DEFAULT_PTT.parse::<Shortcut>().is_ok());
        assert!(DEFAULT_SESSIONS.parse::<Shortcut>().is_ok());
        assert!("NotAKey+Nope".parse::<Shortcut>().is_err());
    }
}
