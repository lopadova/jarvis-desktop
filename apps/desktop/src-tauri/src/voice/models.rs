//! On-device model management: first-run download from the official sherpa-onnx GitHub releases
//! into `<dataDir>/models`, with size + SHA-256 verification, progress reporting and safe extraction.
//! Voice features that need a model stay disabled until it is present.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

const RELEASES: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Archive {
    /// A single file saved as `<dir>/<file>`.
    File,
    /// A `.tar.bz2` whose top-level directory becomes `<dir>`.
    TarBz2,
}

#[derive(Debug, Clone, Copy)]
pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub url_path: &'static str,
    pub size: u64,
    /// Pinned SHA-256. `None` only for assets too large to pin in this release (size is checked).
    pub sha256: Option<&'static str>,
    pub archive: Archive,
    /// Directory name under `models/`.
    pub dir: &'static str,
    /// Files that must exist (relative to `dir`) for the model to be "ready".
    pub files: &'static [&'static str],
}

pub const KWS: ModelSpec = ModelSpec {
    id: "kws",
    label: "Wake word (Zipformer KWS, 3.3M)",
    url_path: "kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2",
    size: 17_626_723,
    sha256: Some("f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a"),
    archive: Archive::TarBz2,
    dir: "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01",
    files: &[
        "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
        "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
        "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
        "tokens.txt",
    ],
};

pub const VAD: ModelSpec = ModelSpec {
    id: "vad",
    label: "Voice activity (Silero VAD)",
    url_path: "asr-models/silero_vad.onnx",
    size: 643_854,
    sha256: Some("9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"),
    archive: Archive::File,
    dir: "silero-vad",
    files: &["silero_vad.onnx"],
};

macro_rules! whisper {
    ($id:literal, $name:literal, $label:literal, $size:literal, $sha:expr) => {
        ModelSpec {
            id: concat!("whisper-", $id),
            label: $label,
            url_path: concat!("asr-models/sherpa-onnx-whisper-", $name, ".tar.bz2"),
            size: $size,
            sha256: $sha,
            archive: Archive::TarBz2,
            dir: concat!("sherpa-onnx-whisper-", $name),
            files: &[
                concat!($name, "-encoder.int8.onnx"),
                concat!($name, "-decoder.int8.onnx"),
                concat!($name, "-tokens.txt"),
            ],
        }
    };
}

pub const WHISPER: [ModelSpec; 5] = [
    whisper!(
        "tiny",
        "tiny",
        "Speech recognition (Whisper tiny)",
        116_204_861,
        Some("c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1")
    ),
    whisper!(
        "base",
        "base",
        "Speech recognition (Whisper base)",
        207_557_382,
        Some("911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de")
    ),
    whisper!(
        "small",
        "small",
        "Speech recognition (Whisper small)",
        639_387_718,
        Some("486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6")
    ),
    whisper!(
        "medium",
        "medium",
        "Speech recognition (Whisper medium)",
        1_931_372_882,
        None
    ),
    whisper!(
        "large-v3-turbo",
        "turbo",
        "Speech recognition (Whisper large-v3-turbo)",
        563_790_207,
        Some("b11acbbcd660b44a8e0df33724feb5aaa709cf65668f2823d59f656312544f22")
    ),
];

pub fn whisper_spec(setting: &str) -> &'static ModelSpec {
    WHISPER
        .iter()
        .find(|m| m.id.strip_prefix("whisper-") == Some(setting))
        .unwrap_or(&WHISPER[2])
}

/// Models needed for the current settings (KWS + VAD + the selected Whisper size).
pub fn needed(whisper_model: &str, local_stt: bool) -> Vec<&'static ModelSpec> {
    let mut v = vec![&KWS, &VAD];
    if local_stt {
        v.push(whisper_spec(whisper_model));
    }
    v
}

pub fn model_dir(root: &Path, spec: &ModelSpec) -> PathBuf {
    root.join(spec.dir)
}

