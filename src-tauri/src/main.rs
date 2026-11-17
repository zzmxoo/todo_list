#![windows_subsystem = "windows"]

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = data_dir(&app)?.join("data.json");
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("data.json");
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, &path).is_err() {
        fs::copy(&tmp, &path).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(())
}

/// 选择背景图片并复制到应用数据目录，返回复制后的绝对路径。
#[tauri::command]
fn pick_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("选择背景图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "bmp", "webp", "gif"])
        .pick_file();

    let Some(src) = picked else {
        return Ok(None);
    };

    let dir = data_dir(&app)?;
    let ext = src
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dst = dir.join(format!("bg-{stamp}.{ext}"));
    fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(Some(dst.to_string_lossy().to_string()))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_state, save_state, pick_image])
        .run(tauri::generate_context!())
        .expect("failed to run desktop todo widget");
}
