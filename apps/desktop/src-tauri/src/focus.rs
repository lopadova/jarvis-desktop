//! `host.focusChanged` — best-effort "do not disturb" detection.
//!
//! - Windows: `SHQueryUserNotificationState` (busy / presentation / quiet time / D3D full screen).
//! - macOS / Linux: no stable public API for Focus / DND here yet → always `false` (follow-up).

use crate::shell::ShellRef;
use serde_json::json;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

static LAST: AtomicU8 = AtomicU8::new(2); // 2 = unknown

#[cfg(windows)]
pub fn do_not_disturb() -> bool {
    use windows::Win32::UI::Shell::{
        QUNS_ACCEPTS_NOTIFICATIONS, QUNS_APP, QUNS_NOT_PRESENT, SHQueryUserNotificationState,
    };
    // SAFETY: plain query with no pointers retained.
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => {
            !(state == QUNS_ACCEPTS_NOTIFICATIONS || state == QUNS_APP || state == QUNS_NOT_PRESENT)
        }
        Err(_) => false,
    }
}

#[cfg(not(windows))]
pub fn do_not_disturb() -> bool {
    false
}

/// Sends the current state unconditionally (on every new connection).
pub fn report_now(shell: &ShellRef) {
    let dnd = do_not_disturb();
    LAST.store(dnd as u8, Ordering::Relaxed);
    shell.notify("host.focusChanged", json!({ "doNotDisturb": dnd }));
}

/// Polls every 5 s and reports changes.
pub async fn watch(shell: ShellRef) {
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let dnd = do_not_disturb();
        if LAST.swap(dnd as u8, Ordering::Relaxed) != dnd as u8 {
            shell.notify("host.focusChanged", json!({ "doNotDisturb": dnd }));
        }
    }
}
