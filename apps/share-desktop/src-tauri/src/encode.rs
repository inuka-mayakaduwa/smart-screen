use std::mem::ManuallyDrop;
use std::time::Duration;

use windows::core::Interface;
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::Media::MediaFoundation::{
    MFCreateMediaType, MFCreateMemoryBuffer, MFCreateSample, MFShutdown, MFStartup, IMFActivate, IMFMediaBuffer, IMFSample, IMFTransform,
    ICodecAPI, MF_E_TRANSFORM_NEED_MORE_INPUT, MF_LOW_LATENCY, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE, MF_MT_INTERLACE_MODE,
    MF_MT_MAJOR_TYPE, MF_MT_MPEG2_PROFILE, MF_MT_MPEG_SEQUENCE_HEADER, MF_MT_PIXEL_ASPECT_RATIO, MF_MT_SUBTYPE, MF_VERSION, MFSTARTUP_NOSOCKET,
    MFTEnumEx, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_ENUM_FLAG_SYNCMFT,
    MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, MFT_MESSAGE_NOTIFY_START_OF_STREAM, MFT_OUTPUT_DATA_BUFFER, MFT_OUTPUT_STREAM_PROVIDES_SAMPLES,
    MFT_REGISTER_TYPE_INFO, MFMediaType_Video, MFSampleExtension_CleanPoint, MFVideoFormat_H264, MFVideoFormat_NV12,
    MFVideoInterlace_Progressive, CODECAPI_AVEncCommonMeanBitRate, CODECAPI_AVEncMPVGOPSize, CODECAPI_AVEncMPVDefaultBPictureCount,
    CODECAPI_AVEncVideoForceKeyFrame, CODECAPI_AVLowLatencyMode,
};
use windows::Win32::System::Com::{CoTaskMemFree, COINIT_MULTITHREADED, CoInitializeEx};
use windows::Win32::System::Variant::{VARIANT, VT_BOOL, VT_UI4};

use crate::picture::{is_keyframe, to_annex_b, with_parameter_sets};

pub struct Encoded {
    pub bytes: Vec<u8>,
    pub duration: Duration,
    pub keyframe: bool,
}

pub struct Encoder {
    transform: IMFTransform,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    frames: u64,
    hardware: bool,
    provides_samples: bool,
    parameter_sets: Vec<u8>,
    force: bool,
}

impl Encoder {
    pub fn open(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<Self, String> {
        ensure_media_foundation()?;
        let (transform, hardware) = activate_encoder()?;
        let mut encoder = Self {
            transform,
            width,
            height,
            fps: fps.max(1),
            bitrate,
            frames: 0,
            hardware,
            provides_samples: false,
            parameter_sets: Vec::new(),
            force: true,
        };
        encoder.configure()?;
        Ok(encoder)
    }

    pub fn hardware(&self) -> bool {
        self.hardware
    }

    pub fn matches(&self, width: u32, height: u32, fps: u32, bitrate: u32) -> bool {
        self.width == width && self.height == height && self.fps == fps.max(1) && self.bitrate == bitrate
    }

    pub fn force_key(&mut self) {
        self.force = true;
    }

    pub fn encode(&mut self, bgra: &[u8]) -> Result<Option<Encoded>, String> {
        let nv12 = bgra_to_nv12(bgra, self.width, self.height);
        self.apply_force();
        let sample = nv12_sample(&nv12, self.frames, self.fps)?;
        let pushed = unsafe { self.transform.ProcessInput(0, &sample, 0) };
        if let Err(error) = pushed {
            if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                return Ok(None);
            }
            return Err(error.to_string());
        }
        self.frames += 1;
        let produced = self.pull()?;
        let Some(bytes) = produced else { return Ok(None) };
        let annex = to_annex_b(&bytes);
        let annex = with_parameter_sets(&annex, &self.parameter_sets);
        if annex.is_empty() {
            return Ok(None);
        }
        Ok(Some(Encoded {
            keyframe: is_keyframe(&annex),
            duration: Duration::from_secs_f64(1.0 / self.fps as f64),
            bytes: annex,
        }))
    }

