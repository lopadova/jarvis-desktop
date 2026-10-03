//! Tray icon + menu (brief S6). The icon is drawn procedurally (orb glyph, monochrome template on
//! macOS) with a "busy" variant that adds a small dot; the final assets come from the design work.

use crate::shell::ShellRef;
use crate::surfaces::{self, Surface};
use serde_json::json;
use std::sync::atomic::Ordering;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub const TRAY_ID: &str = "jarvis";

struct Labels {
    home: &'static str,
    sessions: &'static str,
    hands_free: &'static str,
    private: &'static str,
    settings: &'static str,
    quit: &'static str,
}

fn labels(locale: &str) -> Labels {
    if locale.starts_with("it") {
        Labels {
            home: "Mostra Home",
            sessions: "Mostra/nascondi sessioni",
            hands_free: "Mani libere (“Jarvis”)",
            private: "Modalità privata",
            settings: "Impostazioni…",
            quit: "Esci da Jarvis",
        }
    } else {
        Labels {
            home: "Show Home",
            sessions: "Show/Hide Sessions",
            hands_free: "Hands-free (“Jarvis”)",
            private: "Private mode",
            settings: "Settings…",
            quit: "Quit Jarvis",
        }
    }
}

/// 32×32 RGBA orb: a filled disc with a soft edge; `busy` adds a dot at the bottom-right.
pub fn icon_rgba(busy: bool) -> Vec<u8> {
    const N: usize = 32;
    let mut px = vec![0u8; N * N * 4];
    let c = (N as f32 - 1.0) / 2.0;
    for y in 0..N {
        for x in 0..N {
            let (dx, dy) = (x as f32 - c, y as f32 - c);
            let d = (dx * dx + dy * dy).sqrt();
            let mut a = ((11.5 - d).clamp(0.0, 1.0) * 255.0) as u8;
            if busy {
                let (bx, by) = (x as f32 - 26.0, y as f32 - 26.0);
                let bd = (bx * bx + by * by).sqrt();
                // Cut a ring around the dot, then draw the dot.
                if bd < 7.0 {
                    a = 0;
                }
                if bd < 4.5 {
                    a = 255;
                }
            }
            let i = (y * N + x) * 4;
            // macOS uses it as a template (only alpha matters); elsewhere a light glyph suits dark taskbars.
            let rgb = if cfg!(target_os = "macos") {
                [0, 0, 0]
            } else {
                [222, 238, 250]
            };
            px[i..i + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], a]);
        }
    }
    px
}

fn icon(busy: bool) -> Image<'static> {
    Image::new_owned(icon_rgba(busy), 32, 32)
}

fn build_menu(app: &AppHandle, shell: &ShellRef) -> tauri::Result<Menu<Wry>> {
    let l = labels(&shell.setting_str("locale", "en"));
    let hands_free = shell.setting_bool("wakeWord", true);
    let private = shell.setting_bool("privateMode", false);
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "home", l.home, true, None::<&str>)?,
            &MenuItem::with_id(app, "sessions", l.sessions, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &CheckMenuItem::with_id(
                app,
                "hands-free",
                l.hands_free,
                true,
                hands_free,
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(app, "private", l.private, true, private, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", l.settings, true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", l.quit, true, None::<&str>)?,
        ],
    )
}

pub fn create(app: &AppHandle, shell: &ShellRef) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, shell)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon(false))
        .icon_as_template(true)
        .tooltip("Jarvis")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                surfaces::show(tray.app_handle(), Surface::Home, None);
            }
        })
        .build(app)
}

fn on_menu(app: &AppHandle, id: &str) {
    let Some(shell) = app.try_state::<ShellRef>().map(|s| s.inner().clone()) else {
        return;
    };
    match id {
        "home" => surfaces::show(app, Surface::Home, None),
        "sessions" => surfaces::toggle_sessions(app),
        "settings" => surfaces::show(app, Surface::Settings, None),
        "hands-free" | "private" => {
            let key = if id == "hands-free" {
                "wakeWord"
            } else {
                "privateMode"
            };
            let default = id == "hands-free";
            let next = !shell.setting_bool(key, default);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = shell
                    .request("settings.update", json!({ "patch": { key: next } }))
                    .await
                {
                    log::warn!("tray toggle {key}: {e}");
                }
                // The ui.settings broadcast refreshes the check marks; re-sync now in case it failed.
                refresh(&shell);
            });
        }
        "quit" => app.exit(0),
        _ => {}
    }
}

/// Re-applies labels, check states and the busy icon.
pub fn refresh(shell: &ShellRef) {
    let app = shell.app.clone();
    let shell = shell.clone();
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(tray) = app2.tray_by_id(TRAY_ID) else {
            return;
        };
        if let Ok(menu) = build_menu(&app2, &shell) {
            let _ = tray.set_menu(Some(menu));
        }
        let _ = tray.set_icon(Some(icon(shell.busy.load(Ordering::Relaxed))));
        let _ = tray.set_icon_as_template(true);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_icon_differs_and_has_a_dot() {
        let idle = icon_rgba(false);
        let busy = icon_rgba(true);
        assert_eq!(idle.len(), 32 * 32 * 4);
        assert_ne!(idle, busy);
        let alpha = |v: &[u8], x: usize, y: usize| v[(y * 32 + x) * 4 + 3];
        assert_eq!(alpha(&idle, 16, 16), 255, "orb centre is opaque");
        assert_eq!(alpha(&busy, 26, 26), 255, "busy dot");
        assert_eq!(alpha(&idle, 0, 0), 0, "corners transparent");
    }

    #[test]
    fn tray_labels_are_localised() {
        assert_eq!(labels("it").quit, "Esci da Jarvis");
        assert_eq!(labels("en").settings, "Settings…");
    }
}
