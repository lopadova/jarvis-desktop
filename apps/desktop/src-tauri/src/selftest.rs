//! `jarvis-desktop --self-test`: initialises the native subsystems without opening any window and
//! exits 0 when the essentials work (used in CI / headless verification).

use crate::secrets::KeyringStore;
use crate::voice::models;

pub fn run() -> i32 {
    let mut failures = 0;
    println!("jarvis-desktop {} self-test", env!("CARGO_PKG_VERSION"));

    let data = crate::paths::data_dir();
    println!("data dir      : {}", data.display());
    let models_root = crate::paths::models_dir();
    println!("models dir    : {}", models_root.display());
    for spec in [&models::KWS, &models::VAD, models::whisper_spec("small")] {
        println!(
            "  model {:<14}: {}",
            spec.id,
            if models::is_ready(&models_root, spec) {
                "ready"
            } else {
                "missing (downloaded on first run)"
            }
        );
    }

    match KeyringStore::status() {
        Ok(()) => println!("keyring       : ok (service {})", crate::secrets::SERVICE),
        Err(e) => {
            println!("keyring       : UNAVAILABLE ({e})");
            failures += 1;
        }
    }

    let devices = crate::voice::describe_input_devices();
    if cfg!(feature = "voice") {
        println!("input devices : {}", devices.len());
        for d in devices.iter().take(8) {
            println!("  - {d}");
        }
    } else {
        println!("input devices : (voice feature disabled)");
    }

    match rodio::DeviceSinkBuilder::open_default_sink() {
        Ok(mut s) => {
            s.log_on_drop(false);
            println!("audio output  : ok");
        }
        Err(e) => println!("audio output  : unavailable ({e})"),
    }

    println!(
        "voice feature : {}",
        if cfg!(feature = "voice") { "on" } else { "off" }
    );
    println!(
        "result        : {}",
        if failures == 0 { "PASS" } else { "FAIL" }
    );
    if failures == 0 { 0 } else { 1 }
}