    fn configure(&mut self) -> Result<(), String> {
        tune_codec(&self.transform, self.bitrate, self.fps);
        let output = h264_type(self.width, self.height, self.fps, self.bitrate)?;
        unsafe { self.transform.SetOutputType(0, &output, 0) }.map_err(|error| error.to_string())?;
        let input = nv12_type(self.width, self.height, self.fps)?;
        unsafe { self.transform.SetInputType(0, &input, 0) }.map_err(|error| error.to_string())?;
        let info = unsafe { self.transform.GetOutputStreamInfo(0) }.map_err(|error| error.to_string())?;
        self.provides_samples = (info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32)) != 0;
        if let Ok(current) = unsafe { self.transform.GetOutputCurrentType(0) } {
            if let Some(header) = blob(&current, &MF_MT_MPEG_SEQUENCE_HEADER) {
                self.parameter_sets = header;
            }
        }
        unsafe {
            self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0).ok();
            self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0).ok();
        }
        Ok(())
    }

    fn apply_force(&mut self) {
        if !self.force {
            return;
        }
        self.force = false;
        if let Ok(codec) = self.transform.cast::<ICodecAPI>() {
            let value = bool_variant(true);
            unsafe { codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &value).ok() };
        }
    }

    fn pull(&mut self) -> Result<Option<Vec<u8>>, String> {
        let sample = if self.provides_samples { None } else { Some(output_sample(self.width * self.height * 2)?) };
        let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(sample),
            dwStatus: 0,
            pEvents: ManuallyDrop::new(None),
        }];
        let mut status = 0u32;
        if let Err(error) = unsafe { self.transform.ProcessOutput(0, &mut buffers, &mut status) } {
            drop(unsafe { ManuallyDrop::take(&mut buffers[0].pSample) });
            drop(unsafe { ManuallyDrop::take(&mut buffers[0].pEvents) });
            if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT {
                return Ok(None);
            }
            return Err(error.to_string());
        }
        drop(unsafe { ManuallyDrop::take(&mut buffers[0].pEvents) });
        let Some(sample) = (unsafe { ManuallyDrop::take(&mut buffers[0].pSample) }) else { return Ok(None) };
        let clean = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) == 1;
        let bytes = read_sample(&sample)?;
        if clean {
            self.force = false;
        }
        Ok(Some(bytes))
    }
}

fn activate_encoder() -> Result<(IMFTransform, bool), String> {
    if let Some(transform) = find_encoder(true)? {
        return Ok((transform, true));
    }
    if let Some(transform) = find_encoder(false)? {
        return Ok((transform, false));
    }
    Err("No H.264 encoder is available.".into())
}

fn find_encoder(hardware: bool) -> Result<Option<IMFTransform>, String> {
    let input = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 };
    let output = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
    let flags = if hardware {
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER
    } else {
        MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER
    };
    let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    unsafe {
        MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            flags,
            Some(&input),
            Some(&output),
            &mut activates,
            &mut count,
        )
    }
    .map_err(|error| error.to_string())?;
    let chosen = if count == 0 || activates.is_null() {
        None
    } else {
        unsafe { (*activates).take() }.and_then(|activate| unsafe { activate.ActivateObject::<IMFTransform>() }.ok())
    };
    if !activates.is_null() {
        let listed = unsafe { std::slice::from_raw_parts_mut(activates, count as usize) };
        for activate in listed.iter_mut() {
            activate.take();
        }
        unsafe { CoTaskMemFree(Some(activates.cast())) };
    }
    Ok(chosen)
}

fn h264_type(width: u32, height: u32, fps: u32, bitrate: u32) -> Result<windows::Win32::Media::MediaFoundation::IMFMediaType, String> {
    let kind = unsafe { MFCreateMediaType() }.map_err(|error| error.to_string())?;
    unsafe {
        kind.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|error| error.to_string())?;
        kind.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264).map_err(|error| error.to_string())?;
        kind.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(|error| error.to_string())?;
        kind.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(|error| error.to_string())?;
        kind.SetUINT32(&MF_LOW_LATENCY, 1).ok();
        kind.SetUINT32(&MF_MT_MPEG2_PROFILE, 66).ok();
        kind.SetUINT64(&MF_MT_FRAME_SIZE, ((width as u64) << 32) | height as u64).map_err(|error| error.to_string())?;
        kind.SetUINT64(&MF_MT_FRAME_RATE, ((fps.max(1) as u64) << 32) | 1).map_err(|error| error.to_string())?;
        kind.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1).ok();
    }
    Ok(kind)
}

fn nv12_type(width: u32, height: u32, fps: u32) -> Result<windows::Win32::Media::MediaFoundation::IMFMediaType, String> {
    let kind = unsafe { MFCreateMediaType() }.map_err(|error| error.to_string())?;
    unsafe {
        kind.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|error| error.to_string())?;
        kind.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_NV12).map_err(|error| error.to_string())?;
        kind.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(|error| error.to_string())?;
        kind.SetUINT64(&MF_MT_FRAME_SIZE, ((width as u64) << 32) | height as u64).map_err(|error| error.to_string())?;
        kind.SetUINT64(&MF_MT_FRAME_RATE, ((fps.max(1) as u64) << 32) | 1).map_err(|error| error.to_string())?;
    }
    Ok(kind)
}

fn tune_codec(transform: &IMFTransform, bitrate: u32, fps: u32) {
    let Ok(codec) = transform.cast::<ICodecAPI>() else { return };
    unsafe {
        codec.SetValue(&CODECAPI_AVLowLatencyMode, &bool_variant(true)).ok();
        codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &u32_variant(0)).ok();
        codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &u32_variant(bitrate)).ok();
        codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &u32_variant(fps.max(1) * 10)).ok();
    }
}

