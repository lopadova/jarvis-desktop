//! Voice input: microphone → 16 kHz mono → wake word / VAD / Whisper → `voice.*` notifications.
//!
//! Raw microphone audio never leaves this process unless the user picked a cloud STT provider,
//! and then only after a command was captured (`voice.audio`) — security-model R11 / ADR 0002.
//! The microphone is opened only while something needs it (wake word, clap, a capture, the level
//! meter); the UI shows a persistent indicator whenever it is live.

pub mod clap;
pub mod frames;
pub mod fsm;
pub mod models;

#[cfg(feature = "voice")]
mod engine;

use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;

/// Receives everything the voice engine reports.
pub trait VoiceSink: Send + Sync + 'static {
    /// A JSON-RPC notification for the sidecar (`voice.*`).
    fn notify(&self, method: &str, params: serde_json::Value);
    /// Mic level for the UI meter (~20 Hz while monitoring or capturing).
    fn mic_level(&self, level: f32);
    /// Whether the microphone is currently open (R11 indicator).
    fn mic_open(&self, open: bool);
}

/// The subset of the sidecar settings the voice engine cares about (camelCase as in core settings.ts).
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceSettings {
    pub locale: String,
    pub stt: String,
    pub whisper_model: String,
    pub wake_word: bool,
    /// Also hear the wake word by transcribing short phrases (works for accents the keyword spotter misses).
    pub wake_by_recognition: bool,
    pub wake_on_clap: bool,
    pub conversation_mode: bool,
    pub conversation_window_ms: u64,
    pub echo_cancellation: bool,
    pub private_mode: bool,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            locale: "en".into(),
            stt: "local-whisper".into(),
            whisper_model: "small".into(),
            wake_word: true,
            wake_by_recognition: true,
            wake_on_clap: false,
            conversation_mode: true,
            conversation_window_ms: 6000,
            echo_cancellation: true,
            private_mode: false,
        }
    }
}

impl VoiceSettings {
    /// Cloud STT is honoured only outside private mode.
    pub fn local_stt(&self) -> bool {
        self.stt == "local-whisper" || self.private_mode
    }
}

pub enum VoiceCmd {
    Settings(VoiceSettings),
    Mode {
        mode: fsm::Mode,
        conversation_ms: Option<u64>,
    },
    PushToTalk(bool),
    Monitor(bool),
    ModelsChanged,
}

#[derive(Clone)]
pub struct VoiceHandle {
    #[cfg(feature = "voice")]
    tx: std::sync::mpsc::Sender<VoiceCmd>,
}

impl VoiceHandle {
    #[allow(unused_variables)]
    pub fn start(models_root: PathBuf, sink: Arc<dyn VoiceSink>) -> Self {
        #[cfg(feature = "voice")]
        {
            Self {
                tx: engine::start(models_root, sink),
            }
        }
        #[cfg(not(feature = "voice"))]
        {
            log::warn!(
                "built without the `voice` feature: wake word and local STT are unavailable"
            );
            Self {}
        }
    }

    #[allow(unused_variables)]
    pub fn send(&self, cmd: VoiceCmd) {
        #[cfg(feature = "voice")]
        let _ = self.tx.send(cmd);
    }
}

/// Enumerates input devices (for `--self-test`).
pub fn describe_input_devices() -> Vec<String> {
    #[cfg(feature = "voice")]
    {
        engine::describe_input_devices()
    }
    #[cfg(not(feature = "voice"))]
    {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_parse_from_core_shape_and_private_mode_forces_local_stt() {
        let s: VoiceSettings = serde_json::from_value(serde_json::json!({
            "locale": "it", "stt": "openai", "whisperModel": "base", "wakeWord": false,
            "privateMode": false, "unknownKey": 1
        }))
        .unwrap();
        assert_eq!(s.locale, "it");
        assert_eq!(s.whisper_model, "base");
        assert!(!s.wake_word);
        assert!(!s.local_stt());
        let private = VoiceSettings {
            private_mode: true,
            ..s
        };
        assert!(private.local_stt());
    }
}
