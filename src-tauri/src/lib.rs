mod audio_tempo;
mod collection;
mod ffmpeg;
mod library_archive;

use crate::collection::FileItem;
use rayon::prelude::*;
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

enum TaskType {
    Waveform { normalize: bool },
    Convert { id: String },
}

struct WaveformTask {
    id: String,
    collection_path: PathBuf,
    relative_path: String,
    task_type: TaskType,
}

#[derive(Clone, serde::Serialize)]
struct WaveformProgress {
    id: String,
    progress: f32,
    data: Option<Vec<u8>>,
}

struct WaveformQueue {
    tasks: Mutex<VecDeque<WaveformTask>>,
    cvar: Condvar,
    paused: AtomicBool,
    pause_mutex: Mutex<()>,
    pause_cvar: Condvar,
}

use std::sync::atomic::{AtomicBool, Ordering};

struct AudioState {
    _handle: OutputStreamHandle,
    sink: Mutex<Sink>,
    global_volume: Mutex<f32>,
    current_file_gain: Mutex<f32>,
    playback_speed: Mutex<f32>,
    pitch_preserved: Mutex<bool>,
    current_full_path: Mutex<Option<PathBuf>>,
    current_relative_path: Mutex<Option<String>>,
    tempo_cache: Mutex<HashMap<(String, u32), Vec<u8>>>,
    start_instant: Mutex<Option<Instant>>,
    elapsed_before_pause: Mutex<Duration>,
    suppress_ended: Arc<AtomicBool>,
}

fn tempo_cache_key(path: &Path, speed: f32) -> (String, u32) {
    (
        path.to_string_lossy().to_string(),
        (speed * 1000.0).round() as u32,
    )
}

fn get_playback_bytes(audio: &AudioState, full_path: &Path, speed: f32) -> Result<Vec<u8>, String> {
    if (speed - 1.0).abs() < 0.001 {
        return std::fs::read(full_path).map_err(|e| e.to_string());
    }

    let key = tempo_cache_key(full_path, speed);
    if let Ok(cache) = audio.tempo_cache.lock() {
        if let Some(bytes) = cache.get(&key) {
            return Ok(bytes.clone());
        }
    }

    let bytes = audio_tempo::decode_for_playback(full_path, speed, || {
        ffmpeg::create_ffmpeg_command(None)
    })?;

    if let Ok(mut cache) = audio.tempo_cache.lock() {
        if cache.len() >= 8 {
            if let Some(oldest) = cache.keys().next().cloned() {
                cache.remove(&oldest);
            }
        }
        cache.insert(key, bytes.clone());
    }

    Ok(bytes)
}

fn is_audio_playing(audio: &AudioState) -> bool {
    audio
        .start_instant
        .lock()
        .map(|start| start.is_some())
        .unwrap_or(false)
}

fn stream_seek_seconds(audio: &AudioState, original_seconds: f32) -> f32 {
    let speed = audio_playback_speed(audio);
    let pitch_preserved = audio
        .pitch_preserved
        .lock()
        .map(|v| *v)
        .unwrap_or(false);
    if pitch_preserved && (speed - 1.0).abs() >= 0.001 {
        original_seconds / speed
    } else {
        original_seconds
    }
}

