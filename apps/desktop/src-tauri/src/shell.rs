//! Shared shell state (one per process, managed by Tauri).

use crate::audio::AudioHandle;
use crate::secrets::{Chunked, KeyringStore, Secrets};
use crate::sidecar::Endpoint;
use crate::voice::VoiceHandle;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;

pub struct Shell {
    pub app: AppHandle,
    pub endpoint: watch::Receiver<Option<Endpoint>>,
    pub out: Mutex<Option<mpsc::UnboundedSender<Message>>>,
    pub pending: Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>,
    pub next_id: AtomicU64,
    pub audio: AudioHandle,
    pub voice: VoiceHandle,
    pub secrets: Secrets<Chunked<KeyringStore>>,
    pub settings: Mutex<Value>,
    pub speak_child: Mutex<Option<std::process::Child>>,
    pub busy: AtomicBool,
    pub mic_open: AtomicBool,
    pub models_root: PathBuf,
    /// OS material actually applied per window label ("glass" | "solid").
    pub materials: Mutex<HashMap<String, &'static str>>,
    pub downloading: AtomicBool,
}

pub type ShellRef = Arc<Shell>;

impl Shell {
    /// Fire-and-forget JSON-RPC notification to the sidecar (dropped while disconnected).
    pub fn notify(&self, method: &str, params: Value) {
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        if let Some(tx) = self.out.lock().expect("poisoned").as_ref() {
            let _ = tx.send(Message::text(msg.to_string()));
        }
    }

    /// JSON-RPC request to the sidecar; resolves with `result` or an error string.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = format!("shell-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        {
            let out = self.out.lock().expect("poisoned");
            let Some(sender) = out.as_ref() else {
                return Err("sidecar not connected".into());
            };
            self.pending
                .lock()
                .expect("poisoned")
                .insert(id.clone(), tx);
            let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
            let _ = sender.send(Message::text(msg.to_string()));
        }
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(r)) => r,
            _ => {
                self.pending.lock().expect("poisoned").remove(&id);
                Err("timeout".into())
            }
        }
    }

    pub fn setting_bool(&self, key: &str, default: bool) -> bool {
        self.settings
            .lock()
            .expect("poisoned")
            .get(key)
            .and_then(Value::as_bool)
            .unwrap_or(default)
    }

    pub fn setting_str(&self, key: &str, default: &str) -> String {
        self.settings
            .lock()
            .expect("poisoned")
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or(default)
            .to_string()
    }
}
