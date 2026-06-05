use lofty::config::WriteOptions;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use symphonia::core::audio::AudioBufferRef;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use uuid::Uuid;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileItem {
    pub id: String,
    pub filename: String,
    pub filepath: String,
    pub format: String,
    pub length: String,
    pub duration: f64,
    pub size: String,
    pub tags: Vec<String>,
    pub gain: f32,
    #[serde(default)]
    pub missing: bool,
}

pub fn init_db(folder_path: &Path) -> rusqlite::Result<Connection> {
    let db_path = folder_path.join(".sonixy.db");
    let conn = Connection::open(db_path)?;

    // Set busy timeout to handle concurrent writes
    conn.busy_timeout(std::time::Duration::from_secs(5))?;

    // Enable WAL mode for better performance with multiple readers/writers
    let _ = conn.execute("PRAGMA journal_mode=WAL", []);

    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL UNIQUE,
            format TEXT NOT NULL,
            length TEXT NOT NULL,
            duration REAL NOT NULL DEFAULT 0.0,
            size TEXT NOT NULL,
            tags TEXT NOT NULL,
            gain REAL DEFAULT 1.0
        )",
        [],
    )?;

    // Check if gain column exists (simple migration)
    {
        let mut stmt = conn.prepare("PRAGMA table_info(files)")?;
        let mut has_gain = false;
        let mut has_duration = false;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(1)?;
            if name == "gain" {
                has_gain = true;
            }
            if name == "duration" {
                has_duration = true;
            }
        }
        if !has_gain {
            let _ = conn.execute("ALTER TABLE files ADD COLUMN gain REAL DEFAULT 1.0", []);
        }
        if !has_duration {
            let _ = conn.execute("ALTER TABLE files ADD COLUMN duration REAL DEFAULT 0.0", []);

            // Migrate existing files by extracting duration
            let mut stmt = conn.prepare("SELECT id, filepath FROM files")?;
            let file_iter = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;

            for file in file_iter {
                if let Ok((id, relative_path)) = file {
                    let full_path = folder_path.join(&relative_path);
                    if let Some(meta) = extract_metadata(&full_path) {
                        let _ = conn.execute(
                            "UPDATE files SET duration = ?1 WHERE id = ?2",
                            params![meta.duration, id],
                        );
                    }
                }
            }
        }
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS waveforms (
            id TEXT PRIMARY KEY,
            data BLOB NOT NULL
        )",
        [],
    )?;

    Ok(conn)
}

pub fn extract_metadata(path: &Path) -> Option<FileItem> {
    let tagged_file = Probe::open(path).ok()?.read().ok()?;
    let properties = tagged_file.properties();

    let duration = properties.duration();
    let seconds = duration.as_secs() % 60;
    let minutes = (duration.as_secs() / 60) % 60;
    let length = format!("{}:{:02}", minutes, seconds);

    let file_size = std::fs::metadata(path).ok()?.len();
    let size = if file_size < 1024 * 1024 {
        format!("{:.1} KB", file_size as f64 / 1024.0)
    } else {
        format!("{:.1} MB", file_size as f64 / (1024.0 * 1024.0))
    };

    let filename = path.file_name()?.to_string_lossy().to_string();
    let format = path
        .extension()?
        .to_string_lossy()
        .to_string()
        .to_uppercase();

    let mut tags = Vec::new();
    if let Some(tag) = tagged_file.primary_tag() {
        if let Some(genre) = tag.genre() {
            // Split by common delimiters
            for g in genre.split([';', ',']) {
                let trimmed = g.trim();
                if !trimmed.is_empty() {
                    tags.push(trimmed.to_string());
                }
            }
        }
    }

    Some(FileItem {
        id: Uuid::new_v4().to_string(),
        filename,
        filepath: path.to_string_lossy().to_string(),
        format,
        length,
        duration: properties.duration().as_secs_f64(),
        size,
        tags,
        gain: 1.0,
        missing: false,
    })
}