fn load_audio_at(
    audio: &AudioState,
    full_path: &Path,
    relative_path: &str,
    gain: f32,
    speed: f32,
    start_original_seconds: f32,
    play: bool,
) -> Result<(), String> {
    let mut pitch_preserved = false;
    let bytes = match get_playback_bytes(audio, full_path, speed) {
        Ok(bytes) => {
            pitch_preserved = (speed - 1.0).abs() >= 0.001;
            bytes
        }
        Err(err) if (speed - 1.0).abs() >= 0.001 => {
            eprintln!("Pitch-preserving speed failed, falling back to rodio: {err}");
            std::fs::read(full_path).map_err(|e| e.to_string())?
        }
        Err(err) => return Err(err),
    };

    let source = Decoder::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;

    audio.suppress_ended.store(true, Ordering::SeqCst);
    let sink = audio
        .sink
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    sink.stop();

    {
        let mut g = audio
            .current_file_gain
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *g = gain;
        let vol = audio
            .global_volume
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        sink.set_volume(*vol * gain);
    }

    sink.append(source);
    if pitch_preserved {
        sink.set_speed(1.0);
    } else {
        sink.set_speed(speed);
    }

    let seek_pos = if pitch_preserved {
        start_original_seconds / speed
    } else {
        start_original_seconds
    };
    if seek_pos > 0.0 {
        let _ = sink.try_seek(Duration::from_secs_f32(seek_pos));
    }

    if play {
        sink.play();
    } else {
        sink.pause();
    }
    audio.suppress_ended.store(false, Ordering::SeqCst);

    {
        let mut path_slot = audio
            .current_full_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *path_slot = Some(full_path.to_path_buf());
        let mut rel_slot = audio
            .current_relative_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *rel_slot = Some(relative_path.to_string());
        let mut preserved = audio
            .pitch_preserved
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *preserved = pitch_preserved;
        let mut start = audio
            .start_instant
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *start = if play { Some(Instant::now()) } else { None };
        let mut elapsed = audio
            .elapsed_before_pause
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *elapsed = Duration::from_secs_f32(start_original_seconds);
    }

    Ok(())
}

fn audio_playback_speed(state: &AudioState) -> f32 {
    state
        .playback_speed
        .lock()
        .map(|speed| *speed)
        .unwrap_or(1.0)
}

fn audio_position_seconds(state: &AudioState) -> f32 {
    let speed = audio_playback_speed(state);
    let Ok(start) = state.start_instant.lock() else {
        return 0.0;
    };
    let Ok(elapsed) = state.elapsed_before_pause.lock() else {
        return 0.0;
    };

    if let Some(s) = *start {
        elapsed.as_secs_f32() + s.elapsed().as_secs_f32() * speed
    } else {
        elapsed.as_secs_f32()
    }
}

fn sync_audio_position(state: &AudioState) {
    let position = audio_position_seconds(state);
    if let Ok(mut elapsed) = state.elapsed_before_pause.lock() {
        *elapsed = Duration::from_secs_f32(position);
    }
    if let Ok(mut start) = state.start_instant.lock() {
        if start.is_some() {
            *start = Some(Instant::now());
        }
    }
}

struct AppState {
    collection_path: Mutex<Option<PathBuf>>,
    waveform_queue: Arc<WaveformQueue>,
    audio: AudioState,
}

#[derive(serde::Serialize)]
struct CollectionResult {
    files: Vec<FileItem>,
    waveform_ids: Vec<String>,
    conversion_ids: Vec<String>,
}

fn queue_waveform_tasks(
    folder_path: &PathBuf,
    queue: &Arc<WaveformQueue>,
    items: impl IntoIterator<Item = (String, String)>,
    normalize: bool,
) -> Result<Vec<String>, String> {
    let mut tasks = queue
        .tasks
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let mut queued_ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();
    let mut added_ids = Vec::new();

    for (id, relative_path) in items {
        if !queued_ids.insert(id.clone()) {
            continue;
        }
        added_ids.push(id.clone());
        tasks.push_back(WaveformTask {
            id,
            collection_path: folder_path.clone(),
            relative_path,
            task_type: TaskType::Waveform { normalize },
        });
    }

    if !added_ids.is_empty() {
        queue.cvar.notify_all();
    }
    Ok(added_ids)
}

fn queue_missing_waveforms(
    folder_path: &PathBuf,
    queue: &Arc<WaveformQueue>,
    normalize: bool,
) -> Result<Vec<String>, String> {
    let conn = collection::init_db(folder_path).map_err(|e| e.to_string())?;

    // Find files that don't have a waveform yet AND are not OGG/OGA (which need conversion first)
    let mut stmt = conn
        .prepare("SELECT id, filepath FROM files WHERE id NOT IN (SELECT id FROM waveforms) AND LOWER(format) NOT IN ('ogg', 'oga')")
        .map_err(|e| e.to_string())?;

    let missing_iter = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut missing = Vec::new();
    for row in missing_iter {
        if let Ok(item) = row {
            missing.push(item);
        }
    }

    queue_waveform_tasks(folder_path, queue, missing, normalize)
}

