//! The voice worker (feature `voice`): cpal capture, sherpa-onnx KWS + Silero VAD, Whisper ASR.
//!
//! Threads:
//! - the cpal callback (realtime): downmix + push into an `rtrb` ring buffer — no locks/allocations;
//! - `jarvis-voice`: owns the mic stream and the models, runs KWS/VAD/clap/FSM every ~10 ms;
//! - `jarvis-asr`: runs Whisper on finished captures so wake-word detection never stalls.
//!
//! Echo cancellation: cpal does not expose platform voice processing; feature `aec` is a
//! documented follow-up (barge-in relies on VAD + the 400 ms rule meanwhile).

use super::clap::{self, ClapDetector};
use super::frames::{Framer, Resampler16k, TARGET_RATE, f32_to_pcm16_le, push_mono};
use super::fsm::{Action, Config, Fsm, Mode, Trigger};
use super::models::{self, ModelSpec};
use super::{VoiceCmd, VoiceSettings, VoiceSink};
use base64::Engine as _;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::time::{Duration, Instant};

const VAD_WINDOW: usize = 512; // Silero window @ 16 kHz (32 ms)
const LEVEL_EVERY_MS: u64 = 50; // ~20 Hz
const MIN_CAPTURE_SAMPLES: usize = (TARGET_RATE as usize) * 3 / 10; // 300 ms

// Wake word by speech recognition ("probes"): short phrases heard while idle are transcribed on this computer and
// the assistant decides whether they start with "Jarvis". Complements the English-trained keyword spotter, which
// misses many Italian pronunciations.
const PROBE_PREROLL_FRAMES: usize = 8; // ~256 ms kept before the speech starts
const PROBE_END_SILENCE_FRAMES: u32 = 20; // ~640 ms of silence ends the phrase
const PROBE_MIN_SAMPLES: usize = (TARGET_RATE as usize) * 4 / 10; // 400 ms
const PROBE_MAX_SAMPLES: usize = (TARGET_RATE as usize) * 4; // longer speech is conversation, not a wake phrase
/// Silence added before and after a probe: Whisper transcribes a lone, very short "Jarvis" more reliably with it.
const PROBE_PAD_SAMPLES: usize = TARGET_RATE as usize;

/// Speech-recognition jobs queued or running; probes are skipped while the recogniser is busy so they never delay a
/// real capture.
static ASR_PENDING: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub fn describe_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let mut out = vec![];
    if let Some(d) = host.default_input_device() {
        let name = d
            .description()
            .map(|x| x.name().to_string())
            .unwrap_or_else(|_| "?".into());
        let cfg = d
            .default_input_config()
            .map(|c| {
                format!(
                    "{} Hz, {} ch, {:?}",
                    c.sample_rate(),
                    c.channels(),
                    c.sample_format()
                )
            })
            .unwrap_or_else(|e| format!("no config: {e}"));
        out.push(format!("default: {name} ({cfg})"));
    }
    if let Ok(devs) = host.input_devices() {
        out.extend(devs.filter_map(|d| d.description().ok().map(|x| x.name().to_string())));
    }
    out
}

struct Mic {
    _stream: cpal::Stream,
    cons: rtrb::Consumer<f32>,
    resampler: Resampler16k,
}

fn open_mic() -> anyhow::Result<Mic> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow::anyhow!("no input device"))?;
    let supported = device.default_input_config()?;
    let rate = supported.sample_rate();
    let channels = supported.channels() as usize;
    let config: cpal::StreamConfig = supported.config();
    let (mut prod, cons) = rtrb::RingBuffer::<f32>::new(rate as usize * 2);
    let err = |e| log::warn!("mic stream error: {e}");
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |d: &[f32], _| {
                push_mono(&mut prod, d, channels, |s| s);
            },
            err,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |d: &[i16], _| {
                push_mono(&mut prod, d, channels, |s| s as f32 / 32768.0);
            },
            err,
            None,
        )?,
        cpal::SampleFormat::I32 => device.build_input_stream(
            &config,
            move |d: &[i32], _| {
                push_mono(&mut prod, d, channels, |s| s as f32 / 2_147_483_648.0);
            },
            err,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |d: &[u16], _| {
                push_mono(&mut prod, d, channels, |s| (s as f32 - 32768.0) / 32768.0);
            },
            err,
            None,
        )?,
        f => anyhow::bail!("unsupported sample format {f:?}"),
    };
    stream.play()?;
    Ok(Mic {
        _stream: stream,
        cons,
        resampler: Resampler16k::new(rate)?,
    })
}

