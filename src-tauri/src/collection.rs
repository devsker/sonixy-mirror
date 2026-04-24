use serde::{Deserialize, Serialize};
use rusqlite::{params, Connection};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{Tag, TagType, Accessor};
use lofty::config::WriteOptions;
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
    let format = path.extension()?.to_string_lossy().to_string().to_uppercase();
    
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

pub fn update_tags(path: &Path, tags: Vec<String>, id: &str, conn: &Connection) -> Result<(), String> {
    let mut tagged_file = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;

    let tag_type = tagged_file.primary_tag_type();
    
    // Get existing primary tag or create a new one of the default type for the format
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    
    let tag = tagged_file.primary_tag_mut().ok_or("Failed to access tag")?;

    // Join tags with a semicolon and space
    let genre_string = tags.join("; ");
    tag.set_genre(genre_string);

    tagged_file.save_to_path(path, WriteOptions::default()).map_err(|e| e.to_string())?;

    // Update database
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE files SET tags = ?1 WHERE id = ?2",
        params![tags_json, id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

use rayon::prelude::*;

pub fn scan_folder(folder_path: &Path, conn: &Connection) -> rusqlite::Result<()> {
    // 1. Get all file paths that are not hidden
    let entries: Vec<_> = WalkDir::new(folder_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            !e.file_name()
                .to_string_lossy()
                .starts_with('.')
        })
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
        return Ok(());
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
    }
    tx.commit()?;
    
    Ok(())
}

pub fn get_all_files(folder_path: &Path, conn: &Connection) -> rusqlite::Result<Vec<FileItem>> {
    let mut stmt = conn.prepare("SELECT id, filename, filepath, format, length, duration, size, tags, gain FROM files")?;
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

pub fn update_file_path(id: &str, new_relative_path: &str, conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET filepath = ?1 WHERE id = ?2",
        params![new_relative_path, id],
    )?;
    Ok(())
}

pub fn trim_and_save(
    src_path: &Path, 
    dest_path: &Path, 
    start_pct: f32, 
    end_pct: f32
) -> Result<(), String> {
    let file = std::fs::File::open(src_path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = src_path.extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let meta_opts = MetadataOptions::default();
    let fmt_opts = FormatOptions::default();
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .map_err(|e| e.to_string())?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("No valid audio track found")?;

    let dec_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &dec_opts)
        .map_err(|e| e.to_string())?;

    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map(|c| c.count() as u16).unwrap_or(2);

    // Calculate frame ranges
    let total_frames = track.codec_params.n_frames.unwrap_or_else(|| {
        // If n_frames is missing, estimate from duration or just decode all
        0
    });
    
    // Better to decode everything if we don't know total_frames, 
    // but usually it's available. If not, we'll just use the time-based approach.
    
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(dest_path, spec).map_err(|e| e.to_string())?;

    let mut current_frame: u64 = 0;
    
    // Simplified: decode and write if within percentage range of the whole file
    // To be precise, we should really use symphonia's seek if possible, 
    // but for now, decoding and skipping is safer across all formats.

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(AudioBufferRef::F32(buf)) => {
                let frames = buf.frames();
                let start_frame = (start_pct * total_frames as f32) as u64;
                let end_frame = (end_pct * total_frames as f32) as u64;

                for i in 0..frames {
                    let f = current_frame + i as u64;
                    if f >= start_frame && (f <= end_frame || end_frame == 0) {
                        for plane in buf.planes().planes() {
                            let sample = (plane[i] * 32767.0) as i16;
                            writer.write_sample(sample).map_err(|e| e.to_string())?;
                        }
                    }
                }
                current_frame += frames as u64;
            }
            Ok(AudioBufferRef::S16(buf)) => {
                let frames = buf.frames();
                let start_frame = (start_pct * total_frames as f32) as u64;
                let end_frame = (end_pct * total_frames as f32) as u64;

                for i in 0..frames {
                    let f = current_frame + i as u64;
                    if f >= start_frame && (f <= end_frame || end_frame == 0) {
                        for plane in buf.planes().planes() {
                            writer.write_sample(plane[i]).map_err(|e| e.to_string())?;
                        }
                    }
                }
                current_frame += frames as u64;
            }
            // Add other formats as needed, or convert everything to f32 first
            Ok(AudioBufferRef::U8(buf)) => {
                let frames = buf.frames();
                let start_frame = (start_pct * total_frames as f32) as u64;
                let end_frame = (end_pct * total_frames as f32) as u64;
                for i in 0..frames {
                    let f = current_frame + i as u64;
                    if f >= start_frame && (f <= end_frame || end_frame == 0) {
                        for plane in buf.planes().planes() {
                            let sample = (plane[i] as i16 - 128) * 256;
                            writer.write_sample(sample).map_err(|e| e.to_string())?;
                        }
                    }
                }
                current_frame += frames as u64;
            }
            Ok(AudioBufferRef::S24(buf)) => {
                let frames = buf.frames();
                let start_frame = (start_pct * total_frames as f32) as u64;
                let end_frame = (end_pct * total_frames as f32) as u64;
                for i in 0..frames {
                    let f = current_frame + i as u64;
                    if f >= start_frame && (f <= end_frame || end_frame == 0) {
                        for plane in buf.planes().planes() {
                            let sample = (plane[i].0 >> 8) as i16;
                            writer.write_sample(sample).map_err(|e| e.to_string())?;
                        }
                    }
                }
                current_frame += frames as u64;
            }
            Ok(AudioBufferRef::S32(buf)) => {
                let frames = buf.frames();
                let start_frame = (start_pct * total_frames as f32) as u64;
                let end_frame = (end_pct * total_frames as f32) as u64;
                for i in 0..frames {
                    let f = current_frame + i as u64;
                    if f >= start_frame && (f <= end_frame || end_frame == 0) {
                        for plane in buf.planes().planes() {
                            let sample = (plane[i] >> 16) as i16;
                            writer.write_sample(sample).map_err(|e| e.to_string())?;
                        }
                    }
                }
                current_frame += frames as u64;
            }
            Ok(_) => {}
            Err(symphonia::core::errors::Error::IoError(_)) => break,
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(_) => break,
        }
        
        // Stop early if we passed the end frame
        let end_frame = (end_pct * total_frames as f32) as u64;
        if end_frame > 0 && current_frame > end_frame {
            break;
        }
    }

    writer.finalize().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn generate_waveform(path: &Path) -> Option<(Vec<u8>, f32)> {
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
    let mut peak = 0.0f32;

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(AudioBufferRef::F32(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let val = plane[i].abs();
                        max = max.max(val);
                        peak = peak.max(val);
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::U8(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let sample = (plane[i] as f32 - 128.0) / 128.0;
                        let val = sample.abs();
                        max = max.max(val);
                        peak = peak.max(val);
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::S16(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let sample = plane[i] as f32 / 32768.0;
                        let val = sample.abs();
                        max = max.max(val);
                        peak = peak.max(val);
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
                        let val = sample.abs();
                        max = max.max(val);
                        peak = peak.max(val);
                    }
                    samples.push(max);
                }
            }
            Ok(AudioBufferRef::S32(buf)) => {
                for i in 0..buf.frames() {
                    let mut max = 0.0f32;
                    for plane in buf.planes().planes() {
                        let sample = plane[i] as f32 / 2147483648.0;
                        let val = sample.abs();
                        max = max.max(val);
                        peak = peak.max(val);
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

    Some((result, peak))
}