fn enqueue_post_scan_work(
    folder_path: &PathBuf,
    conversion_needed: Vec<(String, String)>,
    state: &AppState,
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut conversion_ids = Vec::new();
    if !conversion_needed.is_empty() {
        let mut tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        for (id, relative_path) in conversion_needed {
            conversion_ids.push(id.clone());
            tasks.push_back(WaveformTask {
                id: id.clone(),
                collection_path: folder_path.clone(),
                relative_path,
                task_type: TaskType::Convert { id },
            });
        }
        state.waveform_queue.cvar.notify_all();
    }

    let waveform_ids =
        queue_missing_waveforms(folder_path, &state.waveform_queue, false).unwrap_or_default();

    Ok((conversion_ids, waveform_ids))
}

fn activate_collection(
    folder_path: PathBuf,
    clear_unrelated_tasks: bool,
    state: &AppState,
) -> Result<CollectionResult, String> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Invalid folder path".to_string());
    }

    {
        let mut state_path = state
            .collection_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *state_path = Some(folder_path.clone());
    }

    {
        let mut tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        if clear_unrelated_tasks {
            tasks.clear();
        } else {
            tasks.retain(|t| t.collection_path == folder_path);
        }
        state.waveform_queue.paused.store(false, Ordering::SeqCst);
        state.waveform_queue.cvar.notify_all();
        state.waveform_queue.pause_cvar.notify_all();
    }

    let conn = collection::init_db(&folder_path).map_err(|e| e.to_string())?;
    let conversion_needed =
        collection::scan_folder(&folder_path, &conn).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(&folder_path, &conn).map_err(|e| e.to_string())?;

    let (conversion_ids, waveform_ids) =
        enqueue_post_scan_work(&folder_path, conversion_needed, state)?;

    Ok(CollectionResult {
        files,
        waveform_ids,
        conversion_ids,
    })
}

#[tauri::command]
async fn open_collection(
    path: String,
    state: State<'_, AppState>,
) -> Result<CollectionResult, String> {
    activate_collection(PathBuf::from(path), true, &state)
}

#[tauri::command]
async fn switch_collection(
    path: String,
    state: State<'_, AppState>,
) -> Result<CollectionResult, String> {
    activate_collection(PathBuf::from(path), false, &state)
}