struct Kws {
    spotter: sherpa_onnx::KeywordSpotter,
    stream: sherpa_onnx::OnlineStream,
}

/// "JARVIS" tokenised with the KWS model's BPE (sentencepiece): tokens, boost, threshold, label.
const WAKE_KEYWORD: &str = "▁JA R VI S :2.5 #0.15 @JARVIS";

/// Diagnostics only: JARVIS_WAKE_KEYWORDS replaces the keyword lines (write `\n` between lines) so thresholds and
/// pronunciations can be tuned against recordings without rebuilding.
fn wake_keywords() -> String {
    match std::env::var("JARVIS_WAKE_KEYWORDS") {
        Ok(v) if !v.trim().is_empty() => v.replace("\\n", "\n"),
        _ => WAKE_KEYWORD.to_string(),
    }
}

fn load_kws(root: &Path) -> Option<Kws> {
    load_kws_with(root, &wake_keywords())
}

/// Diagnostics only: when JARVIS_DUMP_CAPTURES names a directory, every finished capture is saved there as a
/// 16 kHz mono WAV so a real voice can be replayed against the wake-word and speech models. Off by default.
fn dump_capture(samples: &[f32], trigger: &str) {
    let Ok(dir) = std::env::var("JARVIS_DUMP_CAPTURES") else {
        return;
    };
    let pcm = f32_to_pcm16_le(samples);
    let mut wav = Vec::with_capacity(44 + pcm.len());
    let rate = TARGET_RATE;
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&rate.to_le_bytes());
    wav.extend_from_slice(&(rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(&pcm);
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(
        Path::new(&dir).join(format!("capture-{ms}-{trigger}.wav")),
        wav,
    );
}

fn load_kws_with(root: &Path, keywords: &str) -> Option<Kws> {
    let spec = &models::KWS;
    if !models::is_ready(root, spec) {
        return None;
    }
    let d = models::model_dir(root, spec);
    let p = |f: &str| Some(d.join(f).to_string_lossy().into_owned());
    let mut cfg = sherpa_onnx::KeywordSpotterConfig::default();
    cfg.model_config.transducer.encoder = p(spec.files[0]);
    cfg.model_config.transducer.decoder = p(spec.files[1]);
    cfg.model_config.transducer.joiner = p(spec.files[2]);
    cfg.model_config.tokens = p(spec.files[3]);
    cfg.model_config.num_threads = 1;
    cfg.keywords_buf = Some(keywords.to_string());
    let spotter = sherpa_onnx::KeywordSpotter::create(&cfg)?;
    let stream = spotter.create_stream();
    Some(Kws { spotter, stream })
}

fn load_vad(root: &Path) -> Option<sherpa_onnx::VoiceActivityDetector> {
    let spec = &models::VAD;
    if !models::is_ready(root, spec) {
        return None;
    }
    let mut cfg = sherpa_onnx::VadModelConfig::default();
    cfg.silero_vad.model = Some(
        models::model_dir(root, spec)
            .join(spec.files[0])
            .to_string_lossy()
            .into_owned(),
    );
    cfg.silero_vad.threshold = 0.5;
    cfg.silero_vad.min_silence_duration = 0.25;
    cfg.silero_vad.min_speech_duration = 0.1;
    cfg.silero_vad.window_size = VAD_WINDOW as i32;
    cfg.silero_vad.max_speech_duration = 30.0;
    cfg.sample_rate = TARGET_RATE as i32;
    cfg.num_threads = 1;
    sherpa_onnx::VoiceActivityDetector::create(&cfg, 30.0)
}

struct AsrJob {
    samples: Vec<f32>,
    trigger: Trigger,
    /// The selected `whisperModel` setting; resolved to an installed model when the job runs.
    whisper_setting: String,
    /// A wake-word probe: a missing model or an empty result is silent, and the transcript is tagged "probe".
    probe: bool,
    language: String,
}

fn start_asr(root: PathBuf, sink: Arc<dyn VoiceSink>) -> Sender<AsrJob> {
    let (tx, rx) = mpsc::channel::<AsrJob>();
    std::thread::Builder::new()
        .name("jarvis-asr".into())
        .spawn(move || {
            let mut loaded: Option<(&'static str, sherpa_onnx::OfflineRecognizer)> = None;
            while let Ok(job) = rx.recv() {
                let probe = job.probe;
                let trigger_name = if probe { "probe" } else { job.trigger.as_str() };
                let duration_ms = (job.samples.len() as u64 * 1000) / TARGET_RATE as u64;
                let Some(spec) = models::usable_whisper(&root, &job.whisper_setting) else {
                    if probe {
                        ASR_PENDING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                        continue;
                    }
                    log::warn!(
                        "no whisper model installed (selected: {})",
                        job.whisper_setting
                    );
                    sink.notify(
                        "voice.nothingHeard",
                        json!({ "trigger": job.trigger.as_str(), "reason": "no-model" }),
                    );
                    continue;
                };
                if spec.id != format!("whisper-{}", job.whisper_setting) {
                    log::warn!(
                        "whisper model {} selected but not installed; using {}",
                        job.whisper_setting,
                        spec.id
                    );
                }
                if loaded.as_ref().map(|(id, _)| *id) != Some(spec.id) {
                    loaded = build_recognizer(&root, spec, &job.language).map(|r| (spec.id, r));
                }
                let Some((_, rec)) = &loaded else {
                    ASR_PENDING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                    log::warn!("whisper model {} could not be loaded", spec.id);
                    sink.notify(
                        "voice.nothingHeard",
                        json!({ "trigger": job.trigger.as_str() }),
                    );
                    continue;
                };
                let stream = rec.create_stream();
                stream.accept_waveform(TARGET_RATE as i32, &job.samples);
                rec.decode(&stream);
                let text = stream
                    .get_result()
                    .map(|r| r.text.trim().to_string())
                    .unwrap_or_default();
                ASR_PENDING.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                if text.is_empty() {
                    // A probe that heard nothing is not an event: the user never asked for anything.
                    if !probe {
                        sink.notify("voice.nothingHeard", json!({ "trigger": trigger_name }));
                    }
                } else {
                    sink.notify(
                        "voice.transcript",
                        json!({ "text": text, "trigger": trigger_name, "durationMs": duration_ms }),
                    );
                }
            }
        })
        .expect("spawn asr thread");
    tx
}

fn build_recognizer(
    root: &Path,
    spec: &ModelSpec,
    language: &str,
) -> Option<sherpa_onnx::OfflineRecognizer> {
    if !models::is_ready(root, spec) {
        return None;
    }
    let d = models::model_dir(root, spec);
    let p = |f: &str| Some(d.join(f).to_string_lossy().into_owned());
    let mut cfg = sherpa_onnx::OfflineRecognizerConfig::default();
    cfg.model_config.whisper.encoder = p(spec.files[0]);
    cfg.model_config.whisper.decoder = p(spec.files[1]);
    cfg.model_config.whisper.language = Some(language.to_string());
    cfg.model_config.whisper.task = Some("transcribe".into());
    cfg.model_config.whisper.tail_paddings = -1;
    cfg.model_config.tokens = p(spec.files[2]);
    cfg.model_config.num_threads = 2;
    sherpa_onnx::OfflineRecognizer::create(&cfg)
}

pub fn start(models_root: PathBuf, sink: Arc<dyn VoiceSink>) -> Sender<VoiceCmd> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("jarvis-voice".into())
        .spawn(move || Worker::new(models_root, sink).run(rx))
        .expect("spawn voice thread");
    tx
}

struct Worker {
    root: PathBuf,
    sink: Arc<dyn VoiceSink>,
    settings: VoiceSettings,
    fsm: Fsm,
    clap: ClapDetector,
    mic: Option<Mic>,
    mic_failed_at: Option<Instant>,
    kws: Option<Kws>,
    vad: Option<sherpa_onnx::VoiceActivityDetector>,
    asr: Sender<AsrJob>,
    capture: Vec<f32>,
    /// Wake-word probe: rolling pre-roll, then the current short phrase.
    probe: Vec<f32>,
    probe_active: bool,
    probe_overflow: bool,
    probe_silence: u32,
    monitor: bool,
    epoch: Instant,
    last_level_ms: u64,
    framer: Framer,
    scratch: Vec<f32>,
    resampled: Vec<f32>,
}

impl Worker {
    fn new(root: PathBuf, sink: Arc<dyn VoiceSink>) -> Self {
        let asr = start_asr(root.clone(), sink.clone());
        let mut w = Self {
            kws: None,
            vad: None,
            root,
            asr,
            sink,
            settings: VoiceSettings::default(),
            fsm: Fsm::new(Config::default()),
            clap: ClapDetector::default(),
            mic: None,
            mic_failed_at: None,
            capture: Vec::new(),
            probe: Vec::new(),
            probe_active: false,
            probe_overflow: false,
            probe_silence: 0,
            monitor: false,
            epoch: Instant::now(),
            last_level_ms: 0,
            framer: Framer::new(VAD_WINDOW),
            scratch: Vec::with_capacity(8192),
            resampled: Vec::with_capacity(8192),
        };
        w.reload_models();
        w
    }

    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn reload_models(&mut self) {
        self.kws = load_kws(&self.root);
        self.vad = load_vad(&self.root);
        log::info!(
            "voice models: kws={} vad={}",
            self.kws.is_some(),
            self.vad.is_some()
        );
    }

    fn mic_needed(&self) -> bool {
        self.monitor
            || self.fsm.is_capturing()
            || (self.settings.wake_word && self.kws.is_some())
            || self.settings.wake_on_clap
            || matches!(self.fsm.mode(), Mode::Speaking | Mode::Conversation)
    }

    fn run(mut self, rx: Receiver<VoiceCmd>) {
        loop {
            loop {
                match rx.try_recv() {
                    Ok(cmd) => self.handle(cmd),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => return,
                }
            }
            self.ensure_mic();
            self.pump();
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn handle(&mut self, cmd: VoiceCmd) {
        let now = self.now_ms();
        match cmd {
            VoiceCmd::Settings(s) => {
                self.fsm.set_barge_in(s.barge_in);
                self.settings = s;
            }
            VoiceCmd::Mode {
                mode,
                conversation_ms,
            } => {
                let conv = if self.settings.conversation_mode {
                    conversation_ms.or(Some(self.settings.conversation_window_ms))
                } else {
                    None
                };
                let mode = if mode == Mode::Conversation && conv.is_none() {
                    Mode::Idle
                } else {
                    mode
                };
                self.fsm.set_mode(mode, conv, now);
            }
            VoiceCmd::PushToTalk(true) => {
                self.ensure_mic();
                if let Some(a) = self.fsm.ptt_down(now) {
                    self.act(a);
                }
            }
            VoiceCmd::PushToTalk(false) => {
                // Flush what is buffered so the tail of the utterance is not lost.
                self.pump();
                if let Some(a) = self.fsm.ptt_up() {
                    self.act(a);
                }
            }
            VoiceCmd::Monitor(on) => self.monitor = on,
            VoiceCmd::ModelsChanged => self.reload_models(),
        }
    }

    fn ensure_mic(&mut self) {
        let needed = self.mic_needed();
        if needed && self.mic.is_none() {
            if self
                .mic_failed_at
                .is_some_and(|t| t.elapsed() < Duration::from_secs(5))
            {
                return;
            }
            match open_mic() {
                Ok(m) => {
                    self.mic = Some(m);
                    self.mic_failed_at = None;
                    self.sink.mic_open(true);
                }
                Err(e) => {
                    log::warn!("cannot open microphone: {e}");
                    self.mic_failed_at = Some(Instant::now());
                }
            }
        } else if !needed && self.mic.is_some() {
            self.mic = None;
            self.framer.clear();
            self.sink.mic_open(false);
        }
    }

    fn pump(&mut self) {
        let Some(mic) = self.mic.as_mut() else { return };
        self.scratch.clear();
        while let Ok(s) = mic.cons.pop() {
            self.scratch.push(s);
        }
        if self.scratch.is_empty() {
            return;
        }
        self.resampled.clear();
        if let Err(e) = mic.resampler.process(&self.scratch, &mut self.resampled) {
            log::warn!("resampler: {e}");
            return;
        }
        self.framer.push(&self.resampled);
        let mut frames: Vec<f32> = Vec::new();
        self.framer.drain(|f| frames.extend_from_slice(f));
        let (windows, _partial) = frames.as_chunks::<VAD_WINDOW>();
        for frame in windows {
            self.frame(frame);
        }
    }

    fn frame(&mut self, frame: &[f32]) {
        let now = self.now_ms();
        let rms = clap::rms(frame);
        let level = (rms * 6.0).min(1.0);

        let speech = match &self.vad {
            Some(vad) => {
                vad.accept_waveform(frame);
                while !vad.is_empty() {
                    vad.pop();
                }
                vad.detected()
            }
            None => rms > 0.03, // energy fallback until the VAD model is present
        };

        self.probe_frame(frame, speech);

        if self.fsm.wants_wake_word()
            && self.settings.wake_word
            && let Some(k) = &self.kws
        {
            k.stream.accept_waveform(TARGET_RATE as i32, frame);
            let mut hit = false;
            while k.spotter.is_ready(&k.stream) {
                k.spotter.decode(&k.stream);
                if k.spotter
                    .get_result(&k.stream)
                    .is_some_and(|r| !r.keyword.is_empty())
                {
                    k.spotter.reset(&k.stream);
                    hit = true;
                    break;
                }
            }
            if hit && let Some(a) = self.fsm.wake(Trigger::WakeWord, now) {
                self.act(a);
            }
        }

        if self.settings.wake_on_clap && !self.fsm.is_capturing() && self.fsm.mode() == Mode::Idle {
            let mut clapped = false;
            for (i, sub) in frame.chunks(clap::FRAME).enumerate() {
                clapped |= self.clap.push(sub, now + i as u64 * 10);
            }
            if clapped && let Some(a) = self.fsm.wake(Trigger::Clap, now) {
                self.act(a);
            }
        }

        if let Some(a) = self.fsm.frame(now, speech) {
            self.act(a);
        }

        if self.fsm.is_capturing() {
            self.capture.extend_from_slice(frame);
        }
        if now.saturating_sub(self.last_level_ms) >= LEVEL_EVERY_MS {
            self.last_level_ms = now;
            if self.fsm.is_capturing() {
                // Whisper is offline: there is no streaming text, only the live level.
                self.sink.notify(
                    "voice.partial",
                    json!({ "partial": "", "committed": "", "level": level }),
                );
            }
            if self.monitor || self.fsm.is_capturing() {
                self.sink.mic_level(level);
            }
        }
    }

    /// Collects short phrases heard while idle and queues them for a wake-word probe.
    fn probe_frame(&mut self, frame: &[f32], speech: bool) {
        let listening = self.settings.wake_by_recognition
            && self.settings.wake_word
            && self.fsm.mode() == Mode::Idle
            && !self.fsm.is_capturing();
        if !listening {
            self.probe.clear();
            self.probe_active = false;
            self.probe_overflow = false;
            self.probe_silence = 0;
            return;
        }
        if speech {
            if self.probe_overflow {
                return;
            }
            self.probe_silence = 0;
            self.probe_active = true;
            self.probe.extend_from_slice(frame);
            if self.probe.len() > PROBE_MAX_SAMPLES {
                // Too long to be a wake phrase: ordinary conversation, do not transcribe it.
                self.probe.clear();
                self.probe_active = false;
                self.probe_overflow = true;
            }
        } else if self.probe_active {
            self.probe.extend_from_slice(frame);
            self.probe_silence += 1;
            if self.probe_silence >= PROBE_END_SILENCE_FRAMES {
                let phrase = std::mem::take(&mut self.probe);
                let mut samples = vec![0.0f32; PROBE_PAD_SAMPLES];
                samples.extend_from_slice(&phrase);
                samples.resize(samples.len() + PROBE_PAD_SAMPLES, 0.0);
                self.probe_active = false;
                self.probe_silence = 0;
                if phrase.len() >= PROBE_MIN_SAMPLES
                    && ASR_PENDING.load(std::sync::atomic::Ordering::SeqCst) == 0
                {
                    ASR_PENDING.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let _ = self.asr.send(AsrJob {
                        samples,
                        trigger: Trigger::WakeWord,
                        probe: true,
                        whisper_setting: self.settings.whisper_model.clone(),
                        language: if self.settings.locale.starts_with("it") {
                            "it".into()
                        } else {
                            "en".into()
                        },
                    });
                }
            }
        } else {
            self.probe_overflow = false;
            self.probe.extend_from_slice(frame);
            let keep = PROBE_PREROLL_FRAMES * VAD_WINDOW;
            if self.probe.len() > keep {
                let extra = self.probe.len() - keep;
                self.probe.drain(..extra);
            }
        }
    }

    fn act(&mut self, action: Action) {
        match action {
            Action::Start(trigger) => {
                self.capture.clear();
                self.sink
                    .notify("voice.wake", json!({ "trigger": trigger.as_str() }));
            }
            Action::End {
                trigger,
                heard_speech,
                ..
            } => {
                let samples = std::mem::take(&mut self.capture);
                dump_capture(&samples, trigger.as_str());
                self.sink.mic_level(0.0);
                if !heard_speech || samples.len() < MIN_CAPTURE_SAMPLES {
                    self.sink
                        .notify("voice.nothingHeard", json!({ "trigger": trigger.as_str() }));
                    return;
                }
                if self.settings.local_stt() {
                    let language = if self.settings.locale.starts_with("it") {
                        "it"
                    } else {
                        "en"
                    };
                    ASR_PENDING.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let _ = self.asr.send(AsrJob {
                        samples,
                        trigger,
                        probe: false,
                        whisper_setting: self.settings.whisper_model.clone(),
                        language: language.into(),
                    });
                } else {
                    let pcm = f32_to_pcm16_le(&samples);
                    let b64 = base64::engine::general_purpose::STANDARD.encode(pcm);
                    self.sink.notify(
                        "voice.audio",
                        json!({ "pcmBase64": b64, "trigger": trigger.as_str() }),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Model smoke test (needs downloaded models): `JARVIS_TEST_MODELS=<models dir>
    /// JARVIS_TEST_WAV=<wav saying "Jarvis"> cargo test -- --ignored kws_detects`.
    #[test]
    #[ignore]
    fn kws_detects_the_wake_word() {
        let root = PathBuf::from(std::env::var("JARVIS_TEST_MODELS").expect("JARVIS_TEST_MODELS"));
        let wav = std::env::var("JARVIS_TEST_WAV").expect("JARVIS_TEST_WAV");
        let keywords =
            std::env::var("JARVIS_TEST_KEYWORDS").unwrap_or_else(|_| WAKE_KEYWORD.into());
        let expect = std::env::var("JARVIS_TEST_EXPECT").unwrap_or_else(|_| "JARVIS".into());
        let kws = load_kws_with(&root, &keywords).expect("KWS model loads with the keyword");
        let w = sherpa_onnx::Wave::read(&wav).expect("wav");
        kws.stream.accept_waveform(w.sample_rate(), w.samples());
        // sherpa-onnx aborts if the sample rate changes within a stream: pad at the same rate.
        let tail = vec![0.0f32; w.sample_rate() as usize];
        kws.stream.accept_waveform(w.sample_rate(), &tail);
        let mut found = String::new();
        while kws.spotter.is_ready(&kws.stream) {
            kws.spotter.decode(&kws.stream);
            if let Some(r) = kws.spotter.get_result(&kws.stream)
                && !r.keyword.is_empty()
            {
                found = r.keyword;
                break;
            }
        }
        assert_eq!(found, expect);
    }
    /// Diagnostics (needs downloaded models): prints what Whisper hears in a recording.
    /// `JARVIS_TEST_MODELS=<models dir> JARVIS_TEST_WAV=<wav> [JARVIS_TEST_LANG=it] [JARVIS_TEST_WHISPER=small]
    /// cargo test -- --ignored --nocapture whisper_hears`.
    #[test]
    #[ignore]
    fn whisper_hears_the_recording() {
        let root = PathBuf::from(std::env::var("JARVIS_TEST_MODELS").expect("JARVIS_TEST_MODELS"));
        let wav = std::env::var("JARVIS_TEST_WAV").expect("JARVIS_TEST_WAV");
        let lang = std::env::var("JARVIS_TEST_LANG").unwrap_or_else(|_| "it".into());
        let size = std::env::var("JARVIS_TEST_WHISPER").unwrap_or_else(|_| "small".into());
        let rec = build_recognizer(&root, models::whisper_spec(&size), &lang)
            .expect("Whisper model loads");
        let w = sherpa_onnx::Wave::read(&wav).expect("wav");
        // JARVIS_TEST_PAD_MS=<ms> adds that much silence before and after, to see if very short words transcribe better.
        let pad_ms: usize = std::env::var("JARVIS_TEST_PAD_MS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let pad = vec![0.0f32; w.sample_rate() as usize * pad_ms / 1000];
        let mut samples = pad.clone();
        samples.extend_from_slice(w.samples());
        samples.extend_from_slice(&pad);
        let stream = rec.create_stream();
        stream.accept_waveform(w.sample_rate(), &samples);
        rec.decode(&stream);
        let text = stream.get_result().map(|r| r.text).unwrap_or_default();
        println!("WHISPER[{size}/{lang}]: {text}");
    }
}