pub fn update_tags(
    path: &Path,
    tags: Vec<String>,
    id: &str,
    conn: &Connection,
) -> Result<(), String> {
    let mut tagged_file = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag_type = tagged_file.primary_tag_type();

    // Get existing primary tag or create a new one of the default type for the format
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or("Failed to access tag")?;

    // Join tags with a semicolon and space
    let genre_string = tags.join("; ");
    tag.set_genre(genre_string);

    tagged_file
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| e.to_string())?;

    // Update database
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE files SET tags = ?1 WHERE id = ?2",
        params![tags_json, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

use rayon::prelude::*;

pub fn scan_folder(
    folder_path: &Path,
    conn: &Connection,
) -> rusqlite::Result<Vec<(String, String)>> {
    // 1. Get all file paths that are not hidden
    let entries: Vec<_> = WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .collect();

    // 2. Filter out files already in DB (this part is still sequential but fast)
    let mut files_to_scan = Vec::new();
    for entry in entries {
        let path = entry.path();
        let relative_path = path.strip_prefix(folder_path).unwrap_or(path);
        let filepath_str = relative_path.to_string_lossy().to_string();

        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM files WHERE filepath = ?1)",
            params![filepath_str],
            |row| row.get(0),
        )?;

        if !exists {
            files_to_scan.push((path.to_path_buf(), filepath_str));
        }
    }

    if files_to_scan.is_empty() {
        return Ok(Vec::new());
    }

    // 3. Extract metadata in parallel
    let processed_items: Vec<FileItem> = files_to_scan
        .into_par_iter()
        .filter_map(|(path, filepath_str)| {
            if let Some(mut item) = extract_metadata(&path) {
                item.filepath = filepath_str;
                Some(item)
            } else {
                None
            }
        })
        .collect();

    // 4. Insert into DB in a single transaction
    let mut mut_conn = Connection::open(folder_path.join(".sonixy.db"))?;
    mut_conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let tx = mut_conn.transaction()?;

    let mut conversion_needed = Vec::new();

    for item in processed_items {
        tx.execute(
            "INSERT INTO files (id, filename, filepath, format, length, duration, size, tags, gain) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
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
        )?;

        let ext = item.format.to_lowercase();
        if ext == "ogg" || ext == "oga" {
            conversion_needed.push((item.id, item.filepath));
        }
    }
    tx.commit()?;

    Ok(conversion_needed)
}

pub fn get_all_files(folder_path: &Path, conn: &Connection) -> rusqlite::Result<Vec<FileItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, filename, filepath, format, length, duration, size, tags, gain FROM files",
    )?;
    let file_iter = stmt.query_map([], |row| {
        let tags_json: String = row.get(7)?;
        let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
        let relative_path: String = row.get(2)?;
        let full_path = folder_path.join(&relative_path);
        let missing = !full_path.exists();

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
            missing,
        })
    })?;

    let mut files = Vec::new();
    for file in file_iter {
        files.push(file?);
    }

    Ok(files)
}

pub fn remove_file(id: &str, conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM files WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM waveforms WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn update_file_path(
    id: &str,
    new_relative_path: &str,
    conn: &Connection,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET filepath = ?1 WHERE id = ?2",
        params![new_relative_path, id],
    )?;
    Ok(())
}

use std::io::BufRead;
use std::process::{Command, Stdio};

fn create_ffmpeg_command() -> Result<Command, String> {
    crate::ffmpeg::create_ffmpeg_command(None)
}

pub fn convert_to_mp3<F>(path: &Path, mut on_progress: F) -> Result<PathBuf, String>
where
    F: FnMut(f32),
{
    let mut mp3_path = path.to_path_buf();
    mp3_path.set_extension("mp3");

    // If the file is already an mp3, we don't need to do anything
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        == Some("mp3".to_string())
    {
        return Ok(mp3_path);
    }

    // Get total duration first for progress calculation
    let total_duration = match Probe::open(path).ok().and_then(|p| p.read().ok()) {
        Some(tagged_file) => tagged_file.properties().duration().as_secs_f32(),
        None => 0.0,
    };

    let mut child = create_ffmpeg_command()?
        .arg("-i")
        .arg(path)
        .arg("-codec:a")
        .arg("libmp3lame")
        .arg("-qscale:a")
        .arg("2") // High quality
        .arg("-progress")
        .arg("pipe:2") // Send progress to stderr
        .arg("-y") // Overwrite if exists
        .arg(&mp3_path)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;
    let reader = std::io::BufReader::new(stderr);

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.starts_with("out_time_ms=") {
            if total_duration > 0.0 {
                let ms_str = &line[12..];
                if let Ok(ms) = ms_str.parse::<f32>() {
                    let progress = (ms / 1_000_000.0) / total_duration;
                    on_progress(progress.min(1.0));
                }
            }
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("ffmpeg conversion failed".to_string());
    }

    Ok(mp3_path)
}

pub fn normalize_file_destructive(path: &Path) -> Result<(), String> {
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("wav");
    let mut temp_path = path.to_path_buf();
    temp_path.set_extension(format!("normalized.{}", extension));

    // Use ffmpeg's loudnorm filter for EBU R128 normalization
    let output = create_ffmpeg_command()?
        .arg("-i")
        .arg(path)
        .arg("-af")
        .arg("loudnorm=I=-16:TP=-1.5:LRA=11") // Target -16 LUFS, -1.5dB TP
        .arg("-y") // Overwrite temp if exists
        .arg(&temp_path)
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", stderr));
    }

    // Replace original file with normalized one
    std::fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to replace original file: {}", e))?;

    Ok(())
}