fn nv12_sample(nv12: &[u8], frame: u64, fps: u32) -> Result<IMFSample, String> {
    let buffer = unsafe { MFCreateMemoryBuffer(nv12.len() as u32) }.map_err(|error| error.to_string())?;
    copy_buffer(&buffer, nv12)?;
    let sample = unsafe { MFCreateSample() }.map_err(|error| error.to_string())?;
    unsafe {
        sample.AddBuffer(&buffer).map_err(|error| error.to_string())?;
        let tick = 10_000_000i64 / fps.max(1) as i64;
        sample.SetSampleTime(frame as i64 * tick).ok();
        sample.SetSampleDuration(tick).ok();
    }
    Ok(sample)
}

fn output_sample(size: u32) -> Result<IMFSample, String> {
    let buffer = unsafe { MFCreateMemoryBuffer(size.max(64 * 1024)) }.map_err(|error| error.to_string())?;
    let sample = unsafe { MFCreateSample() }.map_err(|error| error.to_string())?;
    unsafe { sample.AddBuffer(&buffer).map_err(|error| error.to_string())? };
    Ok(sample)
}

fn copy_buffer(buffer: &IMFMediaBuffer, bytes: &[u8]) -> Result<(), String> {
    let mut data = std::ptr::null_mut();
    let mut max = 0u32;
    unsafe { buffer.Lock(&mut data, Some(&mut max), None) }.map_err(|error| error.to_string())?;
    if data.is_null() || (max as usize) < bytes.len() {
        unsafe { buffer.Unlock().ok() };
        return Err("The encoder rejected the frame.".into());
    }
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), data, bytes.len()) };
    unsafe {
        buffer.Unlock().ok();
        buffer.SetCurrentLength(bytes.len() as u32).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn read_sample(sample: &IMFSample) -> Result<Vec<u8>, String> {
    let buffer = unsafe { sample.ConvertToContiguousBuffer() }.map_err(|error| error.to_string())?;
    let mut data = std::ptr::null_mut();
    let mut current = 0u32;
    unsafe { buffer.Lock(&mut data, None, Some(&mut current)) }.map_err(|error| error.to_string())?;
    let bytes = if data.is_null() || current == 0 {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(data, current as usize).to_vec() }
    };
    unsafe { buffer.Unlock().ok() };
    Ok(bytes)
}

fn blob(kind: &windows::Win32::Media::MediaFoundation::IMFMediaType, key: &windows::core::GUID) -> Option<Vec<u8>> {
    let size = unsafe { kind.GetBlobSize(key) }.ok()?;
    if size == 0 {
        return None;
    }
    let mut data = vec![0u8; size as usize];
    let mut written = size;
    unsafe { kind.GetBlob(key, &mut data, Some(&mut written)) }.ok()?;
    data.truncate(written as usize);
    Some(data)
}

fn bgra_to_nv12(bgra: &[u8], width: u32, height: u32) -> Vec<u8> {
    let width = width as usize;
    let height = height as usize;
    let y_size = width * height;
    let mut out = vec![0u8; y_size + y_size / 2];
    for row in 0..height {
        for col in 0..width {
            let index = (row * width + col) * 4;
            if index + 2 >= bgra.len() {
                continue;
            }
            let b = bgra[index] as i32;
            let g = bgra[index + 1] as i32;
            let r = bgra[index + 2] as i32;
            let y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            out[row * width + col] = y.clamp(0, 255) as u8;
            if row % 2 == 0 && col % 2 == 0 {
                let u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                let v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                let uv = y_size + (row / 2) * width + col;
                if uv + 1 < out.len() {
                    out[uv] = u.clamp(0, 255) as u8;
                    out[uv + 1] = v.clamp(0, 255) as u8;
                }
            }
        }
    }
    out
}

fn bool_variant(value: bool) -> VARIANT {
    let mut variant = VARIANT::default();
    unsafe {
        let inner = &mut variant.Anonymous.Anonymous;
        inner.vt = VT_BOOL;
        inner.Anonymous.boolVal = VARIANT_BOOL(if value { -1 } else { 0 });
    }
    variant
}

fn u32_variant(value: u32) -> VARIANT {
    let mut variant = VARIANT::default();
    unsafe {
        let inner = &mut variant.Anonymous.Anonymous;
        inner.vt = VT_UI4;
        inner.Anonymous.ulVal = value;
    }
    variant
}

fn ensure_media_foundation() -> Result<(), String> {
    use std::sync::Once;
    static START: Once = Once::new();
    let mut result = Ok(());
    START.call_once(|| {
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        result = unsafe { MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|error| error.to_string()) };
    });
    result
}

#[allow(dead_code)]
fn _shutdown() {
    unsafe { MFShutdown().ok() };
}
