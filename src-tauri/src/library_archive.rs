use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use tauri::{AppHandle, Emitter};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub const FORMAT: &str = "sonixy-library";
pub const FORMAT_VERSION: u32 = 1;
const MANIFEST_NAME: &str = "library.json";
const DB_NAME: &str = ".sonixy.db";

#[derive(Debug, Serialize, Deserialize)]
pub struct LibraryManifest {
    pub format: String,
    pub format_version: u32,
    pub exported_at: String,
    pub app_version: String,
    pub source_name: String,
}

#[derive(Clone, serde::Serialize)]
pub struct LibraryTransferProgress {
    pub phase: String,
    pub progress: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct LibraryTransferDone {
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_path: Option<String>,
}

fn emit_progress(app: &AppHandle, phase: &str, progress: f32, message: Option<&str>) {
    let _ = app.emit(
        "library-transfer-progress",
        LibraryTransferProgress {
            phase: phase.to_string(),
            progress,
            message: message.map(str::to_string),
        },
    );
}

fn emit_done(app: &AppHandle, phase: &str, result_path: Option<&Path>) {
    let _ = app.emit(
        "library-transfer-done",
        LibraryTransferDone {
            phase: phase.to_string(),
            result_path: result_path.map(|p| p.to_string_lossy().into_owned()),
        },
    );
}

fn emit_error(app: &AppHandle, message: &str) {
    let _ = app.emit("library-transfer-error", message);
}

fn build_manifest(collection_path: &Path) -> Result<LibraryManifest, String> {
    let source_name = collection_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("library")
        .to_string();

    let exported_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| e.to_string())?;

    Ok(LibraryManifest {
        format: FORMAT.to_string(),
        format_version: FORMAT_VERSION,
        exported_at,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        source_name,
    })
}

fn validate_manifest(manifest: &LibraryManifest) -> Result<(), String> {
    if manifest.format != FORMAT {
        return Err(format!(
            "Not a Sonixy library (expected format \"{}\")",
            FORMAT
        ));
    }
    if manifest.format_version > FORMAT_VERSION {
        return Err(format!(
            "Library format version {} is newer than this app supports ({}). Update Sonixy.",
            manifest.format_version, FORMAT_VERSION
        ));
    }
    if manifest.format_version == 0 {
        return Err("Invalid library format version".to_string());
    }
    Ok(())
}

