use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{OnceLock, RwLock};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use walkdir::WalkDir;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

static FFMPEG_PATH: OnceLock<PathBuf> = OnceLock::new();
static DOWNLOAD_LOCK: RwLock<()> = RwLock::new(());

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    progress: f32,
    message: String,
}

struct PlatformArtifact {
    url: &'static str,
    archive_file: &'static str,
    archive_kind: ArchiveKind,
}

enum ArchiveKind {
    Zip,
    #[cfg(target_os = "linux")]
    TarXz,
}

fn binary_file_name() -> &'static str {
    #[cfg(windows)]
    {
        "ffmpeg.exe"
    }
    #[cfg(not(windows))]
    {
        "ffmpeg"
    }
}

fn platform_artifact() -> PlatformArtifact {
    // BtbN auto-builds: Windows + Linux only (no macOS). macOS uses martin-riedl.de static builds.
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        PlatformArtifact {
            url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip",
            archive_file: "ffmpeg-download.zip",
            archive_kind: ArchiveKind::Zip,
        }
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        PlatformArtifact {
            url: "https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip",
            archive_file: "ffmpeg-download.zip",
            archive_kind: ArchiveKind::Zip,
        }
    }
    #[cfg(target_os = "windows")]
    {
        PlatformArtifact {
            url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
            archive_file: "ffmpeg-download.zip",
            archive_kind: ArchiveKind::Zip,
        }
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        PlatformArtifact {
            url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz",
            archive_file: "ffmpeg-download.tar.xz",
            archive_kind: ArchiveKind::TarXz,
        }
    }
    #[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
    {
        PlatformArtifact {
            url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz",
            archive_file: "ffmpeg-download.tar.xz",
            archive_kind: ArchiveKind::TarXz,
        }
    }
}

fn emit_progress(app: &AppHandle, progress: f32, message: impl Into<String>) {
    let _ = app.emit(
        "ffmpeg-download-progress",
        DownloadProgress {
            progress,
            message: message.into(),
        },
    );
}

fn install_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ffmpeg");
    std::fs::create_dir_all(root.join("bin")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(root.join("cache")).map_err(|e| e.to_string())?;
    Ok(root)
}

fn installed_binary(app: &AppHandle) -> PathBuf {
    install_root(app)
        .map(|r| r.join("bin").join(binary_file_name()))
        .unwrap_or_else(|_| PathBuf::from(binary_file_name()))
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
        && std::fs::metadata(path)
            .map(|m| m.len() > 0)
            .unwrap_or(false)
}

fn discover_on_path(name: &str) -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        #[cfg(windows)]
        let sep = ';';
        #[cfg(not(windows))]
        let sep = ':';
        for dir in path_var.split(sep).filter(|d| !d.is_empty()) {
            let candidate = PathBuf::from(dir).join(name);
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }

    #[cfg(target_os = "macos")]
    for candidate in [
        PathBuf::from(format!("/opt/homebrew/bin/{name}")),
        PathBuf::from(format!("/usr/local/bin/{name}")),
        PathBuf::from(format!("/opt/local/bin/{name}")),
    ] {
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }

    None
}

/// Returns a usable ffmpeg path if already installed (bundled, app data, or system).
pub fn discover(app: Option<&AppHandle>) -> Option<PathBuf> {
    if let Some(path) = FFMPEG_PATH.get() {
        return Some(path.clone());
    }

    if let Some(app) = app {
        let bundled = installed_binary(app);
        if is_executable(&bundled) {
            return Some(bundled);
        }
    }

    discover_on_path(binary_file_name())
}

pub fn program_path(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    discover(app).ok_or_else(|| {
        "FFmpeg is not installed. Use Download when prompted or install FFmpeg manually."
            .to_string()
    })
}

fn cache_path(path: PathBuf) -> PathBuf {
    let _ = FFMPEG_PATH.set(path.clone());
    path
}

fn find_ffmpeg_in_tree(root: &Path) -> Option<PathBuf> {
    let name = binary_file_name();
    for entry in WalkDir::new(root).max_depth(5).into_iter().flatten() {
        if entry.file_type().is_file() && entry.file_name() == name {
            return Some(entry.path().to_path_buf());
        }
    }
    None
}