#[tauri::command]
async fn delete_collection_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let folder = PathBuf::from(&path);
    if !folder.is_dir() {
        return Err("Library folder not found".to_string());
    }

    let canonical = folder
        .canonicalize()
        .map_err(|e| format!("Invalid library path: {e}"))?;

    if canonical.components().count() < 2 {
        return Err("Refusing to delete this path".to_string());
    }

    {
        let open = state
            .collection_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        if let Some(open_path) = open.as_ref() {
            let open_canonical = open_path
                .canonicalize()
                .unwrap_or_else(|_| open_path.clone());
            if open_canonical == canonical {
                return Err("Unload the library before deleting it".to_string());
            }
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::remove_dir_all(&canonical).map_err(|e| format!("Failed to delete library: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn close_collection(state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut state_path = state
            .collection_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *state_path = None;
    }

    {
        let mut tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        tasks.clear();
    }

    state.waveform_queue.paused.store(false, Ordering::SeqCst);
    state.waveform_queue.cvar.notify_all();
    state.waveform_queue.pause_cvar.notify_all();

    let sink = state
        .audio
        .sink
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    sink.stop();

    Ok(())
}

#[tauri::command]
async fn rescan_collection(state: State<'_, AppState>) -> Result<CollectionResult, String> {
    let state_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let folder_path = state_path.as_ref().ok_or("No collection open")?.clone();

    let conn = collection::init_db(&folder_path).map_err(|e| e.to_string())?;
    let conversion_needed =
        collection::scan_folder(&folder_path, &conn).map_err(|e| e.to_string())?;
    let files = collection::get_all_files(&folder_path, &conn).map_err(|e| e.to_string())?;

    let (conversion_ids, waveform_ids) =
        enqueue_post_scan_work(&folder_path, conversion_needed, &state)?;

    Ok(CollectionResult {
        files,
        waveform_ids,
        conversion_ids,
    })
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
                collection_path: folder_path.clone(),
                relative_path,
                task_type: TaskType::Waveform { normalize: false },
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
    let filepath_str = relative_path.to_string_lossy().to_string();
    collection::update_file_path(&id, &filepath_str, &conn).map_err(|e| e.to_string())?;

    // Check if it needs conversion
    let ext = dest_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if (ext == "ogg" || ext == "oga") && action != "link" {
        let mut tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned")?;
        tasks.push_back(WaveformTask {
            id: id.clone(),
            collection_path: folder_path.clone(),
            relative_path: filepath_str,
            task_type: TaskType::Convert { id: id.clone() },
        });
        state.waveform_queue.cvar.notify_all();
    }

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

struct AddFilesWorkResult {
    added_files: Vec<FileItem>,
    conversion_tasks: Vec<WaveformTask>,
    conversion_ids: Vec<String>,
    waveform_items: Vec<(String, String)>,
}

fn add_files_blocking(
    folder_path: PathBuf,
    files: Vec<String>,
    action: String,
) -> Result<AddFilesWorkResult, String> {
    let action_clone = action;

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
            let dest_path = folder_path.join(filename);

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
                .strip_prefix(&folder_path)
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

    let mut conn = collection::init_db(&folder_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let mut added_files = Vec::new();
    let mut conversion_tasks = Vec::new();
    let mut conversion_ids = Vec::new();
    let mut waveform_items = Vec::new();

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

            if tx.changes() == 0 {
                continue;
            }

            added_files.push(item.clone());

            let ext = item.format.to_lowercase();
            if ext == "ogg" || ext == "oga" {
                conversion_ids.push(item.id.clone());
                conversion_tasks.push(WaveformTask {
                    id: item.id.clone(),
                    collection_path: folder_path.clone(),
                    relative_path: item.filepath.clone(),
                    task_type: TaskType::Convert {
                        id: item.id.clone(),
                    },
                });
            } else {
                waveform_items.push((item.id.clone(), item.filepath.clone()));
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(AddFilesWorkResult {
        added_files,
        conversion_tasks,
        conversion_ids,
        waveform_items,
    })
}

#[tauri::command]
async fn add_files_to_collection(
    files: Vec<String>,
    action: String,
    normalize: bool,
    state: State<'_, AppState>,
) -> Result<CollectionResult, String> {
    let folder_path = {
        let state_path = state
            .collection_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        state_path.as_ref().ok_or("No collection open")?.clone()
    };
    let folder_path_for_queue = folder_path.clone();

    let work = tauri::async_runtime::spawn_blocking(move || {
        add_files_blocking(folder_path, files, action)
    })
    .await
    .map_err(|e| e.to_string())??;

    if !work.conversion_tasks.is_empty() {
        let mut tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned")?;
        for task in work.conversion_tasks {
            tasks.push_back(task);
        }
        state.waveform_queue.cvar.notify_all();
    }

    let waveform_ids = queue_waveform_tasks(
        &folder_path_for_queue,
        &state.waveform_queue,
        work.waveform_items,
        normalize,
    )
    .unwrap_or_default();

    Ok(CollectionResult {
        files: work.added_files,
        waveform_ids,
        conversion_ids: work.conversion_ids,
    })
}

#[tauri::command]
fn export_collection_library(
    output_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let collection_path = state
        .collection_path
        .lock()
        .map_err(|_| "State poisoned".to_string())?
        .clone()
        .ok_or("No collection open")?;

    {
        let tasks = state
            .waveform_queue
            .tasks
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        if !tasks.is_empty() {
            return Err(
                "Wait for waveform or conversion tasks to finish before exporting".to_string(),
            );
        }
    }

    let output = PathBuf::from(output_path);
    std::thread::spawn(move || {
        let _ = library_archive::export_collection(&collection_path, &output, &app);
    });
    Ok(())
}

#[tauri::command]
fn import_collection_library(
    archive_path: String,
    parent_dir: String,
    app: AppHandle,
) -> Result<(), String> {
    let archive = PathBuf::from(archive_path);
    let parent = PathBuf::from(parent_dir);

    std::thread::spawn(move || {
        let _ = library_archive::import_collection(archive.as_path(), parent.as_path(), &app);
    });
    Ok(())
}

#[tauri::command]
fn regenerate_waveforms(
    normalize: bool,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
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
        p.join(&path)
    } else {
        PathBuf::from(&path)
    };

    let speed = audio_playback_speed(&state.audio);
    load_audio_at(&state.audio, &full_path, &path, gain, speed, 0.0, true)
}

#[tauri::command]
fn pause_audio(state: State<'_, AppState>) {
    let Ok(sink) = state.audio.sink.lock() else {
        return;
    };
    if !sink.is_paused() {
        let position = audio_position_seconds(&state.audio);
        sink.pause();
        if let Ok(mut elapsed) = state.audio.elapsed_before_pause.lock() {
            *elapsed = Duration::from_secs_f32(position);
        }
        if let Ok(mut start) = state.audio.start_instant.lock() {
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
    if let Ok(mut path_slot) = state.audio.current_full_path.lock() {
        *path_slot = None;
    }
    if let Ok(mut rel_slot) = state.audio.current_relative_path.lock() {
        *rel_slot = None;
    }
    if let Ok(mut preserved) = state.audio.pitch_preserved.lock() {
        *preserved = false;
    }
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
    audio_position_seconds(&state.audio)
}

#[tauri::command]
async fn set_playback_speed(
    speed: f32,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let speed = speed.clamp(0.25, 4.0);
    sync_audio_position(&state.audio);
    let original_pos = audio_position_seconds(&state.audio);
    let playing = is_audio_playing(&state.audio);
    let gain = {
        let guard = state
            .audio
            .current_file_gain
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *guard
    };
    let reload = {
        let path = state
            .audio
            .current_full_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?
            .clone();
        let rel = state
            .audio
            .current_relative_path
            .lock()
            .map_err(|_| "State poisoned".to_string())?
            .clone();
        match (path, rel) {
            (Some(full_path), Some(relative_path)) => Some((full_path, relative_path)),
            _ => None,
        }
    };
    {
        let mut stored = state
            .audio
            .playback_speed
            .lock()
            .map_err(|_| "State poisoned".to_string())?;
        *stored = speed;
    }

    if let Some((full_path, relative_path)) = reload {
        if (speed - 1.0).abs() >= 0.001 {
            let app_for_ffmpeg = app.clone();
            tauri::async_runtime::spawn_blocking(move || ffmpeg::ensure_blocking(&app_for_ffmpeg))
                .await
                .map_err(|e| e.to_string())??;
        }
        let handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let state = handle.state::<AppState>();
            load_audio_at(
                &state.audio,
                &full_path,
                &relative_path,
                gain,
                speed,
                original_pos,
                playing,
            )
        })
        .await
        .map_err(|e| e.to_string())??;
    }

    Ok(())
}

#[tauri::command]
fn seek_audio(time_seconds: f32, state: State<'_, AppState>) -> Result<(), String> {
    let sink = state
        .audio
        .sink
        .lock()
        .map_err(|_| "State poisoned".to_string())?;
    let stream_time = stream_seek_seconds(&state.audio, time_seconds);
    if let Err(e) = sink.try_seek(Duration::from_secs_f32(stream_time)) {
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
    *elapsed = Duration::from_secs_f32(time_seconds);
    if start.is_some() {
        *start = Some(Instant::now());
    }
    Ok(())
}

fn task_needs_ffmpeg(task: &WaveformTask) -> bool {
    match task.task_type {
        TaskType::Waveform { normalize: true } => true,
        TaskType::Convert { .. } => true,
        TaskType::Waveform { normalize: false } => false,
    }
}

#[tauri::command]
async fn prepare_drag_clip(
    app: AppHandle,
    id: String,
    start_pct: f32,
    end_pct: f32,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let app_for_ffmpeg = app.clone();
    tauri::async_runtime::spawn_blocking(move || ffmpeg::ensure_blocking(&app_for_ffmpeg))
        .await
        .map_err(|e| e.to_string())??;
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

    let item = stmt
        .query_row([&id], |row| {
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
        })
        .map_err(|e| e.to_string())?;

    Ok(item)
}

#[tauri::command]
fn ffmpeg_is_available(app: AppHandle) -> bool {
    ffmpeg::is_available(&app)
}

#[tauri::command]
async fn ensure_ffmpeg(app: AppHandle) -> Result<String, String> {
    let path = tauri::async_runtime::spawn_blocking(move || ffmpeg::ensure_blocking(&app))
        .await
        .map_err(|e| e.to_string())??;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn pause_processing(state: State<'_, AppState>) {
    state.waveform_queue.paused.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn resume_processing(state: State<'_, AppState>) {
    state.waveform_queue.paused.store(false, Ordering::SeqCst);
    state.waveform_queue.cvar.notify_all();
    state.waveform_queue.pause_cvar.notify_all();
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
        playback_speed: Mutex::new(1.0),
        pitch_preserved: Mutex::new(false),
        current_full_path: Mutex::new(None),
        current_relative_path: Mutex::new(None),
        tempo_cache: Mutex::new(HashMap::new()),
        start_instant: Mutex::new(None),
        elapsed_before_pause: Mutex::new(Duration::ZERO),
        suppress_ended: Arc::new(AtomicBool::new(false)),
    };

    let waveform_queue = Arc::new(WaveformQueue {
        tasks: Mutex::new(VecDeque::new()),
        cvar: Condvar::new(),
        paused: AtomicBool::new(false),
        pause_mutex: Mutex::new(()),
        pause_cvar: Condvar::new(),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            collection_path: Mutex::new(None),
            waveform_queue: Arc::clone(&waveform_queue),
            audio: audio_state,
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            ffmpeg::offer_install_on_startup(&handle);

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

            let worker_count = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4)
                .min(8);
            for _ in 0..worker_count {
                let handle = handle.clone();
                let queue = Arc::clone(&handle.state::<AppState>().waveform_queue);

                std::thread::spawn(move || {
                    // One DB connection per worker, reused across all tasks.
                    let mut worker_conn: Option<(PathBuf, rusqlite::Connection)> = None;

                    loop {
                        let task = {
                            let Ok(mut tasks) = queue.tasks.lock() else { break; };
                            while tasks.is_empty() || queue.paused.load(Ordering::SeqCst) {
                                tasks = match queue.cvar.wait(tasks) {
                                    Ok(t) => t,
                                    Err(_) => return,
                                };
                            }

                            // Prioritize Convert tasks
                            let task_index = tasks.iter().position(|t| matches!(t.task_type, TaskType::Convert { .. }))
                                .unwrap_or(0);

                            tasks.remove(task_index).unwrap()
                        };

                        let folder_path = task.collection_path.clone();

                        // Re-open connection if collection path changed.
                        let conn_valid = worker_conn.as_ref().map(|(p, _)| p == &folder_path).unwrap_or(false);
                        if !conn_valid {
                            worker_conn = collection::init_db(&folder_path).ok().map(|c| (folder_path.clone(), c));
                        }

                        let full_path = folder_path.join(&task.relative_path);

                        if task_needs_ffmpeg(&task) {
                            if let Err(err) = ffmpeg::ensure_blocking(&handle) {
                                eprintln!("Skipping task (FFmpeg): {err}");
                                continue;
                            }
                        }

                        match task.task_type {
                            TaskType::Waveform { normalize } => {
                                // Perform destructive normalization if requested
                                if normalize {
                                    let _ = handle.emit("waveform-started", format!("{}-normalizing", task.id));
                                    if let Err(e) = collection::normalize_file_destructive(&full_path) {
                                        eprintln!("Destructive normalization failed for {}: {}", task.id, e);
                                    }
                                }

                                // Emit started event
                                let _ = handle.emit("waveform-started", task.id.clone());

                                let task_id = task.id.clone();
                                let handle_clone = handle.clone();
                                let queue_clone = Arc::clone(&queue);
                                if let Some(waveform) = collection::generate_waveform(&full_path, move |progress, data| {
                                    let mut guard = queue_clone.pause_mutex.lock().unwrap_or_else(|e| e.into_inner());
                                    while queue_clone.paused.load(Ordering::SeqCst) {
                                        guard = queue_clone.pause_cvar.wait(guard).unwrap_or_else(|e| e.into_inner());
                                    }
                                    drop(guard);
                                    let _ = handle_clone.emit("waveform-progress", WaveformProgress {
                                        id: task_id.clone(),
                                        progress,
                                        data,
                                    });
                                }) {
                                    if let Some((_, conn)) = &worker_conn {
                                        let _ = conn.execute(
                                            "INSERT OR REPLACE INTO waveforms (id, data) VALUES (?1, ?2)",
                                            rusqlite::params![task.id, waveform],
                                        );

                                        if normalize {
                                            if let Some(meta) = collection::extract_metadata(&full_path) {
                                                let _ = conn.execute(
                                                    "UPDATE files SET size = ?1, duration = ?2, length = ?3, gain = 1.0 WHERE id = ?4",
                                                    rusqlite::params![meta.size, meta.duration, meta.length, task.id],
                                                );
                                            }
                                        }

                                        let _ = handle.emit("waveform-generated", serde_json::json!({
                                            "id": task.id,
                                            "gain": 1.0
                                        }));
                                    }
                                }
                            }
                            TaskType::Convert { id } => {
                                let _ = handle.emit("waveform-started", format!("{}-converting", id));

                                let id_clone = id.clone();
                                let handle_clone = handle.clone();
                                let queue_clone = Arc::clone(&queue);
                                match collection::convert_to_mp3(&full_path, move |progress| {
                                    let mut guard = queue_clone.pause_mutex.lock().unwrap_or_else(|e| e.into_inner());
                                    while queue_clone.paused.load(Ordering::SeqCst) {
                                        guard = queue_clone.pause_cvar.wait(guard).unwrap_or_else(|e| e.into_inner());
                                    }
                                    drop(guard);
                                    let _ = handle_clone.emit("waveform-progress", WaveformProgress {
                                        id: format!("{}-converting", id_clone),
                                        progress,
                                        data: None,
                                    });
                                }) {
                                    Ok(new_path) => {
                                        let _ = std::fs::remove_file(&full_path);

                                        if let Some((_, conn)) = &worker_conn {
                                            let relative_path = new_path.strip_prefix(&folder_path).unwrap_or(&new_path);
                                            let filepath_str = relative_path.to_string_lossy().to_string();

                                            if let Some(meta) = collection::extract_metadata(&new_path) {
                                                let _ = conn.execute(
                                                    "UPDATE files SET filename = ?1, filepath = ?2, format = ?3, size = ?4, duration = ?5, length = ?6 WHERE id = ?7",
                                                    rusqlite::params![meta.filename, filepath_str, meta.format, meta.size, meta.duration, meta.length, id],
                                                );
                                            }
                                        }

                                        let _ = handle.emit("waveform-generated", serde_json::json!({
                                            "id": format!("{}-converting", id),
                                            "gain": 1.0
                                        }));

                                        // Now queue waveform generation for the new file
                                        let mut tasks = queue.tasks.lock().unwrap();
                                        tasks.push_back(WaveformTask {
                                            id: id.clone(),
                                            collection_path: folder_path.clone(),
                                            relative_path: new_path.strip_prefix(&folder_path).unwrap_or(&new_path).to_string_lossy().to_string(),
                                            task_type: TaskType::Waveform { normalize: false },
                                        });
                                        queue.cvar.notify_all();
                                    }
                                    Err(e) => {
                                        eprintln!("Conversion failed for {}: {}", id, e);
                                    }
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
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_collection,
            switch_collection,
            close_collection,
            delete_collection_folder,
            rescan_collection,
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
            set_playback_speed,
            seek_audio,
            prepare_drag_clip,
            update_file_tags,
            pause_processing,
            resume_processing,
            ffmpeg_is_available,
            ensure_ffmpeg,
            export_collection_library,
            import_collection_library
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
