#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Latency {
    Skip,
    Queue,
}

#[derive(Clone, Debug)]
pub struct Picture {
    pub width: i32,
    pub fps: u32,
    pub quality: f64,
    pub latency: Latency,
}

impl Default for Picture {
    fn default() -> Self {
        Self { width: -1, fps: 0, quality: 0.9, latency: Latency::Skip }
    }
}

impl Picture {
    pub fn apply(&mut self, width: Option<i32>, fps: Option<u32>, quality: Option<f64>, latency: Option<&str>) {
        if let Some(width) = width {
            self.width = width;
        }
        if let Some(fps) = fps {
            self.fps = if fps == 0 { 0 } else { fps.min(60) };
        }
        if let Some(quality) = quality {
            self.quality = quality.clamp(0.4, 0.95);
        }
        if latency == Some("queue") || latency == Some("skip") {
            self.latency = if latency == Some("queue") { Latency::Queue } else { Latency::Skip };
        }
    }
}

pub fn fit_width(source_width: u32) -> u32 {
    let mut chosen = 0;
    for step in [1280, 1920, 2560] {
        if source_width >= step {
            chosen = step;
        }
    }
    chosen
}

pub fn fit_fps(source_width: u32, source_fps: u32) -> u32 {
    let ceiling = source_fps.clamp(15, 60);
    let ideal = if source_width >= 2560 {
        24
    } else if source_width >= 1920 {
        30
    } else {
        60
    };
    let mut pool = [15, 24, 30, 60].into_iter().filter(|fps| *fps <= ceiling).collect::<Vec<_>>();
    if pool.is_empty() {
        pool.push(15);
    }
    pool.into_iter().min_by_key(|fps| fps.abs_diff(ideal)).unwrap_or(15)
}

pub fn active_size(source_width: u32, source_height: u32, width_setting: i32) -> (u32, u32) {
    let chosen = if width_setting < 0 {
        fit_width(source_width)
    } else {
        width_setting.max(0) as u32
    };
    let mut width = if chosen == 0 { source_width } else { chosen.min(source_width) };
    if width < 2 {
        width = 2;
    }
    width &= !1;
    let mut height = ((source_height as u64 * width as u64) / source_width.max(1) as u64).max(2) as u32;
    height &= !1;
    if height < 2 {
        height = 2;
    }
    (width, height)
}

pub fn active_fps(picture: &Picture, source_width: u32, source_fps: u32) -> u32 {
    let width = if picture.width < 0 {
        let fitted = fit_width(source_width);
        if fitted == 0 { source_width } else { fitted }
    } else if picture.width == 0 {
        source_width
    } else {
        picture.width as u32
    };
    if picture.fps == 0 { fit_fps(width, source_fps) } else { picture.fps.clamp(1, 60) }
}

pub fn screen_bitrate(width: u32, fps: u32, quality: f64, lan: bool) -> u32 {
    let base = if lan {
        if width >= 2560 {
            22_000_000.0
        } else if width >= 1920 {
            16_000_000.0
        } else if width >= 1280 {
            12_000_000.0
        } else {
            4_000_000.0
        }
    } else if width >= 2560 {
        6_000_000.0
    } else if width >= 1920 {
        4_000_000.0
    } else if width >= 1280 {
        2_500_000.0
    } else {
        1_200_000.0
    };
    let rate = (fps.clamp(1, 60) as f64) / 30.0;
    let sharp = quality.clamp(0.35, 1.0);
    let scaled = base * rate * sharp;
    let cap = if lan { 30_000_000.0 } else { 8_000_000.0 };
    scaled.clamp(350_000.0, cap).round() as u32
}

pub fn to_annex_b(sample: &[u8]) -> Vec<u8> {
    if sample.is_empty() {
        return Vec::new();
    }
    if starts_with_start_code(sample) {
        return sample.to_vec();
    }
    let mut out = Vec::with_capacity(sample.len() + 16);
    let mut offset = 0;
    while offset + 4 <= sample.len() {
        let length = u32::from_be_bytes(sample[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        if length == 0 || offset + length > sample.len() {
            return sample.to_vec();
        }
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&sample[offset..offset + length]);
        offset += length;
    }
    if out.is_empty() { sample.to_vec() } else { out }
}

pub fn is_keyframe(annex_b: &[u8]) -> bool {
    nal_types(annex_b).contains(&5)
}

pub fn has_parameter_sets(annex_b: &[u8]) -> bool {
    let types = nal_types(annex_b);
    types.contains(&7) && types.contains(&8)
}

pub fn with_parameter_sets(annex_b: &[u8], parameter_sets: &[u8]) -> Vec<u8> {
    if parameter_sets.is_empty() || has_parameter_sets(annex_b) || !is_keyframe(annex_b) {
        return annex_b.to_vec();
    }
    let mut out = to_annex_b(parameter_sets);
    if !out.is_empty() && !starts_with_start_code(&out) {
        return annex_b.to_vec();
    }
    out.extend_from_slice(annex_b);
    out
}

fn starts_with_start_code(sample: &[u8]) -> bool {
    sample.starts_with(&[0, 0, 0, 1]) || sample.starts_with(&[0, 0, 1])
}

fn nal_types(annex_b: &[u8]) -> Vec<u8> {
    let mut types = Vec::new();
    let mut index = 0;
    while index + 3 < annex_b.len() {
        let start = if annex_b[index..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if annex_b[index..].starts_with(&[0, 0, 1]) {
            3
        } else {
            index += 1;
            continue;
        };
        let nal = index + start;
        if nal < annex_b.len() {
            types.push(annex_b[nal] & 0x1f);
        }
        index = nal + 1;
    }
    types
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn width_steps_match_the_browser() {
        assert_eq!(fit_width(800), 0);
        assert_eq!(fit_width(1366), 1280);
        assert_eq!(fit_width(1920), 1920);
        assert_eq!(fit_width(2560), 2560);
    }

    #[test]
    fn frame_rate_steps_match_the_browser() {
        assert_eq!(fit_fps(2560, 60), 24);
        assert_eq!(fit_fps(1920, 60), 30);
        assert_eq!(fit_fps(1280, 60), 60);
        assert_eq!(fit_fps(1920, 24), 24);
    }

    #[test]
    fn bitrate_keeps_the_relay_cap_and_raises_it_on_a_host_path() {
        assert_eq!(screen_bitrate(1920, 30, 0.9, false), 3_600_000);
        assert_eq!(screen_bitrate(1920, 30, 0.9, true), 14_400_000);
        assert_eq!(screen_bitrate(1280, 30, 1.0, true), 12_000_000);
        assert_eq!(screen_bitrate(2560, 60, 1.0, true), 30_000_000);
        assert_eq!(screen_bitrate(2560, 60, 1.0, false), 8_000_000);
    }

    #[test]
    fn length_prefixed_nals_become_annex_b() {
        let sample = [0u8, 0, 0, 2, 0x65, 0x11, 0, 0, 0, 2, 0x41, 0x22];
        let annex = to_annex_b(&sample);
        assert_eq!(annex, [0, 0, 0, 1, 0x65, 0x11, 0, 0, 0, 1, 0x41, 0x22]);
        assert!(is_keyframe(&annex));
    }

    #[test]
    fn a_keyframe_gains_parameter_sets_when_the_sample_has_none() {
        let idr = [0u8, 0, 0, 1, 0x65, 1];
        let sets = [0u8, 0, 0, 1, 0x67, 2, 0, 0, 0, 1, 0x68, 3];
        let merged = with_parameter_sets(&idr, &sets);
        assert!(has_parameter_sets(&merged));
        assert!(is_keyframe(&merged));
    }
}