fn extract_archive(archive: &Path, dest: &Path, kind: &ArchiveKind) -> Result<(), String> {
    match kind {
        ArchiveKind::Zip => {
            let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
            let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            archive.extract(dest).map_err(|e| e.to_string())?;
        }
        #[cfg(target_os = "linux")]
        ArchiveKind::TarXz => {
            let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
            let decompressor = xz2::read::XzDecoder::new(file);
            let mut archive = tar::Archive::new(decompressor);
            archive.unpack(dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn download_file(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    emit_progress(app, 0.0, "Connecting…");

    let response = ureq::get(url)
        .call()
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let total = response
        .headers()
        .get("Content-Length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok());
    let mut reader = response.into_body().into_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        downloaded += read as u64;
        if let Some(total) = total {
            let pct = (downloaded as f32 / total as f32).min(0.95);
            emit_progress(app, pct, "Downloading FFmpeg…");
        }
    }

    Ok(())
}

fn install_downloaded(app: &AppHandle) -> Result<PathBuf, String> {
    let artifact = platform_artifact();
    let root = install_root(app)?;
    let cache_dir = root.join("cache");
    let archive_path = cache_dir.join(artifact.archive_file);
    let extract_dir = cache_dir.join("extract");
    let dest_binary = root.join("bin").join(binary_file_name());

    if is_executable(&dest_binary) {
        return Ok(cache_path(dest_binary));
    }

    let _guard = DOWNLOAD_LOCK
        .write()
        .map_err(|_| "FFmpeg install already in progress".to_string())?;

    if is_executable(&dest_binary) {
        return Ok(cache_path(dest_binary));
    }

    if let Err(err) = std::fs::remove_dir_all(&extract_dir) {
        if extract_dir.exists() {
            return Err(err.to_string());
        }
    }
    std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

    download_file(app, artifact.url, &archive_path)?;

    emit_progress(app, 0.96, "Extracting FFmpeg…");
    extract_archive(&archive_path, &extract_dir, &artifact.archive_kind)?;

    let found = find_ffmpeg_in_tree(&extract_dir)
        .ok_or_else(|| "Downloaded archive did not contain an ffmpeg binary".to_string())?;

    if let Some(parent) = dest_binary.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&found, &dest_binary).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest_binary, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }

    let _ = std::fs::remove_file(&archive_path);

    emit_progress(app, 1.0, "FFmpeg ready");
    Ok(cache_path(dest_binary))
}

fn prompt_download(app: &AppHandle) -> Result<bool, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let dialog_app = app.clone();
    app.run_on_main_thread(move || {
        let confirmed = dialog_app
            .dialog()
            .message(
                "Sonixy needs FFmpeg for clip export, format conversion, playback speed adjustment, and loudness normalization.\n\n\
                 Download FFmpeg now? (~80 MB; a third-party GPL-licensed static build will be installed)",
            )
            .title("FFmpeg required")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Download".into(),
                "Cancel".into(),
            ))
            .blocking_show();
        let _ = tx.send(confirmed);
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())
}

/// If FFmpeg is missing, show the install dialog once the app window is up.
pub fn offer_install_on_startup(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        if is_available(&app) {
            return;
        }
        let _ = ensure_blocking(&app);
    });
}

/// Find ffmpeg or ask the user to download it. Safe to call from background threads.
pub fn ensure_blocking(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = discover(Some(app)) {
        return Ok(cache_path(path));
    }

    if !prompt_download(app)? {
        return Err(
            "FFmpeg is required for this action. Install FFmpeg or choose Download when prompted."
                .to_string(),
        );
    }

    install_downloaded(app)
}

pub fn is_available(app: &AppHandle) -> bool {
    discover(Some(app)).is_some()
}

pub fn create_ffmpeg_command(app: Option<&AppHandle>) -> Result<Command, String> {
    let program = program_path(app)?;
    #[cfg(windows)]
    {
        let mut cmd = Command::new(program);
        cmd.creation_flags(0x08000000);
        Ok(cmd)
    }
    #[cfg(not(windows))]
    {
        Ok(Command::new(program))
    }
}
