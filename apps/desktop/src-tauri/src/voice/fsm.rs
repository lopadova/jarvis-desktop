//! Voice capture state machine (pure, time passed in explicitly — fully unit-testable).
//!
//! idle (KWS / clap) ──wake│PTT down│speech in conversation window──▶ capturing
//! capturing ──~1.2 s silence │ PTT release │ 30 s──▶ idle (+ transcribe)
//! While the sidecar says `speaking`, ≥ 400 ms of continuous speech raises a barge-in wake.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    WakeWord,
    PushToTalk,
    Clap,
    BargeIn,
    Conversation,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::WakeWord => "wake-word",
            Trigger::PushToTalk => "push-to-talk",
            Trigger::Clap => "clap",
            Trigger::BargeIn => "barge-in",
            Trigger::Conversation => "conversation",
        }
    }
}

/// `host.setListening` modes from the sidecar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Idle,
    Speaking,
    Busy,
    Conversation,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "idle" => Mode::Idle,
            "speaking" => Mode::Speaking,
            "busy" => Mode::Busy,
            "conversation" => Mode::Conversation,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndReason {
    Silence,
    PttReleased,
    MaxDuration,
}

#[derive(Debug, Clone, Copy)]
pub struct Config {
    pub silence_end_ms: u64,
    pub max_capture_ms: u64,
    pub barge_in_ms: u64,
    /// How long to wait for the first word before giving up (wake word / conversation).
    pub no_speech_timeout_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            silence_end_ms: 1200,
            max_capture_ms: 30_000,
            barge_in_ms: 400,
            no_speech_timeout_ms: 5000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Start capturing (send `voice.wake`).
    Start(Trigger),
    /// Stop capturing and transcribe what was captured.
    End {
        trigger: Trigger,
        reason: EndReason,
        heard_speech: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Capturing {
        trigger: Trigger,
        started: u64,
        last_speech: Option<u64>,
        ptt: bool,
    },
}

#[derive(Debug, Clone)]
pub struct Fsm {
    cfg: Config,
    phase: Phase,
    mode: Mode,
    conversation_until: Option<u64>,
    speech_run_start: Option<u64>,
    /// Speaking over Jarvis interrupts it. Off by default: without acoustic echo cancellation the speakers
    /// would make Jarvis interrupt (and answer) itself.
    barge_in_enabled: bool,
    /// After Jarvis stops speaking, ignore the microphone for a moment: the tail of its own voice is still in the room.
    quiet_until: u64,
}

/// How long the microphone is ignored after Jarvis finishes a reply.
const AFTER_SPEECH_QUIET_MS: u64 = 1500;

impl Fsm {
    pub fn new(cfg: Config) -> Self {
        Self {
            cfg,
            phase: Phase::Idle,
            mode: Mode::Idle,
            conversation_until: None,
            speech_run_start: None,
            barge_in_enabled: false,
            quiet_until: 0,
        }
    }

    pub fn set_barge_in(&mut self, enabled: bool) {
        self.barge_in_enabled = enabled;
    }

