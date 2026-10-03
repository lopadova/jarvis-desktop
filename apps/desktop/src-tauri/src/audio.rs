//! TTS playback (`host.audio.*`): sidecar → shell binary frames, played with rodio.
//!
//! The output device lives on a dedicated thread (the cpal stream is not `Send` everywhere); the rest
//! of the app talks to it through a channel. Raw PCM (`audio/pcm;rate=N`, s16le mono) is streamed as
//! frames arrive; compressed formats (mp3, wav) are decoded once `host.audio.end` arrives.
//! While playing, the RMS level is reported ~20 Hz and the end of each utterance is reported once.

use std::io::Cursor;
use std::num::NonZero;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioFormat {
    /// Signed 16-bit little-endian mono PCM at the given rate.
    Pcm { rate: u32 },
    /// Anything rodio can decode from a complete buffer (mp3, wav).
    Encoded,
}

/// `audio/pcm;rate=24000`, `audio/L16; rate=16000`, `audio/mpeg`, `audio/wav` …
pub fn parse_mime(mime: &str) -> Option<AudioFormat> {
    let mut parts = mime.split(';').map(str::trim);
    let essence = parts.next()?.to_ascii_lowercase();
    let params: Vec<(String, String)> = parts
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_ascii_lowercase(), v.trim().to_string()))
        })
        .collect();
    match essence.as_str() {
        "audio/pcm" | "audio/l16" | "audio/raw" => {
            let rate = params
                .iter()
                .find(|(k, _)| k == "rate")
                .and_then(|(_, v)| v.parse::<u32>().ok())
                .unwrap_or(24_000);
            (8_000..=192_000)
                .contains(&rate)
                .then_some(AudioFormat::Pcm { rate })
        }
        "audio/mpeg" | "audio/mp3" | "audio/wav" | "audio/x-wav" | "audio/wave" => {
            Some(AudioFormat::Encoded)
        }
        _ => None,
    }
}

/// s16le bytes → f32 samples; an odd trailing byte is carried over to the next chunk.
pub fn pcm16_to_f32(carry: &mut Option<u8>, bytes: &[u8], out: &mut Vec<f32>) {
    let mut i = 0;
    if let Some(lo) = carry.take() {
        if let Some(&hi) = bytes.first() {
            out.push(i16::from_le_bytes([lo, hi]) as f32 / 32768.0);
            i = 1;
        } else {
            *carry = Some(lo);
            return;
        }
    }
    let rest = &bytes[i..];
    let mut chunks = rest.chunks_exact(2);
    for c in &mut chunks {
        out.push(i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0);
    }
    if let [b] = chunks.remainder() {
        *carry = Some(*b);
    }
}

pub enum AudioCmd {
    Begin { id: String, format: AudioFormat },
    Data { id: String, bytes: Vec<u8> },
    End { id: String },
    Stop,
    Pause(bool),
}

/// Events reported back to the sidecar.
pub enum AudioEvent {
    Level(f32),
    Ended(String),
}

#[derive(Clone)]
pub struct AudioHandle {
    tx: Sender<AudioCmd>,
}

impl AudioHandle {
    pub fn send(&self, cmd: AudioCmd) {
        let _ = self.tx.send(cmd);
    }
}

/// A rodio source wrapper that publishes a smoothed RMS level of what is being played.
struct Metered<S> {
    inner: S,
    level: Arc<AtomicU32>,
    acc: f32,
    n: u32,
}

impl<S: rodio::Source> Iterator for Metered<S> {
    type Item = rodio::Sample;
    fn next(&mut self) -> Option<Self::Item> {
        let s = self.inner.next()?;
        self.acc += s * s;
        self.n += 1;
        if self.n >= 1024 {
            let rms = (self.acc / self.n as f32).sqrt();
            // Map RMS (≈0..0.5 for speech) to 0..1.
            let lv = (rms * 3.0).min(1.0);
            self.level.store(lv.to_bits(), Ordering::Relaxed);
            self.acc = 0.0;
            self.n = 0;
        }
        Some(s)
    }
}

