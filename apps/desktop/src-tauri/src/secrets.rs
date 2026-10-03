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
}
