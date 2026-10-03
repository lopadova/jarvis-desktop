//! `jarvis://` deep links — inert by design (security-model R3).
//!
//! Same semantics as `packages/core/src/deeplink.ts` `parseDeepLink`: a link may only *show* a UI
//! surface. Anything else — unknown hosts, extra text, commands, malformed pairing codes — is
//! ignored (`None`). A deep link can never carry an utterance or trigger an action.

use url::Url;

pub const SETTINGS_TABS: [&str; 9] = [
    "general",
    "brain",
    "agents",
    "voice",
    "microphone",
    "privacy",
    "integrations",
    "shortcuts",
    "about",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkTarget {
    ShowHome,
    ShowSessions,
    OpenSettings {
        tab: Option<&'static str>,
    },
    /// The code is only displayed for confirmation; it never authorises anything by itself.
    Pair {
        code: String,
    },
}

fn valid_pair_code(code: &str) -> bool {
    (6..=12).contains(&code.len())
        && code
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

pub fn parse_deep_link(raw: &str) -> Option<DeepLinkTarget> {
    let url = Url::parse(raw).ok()?;
    if url.scheme() != "jarvis" {
        return None;
    }
    // jarvis://settings/voice → host "settings", path "/voice".
    // jarvis:settings/voice (no authority) → path "settings/voice".
    let (host, rest): (String, String) = match url.host_str() {
        Some(h) if !h.is_empty() => (
            h.to_string(),
            url.path().trim_start_matches('/').to_string(),
        ),
        _ => {
            let path = url.path().trim_start_matches('/');
            let mut parts = path.splitn(2, '/');
            let host = parts.next().unwrap_or_default().to_string();
            let rest = parts.next().unwrap_or_default().to_string();
            (host, rest)
        }
    };
    match host.as_str() {
        "home" => Some(DeepLinkTarget::ShowHome),
        "sessions" => Some(DeepLinkTarget::ShowSessions),
        "settings" => {
            let tab = SETTINGS_TABS.iter().copied().find(|t| *t == rest);
            Some(DeepLinkTarget::OpenSettings { tab })
        }
        "pair" => {
            let code = url
                .query_pairs()
                .find(|(k, _)| k == "code")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default();
            valid_pair_code(&code).then_some(DeepLinkTarget::Pair { code })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shows_surfaces() {
        assert_eq!(
            parse_deep_link("jarvis://home"),
            Some(DeepLinkTarget::ShowHome)
        );
        assert_eq!(
            parse_deep_link("jarvis://sessions"),
            Some(DeepLinkTarget::ShowSessions)
        );
        assert_eq!(
            parse_deep_link("jarvis://settings"),
            Some(DeepLinkTarget::OpenSettings { tab: None })
        );
        assert_eq!(
            parse_deep_link("jarvis://settings/voice"),
            Some(DeepLinkTarget::OpenSettings { tab: Some("voice") })
        );
        assert_eq!(
            parse_deep_link("jarvis:settings/privacy"),
            Some(DeepLinkTarget::OpenSettings {
                tab: Some("privacy")
            })
        );
    }

    #[test]
    fn unknown_settings_tab_falls_back_to_settings() {
        assert_eq!(
            parse_deep_link("jarvis://settings/../../etc"),
            Some(DeepLinkTarget::OpenSettings { tab: None })
        );
        assert_eq!(
            parse_deep_link("jarvis://settings/rm -rf"),
            Some(DeepLinkTarget::OpenSettings { tab: None })
        );
    }

    #[test]
    fn pairing_code_is_validated() {
        assert_eq!(
            parse_deep_link("jarvis://pair?code=K7Q2M9XD"),
            Some(DeepLinkTarget::Pair {
                code: "K7Q2M9XD".into()
            })
        );
        assert_eq!(parse_deep_link("jarvis://pair?code=abc"), None);
        assert_eq!(parse_deep_link("jarvis://pair?code=K7Q2M9XD;rm"), None);
        assert_eq!(parse_deep_link("jarvis://pair"), None);
        assert_eq!(
            parse_deep_link("jarvis://pair?code=ABCDEFGHIJKLMNOP"),
            None,
            "too long"
        );
    }

    #[test]
    fn r3_actions_and_utterances_are_ignored() {
        for raw in [
            "jarvis://run?cmd=rm%20-rf%20~",
            "jarvis://say?text=delete%20my%20documents",
            "jarvis://turn?text=hello",
            "jarvis://approve?id=1",
            "jarvis://exec/rm",
            "http://home",
            "javascript:alert(1)",
            "jarvis-evil://home",
            "not a url",
            "",
        ] {
            assert_eq!(parse_deep_link(raw), None, "{raw} must be inert");
        }
    }

    #[test]
    fn extra_query_never_changes_the_target() {
        assert_eq!(
            parse_deep_link("jarvis://home?text=delete%20everything"),
            Some(DeepLinkTarget::ShowHome)
        );
    }
}
