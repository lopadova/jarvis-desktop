//! The five webview windows (one Vite app, hash routes) and their OS materials.

use crate::shell::ShellRef;
use serde_json::json;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Pill,
    Sessions,
    Home,
    Settings,
    Onboarding,
}

impl Surface {
    pub const ALL: [Surface; 5] = [
        Surface::Pill,
        Surface::Sessions,
        Surface::Home,
        Surface::Settings,
        Surface::Onboarding,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Surface::Pill => "pill",
            Surface::Sessions => "sessions",
            Surface::Home => "home",
            Surface::Settings => "settings",
            Surface::Onboarding => "onboarding",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|x| x.label() == s)
    }
}

/// Logical sizes (brief §5). The pill/sessions windows are larger than their content because the
/// content is a floating card inside a transparent window.
const PILL: (f64, f64) = (576.0, 440.0);
const SESSIONS: (f64, f64) = (396.0, 640.0);
const MARGIN: f64 = 24.0;

fn builder<'a>(
    app: &'a AppHandle,
    s: Surface,
    route: &str,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(
        app,
        s.label(),
        WebviewUrl::App(format!("index.html#/{route}").into()),
    )
    .title("Jarvis")
    .visible(false)
}

fn create(app: &AppHandle, s: Surface) -> tauri::Result<WebviewWindow> {
    let w = match s {
        Surface::Pill => builder(app, s, "pill")
            .inner_size(PILL.0, PILL.1)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .focusable(false)
            .visible_on_all_workspaces(true)
            .build()?,
        Surface::Sessions => builder(app, s, "sessions")
            .inner_size(SESSIONS.0, SESSIONS.1)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .build()?,
        Surface::Home => builder(app, s, "home")
            .inner_size(960.0, 680.0)
            .min_inner_size(720.0, 520.0)
            .decorations(false)
            .transparent(true)
            .center()
            .build()?,
        Surface::Settings => builder(app, s, "settings")
            .inner_size(820.0, 600.0)
            .min_inner_size(720.0, 520.0)
            .decorations(false)
            .transparent(true)
            .center()
            .build()?,
        Surface::Onboarding => builder(app, s, "onboarding")
            .inner_size(720.0, 560.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .center()
            .build()?,
    };
    let material = apply_material(&w, s);
    if let Some(shell) = app.try_state::<ShellRef>() {
        shell
            .materials
            .lock()
            .expect("poisoned")
            .insert(s.label().to_string(), material);
    }
    Ok(w)
}

/// macOS vibrancy / Windows 11 Mica for the rectangular windows; the floating pill and sessions
/// cards draw their own (solid) surface. Returns the material the UI should use.
#[allow(unused_variables)]
fn apply_material(w: &WebviewWindow, s: Surface) -> &'static str {
    if matches!(s, Surface::Pill | Surface::Sessions) {
        return "solid";
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{NSVisualEffectMaterial, apply_vibrancy};
        if apply_vibrancy(w, NSVisualEffectMaterial::Sidebar, None, Some(12.0)).is_ok() {
            return "glass";
        }
    }
    #[cfg(target_os = "windows")]
    {
        if window_vibrancy::apply_mica(w, None).is_ok() {
            return "glass";
        }
    }
    "solid"
}

pub fn get_or_create(app: &AppHandle, s: Surface) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window(s.label()) {
        return Some(w);
    }
    match create(app, s) {
        Ok(w) => Some(w),
        Err(e) => {
            log::error!("cannot create {} window: {e}", s.label());
            None
        }
    }
}

pub fn show(app: &AppHandle, s: Surface, tab: Option<&str>) {
    match s {
        Surface::Pill => return show_pill(app),
        Surface::Sessions => return show_sessions(app),
        _ => {}
    }
    let Some(w) = get_or_create(app, s) else {
        return;
    };
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    if let Some(tab) = tab.filter(|t| crate::deeplink::SETTINGS_TABS.contains(t)) {
        let _ = w.emit("shell://navigate", json!({ "tab": tab }));
    }
}

/// The monitor under the cursor (the "active" screen), falling back to the primary one.
fn active_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let by_cursor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten());
    by_cursor.or_else(|| app.primary_monitor().ok().flatten())
}

/// Top-centre of the active monitor, just below the menu bar (work area top), without focus steal.
pub fn show_pill(app: &AppHandle) {
    let Some(w) = get_or_create(app, Surface::Pill) else {
        return;
    };
    if let Some(m) = active_monitor(app) {
        let area = m.work_area();
        let scale = m.scale_factor();
        let width = PILL.0 * scale;
        let x = area.position.x as f64 + (area.size.width as f64 - width) / 2.0;
        let y = area.position.y as f64 + 12.0 * scale - 8.0 * scale;
        let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
    let _ = w.show();
}

pub fn show_sessions(app: &AppHandle) {
    let Some(w) = get_or_create(app, Surface::Sessions) else {
        return;
    };
    if let Some(m) = active_monitor(app) {
        let area = m.work_area();
        let scale = m.scale_factor();
        let x = area.position.x as f64 + area.size.width as f64 - (SESSIONS.0 + MARGIN) * scale;
        let y = area.position.y as f64 + MARGIN * scale;
        let height = (area.size.height as f64 * 0.7 / scale).min(SESSIONS.1);
        let _ = w.set_size(tauri::LogicalSize::new(SESSIONS.0, height));
        let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
    let _ = w.show();
}

pub fn toggle_sessions(app: &AppHandle) {
    match app.get_webview_window(Surface::Sessions.label()) {
        Some(w) if w.is_visible().unwrap_or(false) => {
            let _ = w.hide();
        }
        _ => show_sessions(app),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_round_trip() {
        for s in Surface::ALL {
            assert_eq!(Surface::parse(s.label()), Some(s));
        }
        assert_eq!(Surface::parse("devtools"), None);
    }
}
