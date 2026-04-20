mod collection;

use std::sync::{Arc, Mutex, Condvar};
use std::collections::VecDeque;
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use crate::collection::FileItem;

struct WaveformTask {
    id: String,
    relative_path: String,
    normalize: bool,
}

struct WaveformQueue {
    tasks: Mutex<VecDeque<WaveformTask>>,
    cvar: Condvar,
}

struct AppState {
    collection_path: Mutex<Option<PathBuf>>,
    waveform_queue: Arc<WaveformQueue>,
}

fn queue_missing_waveforms(folder_path: &PathBuf, queue: &Arc<WaveformQueue>, normalize: bool) -> Result<Vec<String>, String> {
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    
    // Find files that don't have a waveform yet
    let mut stmt = conn.prepare(
        "SELECT id, filepath FROM files WHERE id NOT IN (SELECT id FROM waveforms)"
    ).map_err(|e| e.to_string())?;
    
    let missing_iter = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    let mut added_ids = Vec::new();
    let mut tasks = queue.tasks.lock().unwrap();
    for row in missing_iter {
        if let Ok((id, relative_path)) = row {
            // Avoid duplicates in queue
            if !tasks.iter().any(|existing| existing.id == id) {
                added_ids.push(id.clone());
                tasks.push_back(WaveformTask {
                    id,
                    relative_path,
                    normalize,
                });
            }
        }
    }
    queue.cvar.notify_all();
    Ok(added_ids)
}

#[tauri::command]
fn open_collection(path: String, state: State<'_, AppState>) -> Result<(Vec<FileItem>, Vec<String>), String> {
    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Invalid folder path".to_string());
    }

    let conn = collection::init_db(&folder_path).map_err(|e| e.to_string())?;
    collection::scan_folder(&folder_path, &conn).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(&folder_path, &conn).map_err(|e| e.to_string())?;

    {
        let mut state_path = state.collection_path.lock().unwrap();
        *state_path = Some(folder_path.clone());
    }

    // Queue missing waveforms in background (default no normalize for existing files unless requested?)
    // Actually, if they are missing waveforms, they might also need normalization check.
    // But let's keep it simple: open_collection doesn't re-normalize.
    let missing_ids = queue_missing_waveforms(&folder_path, &state.waveform_queue, false).unwrap_or_default();

    Ok((files, missing_ids))
}

#[tauri::command]
fn get_collection_files(state: State<'_, AppState>) -> Result<Vec<FileItem>, String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    
    Ok(files)
}

#[tauri::command]
fn get_waveform(id: String, state: State<'_, AppState>) -> Result<Option<Vec<u8>>, String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT data FROM waveforms WHERE id = ?1").map_err(|e| e.to_string())?;
    let result: Option<Vec<u8>> = stmt.query_row([&id], |row| row.get(0)).ok();

    if result.is_none() {
        // Prioritize this waveform if it's missing
        let mut stmt = conn.prepare("SELECT filepath FROM files WHERE id = ?1").map_err(|e| e.to_string())?;
        if let Ok(relative_path) = stmt.query_row([&id], |row| row.get::<_, String>(0)) {
            let mut tasks = state.waveform_queue.tasks.lock().unwrap();
            // Remove if already in queue, then push to front
            tasks.retain(|t| t.id != id);
            tasks.push_front(WaveformTask { id, relative_path, normalize: false });
            state.waveform_queue.cvar.notify_all();
        }
    }

    Ok(result)
}

