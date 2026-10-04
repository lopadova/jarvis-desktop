//! Secrets live only in the OS keyring (security-model R6): Keychain / Windows Credential Manager /
//! Secret Service. The store is behind a trait so the host handlers are testable with a mock.

use std::collections::HashMap;
use std::sync::Mutex;

pub const SERVICE: &str = "dev.lopadova.jarvis";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SecretError {
    #[error("invalid secret key")]
    InvalidKey,
    #[error("secret too large")]
    TooLarge,
    #[error("keyring unavailable: {0}")]
    Unavailable(String),
}

pub trait SecretStore: Send + Sync {
    fn get(&self, key: &str) -> Result<Option<String>, SecretError>;
    fn set(&self, key: &str, value: &str) -> Result<(), SecretError>;
    fn delete(&self, key: &str) -> Result<(), SecretError>;
}

/// Keys are short identifiers chosen by the sidecar (e.g. `openai-api-key`, `chatgpt-oauth`).
/// Restricting the alphabet keeps them from being used as paths or injection vectors.
pub fn validate_key(key: &str) -> Result<(), SecretError> {
    let ok = !key.is_empty()
        && key.len() <= 64
        && key.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.' || b == b'_'
        });
    if ok {
        Ok(())
    } else {
        Err(SecretError::InvalidKey)
    }
}

const MAX_SECRET: usize = 16 * 1024;

/// Validating wrapper used by the host handlers, independent of the backing store.
pub struct Secrets<S: SecretStore> {
    store: S,
}

impl<S: SecretStore> Secrets<S> {
    pub fn new(store: S) -> Self {
        Self { store }
    }
    pub fn get(&self, key: &str) -> Result<Option<String>, SecretError> {
        validate_key(key)?;
        self.store.get(key)
    }
    pub fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        validate_key(key)?;
        if value.len() > MAX_SECRET {
            return Err(SecretError::TooLarge);
        }
        self.store.set(key, value)
    }
    pub fn delete(&self, key: &str) -> Result<(), SecretError> {
        validate_key(key)?;
        self.store.delete(key)
    }
}

/// The real OS keyring.
pub struct KeyringStore;

impl KeyringStore {
    fn entry(key: &str) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(SERVICE, key).map_err(|e| SecretError::Unavailable(e.to_string()))
    }

    /// Initialises the platform store (used by `--self-test`).
    pub fn status() -> Result<(), String> {
        keyring::Entry::store_status()
            .as_ref()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

impl SecretStore for KeyringStore {
    fn get(&self, key: &str) -> Result<Option<String>, SecretError> {
        match Self::entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Unavailable(e.to_string())),
        }
    }
    fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        Self::entry(key)?
            .set_password(value)
            .map_err(|e| SecretError::Unavailable(e.to_string()))
    }
    fn delete(&self, key: &str) -> Result<(), SecretError> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Unavailable(e.to_string())),
        }
    }
}

/// Windows Credential Manager rejects values longer than 2560 UTF-16 units, which an OAuth token bundle exceeds.
/// Long values are split over several entries (`<key>.part<i>`); the main entry then holds a small marker.
/// Short values are stored as-is, so existing entries keep working.
pub struct Chunked<S: SecretStore> {
    inner: S,
    chunk_chars: usize,
}

const CHUNK_MARK: &str = "jarvis-chunks:";

impl<S: SecretStore> Chunked<S> {
    pub fn new(inner: S, chunk_chars: usize) -> Self {
        Self { inner, chunk_chars }
    }

    fn part_key(key: &str, i: usize) -> String {
        format!("{key}.part{i}")
    }

    fn parts_of(&self, key: &str) -> Result<usize, SecretError> {
        Ok(match self.inner.get(key)? {
            Some(v) => v
                .strip_prefix(CHUNK_MARK)
                .and_then(|n| n.parse().ok())
                .unwrap_or(0),
            None => 0,
        })
    }
}

impl<S: SecretStore> SecretStore for Chunked<S> {
    fn get(&self, key: &str) -> Result<Option<String>, SecretError> {
        let Some(head) = self.inner.get(key)? else {
            return Ok(None);
        };
        let Some(n) = head
            .strip_prefix(CHUNK_MARK)
            .and_then(|n| n.parse::<usize>().ok())
        else {
            return Ok(Some(head));
        };
        let mut out = String::new();
        for i in 0..n {
            match self.inner.get(&Self::part_key(key, i))? {
                Some(p) => out.push_str(&p),
                None => return Ok(None), // torn write: treat as missing rather than return a truncated secret
            }
        }
        Ok(Some(out))
    }

    fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        let old_parts = self.parts_of(key)?;
        let chars: Vec<char> = value.chars().collect();
        let new_parts = if chars.len() <= self.chunk_chars {
            self.inner.set(key, value)?;
            0
        } else {
            let pieces: Vec<String> = chars
                .chunks(self.chunk_chars)
                .map(|c| c.iter().collect())
                .collect();
            for (i, p) in pieces.iter().enumerate() {
                self.inner.set(&Self::part_key(key, i), p)?;
            }
            // The marker goes last: readers never see a marker whose parts are missing.
            self.inner
                .set(key, &format!("{CHUNK_MARK}{}", pieces.len()))?;
            pieces.len()
        };
        for i in new_parts..old_parts {
            self.inner.delete(&Self::part_key(key, i))?;
        }
        Ok(())
    }

    fn delete(&self, key: &str) -> Result<(), SecretError> {
        let n = self.parts_of(key)?;
        self.inner.delete(key)?;
        for i in 0..n {
            self.inner.delete(&Self::part_key(key, i))?;
        }
        Ok(())
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore {
    map: Mutex<HashMap<String, String>>,
}

impl SecretStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<String>, SecretError> {
        Ok(self.map.lock().expect("poisoned").get(key).cloned())
    }
    fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
        self.map
            .lock()
            .expect("poisoned")
            .insert(key.to_string(), value.to_string());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<(), SecretError> {
        self.map.lock().expect("poisoned").remove(key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_with_mock_store() {
        let s = Secrets::new(MemoryStore::default());
        assert_eq!(s.get("openai-api-key"), Ok(None));
        s.set("openai-api-key", "sk-test").unwrap();
        assert_eq!(s.get("openai-api-key"), Ok(Some("sk-test".into())));
        s.delete("openai-api-key").unwrap();
        assert_eq!(s.get("openai-api-key"), Ok(None));
        // Deleting a missing key is not an error.
        s.delete("openai-api-key").unwrap();
    }

    #[test]
    fn rejects_bad_keys_and_oversized_values() {
        let s = Secrets::new(MemoryStore::default());
        for bad in ["", "../x", "A", "a b", "k\0", &"x".repeat(65)] {
            assert_eq!(s.set(bad, "v"), Err(SecretError::InvalidKey), "{bad:?}");
            assert_eq!(s.get(bad), Err(SecretError::InvalidKey));
        }
        assert_eq!(
            s.set("ok-key", &"v".repeat(MAX_SECRET + 1)),
            Err(SecretError::TooLarge)
        );
    }
    /// A store that, like Windows Credential Manager, refuses values over a size limit.
    struct Limited {
        inner: MemoryStore,
        max: usize,
    }
    impl SecretStore for Limited {
        fn get(&self, key: &str) -> Result<Option<String>, SecretError> {
            self.inner.get(key)
        }
        fn set(&self, key: &str, value: &str) -> Result<(), SecretError> {
            if value.encode_utf16().count() > self.max {
                return Err(SecretError::Unavailable(
                    "longer than the platform limit".into(),
                ));
            }
            self.inner.set(key, value)
        }
        fn delete(&self, key: &str) -> Result<(), SecretError> {
            self.inner.delete(key)
        }
    }

    fn limited() -> Chunked<Limited> {
        Chunked::new(
            Limited {
                inner: MemoryStore::default(),
                max: 2560,
            },
            1000,
        )
    }

    #[test]
    fn large_secrets_are_split_and_reassembled() {
        let s = limited();
        let big: String = (0..9000)
            .map(|i| char::from(b'a' + (i % 26) as u8))
            .collect();
        s.set("chatgpt-plan", &big).unwrap();
        assert_eq!(
            s.get("chatgpt-plan").unwrap().as_deref(),
            Some(big.as_str())
        );
        // Non-ASCII survives chunking intact.
        let uni = "àé€🙂".repeat(900);
        s.set("uni", &uni).unwrap();
        assert_eq!(s.get("uni").unwrap().as_deref(), Some(uni.as_str()));
    }

    #[test]
    fn short_secrets_stay_single_entry_and_shrinking_cleans_parts() {
        let s = limited();
        s.set("k", "short").unwrap();
        assert_eq!(s.get("k").unwrap().as_deref(), Some("short"));
        assert_eq!(s.inner.get("k.part0").unwrap(), None);
        s.set("k", &"x".repeat(5000)).unwrap();
        assert!(s.inner.get("k.part4").unwrap().is_some());
        s.set("k", &"y".repeat(1500)).unwrap();
        assert_eq!(s.inner.get("k.part2").unwrap(), None, "stale parts removed");
        assert_eq!(s.get("k").unwrap().unwrap().len(), 1500);
        s.delete("k").unwrap();
        assert_eq!(s.get("k").unwrap(), None);
        assert_eq!(s.inner.get("k.part0").unwrap(), None);
    }

    #[test]
    fn torn_chunked_secret_reads_as_missing() {
        let s = limited();
        s.set("t", &"z".repeat(4000)).unwrap();
        s.inner.delete("t.part2").unwrap();
        assert_eq!(s.get("t").unwrap(), None);
    }
}
