mod collection;

use std::sync::Mutex;
use std::path::PathBuf;
use tauri::State;
use crate::collection::FileItem;

struct AppState {
    collection_path: Mutex<Option<PathBuf>>,
}

#[tauri::command]
fn open_collection(path: String, state: State<'_, AppState>) -> Result<Vec<FileItem>, String> {
    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Invalid folder path".to_string());
    }

    let conn = collection::init_db(&folder_path).map_err(|e| e.to_string())?;
    collection::scan_folder(&folder_path, &conn).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(&folder_path, &conn).map_err(|e| e.to_string())?;

    let mut state_path = state.collection_path.lock().unwrap();
    *state_path = Some(folder_path);

    Ok(files)
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
fn relocate_file(id: String, new_path: String, action: String, state: State<'_, AppState>) -> Result<Vec<FileItem>, String> {
    let state_path = state.collection_path.lock().unwrap();
    let folder_path = state_path.as_ref().ok_or("No collection open")?;
    
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    
    let src_path = PathBuf::from(&new_path);
    if !src_path.exists() { return Err("File does not exist".to_string()); }

    let dest_path = if action == "link" {
        // Verify it's already in the collection folder
        if !src_path.starts_with(folder_path) {
            return Err("Linked file must be inside the collection folder. Please choose Copy or Move instead.".to_string());
        }
        src_path
    } else {
        // Copy or Move to collection folder
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
    state: State<'_, AppState>
) -> Result<Vec<FileItem>, String> {
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
        
        // Use relative path for the database
        let relative_path = dest_path.strip_prefix(folder_path).unwrap_or(&dest_path);
        let filepath_str = relative_path.to_string_lossy().to_string();

        if let Some(mut item) = collection::extract_metadata(&dest_path) {
            item.filepath = filepath_str;
            conn.execute(
                "INSERT OR IGNORE INTO files (id, filename, filepath, format, length, size, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    item.id,
                    item.filename,
                    item.filepath,
                    item.format,
                    item.length,
                    item.size,
                    serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string())
                ],
            ).map_err(|e| e.to_string())?;
        }
    }
    
    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            collection_path: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            open_collection, 
            get_collection_files,
            add_files_to_collection,
            relocate_file,
            remove_file_from_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
