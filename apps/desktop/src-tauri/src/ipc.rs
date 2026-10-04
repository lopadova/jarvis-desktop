//! The shell's WebSocket JSON-RPC client (role `shell`, ADR 0002).
//!
//! Connects to `ws://127.0.0.1:<port>/?role=shell` with the subprotocol `jarvis.<token>`, serves
//! `host.*` requests, receives `ui.settings` / `ui.pill`, streams TTS binary frames to the audio
//! thread, and reconnects whenever the sidecar restarts (new port + token).

use crate::audio::AudioCmd;
use crate::host;
use crate::shell::ShellRef;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

pub const UTTERANCE_ID_LEN: usize = 16;

pub fn subprotocol(token: &str) -> String {
    format!("jarvis.{token}")
}

/// Binary audio frame: `[16-byte ASCII utterance id][payload]`.
pub fn split_audio_frame(frame: &[u8]) -> Option<(String, &[u8])> {
    if frame.len() < UTTERANCE_ID_LEN {
        return None;
    }
    let (id, payload) = frame.split_at(UTTERANCE_ID_LEN);
    let id = std::str::from_utf8(id).ok()?;
    id.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        .then(|| (id.to_string(), payload))
}

pub fn rpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

pub async fn run(shell: ShellRef) {
    let mut endpoint_rx = shell.endpoint.clone();
    loop {
        let ep = endpoint_rx.borrow_and_update().clone();
        let Some(ep) = ep else {
            if endpoint_rx.changed().await.is_err() {
                return;
            }
            continue;
        };
        match connect_once(&shell, ep.port, &ep.token, &mut endpoint_rx).await {
            Ok(()) => log::info!("shell connection closed"),
            Err(e) => log::warn!("shell connection failed: {e}"),
        }
        *shell.out.lock().expect("poisoned") = None;
        shell.pending.lock().expect("poisoned").clear();
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

async fn connect_once(
    shell: &ShellRef,
    port: u16,
    token: &str,
    endpoint_rx: &mut tokio::sync::watch::Receiver<Option<crate::sidecar::Endpoint>>,
) -> anyhow::Result<()> {
    let mut req = format!("ws://127.0.0.1:{port}/?role=shell").into_client_request()?;
    req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&subprotocol(token))?,
    );
    let (ws, _resp) = tokio_tungstenite::connect_async(req).await?;
    log::info!("connected to sidecar as shell");
    let (mut sink, mut stream) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    *shell.out.lock().expect("poisoned") = Some(tx);

    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    // Initial sync: settings + focus state.
    {
        let s = shell.clone();
        tokio::spawn(async move {
            // A (re)started assistant process knows nothing about what the voice engine was doing: a mode left over
            // from a request that died with the old process (busy, speaking, conversation) would keep it deaf to the
            // wake word, so go back to idle and stop any half-played reply.
            s.voice.send(crate::voice::VoiceCmd::Mode {
                mode: crate::voice::fsm::Mode::Idle,
                conversation_ms: None,
            });
            s.audio.send(AudioCmd::Stop);
            if let Ok(res) = s.request("settings.get", json!({})).await
                && let Some(settings) = res.get("settings")
            {
                host::apply_settings(&s, settings.clone());
            }
            crate::focus::report_now(&s);
        });
    }

    let result = loop {
        tokio::select! {
            msg = stream.next() => {
                match msg {
                    Some(Ok(Message::Text(t))) => handle_text(shell, t.as_str()),
                    Some(Ok(Message::Binary(b))) => {
                        if let Some((id, payload)) = split_audio_frame(&b) {
                            shell.audio.send(AudioCmd::Data { id, bytes: payload.to_vec() });
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break Ok(()),
                    Some(Ok(_)) => {}
                    Some(Err(e)) => break Err(e.into()),
                }
            }
            changed = endpoint_rx.changed() => {
                // The supervisor restarted the sidecar: reconnect to the new endpoint.
                if changed.is_err() { break Ok(()); }
                break Ok(());
            }
        }
    };
    *shell.out.lock().expect("poisoned") = None;
    writer.abort();
    result
}

fn handle_text(shell: &ShellRef, text: &str) {
    let Ok(msg) = serde_json::from_str::<Value>(text) else {
        return;
    };
    let method = msg.get("method").and_then(Value::as_str);
    let id = msg.get("id").cloned();
    match (method, id) {
        (Some(method), Some(id)) => {
            let shell = shell.clone();
            let method = method.to_string();
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            tokio::spawn(async move {
                let reply = match host::dispatch(&shell, &method, params).await {
                    Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                    Err(e) => rpc_error(&id, e.code, &e.message),
                };
                if let Some(tx) = shell.out.lock().expect("poisoned").as_ref() {
                    let _ = tx.send(Message::text(reply.to_string()));
                }
            });
        }
        (Some(method), None) => host::on_notification(shell, method, msg.get("params")),
        (None, Some(id)) => {
            let key = match &id {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            if let Some(tx) = shell.pending.lock().expect("poisoned").remove(&key) {
                let r = match msg.get("error") {
                    Some(e) => Err(e
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("error")
                        .to_string()),
                    None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
                };
                let _ = tx.send(r);
            }
        }
        (None, None) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_frames_carry_a_16_char_id() {
        let mut f = b"0123456789abcdef".to_vec();
        f.extend_from_slice(&[1, 2, 3]);
        let (id, payload) = split_audio_frame(&f).unwrap();
        assert_eq!(id, "0123456789abcdef");
        assert_eq!(payload, &[1, 2, 3]);
        assert!(split_audio_frame(b"short").is_none());
        assert!(split_audio_frame(b"0123456789abcd\xff\xfe").is_none());
        assert!(split_audio_frame(b"0123456789 bcdef").is_none());
    }

    #[test]
    fn subprotocol_and_errors() {
        assert_eq!(subprotocol("abc"), "jarvis.abc");
        let e = rpc_error(&json!(7), -32601, "nope");
        assert_eq!(e["error"]["code"], -32601);
        assert_eq!(e["id"], 7);
    }
}