impl<S: rodio::Source> rodio::Source for Metered<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }
    fn channels(&self) -> rodio::ChannelCount {
        self.inner.channels()
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

struct Current {
    id: String,
    format: AudioFormat,
    player: Option<rodio::Player>,
    encoded: Vec<u8>,
    carry: Option<u8>,
    ended: bool,
}

/// Starts the playback thread. `on_event` is called from that thread.
pub fn start(on_event: impl Fn(AudioEvent) + Send + 'static) -> AudioHandle {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("jarvis-audio-out".into())
        .spawn(move || run(rx, on_event))
        .expect("spawn audio thread");
    AudioHandle { tx }
}

fn run(rx: Receiver<AudioCmd>, on_event: impl Fn(AudioEvent)) {
    let mut sink: Option<rodio::MixerDeviceSink> = None;
    let level = Arc::new(AtomicU32::new(0));
    let mut cur: Option<Current> = None;
    let mut paused = false;
    let mut last_level = -1.0f32;

    let new_player = |sink: &mut Option<rodio::MixerDeviceSink>| -> Option<rodio::Player> {
        if sink.is_none() {
            match rodio::DeviceSinkBuilder::open_default_sink() {
                Ok(mut s) => {
                    s.log_on_drop(false);
                    *sink = Some(s);
                }
                Err(e) => {
                    log::error!("audio output unavailable: {e}");
                    return None;
                }
            }
        }
        sink.as_ref().map(|s| rodio::Player::connect_new(s.mixer()))
    };

    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(AudioCmd::Begin { id, format }) => {
                if let Some(c) = cur.take() {
                    if let Some(p) = &c.player {
                        p.stop();
                    }
                    on_event(AudioEvent::Ended(c.id));
                }
                let player = new_player(&mut sink);
                if let Some(p) = &player
                    && paused
                {
                    p.pause();
                }
                cur = Some(Current {
                    id,
                    format,
                    player,
                    encoded: Vec::new(),
                    carry: None,
                    ended: false,
                });
            }
            Ok(AudioCmd::Data { id, bytes }) => {
                if let Some(c) = cur.as_mut().filter(|c| c.id == id) {
                    match c.format {
                        AudioFormat::Pcm { rate } => {
                            let mut samples = Vec::with_capacity(bytes.len() / 2);
                            pcm16_to_f32(&mut c.carry, &bytes, &mut samples);
                            if let (Some(p), Some(r)) = (&c.player, NonZero::new(rate))
                                && !samples.is_empty()
                            {
                                let buf = rodio::buffer::SamplesBuffer::new(
                                    NonZero::<u16>::MIN,
                                    r,
                                    samples,
                                );
                                p.append(Metered {
                                    inner: buf,
                                    level: level.clone(),
                                    acc: 0.0,
                                    n: 0,
                                });
                            }
                        }
                        AudioFormat::Encoded => {
                            // Cap at 32 MB per utterance.
                            if c.encoded.len() + bytes.len() <= 32 * 1024 * 1024 {
                                c.encoded.extend_from_slice(&bytes);
                            }
                        }
                    }
                }
            }
            Ok(AudioCmd::End { id }) => {
                if let Some(c) = cur.as_mut().filter(|c| c.id == id) {
                    c.ended = true;
                    if c.format == AudioFormat::Encoded {
                        let data = std::mem::take(&mut c.encoded);
                        match rodio::Decoder::try_from(Cursor::new(data)) {
                            Ok(dec) => {
                                if let Some(p) = &c.player {
                                    p.append(Metered {
                                        inner: dec,
                                        level: level.clone(),
                                        acc: 0.0,
                                        n: 0,
                                    });
                                }
                            }
                            Err(e) => log::warn!("cannot decode TTS audio: {e}"),
                        }
                    }
                }
            }
            Ok(AudioCmd::Stop) => {
                if let Some(c) = cur.take() {
                    if let Some(p) = &c.player {
                        p.stop();
                    }
                    on_event(AudioEvent::Ended(c.id));
                }
            }
            Ok(AudioCmd::Pause(p)) => {
                paused = p;
                if let Some(pl) = cur.as_ref().and_then(|c| c.player.as_ref()) {
                    if p { pl.pause() } else { pl.play() }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        // Tick: level + end-of-utterance detection.
        let finished = match &cur {
            Some(c) => c.ended && c.player.as_ref().is_none_or(|p| p.empty()),
            None => false,
        };
        if finished {
            if let Some(c) = cur.take() {
                on_event(AudioEvent::Ended(c.id));
            }
            level.store(0f32.to_bits(), Ordering::Relaxed);
        }
        let lv = if cur.is_some() && !paused {
            f32::from_bits(level.load(Ordering::Relaxed))
        } else {
            0.0
        };
        if (lv - last_level).abs() > 0.02 || (lv == 0.0 && last_level != 0.0) {
            last_level = lv;
            on_event(AudioEvent::Level(lv));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_parsing() {
        assert_eq!(parse_mime("audio/mpeg"), Some(AudioFormat::Encoded));
        assert_eq!(parse_mime("audio/wav"), Some(AudioFormat::Encoded));
        assert_eq!(
            parse_mime("audio/pcm;rate=24000"),
            Some(AudioFormat::Pcm { rate: 24000 })
        );
        assert_eq!(
            parse_mime("Audio/L16; Rate=16000; channels=1"),
            Some(AudioFormat::Pcm { rate: 16000 })
        );
        assert_eq!(
            parse_mime("audio/pcm"),
            Some(AudioFormat::Pcm { rate: 24000 })
        );
        assert_eq!(parse_mime("audio/pcm;rate=1"), None);
        assert_eq!(parse_mime("text/html"), None);
    }

    #[test]
    fn pcm_conversion_carries_odd_bytes() {
        let samples: [i16; 3] = [0, 16384, -32768];
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut carry = None;
        let mut out = Vec::new();
        // Split in the middle of the second sample.
        pcm16_to_f32(&mut carry, &bytes[..3], &mut out);
        assert_eq!(out.len(), 1);
        assert!(carry.is_some());
        pcm16_to_f32(&mut carry, &bytes[3..], &mut out);
        assert_eq!(out, vec![0.0, 0.5, -1.0]);
        assert!(carry.is_none());
    }
}
