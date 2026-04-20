use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection};
use lofty::prelude::*;
use lofty::probe::Probe;
use std::path::Path;
use walkdir::WalkDir;
use uuid::Uuid;
use symphonia::core::audio::AudioBufferRef;
use symphonia::core::audio::Signal;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileItem {
    pub id: String,
    pub filename: String,
    pub filepath: String,
    pub format: String,
    pub length: String,
    pub size: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub missing: bool,
}

pub fn init_db(folder_path: &Path) -> rusqlite::Result<Connection> {
    let db_path = folder_path.join(".sonixy.db");
    let conn = Connection::open(db_path)?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL UNIQUE,
            format TEXT NOT NULL,
            length TEXT NOT NULL,
            size TEXT NOT NULL,
            tags TEXT NOT NULL
        )",
        [],
    )?;

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
    let format = path.extension()?.to_string_lossy().to_string().to_uppercase();
    
    let mut tags = Vec::new();
    if let Some(tag) = tagged_file.primary_tag() {
        if let Some(genre) = tag.genre() {
            tags.push(genre.to_string());
        }
    }

    Some(FileItem {
        id: Uuid::new_v4().to_string(),
        filename,
        filepath: path.to_string_lossy().to_string(),
        format,
        length,
        size,
        tags,
        missing: false,
    })
}

pub fn scan_folder(folder_path: &Path, conn: &Connection) -> rusqlite::Result<()> {
    for entry in WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        
        // Skip hidden files/folders (including our db)
        if path.file_name().map_or(false, |s| s.to_string_lossy().starts_with('.')) {
            continue;
        }

        let relative_path = path.strip_prefix(folder_path).unwrap_or(path);
        let filepath_str = relative_path.to_string_lossy().to_string();

        // Check if file already in DB
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM files WHERE filepath = ?1)",
            params![filepath_str],
            |row| row.get(0),
        )?;

        if !exists {
            if let Some(mut item) = extract_metadata(path) {
                item.filepath = filepath_str;
                conn.execute(
                    "INSERT INTO files (id, filename, filepath, format, length, size, tags) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        item.id,
                        item.filename,
                        item.filepath,
                        item.format,
                        item.length,
                        item.size,
                        serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".to_string())
                    ],
                )?;
            }
        }
    }
    
    Ok(())
}

pub fn get_all_files(folder_path: &Path, conn: &Connection) -> rusqlite::Result<Vec<FileItem>> {
    let mut stmt = conn.prepare("SELECT id, filename, filepath, format, length, size, tags FROM files")?;
    let file_iter = stmt.query_map([], |row| {
        let tags_json: String = row.get(6)?;
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
            size: row.get(5)?,
            tags,
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

pub fn update_file_path(id: &str, new_relative_path: &str, conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET filepath = ?1 WHERE id = ?2",
        params![new_relative_path, id],
    )?;
    Ok(())
}

pub fn generate_waveform(path: &Path) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let meta_opts = MetadataOptions::default();
    let fmt_opts = FormatOptions::default();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .ok()?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;

    let dec_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &dec_opts)
        .ok()?;

    let track_id = track.id;
    let mut samples = Vec::new();

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(AudioBufferRef::F32(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        max = max.max(plane[i].abs());
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::U8(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let sample = (plane[i] as f32 - 128.0) / 128.0;
                        max = max.max(sample.abs());
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::S16(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let sample = plane[i] as f32 / 32768.0;
                        max = max.max(sample.abs());
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::S24(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        // symphonia::core::sample::i24 is a tuple struct with .0 as i32
                        let sample = plane[i].0 as f32 / 8388608.0;
                        max = max.max(sample.abs());
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::S32(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let sample = plane[i] as f32 / 2147483648.0;
                        max = max.max(sample.abs());
                    }
                    samples.push(max);
                }
            }
            Ok(_) => {}
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
    }

    if samples.is_empty() {
        return None;
    }

    let bars = 256;
    let chunk_size = samples.len() / bars;
    if chunk_size == 0 {
        return None;
    }

    let mut result = Vec::with_capacity(bars);
    for i in 0..bars {
        let start = i * chunk_size;
        let end = (i + 1) * chunk_size;
        let mut max = 0.0f32;
        for j in start..end {
            if j < samples.len() {
                max = max.max(samples[j]);
            }
        }
        result.push((max * 255.0).min(255.0) as u8);
    }

    Some(result)
}
