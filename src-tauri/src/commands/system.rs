/// Phase 12 — system / portable mode commands.
///
/// These commands expose folder paths and "open in OS file manager" actions
/// that the System Health and Settings pages need for portable-build
/// readiness. They never read or write user data — that responsibility stays
/// in the `audio` module — so they're safe to expose without a guardrail.
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

/// Snapshot of every directory the app touches. Returned by `app_paths` for
/// the Portable Setup section. We compute existence at query time rather
/// than relying on Tauri's path resolver assuming the dir exists — the
/// `backup` and `audio` directories are only created lazily on first use.
#[derive(Serialize)]
pub struct AppPaths {
    pub app_data: String,
    pub audio: String,
    pub backup: String,
    pub models: String,
    pub tools: String,
    pub app_log: String,
    pub audio_exists: bool,
    pub backup_exists: bool,
    pub models_exists: bool,
    pub tools_exists: bool,
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {}", e))
}

fn exists_dir(p: &PathBuf) -> bool {
    p.is_dir()
}

#[tauri::command]
pub async fn app_paths(app: AppHandle) -> Result<AppPaths, String> {
    let base = app_data(&app)?;
    let audio = base.join("audio");
    let backup = base.join("backups");
    let models = base.join("models");
    let tools = base.join("tools");
    let app_log = base.join("logs");
    Ok(AppPaths {
        audio_exists: exists_dir(&audio),
        backup_exists: exists_dir(&backup),
        models_exists: exists_dir(&models),
        tools_exists: exists_dir(&tools),
        app_data: base.to_string_lossy().to_string(),
        audio: audio.to_string_lossy().to_string(),
        backup: backup.to_string_lossy().to_string(),
        models: models.to_string_lossy().to_string(),
        tools: tools.to_string_lossy().to_string(),
        app_log: app_log.to_string_lossy().to_string(),
    })
}

/// Open a folder in the OS file manager. macOS uses `open <dir>`, Windows
/// uses `explorer <dir>`, Linux uses `xdg-open`. We create the directory on
/// the fly if it's missing — opening a non-existent folder fails on every
/// platform we support, and the directory itself isn't sensitive (it's
/// already inside `app_data_dir`).
#[tauri::command]
pub async fn open_in_folder(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        fs::create_dir_all(p)
            .map_err(|e| format!("Could not create folder at {}: {}", path, e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Could not open {}: {}", path, e))?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Could not open {}: {}", path, e))?;
        return Ok(());
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Could not open {}: {}", path, e))?;
        Ok(())
    }
}

/// Returns true when each input path exists on disk. The frontend uses this
/// to detect "missing audio files" — rows in SQLite whose underlying WAV
/// has been moved/deleted outside the app.
#[tauri::command]
pub async fn check_paths_exist(paths: Vec<String>) -> Result<Vec<bool>, String> {
    Ok(paths
        .iter()
        .map(|p| std::path::Path::new(p).exists())
        .collect())
}

/// Write a UTF-8 text file to an absolute path. Used by Export Backup,
/// Export Settings, Export Diagnostics, Export Error Log. The frontend
/// builds the contents (so the format is owned by TypeScript) and asks the
/// Rust side to do the persistence so we can write outside the audio dir —
/// the user picks a destination via the Tauri save dialog.
///
/// Refuses to overwrite an existing file unless `overwrite` is true. The UI
/// passes `false` for the first try and re-asks the user before retrying
/// with `true`, so we never silently clobber.
#[tauri::command]
pub async fn write_text_file(
    path: String,
    contents: String,
    overwrite: bool,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if p.exists() && !overwrite {
        return Err(format!(
            "File already exists at {}. Re-run with overwrite=true to replace.",
            path
        ));
    }
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Could not create parent directory {:?}: {}", parent, e)
            })?;
        }
    }
    fs::write(p, contents.as_bytes())
        .map_err(|e| format!("Could not write {}: {}", path, e))
}

/// Read a UTF-8 text file from an absolute path. Used by Import Backup,
/// Import Settings. Returns the file contents as a string so the frontend
/// can parse / validate.
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {}", path, e))
}

/// Copy every active audio file into a destination folder. Used by the
/// "Export backup with audio" flow — the frontend writes the JSON backup
/// to `<dest>/backup.json` first, then calls this with the list of source
/// paths and `<dest>/audio` as the target. Returns the number of files
/// actually copied (skipping any whose source no longer exists, so a
/// missing-file mid-export doesn't tank the whole operation).
#[tauri::command]
pub async fn copy_audio_files(
    source_paths: Vec<String>,
    dest_dir: String,
) -> Result<u32, String> {
    let dest = std::path::Path::new(&dest_dir);
    fs::create_dir_all(dest)
        .map_err(|e| format!("Could not create dest dir at {}: {}", dest_dir, e))?;
    let mut copied: u32 = 0;
    for src in &source_paths {
        let sp = std::path::Path::new(src);
        if !sp.exists() {
            continue;
        }
        let filename = sp
            .file_name()
            .map(|n| n.to_owned())
            .unwrap_or_else(|| std::ffi::OsString::from(format!(
                "audio-{}.wav",
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            )));
        let target = dest.join(filename);
        if let Err(e) = fs::copy(sp, &target) {
            // Skip on per-file error rather than aborting — the user still
            // gets the backup with whatever files succeeded.
            eprintln!("[backup] copy {} → {:?} failed: {}", src, target, e);
            continue;
        }
        copied += 1;
    }
    Ok(copied)
}
