// Lightweight perf harness for the Sonixy collection pipeline.
//
// Usage:
//   BENCH_DIR=/path/to/1k-wavs cargo run --release --example perf -- 1000
//   cargo run --release --example perf -- 5000
//
// Generates `count` silent WAV files of 1 second each in BENCH_DIR (or a
// tempdir), then measures:
//   - scan_folder wall time
//   - get_all_files wall time (full file-list JSON shape)
//   - generate_waveform on the first 50 files
//   - peak RSS
//
// Prints a JSON line to stdout for easy diffing across runs.

use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

use rayon::prelude::*;
use rusqlite::Connection;
use sonixy_lib::collection;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let count: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(1000);

    let dir = std::env::var("BENCH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join(format!("sonixy-bench-{count}")));

    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::create_dir_all(&dir).expect("create bench dir");
    println!("Generating {count} silent WAVs in {}…", dir.display());
    generate_fixtures(&dir, count);

    let start = Instant::now();
    let conn = Connection::open(dir.join(".sonixy.db")).expect("open db");
    let _ = conn.execute(
        "CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, filename TEXT NOT NULL, filepath TEXT NOT NULL UNIQUE, format TEXT NOT NULL, length TEXT NOT NULL, duration REAL NOT NULL DEFAULT 0.0, size TEXT NOT NULL, tags TEXT NOT NULL, gain REAL DEFAULT 1.0)",
        [],
    );
    let conn = collection::init_db(&dir).expect("init_db");
    drop(conn);

    // scan_folder
    let t_scan_start = Instant::now();
    let conn = collection::init_db(&dir).expect("reopen db");
    let _ = collection::scan_folder(&dir, &conn).expect("scan");
    let t_scan = t_scan_start.elapsed();

    // get_all_files
    let t_query_start = Instant::now();
    let files = collection::get_all_files(&dir, &conn, None).expect("get_all_files");
    let t_query = t_query_start.elapsed();

    // generate_waveform on first 50
    let sample: Vec<_> = files.iter().take(50).cloned().collect();
    let t_wf_start = Instant::now();
    sample.par_iter().for_each(|f| {
        let path = dir.join(&f.filepath);
        let _ = collection::generate_waveform(&path, |_p, _d| {});
    });
    let t_wf = t_wf_start.elapsed();

    let total = start.elapsed();
    let rss = peak_rss_bytes();
    let report = serde_json::json!({
        "count": count,
        "dir": dir.to_string_lossy(),
        "scan_ms": t_scan.as_millis(),
        "get_all_files_ms": t_query.as_millis(),
        "waveform_50_ms": t_wf.as_millis(),
        "total_ms": total.as_millis(),
        "rss_peak_mb": rss as f64 / (1024.0 * 1024.0),
    });
    println!("{}", report);
}

fn generate_fixtures(dir: &std::path::Path, count: usize) {
    // Use ffmpeg to write silent 1-second WAVs. Cheaper than crafting a WAV by hand.
    if Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(true)
    {
        eprintln!("ffmpeg not available; cannot generate fixtures. Set BENCH_DIR to a pre-populated tree.");
        std::process::exit(1);
    }
    (0..count).into_par_iter().for_each(|i| {
        let path = dir.join(format!("bench_{i:06}.wav"));
        let _ = Command::new("ffmpeg")
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=44100:cl=stereo",
                "-t",
                "1",
                "-y",
            ])
            .arg(&path)
            .output();
    });
}

#[cfg(target_os = "macos")]
fn peak_rss_bytes() -> u64 {
    use std::mem;
    extern "C" {
        fn mach_task_basic_info(task: u32, info: *mut MachTaskBasicInfo, count: *mut u32) -> i32;
    }
    #[repr(C)]
    struct MachTaskBasicInfo {
        virtual_size: u64,
        resident_size: u64,
        resident_size_max: u64,
        user_time: [u32; 2],
        system_time: [u32; 2],
        policy: i32,
        suspend_count: i32,
    }
    let mut info = unsafe { mem::zeroed::<MachTaskBasicInfo>() };
    let mut count = (mem::size_of::<MachTaskBasicInfo>() / mem::size_of::<u32>()) as u32;
    unsafe {
        mach_task_basic_info(mach_task_self(), &mut info, &mut count);
    }
    info.resident_size_max
}

#[cfg(target_os = "macos")]
extern "C" {
    fn mach_task_self() -> u32;
}

#[cfg(not(target_os = "macos"))]
fn peak_rss_bytes() -> u64 {
    // Linux: read VmHWM from /proc/self/status. macOS uses the path above.
    if let Ok(s) = std::fs::read_to_string("/proc/self/status") {
        for line in s.lines() {
            if let Some(rest) = line.strip_prefix("VmHWM:") {
                if let Ok(kb) = rest
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("0")
                    .parse::<u64>()
                {
                    return kb * 1024;
                }
            }
        }
    }
    0
}
