//! Audio plumbing between the realtime capture callback and the voice worker:
//!
//! - [`push_mono`] downmixes interleaved device samples into a lock-free SPSC ring buffer (`rtrb`)
//!   without allocating or locking — safe to call from the audio callback thread.
//! - [`Resampler16k`] converts the device rate to 16 kHz mono on the worker thread (`rubato` FFT).
//! - [`Framer`] cuts the 16 kHz stream into fixed-size frames for KWS / VAD / clap detection.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

pub const TARGET_RATE: u32 = 16_000;

/// Audio-callback side: average channels into mono and push; drops samples if the worker lags
/// (never blocks). Returns the number of mono samples dropped.
pub fn push_mono<T: Copy>(
    prod: &mut rtrb::Producer<f32>,
    data: &[T],
    channels: usize,
    to_f32: impl Fn(T) -> f32,
) -> usize {
    let channels = channels.max(1);
    let mut dropped = 0;
    for frame in data.chunks_exact(channels) {
        let mut acc = 0.0f32;
        for &s in frame {
            acc += to_f32(s);
        }
        if prod.push(acc / channels as f32).is_err() {
            dropped += 1;
        }
    }
    dropped
}

pub struct Resampler16k {
    inner: Option<Fft<f32>>,
    pending: Vec<f32>,
    out_buf: Vec<f32>,
}

impl Resampler16k {
    pub fn new(input_rate: u32) -> anyhow::Result<Self> {
        if input_rate == TARGET_RATE {
            return Ok(Self {
                inner: None,
                pending: Vec::new(),
                out_buf: Vec::new(),
            });
        }
        let r = Fft::<f32>::new(
            input_rate as usize,
            TARGET_RATE as usize,
            1024,
            1,
            FixedSync::Input,
        )?;
        let max_out = r.output_frames_max();
        Ok(Self {
            inner: Some(r),
            pending: Vec::with_capacity(4096),
            out_buf: vec![0.0; max_out],
        })
    }

    /// Feed device-rate mono samples; resampled 16 kHz samples are appended to `out`.
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) -> anyhow::Result<()> {
        let Some(r) = self.inner.as_mut() else {
            out.extend_from_slice(input);
            return Ok(());
        };
        self.pending.extend_from_slice(input);
        loop {
            let need = r.input_frames_next();
            if self.pending.len() < need {
                break;
            }
            let frames_out = r.output_frames_next();
            if self.out_buf.len() < frames_out {
                self.out_buf.resize(frames_out, 0.0);
            }
            let inp = InterleavedSlice::new(&self.pending[..need], 1, need)?;
            let mut outp =
                InterleavedSlice::new_mut(&mut self.out_buf[..frames_out], 1, frames_out)?;
            let (used, produced) = r.process_into_buffer(&inp, &mut outp, None)?;
            out.extend_from_slice(&self.out_buf[..produced]);
            self.pending.drain(..used);
        }
        Ok(())
    }
}

/// Accumulates samples and yields fixed-size frames.
pub struct Framer {
    size: usize,
    buf: Vec<f32>,
}

impl Framer {
    pub fn new(size: usize) -> Self {
        Self {
            size,
            buf: Vec::with_capacity(size * 4),
        }
    }

    pub fn push(&mut self, samples: &[f32]) {
        self.buf.extend_from_slice(samples);
    }

    /// Calls `f` for every complete frame, keeping the remainder for the next push.
    pub fn drain(&mut self, mut f: impl FnMut(&[f32])) {
        let full = self.buf.len() / self.size * self.size;
        for frame in self.buf[..full].chunks_exact(self.size) {
            f(frame);
        }
        self.buf.drain(..full);
    }

    pub fn clear(&mut self) {
        self.buf.clear();
    }
}

/// PCM16 little-endian bytes for cloud STT payloads.
pub fn f32_to_pcm16_le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_downmixes_and_never_blocks() {
        let (mut prod, mut cons) = rtrb::RingBuffer::<f32>::new(4);
        // Stereo i16 → mono f32.
        let data: [i16; 8] = [16384, 16384, -16384, -16384, 0, 32767, 100, 100];
        let dropped = push_mono(&mut prod, &data, 2, |s| s as f32 / 32768.0);
        assert_eq!(dropped, 0);
        let got: Vec<f32> = std::iter::from_fn(|| cons.pop().ok()).collect();
        assert_eq!(got.len(), 4);
        assert!((got[0] - 0.5).abs() < 1e-6);
        assert!((got[1] + 0.5).abs() < 1e-6);
        // Full buffer: further samples are dropped, not blocked on.
        let more = [0.1f32; 6];
        assert_eq!(push_mono(&mut prod, &more, 1, |s| s), 2);
    }

    #[test]
    fn passthrough_at_16k() {
        let mut r = Resampler16k::new(16_000).unwrap();
        let mut out = vec![];
        r.process(&[0.1, 0.2, 0.3], &mut out).unwrap();
        assert_eq!(out, vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn resamples_48k_to_16k_preserving_duration_and_tone() {
        let mut r = Resampler16k::new(48_000).unwrap();
        let mut out = vec![];
        // 1 s of a 440 Hz sine fed in uneven chunks.
        let input: Vec<f32> = (0..48_000)
            .map(|i| (2.0 * std::f32::consts::PI * 440.0 * i as f32 / 48_000.0).sin() * 0.5)
            .collect();
        for chunk in input.chunks(733) {
            r.process(chunk, &mut out).unwrap();
        }
        // All complete 1024-frame chunks are processed: ≈ 1 s minus at most one pending chunk.
        assert!(out.len() > 15_000 && out.len() <= 16_000, "{}", out.len());
        // Amplitude is preserved after the filter warm-up.
        let peak = out[4000..12000].iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.5).abs() < 0.05, "peak {peak}");
    }

    #[test]
    fn framer_yields_fixed_frames_and_keeps_remainder() {
        let mut f = Framer::new(4);
        f.push(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let mut frames = vec![];
        f.drain(|fr| frames.push(fr.to_vec()));
        assert_eq!(frames, vec![vec![1.0, 2.0, 3.0, 4.0]]);
        f.push(&[7.0, 8.0]);
        frames.clear();
        f.drain(|fr| frames.push(fr.to_vec()));
        assert_eq!(frames, vec![vec![5.0, 6.0, 7.0, 8.0]]);
    }

    #[test]
    fn pcm16_encoding() {
        assert_eq!(
            f32_to_pcm16_le(&[0.0, 1.0, -1.0, 2.0]),
            vec![0, 0, 0xff, 0x7f, 0x01, 0x80, 0xff, 0x7f]
        );
    }
}
