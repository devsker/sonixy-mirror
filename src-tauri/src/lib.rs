mod collection;

use crate::collection::FileItem;
use rayon::prelude::*;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use std::collections::VecDeque;
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

struct WaveformTask {
    id: String,
    relative_path: String,
    normalize: bool,
}

#[derive(Clone, serde::Serialize)]
struct WaveformProgress {
    id: String,
    progress: f32,
}

struct WaveformQueue {
    tasks: Mutex<VecDeque<WaveformTask>>,
    cvar: Condvar,
}

use std::sync::atomic::{AtomicBool, Ordering};

struct AudioState {
    _handle: OutputStreamHandle,
    sink: Mutex<Sink>,
    global_volume: Mutex<f32>,
    current_file_gain: Mutex<f32>,
    start_instant: Mutex<Option<Instant>>,
    elapsed_before_pause: Mutex<Duration>,
    suppress_ended: Arc<AtomicBool>,
}

struct AppState {
    collection_path: Mutex<Option<PathBuf>>,
    waveform_queue: Arc<WaveformQueue>,
    audio: AudioState,
}

fn queue_missing_waveforms(
    folder_path: &PathBuf,
    queue: &Arc<WaveformQueue>,
    normalize: bool,
) -> Result<Vec<String>, String> {
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;

    // Find files that don't have a waveform yet
    let mut stmt = conn
        .prepare("SELECT id, filepath FROM files WHERE id NOT IN (SELECT id FROM waveforms)")
        .map_err(|e| e.to_string())?;

    let missing_iter = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut added_ids = Vec::new();
    let mut tasks = queue
        .tasks
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
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
async fn open_collection(
    path: String,
    state: State<'_, AppState>,
) -> Result<(Vec<FileItem>, Vec<String>), String> {
    let folder_path = PathBuf::from(&path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Invalid folder path".to_string());
    }

    let conn = collection::init_db(&folder_path).map_err(|e| e.to_string())?;
    collection::scan_folder(&folder_path, &conn).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(&folder_path, &conn).map_err(|e| e.to_string())?;

    {
        let mut state_path = state
            .collection_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *state_path = Some(folder_path.clone());
    }

    // Queue missing waveforms in background (default no normalize for existing files unless requested?)
    // Actually, if they are missing waveforms, they might also need normalization check.
    // But let's keep it simple: open_collection doesn't re-normalize.
    let missing_ids =
        queue_missing_waveforms(&folder_path, &state.waveform_queue, false).unwrap_or_default();

    Ok((files, missing_ids))
}

#[tauri::command]
fn get_collection_files(state: State<'_, AppState>) -> Result<Vec<FileItem>, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;

    Ok(files)
}

#[tauri::command]
fn get_waveform(id: String, state: State<'_, AppState>) -> Result<Option<Vec<u8>>, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM waveforms WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let result: Option<Vec<u8>> = stmt.query_row([&id], |row| row.get(0)).ok();

    if result.is_none() {
        // Prioritize this waveform if it's missing
        let mut stmt = conn
            .prepare("SELECT filepath FROM files WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        if let Ok(relative_path) = stmt.query_row([&id], |row| row.get::<_, String>(0)) {
            let mut tasks = state
                .waveform_queue
                .tasks
                .lock()
                .map_err(|_| "State poisoned".to_string())?;
            // Remove if already in queue, then push to front
            tasks.retain(|t| t.id != id);
            tasks.push_front(WaveformTask {
                id,
                relative_path,
                normalize: false,
            });
            state.waveform_queue.cvar.notify_all();
        }
    }

    Ok(result)
}

#[tauri::command]
async fn relocate_file(
    id: String,
    new_path: String,
    action: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileItem>, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;

    let src_path = PathBuf::from(&new_path);
    if !src_path.exists() {
        return Err("File does not exist".to_string());
    }

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

    let relative_path = dest_path
        .strip_prefix(folder_path)
        .map_err(|_| "Path calculation error")?;
    collection::update_file_path(&id, &relative_path.to_string_lossy(), &conn)
        .map_err(|e| e.to_string())?;

    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
async fn remove_file_from_collection(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<FileItem>, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    collection::remove_file(&id, &conn).map_err(|e| e.to_string())?;

    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
async fn add_files_to_collection(
    files: Vec<String>,
    action: String,
    normalize: bool,
    state: State<'_, AppState>,
) -> Result<(Vec<FileItem>, Vec<String>), String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let folder_path_clone = folder_path.clone();
    let action_clone = action.clone();

    // Process files in parallel: copy/move and extract metadata
    let processed_items: Vec<Result<FileItem, String>> = files
        .into_par_iter()
        .filter_map(|file_path_str| {
            let src_path = PathBuf::from(file_path_str);
            if !src_path.exists() {
                return None;
            }

            let filename = match src_path.file_name().ok_or("Invalid filename") {
                Ok(f) => f,
                Err(e) => return Some(Err(e.to_string())),
            };
            let dest_path = folder_path_clone.join(filename);

            // Perform copy/move
            if action_clone == "move" {
                if let Err(e) = std::fs::rename(&src_path, &dest_path) {
                    return Some(Err(format!("Failed to move {}: {}", src_path.display(), e)));
                }
            } else {
                if let Err(e) = std::fs::copy(&src_path, &dest_path) {
                    return Some(Err(format!("Failed to copy {}: {}", src_path.display(), e)));
                }
            }

            // Extract metadata
            let relative_path = dest_path
                .strip_prefix(&folder_path_clone)
                .unwrap_or(&dest_path);
            let filepath_str = relative_path.to_string_lossy().to_string();

            if let Some(mut item) = collection::extract_metadata(&dest_path) {
                item.filepath = filepath_str;
                Some(Ok(item))
            } else {
                None
            }
        })
        .collect();

    let mut conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for item_res in processed_items {
        if let Ok(item) = item_res {
            tx.execute(
                "INSERT OR IGNORE INTO files (id, filename, filepath, format, length, duration, size, tags, gain) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    item.id,
                    item.filename,
                    item.filepath,
                    item.format,
                    item.length,
                    item.duration,
                    item.size,
                    serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string()),
                    item.gain
                ],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    // Queue missing waveforms
    let missing_ids =
        queue_missing_waveforms(folder_path, &state.waveform_queue, normalize).unwrap_or_default();

    let files = collection::get_all_files(folder_path, &conn).map_err(|e| e.to_string())?;
    Ok((files, missing_ids))
}

#[tauri::command]
fn regenerate_waveforms(normalize: bool, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM waveforms", [])
        .map_err(|e| e.to_string())?;

    // Clear the current queue
    {
        let mut tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        tasks.clear();
    }

    let missing_ids =
        queue_missing_waveforms(folder_path, &state.waveform_queue, normalize).unwrap_or_default();
    Ok(missing_ids)
}

#[tauri::command]
fn play_audio(path: String, gain: f32, state: State<'_, AppState>) -> Result<(), String> {
    let folder_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let full_path = if let Some(ref p) = *folder_path {
        p.join(path)
    } else {
        PathBuf::from(path)
    };

    let mut file = File::open(full_path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;
    
    let source = Decoder::new(Cursor::new(data)).map_err(|e| e.to_string())?;

    state.audio.suppress_ended.store(true, Ordering::SeqCst);
    let sink = state
        .audio
        .sink
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    sink.stop();

    {
        let mut g = state
            .audio
            .current_file_gain
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *g = gain;
        let vol = state
            .audio
            .global_volume
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        sink.set_volume(*vol * gain);
    }

    sink.append(source);
    sink.play();
    state.audio.suppress_ended.store(false, Ordering::SeqCst);

    {
        let mut start = state
            .audio
            .start_instant
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *start = Some(Instant::now());
        let mut elapsed = state
            .audio
            .elapsed_before_pause
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *elapsed = Duration::ZERO;
    }

    Ok(())
}

#[tauri::command]
fn pause_audio(state: State<'_, AppState>) {
    let Ok(sink) = state.audio.sink.lock() else {
        return;
    };
    if !sink.is_paused() {
        sink.pause();
        let Ok(mut start) = state.audio.start_instant.lock() else {
            return;
        };
        if let Some(s) = *start {
            let Ok(mut elapsed) = state.audio.elapsed_before_pause.lock() else {
                return;
            };
            *elapsed += s.elapsed();
            *start = None;
        }
    }
}

#[tauri::command]
fn resume_audio(state: State<'_, AppState>) {
    let Ok(sink) = state.audio.sink.lock() else {
        return;
    };
    if sink.is_paused() {
        sink.play();
        let Ok(mut start) = state.audio.start_instant.lock() else {
            return;
        };
        *start = Some(Instant::now());
    }
}

#[tauri::command]
fn stop_audio(state: State<'_, AppState>) {
    state.audio.suppress_ended.store(true, Ordering::SeqCst);
    let Ok(sink) = state.audio.sink.lock() else {
        return;
    };
    sink.stop();
    state.audio.suppress_ended.store(false, Ordering::SeqCst);
    let Ok(mut start) = state.audio.start_instant.lock() else {
        return;
    };
    *start = None;
    let Ok(mut elapsed) = state.audio.elapsed_before_pause.lock() else {
        return;
    };
    *elapsed = Duration::ZERO;
}

#[tauri::command]
fn set_volume(volume: f32, state: State<'_, AppState>) {
    let Ok(mut global_vol) = state.audio.global_volume.lock() else {
        return;
    };
    *global_vol = volume;
    let Ok(sink) = state.audio.sink.lock() else {
        return;
    };
    let Ok(gain) = state.audio.current_file_gain.lock() else {
        return;
    };
    sink.set_volume(volume * *gain);
}

#[tauri::command]
fn get_audio_time(state: State<'_, AppState>) -> f32 {
    let Ok(start) = state.audio.start_instant.lock() else {
        return 0.0;
    };
    let Ok(elapsed) = state.audio.elapsed_before_pause.lock() else {
        return 0.0;
    };

    if let Some(s) = *start {
        (*elapsed + s.elapsed()).as_secs_f32()
    } else {
        elapsed.as_secs_f32()
    }
}

#[tauri::command]
fn seek_audio(time_seconds: f32, state: State<'_, AppState>) -> Result<(), String> {
    println!("Seeking to {}s", time_seconds);
    let sink = state
        .audio
        .sink
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let duration = Duration::from_secs_f32(time_seconds);
    if let Err(e) = sink.try_seek(duration) {
        println!("Seek error: {}", e);
        return Err(e.to_string());
    }

    let mut start = state
        .audio
        .start_instant
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let mut elapsed = state
        .audio
        .elapsed_before_pause
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    *elapsed = duration;
    if start.is_some() {
        *start = Some(Instant::now());
    }
    Ok(())
}

#[tauri::command]
async fn prepare_drag_clip(
    id: String,
    start_pct: f32,
    end_pct: f32,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT filename, filepath FROM files WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let (filename, relative_path): (String, String) = stmt
        .query_row([&id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;

    let full_path = folder_path.join(relative_path);
    let temp_dir = std::env::temp_dir();
    let clip_filename = format!("clip_{}_{}", id, filename);
    let mut dest_path = temp_dir.join(clip_filename);
    if let Some(ext) = full_path.extension() {
        dest_path.set_extension(ext);
    }

    collection::trim_and_save(&full_path, &dest_path, start_pct, end_pct)?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn update_file_tags(
    id: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<FileItem, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?;

    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT filepath FROM files WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let relative_path: String = stmt
        .query_row([&id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let full_path = folder_path.join(&relative_path);
    if !full_path.exists() {
        return Err("File does not exist".to_string());
    }

    collection::update_tags(&full_path, tags, &id, &conn)?;

    let mut stmt = conn.prepare(
        "SELECT id, filename, filepath, format, length, duration, size, tags, gain FROM files WHERE id = ?1",
    ).map_err(|e| e.to_string())?;

    let item = stmt.query_row([&id], |row| {
        let tags_json: String = row.get(7)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        Ok(FileItem {
            id: row.get(0)?,
            filename: row.get(1)?,
            filepath: relative_path,
            format: row.get(3)?,
            length: row.get(4)?,
            duration: row.get(5)?,
            size: row.get(6)?,
            tags,
            gain: row.get(8)?,
            missing: false,
        })
    }).map_err(|e| e.to_string())?;

    Ok(item)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (stream, stream_handle) =
        OutputStream::try_default().expect("failed to find audio output device");
    Box::leak(Box::new(stream));
    let sink = Sink::try_new(&stream_handle).expect("failed to create audio sink");

    let audio_state = AudioState {
        _handle: stream_handle,
        sink: Mutex::new(sink),
        global_volume: Mutex::new(1.0),
        current_file_gain: Mutex::new(1.0),
        start_instant: Mutex::new(None),
        elapsed_before_pause: Mutex::new(Duration::ZERO),
        suppress_ended: Arc::new(AtomicBool::new(false)),
    };

    let waveform_queue = Arc::new(WaveformQueue {
        tasks: Mutex::new(VecDeque::new()),
        cvar: Condvar::new(),
    });

    tauri::Builder::default()
        .manage(AppState {
            collection_path: Mutex::new(None),
            waveform_queue: Arc::clone(&waveform_queue),
            audio: audio_state,
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            // Background thread for audio completion events
            let handle_ended = handle.clone();
            std::thread::spawn(move || {
                let mut was_empty = true;
                loop {
                    std::thread::sleep(Duration::from_millis(100));
                    let state = handle_ended.state::<AppState>();
                    let Ok(sink) = state.audio.sink.lock() else { break; };
                    let is_empty = sink.empty();
                    if !is_empty {
                        was_empty = false;
                    } else if !was_empty {
                        // Just became empty
                        if !state.audio.suppress_ended.load(Ordering::SeqCst) {
                            let _ = handle_ended.emit("audio-ended", ());
                        }
                        was_empty = true;
                    }
                }
            });

            for _ in 0..4 {
                let handle = handle.clone();
                let queue = Arc::clone(&handle.state::<AppState>().waveform_queue);

                std::thread::spawn(move || {
                    loop {
                        let task = {
                            let Ok(mut tasks) = queue.tasks.lock() else { break; };
                            while tasks.is_empty() {
                                tasks = match queue.cvar.wait(tasks) {
                                    Ok(t) => t,
                                    Err(_) => return,
                                };
                            }
                            let Some(task) = tasks.pop_front() else { continue; };
                            task
                        };

                        // Get collection path
                        let Ok(folder_path) = handle.state::<AppState>().collection_path.lock().map(|g| g.clone()) else { break; };

                        if let Some(folder_path) = folder_path {
                            let full_path = folder_path.join(&task.relative_path);

                            // Perform destructive normalization if requested
                            if task.normalize {
                                let _ = handle.emit("waveform-started", format!("{}-normalizing", task.id));
                                if let Err(e) = collection::normalize_file_destructive(&full_path) {
                                    eprintln!("Destructive normalization failed for {}: {}", task.id, e);
                                }
                            }

                            // Emit started event
                            let _ = handle.emit("waveform-started", task.id.clone());

                            let task_id = task.id.clone();
                            let handle_clone = handle.clone();
                            if let Some((waveform, _peak, _rms)) = collection::generate_waveform(&full_path, move |progress| {
                                let _ = handle_clone.emit("waveform-progress", WaveformProgress {
                                    id: task_id.clone(),
                                    progress,
                                });
                            }) {
                                if let Ok(conn) = collection::init_db(&folder_path) {
                                    let _ = conn.execute(
                                        "INSERT OR REPLACE INTO waveforms (id, data) VALUES (?1, ?2)",
                                        rusqlite::params![task.id, waveform],
                                    );

                                    // Since it's destructive normalization, the file is already at the target level.
                                    // We set gain to 1.0 in the DB because we don't need additional playback gain.
                                    // However, we still might want to re-extract metadata (size, duration might change slightly)
                                    if task.normalize {
                                        if let Some(meta) = collection::extract_metadata(&full_path) {
                                             let _ = conn.execute(
                                                "UPDATE files SET size = ?1, duration = ?2, length = ?3, gain = 1.0 WHERE id = ?4",
                                                rusqlite::params![meta.size, meta.duration, meta.length, task.id],
                                            );
                                        }
                                    }

                                    // Emit event
                                    let _ = handle.emit("waveform-generated", serde_json::json!({
                                        "id": task.id,
                                        "gain": 1.0
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
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            open_collection,
            get_collection_files,
            get_waveform,
            add_files_to_collection,
            relocate_file,
            remove_file_from_collection,
            regenerate_waveforms,
            play_audio,
            pause_audio,
            resume_audio,
            stop_audio,
            set_volume,
            get_audio_time,
            seek_audio,
            prepare_drag_clip,
            update_file_tags
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