pub fn is_ready(root: &Path, spec: &ModelSpec) -> bool {
    let d = model_dir(root, spec);
    spec.files.iter().all(|f| d.join(f).is_file())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: String,
    pub label: String,
    pub state: &'static str,
    pub received: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ModelStatus {
    pub fn of(root: &Path, spec: &ModelSpec) -> Self {
        let ready = is_ready(root, spec);
        Self {
            id: spec.id.into(),
            label: spec.label.into(),
            state: if ready { "ready" } else { "missing" },
            received: if ready { spec.size } else { 0 },
            total: spec.size,
            error: None,
        }
    }
}

pub fn verify(spec: &ModelSpec, len: u64, sha256_hex: &str) -> Result<(), String> {
    if len != spec.size {
        return Err(format!("size mismatch: expected {} got {len}", spec.size));
    }
    if let Some(expected) = spec.sha256
        && !expected.eq_ignore_ascii_case(sha256_hex)
    {
        return Err("checksum mismatch".into());
    }
    Ok(())
}

/// Downloads, verifies and installs one model. `progress(received, total, state)` is called often.
pub async fn download(
    root: &Path,
    spec: &ModelSpec,
    progress: impl Fn(u64, u64, &'static str),
) -> Result<(), String> {
    use futures_util::StreamExt;
    if is_ready(root, spec) {
        return Ok(());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let tmp = root.join(format!(".{}.download", spec.id));
    let url = format!("{RELEASES}/{}", spec.url_path);
    let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last_report = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received > spec.size {
            let _ = std::fs::remove_file(&tmp);
            return Err("download larger than expected".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        if received - last_report > 256 * 1024 {
            last_report = received;
            progress(received, spec.size, "downloading");
        }
    }
    drop(file);
    progress(received, spec.size, "verifying");
    let digest = hex::encode(hasher.finalize());
    if let Err(e) = verify(spec, received, &digest) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    let root_owned = root.to_path_buf();
    let spec_owned = *spec;
    let tmp_owned = tmp.clone();
    let res = tokio::task::spawn_blocking(move || install(&root_owned, &spec_owned, &tmp_owned))
        .await
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    res?;
    progress(spec.size, spec.size, "ready");
    Ok(())
}

fn install(root: &Path, spec: &ModelSpec, tmp: &Path) -> Result<(), String> {
    let target = model_dir(root, spec);
    match spec.archive {
        Archive::File => {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            let name = spec.files[0];
            std::fs::copy(tmp, target.join(name)).map_err(|e| e.to_string())?;
        }
        Archive::TarBz2 => {
            // Extract into a staging dir; `unpack` refuses entries escaping it (`..`, absolute paths).
            let staging = root.join(format!(".{}.staging", spec.id));
            let _ = std::fs::remove_dir_all(&staging);
            std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
            let f = std::fs::File::open(tmp).map_err(|e| e.to_string())?;
            let mut ar = tar::Archive::new(bzip2::read::BzDecoder::new(std::io::BufReader::new(f)));
            ar.unpack(&staging).map_err(|e| e.to_string())?;
            let extracted = staging.join(spec.dir);
            if !extracted.is_dir() {
                return Err("unexpected archive layout".into());
            }
            let _ = std::fs::remove_dir_all(&target);
            std::fs::rename(&extracted, &target).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_dir_all(&staging);
        }
    }
    if is_ready(root, spec) {
        Ok(())
    } else {
        Err("model files missing after install".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whisper_selection_and_needed_set() {
        assert_eq!(whisper_spec("small").id, "whisper-small");
        assert_eq!(
            whisper_spec("large-v3-turbo").dir,
            "sherpa-onnx-whisper-turbo"
        );
        assert_eq!(
            whisper_spec("bogus").id,
            "whisper-small",
            "falls back to the default"
        );
        assert_eq!(needed("tiny", true).len(), 3);
        assert_eq!(needed("tiny", false).len(), 2, "cloud STT needs no Whisper");
        assert_eq!(WHISPER[4].files[0], "turbo-encoder.int8.onnx");
    }

    #[test]
    fn verification_checks_size_and_hash() {
        let sha = VAD.sha256.unwrap();
        assert_eq!(verify(&VAD, VAD.size, sha), Ok(()));
        assert!(verify(&VAD, VAD.size - 1, sha).is_err());
        assert!(verify(&VAD, VAD.size, &"0".repeat(64)).is_err());
        // Unpinned assets still require the exact size.
        let medium = whisper_spec("medium");
        assert_eq!(verify(medium, medium.size, "anything"), Ok(()));
        assert!(verify(medium, 1, "anything").is_err());
    }

    #[test]
    fn readiness_is_based_on_files() {
        let root =
            std::env::temp_dir().join(format!("jarvis-models-{}", crate::sidecar::new_token()));
        assert!(!is_ready(&root, &VAD));
        std::fs::create_dir_all(model_dir(&root, &VAD)).unwrap();
        std::fs::write(model_dir(&root, &VAD).join("silero_vad.onnx"), b"x").unwrap();
        assert!(is_ready(&root, &VAD));
        assert_eq!(ModelStatus::of(&root, &VAD).state, "ready");
        assert_eq!(ModelStatus::of(&root, &KWS).state, "missing");
        let _ = std::fs::remove_dir_all(&root);
    }
}