#[tauri::command]
fn relocate_file(id: String, new_path: String, action: String, state: State<'_, AppState>) -> Result<Vec<FileItem>, String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    
    let src_path = PathBuf::from(&new_path);
    if !src_path.exists() { return Err("File does not exist".to_string()); }

    let dest_path = if action == "link" {
        if !src_path.starts_with(folder_path) {
            return Err("Linked file must be inside the collection folder. Please choose Copy or Move instead.".to_string());
        }
        src_path
    } else {
        let filename = src_path.file_name().ok_or("Invalid filename")?;
        let d = folder_path.join(filename);
        if action == "move" {
            std::fs::rename(&src_path, &d).map_err(|e| e.to_string())?;
        } else {
            std::fs::copy(&src_path, &d).map_err(|e| e.to_string())?;
        }
        d
    };

    let relative_path = dest_path.strip_prefix(folder_path).map_err(|_| "Path calculation error")?;
    collection::update_file_path(&id, &relative_path.to_string_lossy(), &conn).map_err(|e| e.to_string())?;
    
    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
fn remove_file_from_collection(id: String, state: State<'_, AppState>) -> Result<Vec<FileItem>, String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    collection::remove_file(&id, &conn).map_err(|e| e.to_string())?;
    
    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
fn add_files_to_collection(
    files: Vec<String>, 
    action: String, 
    normalize: bool,
    state: State<'_, AppState>
) -> Result<(Vec<FileItem>, Vec<String>), String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    
    for file_path_str in files {
        let src_path = PathBuf::from(file_path_str);
        if !src_path.exists() { continue; }
        
        let filename = src_path.file_name().ok_or("Invalid filename")?;
        let dest_path = folder_path.join(filename);
        
        if action == "move" {
            std::fs::rename(&src_path, &dest_path).map_err(|e| e.to_string())?;
        } else {
            std::fs::copy(&src_path, &dest_path).map_err(|e| e.to_string())?;
        }
        
        let relative_path = dest_path.strip_prefix(folder_path).unwrap_or(&dest_path);
        let filepath_str = relative_path.to_string_lossy().to_string();

        if let Some(mut item) = collection::extract_metadata(&dest_path) {
            item.filepath = filepath_str;
            conn.execute(
                "INSERT OR IGNORE INTO files (id, filename, filepath, format, length, size, tags, gain) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    item.id,
                    item.filename,
                    item.filepath,
                    item.format,
                    item.length,
                    item.size,
                    serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string()),
                    item.gain
                ],
            ).map_err(|e| e.to_string())?;
        }
    }
    
    // Queue missing waveforms
    let missing_ids = queue_missing_waveforms(folder_path, &state.waveform_queue, normalize).unwrap_or_default();
    
    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok((files, missing_ids))
}

#[tauri::command]
fn regenerate_waveforms(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM waveforms", []).map_err(|e| e.to_string())?;
    
    // Clear the current queue
    {
        let mut tasks = state.waveform_queue.tasks.lock().unwrap();
        tasks.clear();
    }

    let missing_ids = queue_missing_waveforms(folder_path, &state.waveform_queue, false).unwrap_or_default();
    Ok(missing_ids)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let waveform_queue = Arc::new(WaveformQueue {
        tasks: Mutex::new(VecDeque::new()),
        cvar: Condvar::new(),
    });

    tauri::Builder::default()
        .manage(AppState {
            collection_path: Mutex::new(None),
            waveform_queue: Arc::clone(&waveform_queue),
        })
        .setup(move |app| {
            let handle = app.handle().clone();
            
            for _ in 0..4 {
                let handle = handle.clone();
                let queue = Arc::clone(&handle.state::<AppState>().waveform_queue);
                
                std::thread::spawn(move || {
                    loop {
                        let task = {
                            let mut tasks = queue.tasks.lock().unwrap();
                            while tasks.is_empty() {
                                tasks = queue.cvar.wait(tasks).unwrap();
                            }
                            tasks.pop_front().unwrap()
                        };

                        // Get collection path
                        let folder_path = handle.state::<AppState>().collection_path.lock().unwrap().clone();

                        if let Some(folder_path) = folder_path {
                            let full_path = folder_path.join(&task.relative_path);
                            
                            // Emit started event
                            let _ = handle.emit("waveform-started", task.id.clone());

                            if let Some((waveform, peak)) = collection::generate_waveform(&full_path) {
                                if let Ok(conn) = collection::init_db(&folder_path) {
                                    let _ = conn.execute(
                                        "INSERT OR REPLACE INTO waveforms (id, data) VALUES (?1, ?2)",
                                        rusqlite::params![task.id, waveform],
                                    );

                                    let mut final_gain = 1.0;
                                    if task.normalize {
                                        // Peak normalization to 0.7 to allow some headroom
                                        final_gain = if peak > 0.0 { 0.3 / peak } else { 1.0 };
                                        let _ = conn.execute(
                                            "UPDATE files SET gain = ?1 WHERE id = ?2",
                                            rusqlite::params![final_gain, task.id],
                                        );
                                    }

                                    // Emit event with gain
                                    let _ = handle.emit("waveform-generated", serde_json::json!({
                                        "id": task.id,
                                        "gain": final_gain
                                    }));
                                }
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            open_collection, 
            get_collection_files,
            get_waveform,
            add_files_to_collection,
            relocate_file,
            remove_file_from_collection,
            regenerate_waveforms
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