fn append_bytes(tar: &mut tar::Builder<impl Write>, name: &str, data: &[u8]) -> Result<(), String> {
    let mut header = tar::Header::new_gnu();
    header.set_size(data.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    tar.append_data(&mut header, name, data)
        .map_err(|e| e.to_string())
}

fn remove_dir_all_best_effort(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

pub fn export_collection(
    collection_path: &Path,
    output_path: &Path,
    app: &AppHandle,
) -> Result<(), String> {
    let result = export_collection_inner(collection_path, output_path, app);
    if let Err(ref e) = result {
        emit_error(app, e);
    }
    result
}

fn export_collection_inner(
    collection_path: &Path,
    output_path: &Path,
    app: &AppHandle,
) -> Result<(), String> {
    const PHASE: &str = "export";

    if !collection_path.is_dir() {
        return Err("Collection path is not a directory".to_string());
    }

    emit_progress(app, PHASE, 0.0, Some("Preparing export…"));
    thread::yield_now();

    let conn = Connection::open(collection_path.join(DB_NAME)).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;

    emit_progress(app, PHASE, 0.02, Some("Checkpointing database…"));
    thread::yield_now();
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;

    let mut paths: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT filepath FROM files")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut scanned = 0usize;
        for row in rows {
            let relative = row.map_err(|e| e.to_string())?;
            scanned += 1;
            let full = collection_path.join(&relative);
            if full.is_file() {
                paths.push(relative);
            }
            if scanned % 64 == 0 {
                emit_progress(
                    app,
                    PHASE,
                    0.05,
                    Some(&format!("Scanning library ({scanned} entries)…")),
                );
                thread::yield_now();
            }
        }
    }

    let total_steps = 2 + paths.len().max(1); // manifest + db + files
    let mut step = 0usize;

    let manifest = build_manifest(collection_path)?;
    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let file = File::create(output_path).map_err(|e| e.to_string())?;
    let encoder = GzEncoder::new(file, Compression::fast());
    let mut tar = tar::Builder::new(encoder);

    append_bytes(&mut tar, MANIFEST_NAME, &manifest_json)?;
    step += 1;
    emit_progress(
        app,
        PHASE,
        step as f32 / total_steps as f32,
        Some("Writing manifest…"),
    );

    let db_path = collection_path.join(DB_NAME);
    tar.append_path_with_name(&db_path, DB_NAME)
        .map_err(|e| e.to_string())?;
    step += 1;
    emit_progress(
        app,
        PHASE,
        step as f32 / total_steps as f32,
        Some("Writing database…"),
    );

    let progress_stride = if paths.len() > 200 {
        16
    } else if paths.len() > 50 {
        4
    } else {
        1
    };

    for (i, relative) in paths.iter().enumerate() {
        let full = collection_path.join(relative);
        tar.append_path_with_name(&full, relative)
            .map_err(|e| format!("Failed to add \"{}\": {}", relative, e))?;
        step += 1;
        if i % progress_stride == 0 || i + 1 == paths.len() {
            emit_progress(
                app,
                PHASE,
                step as f32 / total_steps as f32,
                Some(&format!("Adding files ({}/{})…", i + 1, paths.len())),
            );
            thread::yield_now();
        }
    }

    emit_progress(app, PHASE, 0.98, Some("Finalizing archive…"));
    thread::yield_now();

    let encoder = tar.into_inner().map_err(|e| e.to_string())?;
    encoder.finish().map_err(|e| e.to_string())?;

    emit_progress(app, PHASE, 1.0, Some("Export complete"));
    emit_done(app, PHASE, None);
    Ok(())
}

pub fn import_collection(
    archive_path: &Path,
    parent_dir: &Path,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    const PHASE: &str = "import";

    if !archive_path.is_file() {
        return Err("Archive file not found".to_string());
    }
    if !parent_dir.is_dir() {
        return Err("Parent directory not found".to_string());
    }

    let stem = archive_path
        .file_stem()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .ok_or("Invalid archive file name")?;

    let dest = parent_dir.join(stem);
    if dest.exists() {
        return Err(format!(
            "A folder named \"{}\" already exists in the chosen location",
            stem
        ));
    }

    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    let dest_for_cleanup = dest.clone();
    let run_import = || -> Result<PathBuf, String> {
        emit_progress(app, PHASE, 0.05, Some("Extracting library…"));

        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let decoder = GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        let mut extracted = 0usize;
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            entry.unpack_in(&dest).map_err(|e| {
                format!(
                    "Failed to extract library (invalid or corrupt archive): {}",
                    e
                )
            })?;
            extracted += 1;
            if extracted == 1 || extracted % 8 == 0 {
                let progress = 0.05 + (0.8 * (1.0 - 1.0 / (extracted as f32 + 4.0)));
                emit_progress(
                    app,
                    PHASE,
                    progress,
                    Some(&format!("Extracting ({extracted} entries)…")),
                );
                thread::yield_now();
            }
        }

        emit_progress(app, PHASE, 0.9, Some("Validating library…"));

        let manifest_path = dest.join(MANIFEST_NAME);
        if !manifest_path.is_file() {
            return Err("Archive is missing library.json".to_string());
        }

        let mut manifest_file = File::open(&manifest_path).map_err(|e| e.to_string())?;
        let mut manifest_raw = String::new();
        manifest_file
            .read_to_string(&mut manifest_raw)
            .map_err(|e| e.to_string())?;
        let manifest: LibraryManifest =
            serde_json::from_str(&manifest_raw).map_err(|e| format!("Invalid manifest: {}", e))?;
        validate_manifest(&manifest)?;

        let db_path = dest.join(DB_NAME);
        if !db_path.is_file() {
            return Err("Archive is missing .sonixy.db".to_string());
        }

        emit_progress(app, PHASE, 1.0, Some("Import complete"));
        emit_done(app, PHASE, Some(&dest));
        Ok(dest)
    };

    match run_import() {
        Ok(path) => Ok(path),
        Err(e) => {
            remove_dir_all_best_effort(&dest_for_cleanup);
            emit_error(app, &e);
            Err(e)
        }
    }
}
