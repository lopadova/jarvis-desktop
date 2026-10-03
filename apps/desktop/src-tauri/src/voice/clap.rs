//! Double-clap detector (energy onsets). Pure and allocation-free; fed with 10 ms frames at 16 kHz.
//!
//! A clap is a sharp energy onset well above the adaptive noise floor that decays within ~100 ms.
//! Two claps with a 150–700 ms gap trigger. Used only when idle and enabled in settings.

pub const FRAME: usize = 160; // 10 ms @ 16 kHz

#[derive(Debug, Clone)]
pub struct ClapDetector {
    noise_floor: f32,
    /// Frames since the current loud burst started (None when quiet).
    burst_frames: Option<u32>,
    /// Time (ms) of the previous clap onset.
    last_clap_ms: Option<u64>,
    /// Onset ratio over the noise floor.
    pub ratio: f32,
    /// Absolute minimum RMS for an onset.
    pub min_rms: f32,
    pub min_gap_ms: u64,
    pub max_gap_ms: u64,
}

impl Default for ClapDetector {
    fn default() -> Self {
        Self {
            noise_floor: 0.01,
            burst_frames: None,
            last_clap_ms: None,
            ratio: 8.0,
            min_rms: 0.08,
            min_gap_ms: 150,
            max_gap_ms: 700,
        }
    }
}

pub fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt()
}

impl ClapDetector {
    /// Feed one 10 ms frame captured at `now_ms`; returns true when a double clap completes.
    pub fn push(&mut self, frame: &[f32], now_ms: u64) -> bool {
        let e = rms(frame);
        let loud = e > self.min_rms && e > self.noise_floor * self.ratio;
        match (loud, self.burst_frames) {
            (true, None) => {
                // Onset.
                self.burst_frames = Some(1);
                if let Some(prev) = self.last_clap_ms {
                    let gap = now_ms.saturating_sub(prev);
                    if (self.min_gap_ms..=self.max_gap_ms).contains(&gap) {
                        self.last_clap_ms = None;
                        return true;
                    }
                }
                self.last_clap_ms = Some(now_ms);
            }
            (true, Some(n)) => {
                // Sustained loudness (speech, music) is not a clap: forget the onset.
                if n > 10 {
                    self.last_clap_ms = None;
                }
                self.burst_frames = Some(n + 1);
            }
            (false, Some(_)) => self.burst_frames = None,
            (false, None) => {
                // Track the noise floor slowly when quiet.
                self.noise_floor = (self.noise_floor * 0.98 + e * 0.02).max(0.001);
            }
        }
        if let Some(prev) = self.last_clap_ms
            && now_ms.saturating_sub(prev) > self.max_gap_ms
        {
            self.last_clap_ms = None;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn silence() -> [f32; FRAME] {
        [0.002; FRAME]
    }
    fn clap() -> [f32; FRAME] {
        let mut f = [0.0f32; FRAME];
        for (i, s) in f.iter_mut().enumerate() {
            *s = if i % 2 == 0 { 0.6 } else { -0.6 };
        }
        f
    }

    /// Plays a script of (frame kind, count) and returns the times (ms) at which detection fired.
    fn run(script: &[(bool, u32)]) -> Vec<u64> {
        let mut d = ClapDetector::default();
        let mut t = 0u64;
        let mut hits = vec![];
        for &(is_clap, n) in script {
            for _ in 0..n {
                let f = if is_clap { clap() } else { silence() };
                if d.push(&f, t) {
                    hits.push(t);
                }
                t += 10;
            }
        }
        hits
    }

    #[test]
    fn double_clap_with_valid_gap_triggers() {
        // clap (30 ms) · 300 ms silence · clap
        let hits = run(&[(false, 50), (true, 3), (false, 30), (true, 3), (false, 20)]);
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn single_clap_does_not_trigger() {
        assert!(run(&[(false, 50), (true, 3), (false, 200)]).is_empty());
    }

    #[test]
    fn gaps_outside_150_700_ms_do_not_trigger() {
        // 60 ms apart: too fast.
        assert!(run(&[(false, 50), (true, 2), (false, 4), (true, 2), (false, 100)]).is_empty());
        // 1 s apart: too slow.
        assert!(
            run(&[
                (false, 50),
                (true, 2),
                (false, 100),
                (true, 2),
                (false, 100)
            ])
            .is_empty()
        );
    }

    #[test]
    fn sustained_noise_is_not_a_clap() {
        assert!(run(&[(false, 50), (true, 40), (false, 30), (true, 3), (false, 50)]).is_empty());
    }
}
