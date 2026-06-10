use std::path::Path;
use std::process::Command;

pub fn build_atempo_filter(speed: f32) -> String {
    let mut factors = Vec::new();
    let mut remaining = speed;

    while remaining > 2.0 + f32::EPSILON {
        factors.push(2.0);
        remaining /= 2.0;
    }
    while remaining < 0.5 - f32::EPSILON {
        factors.push(0.5);
        remaining /= 0.5;
    }
    if (remaining - 1.0).abs() > 0.001 {
        factors.push(remaining);
    }

    factors
        .iter()
        .map(|f| format!("atempo={f}"))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn decode_for_playback(
    input: &Path,
    speed: f32,
    create_ffmpeg: impl FnOnce() -> Result<Command, String>,
) -> Result<Vec<u8>, String> {
    if (speed - 1.0).abs() < 0.001 {
        return std::fs::read(input).map_err(|e| e.to_string());
    }

    let filter = build_atempo_filter(speed);
    let output = create_ffmpeg()?
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(input)
        .arg("-af")
        .arg(&filter)
        .arg("-f")
        .arg("wav")
        .arg("pipe:1")
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg tempo decode failed: {stderr}"));
    }

    Ok(output.stdout)
}
