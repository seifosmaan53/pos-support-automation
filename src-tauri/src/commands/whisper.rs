use std::path::Path;
use std::process::Command;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperResult {
    pub text: String,
    pub stderr_tail: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperTestResult {
    pub ok: bool,
    pub executable_ok: bool,
    pub model_ok: bool,
    pub model_size_bytes: u64,
    pub version: String,
    pub message: String,
}

fn tail_lines(text: &str, n: usize) -> String {
    let collected: Vec<&str> = text.lines().collect();
    let start = collected.len().saturating_sub(n);
    collected[start..].join("\n")
}

#[tauri::command]
pub async fn transcribe_audio(
    audio_path: String,
    whisper_path: String,
    model_path: String,
    language: String,
    threads: u32,
    prompt: Option<String>,
) -> Result<WhisperResult, String> {
    let whisper_path = whisper_path.trim().to_string();
    let model_path = model_path.trim().to_string();
    let audio_path = audio_path.trim().to_string();
    let language = language.trim().to_string();
    let prompt = prompt.unwrap_or_default().trim().to_string();

    if whisper_path.is_empty() {
        return Err(
            "whisper.cpp executable path is empty. Set it in Settings → Local Transcription."
                .into(),
        );
    }
    if !Path::new(&whisper_path).exists() {
        return Err(format!(
            "whisper.cpp executable not found at: {}",
            whisper_path
        ));
    }
    if model_path.is_empty() {
        return Err(
            "Whisper model path is empty. Set it in Settings → Local Transcription.".into(),
        );
    }
    if !Path::new(&model_path).exists() {
        return Err(format!("Whisper model not found at: {}", model_path));
    }
    if !Path::new(&audio_path).exists() {
        return Err(format!("Audio file not found at: {}", audio_path));
    }

    let out_prefix = format!("{}.transcript", audio_path);
    let txt_path = format!("{}.txt", out_prefix);
    let _ = std::fs::remove_file(&txt_path);

    let mut cmd = Command::new(&whisper_path);
    cmd.arg("-m").arg(&model_path);
    cmd.arg("-f").arg(&audio_path);
    cmd.arg("-otxt");
    cmd.arg("-of").arg(&out_prefix);
    cmd.arg("-nt");
    if !language.trim().is_empty() {
        cmd.arg("-l").arg(&language);
    }
    if threads > 0 {
        cmd.arg("-t").arg(threads.to_string());
    }
    if !prompt.is_empty() {
        // whisper.cpp uses --prompt as a hint that conditions the decoder.
        // It only helps with vocabulary/spelling; the upper bound is ~224
        // tokens of context. Long prompts past that are silently truncated.
        cmd.arg("--prompt").arg(&prompt);
    }

    let output = cmd.output().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!(
            "whisper.cpp executable not found at: {}",
            whisper_path
        ),
        std::io::ErrorKind::PermissionDenied => format!(
            "Permission denied running: {}. Try: chmod +x {}",
            whisper_path, whisper_path
        ),
        _ => format!("Failed to run whisper.cpp: {}", e),
    })?;

    let stderr_text = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let tail = tail_lines(&stderr_text, 6);
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".into());
        return Err(format!(
            "whisper.cpp failed (exit {}). Output:\n{}",
            code, tail
        ));
    }

    let text = std::fs::read_to_string(&txt_path).map_err(|e| {
        format!(
            "whisper.cpp ran but no transcript file at {}: {}. Try a different model or check the audio file.",
            txt_path, e
        )
    })?;
    let _ = std::fs::remove_file(&txt_path);

    Ok(WhisperResult {
        text: text.trim().to_string(),
        stderr_tail: tail_lines(&stderr_text, 3),
    })
}

#[tauri::command]
pub async fn test_whisper(
    whisper_path: String,
    model_path: String,
) -> Result<WhisperTestResult, String> {
    let whisper_path = whisper_path.trim().to_string();
    let model_path = model_path.trim().to_string();

    let mut result = WhisperTestResult {
        ok: false,
        executable_ok: false,
        model_ok: false,
        model_size_bytes: 0,
        version: String::new(),
        message: String::new(),
    };

    if whisper_path.is_empty() {
        result.message = "whisper.cpp executable path is empty.".into();
        return Ok(result);
    }
    if !Path::new(&whisper_path).exists() {
        result.message = format!(
            "whisper.cpp executable not found at: {} (length {} chars). If you copied this from Settings, the saved value may include trailing whitespace or hidden characters.",
            whisper_path,
            whisper_path.chars().count()
        );
        return Ok(result);
    }

    match Command::new(&whisper_path).arg("--help").output() {
        Ok(out) => {
            result.executable_ok = true;
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            result.version = combined
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("")
                .trim()
                .chars()
                .take(120)
                .collect();
        }
        Err(e) => {
            result.message = match e.kind() {
                std::io::ErrorKind::PermissionDenied => format!(
                    "Permission denied running {}. Try: chmod +x {}",
                    whisper_path, whisper_path
                ),
                _ => format!("Could not run whisper.cpp executable: {}", e),
            };
            return Ok(result);
        }
    }

    if model_path.trim().is_empty() {
        result.message = format!(
            "Executable runs ({}). Model path is empty — set one in Settings.",
            if result.version.is_empty() {
                "version unknown"
            } else {
                &result.version
            }
        );
        return Ok(result);
    }
    let model_p = Path::new(&model_path);
    if !model_p.exists() {
        result.message = format!(
            "Executable runs. Model not found at: {}",
            model_path
        );
        return Ok(result);
    }
    let meta = std::fs::metadata(model_p)
        .map_err(|e| format!("Could not read model file metadata: {}", e))?;
    result.model_size_bytes = meta.len();
    result.model_ok = true;
    result.ok = true;
    let mb = (result.model_size_bytes as f64) / (1024.0 * 1024.0);
    let version_suffix = if result.version.is_empty() {
        String::new()
    } else {
        format!(" — {}", result.version)
    };
    result.message = format!(
        "Executable and model both ready ({:.0} MB){}.",
        mb, version_suffix
    );
    Ok(result)
}