pub fn trim_and_save(
    src_path: &Path,
    dest_path: &Path,
    start_pct: f32,
    end_pct: f32,
) -> Result<(), String> {
    let tagged_file = Probe::open(src_path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let duration = tagged_file.properties().duration().as_secs_f32();

    let start_time = start_pct * duration;
    let end_time = if end_pct > 0.0 {
        end_pct * duration
    } else {
        duration
    };
    let duration_to_cut = end_time - start_time;

    let output = create_ffmpeg_command()?
        .arg("-y")
        .arg("-ss")
        .arg(start_time.to_string())
        .arg("-t")
        .arg(duration_to_cut.to_string())
        .arg("-i")
        .arg(src_path)
        .arg("-c")
        .arg("copy")
        .arg(dest_path)
        .output()
        .map_err(|e| format!("Failed to execute ffmpeg: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

pub fn generate_waveform<F>(path: &Path, mut on_progress: F) -> Option<Vec<u8>>
where
    F: FnMut(f32, Option<Vec<u8>>),
{
    let file = std::fs::File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let meta_opts = MetadataOptions::default();
    let fmt_opts = FormatOptions {
        enable_gapless: false,
        ..Default::default()
    };
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .ok()?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;

    let total_frames = track.codec_params.n_frames;
    let mut decoded_frames = 0u64;

    let dec_opts = DecoderOptions { verify: false };
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &dec_opts)
        .ok()?;

    let track_id = track.id;
    let bars: usize = 512;
    let mut current_bars = vec![0.0f32; bars];
    // Reused buffer for progress events — avoids 100 heap allocations per file.
    let mut partial_data = vec![0u8; bars];

    // Pre-compute bar start frames when total is known, eliminating per-sample division.
    let bar_starts: Option<Vec<u64>> = total_frames.map(|total| {
        (0..=bars)
            .map(|b| (b as u64 * total) / bars as u64)
            .collect()
    });

    let mut last_progress = -1.0f32;

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(buf_ref) => {
                let frames = buf_ref.frames();
                let start_frame = decoded_frames;
                decoded_frames += frames as u64;

                if let (Some(total), Some(bar_starts)) = (total_frames, &bar_starts) {
                    let progress = (decoded_frames as f32 / total as f32).min(1.0);

                    // Plane-first iteration for cache-friendly sequential reads.
                    // Bar cursor advances monotonically (amortized O(1) per frame).
                    macro_rules! process_planes {
                        ($buf:expr, $convert:expr) => {{
                            for plane in $buf.planes().planes() {
                                let mut bar_cursor = {
                                    let b = ((start_frame * bars as u64) / total) as usize;
                                    b.min(bars - 1)
                                };
                                for i in 0..frames {
                                    let frame_abs = start_frame + i as u64;
                                    while bar_cursor + 1 < bars
                                        && frame_abs >= bar_starts[bar_cursor + 1]
                                    {
                                        bar_cursor += 1;
                                    }
                                    let val: f32 = $convert(plane[i]);
                                    current_bars[bar_cursor] = current_bars[bar_cursor].max(val);
                                }
                            }
                        }};
                    }

                    match buf_ref {
                        AudioBufferRef::F32(buf) => process_planes!(buf, |s: f32| s.abs()),
                        AudioBufferRef::U8(buf) => {
                            process_planes!(buf, |s: u8| ((s as f32 - 128.0) / 128.0).abs())
                        }
                        AudioBufferRef::S16(buf) => {
                            process_planes!(buf, |s: i16| (s as f32 / 32768.0).abs())
                        }
                        AudioBufferRef::S24(buf) => {
                            use symphonia::core::sample::i24;
                            process_planes!(buf, |s: i24| (s.0 as f32 / 8388608.0).abs())
                        }
                        AudioBufferRef::S32(buf) => {
                            process_planes!(buf, |s: i32| (s as f32 / 2147483648.0).abs())
                        }
                        _ => {}
                    }

                    // Report progress every 1% change to avoid flooding
                    if (progress - last_progress).abs() >= 0.01 {
                        for (b, &v) in partial_data.iter_mut().zip(current_bars.iter()) {
                            *b = (v * 255.0).min(255.0) as u8;
                        }
                        on_progress(progress, Some(partial_data.clone()));
                        last_progress = progress;
                    }
                } else {
                    // Fallback if total_frames is unknown (e.g. streaming or some MP3s)
                    on_progress(0.0, None);
                }
            }
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    if decoded_frames == 0 {
        return None;
    }

    let result: Vec<u8> = current_bars
        .iter()
        .map(|&v| (v * 255.0).min(255.0) as u8)
        .collect();

    Some(result)
}