    pub fn is_capturing(&self) -> bool {
        matches!(self.phase, Phase::Capturing { .. })
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Wake-word detection is only meaningful when idle and not busy speaking.
    pub fn wants_wake_word(&self) -> bool {
        !self.is_capturing() && self.mode != Mode::Speaking
    }

    pub fn set_mode(&mut self, mode: Mode, conversation_ms: Option<u64>, now: u64) {
        if self.mode == Mode::Speaking && mode != Mode::Speaking {
            self.quiet_until = now + AFTER_SPEECH_QUIET_MS;
        }
        self.mode = mode;
        self.speech_run_start = None;
        self.conversation_until = match mode {
            Mode::Conversation => Some(now + conversation_ms.unwrap_or(6000)),
            _ => None,
        };
    }

    fn start(&mut self, trigger: Trigger, now: u64, ptt: bool) -> Option<Action> {
        if self.is_capturing() {
            // PTT pressed during a wake-word capture takes over the end condition.
            if let Phase::Capturing { ptt: p, .. } = &mut self.phase {
                *p |= ptt;
            }
            return None;
        }
        self.phase = Phase::Capturing {
            trigger,
            started: now,
            last_speech: None,
            ptt,
        };
        self.conversation_until = None;
        self.speech_run_start = None;
        Some(Action::Start(trigger))
    }

    pub fn wake(&mut self, trigger: Trigger, now: u64) -> Option<Action> {
        self.start(trigger, now, false)
    }

    pub fn ptt_down(&mut self, now: u64) -> Option<Action> {
        self.start(Trigger::PushToTalk, now, true)
    }

    pub fn ptt_up(&mut self) -> Option<Action> {
        match self.phase {
            Phase::Capturing {
                trigger,
                ptt: true,
                last_speech,
                ..
            } => {
                self.phase = Phase::Idle;
                Some(Action::End {
                    trigger,
                    reason: EndReason::PttReleased,
                    heard_speech: last_speech.is_some(),
                })
            }
            _ => None,
        }
    }

    /// One analysis frame: `speech` is the VAD decision for it.
    pub fn frame(&mut self, now: u64, speech: bool) -> Option<Action> {
        match self.phase {
            Phase::Idle => {
                if now < self.quiet_until {
                    self.speech_run_start = None;
                    return None;
                }
                if !speech {
                    self.speech_run_start = None;
                    if let Some(until) = self.conversation_until
                        && now > until
                    {
                        self.conversation_until = None;
                    }
                    return None;
                }
                let run_start = *self.speech_run_start.get_or_insert(now);
                if self.mode == Mode::Speaking
                    && self.barge_in_enabled
                    && now.saturating_sub(run_start) >= self.cfg.barge_in_ms
                {
                    return self.wake(Trigger::BargeIn, now);
                }
                if self.conversation_until.is_some_and(|u| now <= u) && self.mode != Mode::Speaking
                {
                    return self.wake(Trigger::Conversation, now);
                }
                None
            }
            Phase::Capturing {
                trigger,
                started,
                last_speech,
                ptt,
            } => {
                let last_speech = if speech { Some(now) } else { last_speech };
                self.phase = Phase::Capturing {
                    trigger,
                    started,
                    last_speech,
                    ptt,
                };
                let elapsed = now.saturating_sub(started);
                let end = |reason| Action::End {
                    trigger,
                    reason,
                    heard_speech: last_speech.is_some(),
                };
                if elapsed >= self.cfg.max_capture_ms {
                    self.phase = Phase::Idle;
                    return Some(end(EndReason::MaxDuration));
                }
                if ptt {
                    return None; // only PTT release (or the cap) ends a push-to-talk capture
                }
                let silent_for = now.saturating_sub(last_speech.unwrap_or(started));
                let limit = if last_speech.is_some() {
                    self.cfg.silence_end_ms
                } else {
                    self.cfg.no_speech_timeout_ms
                };
                if silent_for >= limit {
                    self.phase = Phase::Idle;
                    return Some(end(EndReason::Silence));
                }
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(f: &mut Fsm, from: u64, to: u64, speech: bool) -> Vec<Action> {
        (from..to)
            .step_by(32)
            .filter_map(|t| f.frame(t, speech))
            .collect()
    }

    #[test]
    fn wake_word_capture_ends_after_silence() {
        let mut f = Fsm::new(Config::default());
        assert_eq!(
            f.wake(Trigger::WakeWord, 0),
            Some(Action::Start(Trigger::WakeWord))
        );
        assert!(feed(&mut f, 0, 2000, true).is_empty());
        let a = feed(&mut f, 2000, 4000, false);
        assert_eq!(
            a,
            vec![Action::End {
                trigger: Trigger::WakeWord,
                reason: EndReason::Silence,
                heard_speech: true
            }]
        );
        assert!(!f.is_capturing());
    }

    #[test]
    fn nothing_heard_after_wake_times_out() {
        let mut f = Fsm::new(Config::default());
        f.wake(Trigger::WakeWord, 0);
        let a = feed(&mut f, 0, 6000, false);
        assert!(matches!(
            a[..],
            [Action::End {
                heard_speech: false,
                reason: EndReason::Silence,
                ..
            }]
        ));
    }

    #[test]
    fn ptt_ignores_silence_and_ends_on_release() {
        let mut f = Fsm::new(Config::default());
        assert_eq!(f.ptt_down(0), Some(Action::Start(Trigger::PushToTalk)));
        assert!(feed(&mut f, 0, 5000, false).is_empty());
        assert_eq!(
            f.ptt_up(),
            Some(Action::End {
                trigger: Trigger::PushToTalk,
                reason: EndReason::PttReleased,
                heard_speech: false
            })
        );
        assert_eq!(f.ptt_up(), None);
    }

    #[test]
    fn capture_is_capped_at_30_s() {
        let mut f = Fsm::new(Config::default());
        f.ptt_down(0);
        let a = feed(&mut f, 0, 31_000, true);
        assert!(matches!(
            a[..],
            [Action::End {
                reason: EndReason::MaxDuration,
                ..
            }]
        ));
    }

    #[test]
    fn barge_in_needs_400_ms_of_speech_while_speaking() {
        let mut f = Fsm::new(Config::default());
        f.set_barge_in(true);
        f.set_mode(Mode::Speaking, None, 0);
        assert!(!f.wants_wake_word());
        // 300 ms burst, then silence: no barge-in.
        assert!(feed(&mut f, 0, 300, true).is_empty());
        assert!(feed(&mut f, 300, 600, false).is_empty());
        // Sustained speech: barge-in.
        let a = feed(&mut f, 600, 1200, true);
        assert_eq!(a.first(), Some(&Action::Start(Trigger::BargeIn)));
    }

    #[test]
    fn speaking_over_jarvis_does_nothing_unless_barge_in_is_enabled() {
        let mut f = Fsm::new(Config::default());
        f.set_mode(Mode::Speaking, None, 0);
        // Jarvis' own voice coming back through the microphone must not interrupt it.
        assert!(feed(&mut f, 0, 3000, true).is_empty());
    }

    #[test]
    fn the_microphone_is_ignored_right_after_jarvis_stops_speaking() {
        let mut f = Fsm::new(Config::default());
        f.set_mode(Mode::Speaking, None, 0);
        f.set_mode(Mode::Conversation, Some(6000), 1000);
        // The echo of the reply's tail (inside the quiet period) never starts a capture…
        assert!(feed(&mut f, 1000, 2400, true).is_empty());
        assert!(feed(&mut f, 2400, 2600, false).is_empty());
        // …but the user speaking after it does.
        let a = feed(&mut f, 2600, 3000, true);
        assert_eq!(a.first(), Some(&Action::Start(Trigger::Conversation)));
    }

    #[test]
    fn conversation_window_starts_capture_on_speech_then_expires() {
        let mut f = Fsm::new(Config::default());
        f.set_mode(Mode::Conversation, Some(2000), 0);
        assert_eq!(
            f.frame(500, true),
            Some(Action::Start(Trigger::Conversation))
        );

        let mut g = Fsm::new(Config::default());
        g.set_mode(Mode::Conversation, Some(2000), 0);
        assert!(feed(&mut g, 0, 2100, false).is_empty());
        assert_eq!(g.frame(2200, true), None, "window expired");
    }

    #[test]
    fn mode_parsing() {
        assert_eq!(Mode::parse("speaking"), Some(Mode::Speaking));
        assert_eq!(Mode::parse("nope"), None);
        assert_eq!(Trigger::BargeIn.as_str(), "barge-in");
    }
}
