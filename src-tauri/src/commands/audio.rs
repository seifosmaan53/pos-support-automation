use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

fn audio_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {}", e))?;
    let dir = base.join("audio");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create audio directory at {:?}: {}", dir, e))?;
    Ok(dir)
}

fn sanitize(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "recording.wav".into()
    } else {
        cleaned
    }
}

#[tauri::command]
pub async fn save_audio_file(
    app: AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = audio_dir(&app)?;
    let path = dir.join(sanitize(&filename));
    fs::write(&path, &bytes)
        .map_err(|e| format!("Could not write audio file at {:?}: {}", path, e))?;
    Ok(path.to_string_lossy().to_string())
}

/// Phase 11D — copy a user-chosen audio file into the app's audio
/// directory and return the new path. Used by the "Attach Existing
/// Recording" flow on the New Ticket page. We copy rather than move so the
/// user's original file is never destroyed.
///
/// Allowed extensions: wav / mp3 / m4a / webm / ogg. Any other extension
/// returns an error so we never accept random files (e.g. an .exe) into the
/// audio directory.
#[tauri::command]
pub async fn import_audio_file(
    app: AppHandle,
    source_path: String,
) -> Result<String, String> {
    const ALLOWED: &[&str] = &["wav", "mp3", "m4a", "webm", "ogg"];
    let src = std::path::Path::new(&source_path);
    if !src.exists() {
        return Err(format!("File not found at: {}", source_path));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .ok_or_else(|| "File has no extension".to_string())?;
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported audio format: .{}. Allowed formats: {}.",
            ext,
            ALLOWED.join(", ")
        ));
    }
    let dir = audio_dir(&app)?;
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .map(sanitize)
        .unwrap_or_else(|| "imported".to_string());
    let ts = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = dir.join(format!("imported-{}-{}.{}", ts, stem, ext));
    fs::copy(src, &dest)
        .map_err(|e| format!("Could not copy {} to {:?}: {}", source_path, dest, e))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_audio_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() {
        fs::remove_file(p)
            .map_err(|e| format!("Could not delete audio file at {}: {}", path, e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Could not read audio file at {}: {}", path, e))
}

#[tauri::command]
pub async fn audio_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(audio_dir(&app)?.to_string_lossy().to_string())
}

/// One entry returned by `list_audio_files`.
///
/// `modified_ms` is millis since the Unix epoch (or 0 if the platform did
/// not give us mtime). The frontend uses it to sort newest-first and to
/// show "recorded N minutes ago" without needing a second IPC roundtrip.
#[derive(serde::Serialize)]
pub struct AudioFileEntry {
    pub path: String,
    pub filename: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

/// List every `.wav` file currently sitting in the app's audio directory.
/// Used by the "Recover unlinked recordings" panel in History to surface
/// audio files that were written to disk but never linked to a ticket
/// (e.g. when the user recorded, didn't click Save Ticket, then closed
/// the app or started a new recording).
///
/// Non-recursive on purpose — the audio directory is flat by design and
/// recursion would let us accidentally surface files from other features
/// later.
#[tauri::command]
pub async fn list_audio_files(app: AppHandle) -> Result<Vec<AudioFileEntry>, String> {
    let dir = audio_dir(&app)?;
    let read = match fs::read_dir(&dir) {
        Ok(r) => r,
        Err(e) => return Err(format!("Could not read audio dir at {:?}: {}", dir, e)),
    };
    let mut out: Vec<AudioFileEntry> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("wav"))
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        out.push(AudioFileEntry {
            path: path.to_string_lossy().to_string(),
            filename,
            size_bytes: meta.len(),
            modified_ms,
        });
    }
    out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(out)
}

/// Reveal the audio file in the platform's file manager (Finder on macOS,
/// Explorer on Windows, default file manager on Linux). Falls back to opening
/// the parent directory if a per-file reveal isn't available on the platform.
#[tauri::command]
pub async fn reveal_audio_file(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Audio file not found at {}", path));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Could not reveal {}: {}", path, e))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Could not reveal {}: {}", path, e))?;
        return Ok(());
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let dir = p
            .parent()
            .ok_or_else(|| format!("Could not resolve parent directory of {}", path))?;
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Could not open {}: {}", dir.display(), e))?;
        Ok(())
    }
}
