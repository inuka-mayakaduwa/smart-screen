use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc::RecvTimeoutError};
use std::thread;
use std::time::Duration;

use opus::{Application, Bitrate, Channels, Encoder};
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, watch};
use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

use crate::session::Mode;

const FRAME: usize = 960;
const RATE: u32 = 48_000;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
const PCM_SUBFORMAT: GUID = GUID::from_u128(0x0000_0001_0000_0010_8000_00aa_0038_9b71);
const FLOAT_SUBFORMAT: GUID = GUID::from_u128(0x0000_0003_0000_0010_8000_00aa_0038_9b71);

pub struct Packet {
    pub bytes: Vec<u8>,
    pub duration: Duration,
}

enum SampleKind {
    Pcm16,
    Pcm32,
    Float,
}

struct Mix {
    channels: usize,
    rate: u32,
    stride: usize,
    kind: SampleKind,
}

struct Converter {
    mix: Mix,
    source: Vec<f32>,
    cursor: f64,
}

pub fn share_status(ready: bool) -> &'static str {
    if ready {
        "The panel plays this PC's sound. Mute this PC if it is in the same room."
    } else {
        "Video only. System audio is unavailable."
    }
}

pub fn start(stop: Arc<AtomicBool>, mode: watch::Receiver<Mode>, app: AppHandle) -> Option<mpsc::Receiver<Packet>> {
    let (tx, rx) = mpsc::channel(8);
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let spawned = thread::Builder::new().name("share-audio".into()).spawn(move || {
        let mut loopback = match Loopback::open() {
            Ok(loopback) => loopback,
            Err(error) => {
                eprintln!("[share-desktop] audio unavailable {error}");
                let _ = ready_tx.send(false);
                return;
            }
        };
        let mut encoder = match Encoder::new(RATE, Channels::Stereo, Application::Audio) {
            Ok(mut encoder) => {
                if let Err(error) = encoder.set_bitrate(Bitrate::Bits(96_000)) {
                    eprintln!("[share-desktop] audio bitrate {error}");
                }
                encoder
            }
            Err(error) => {
                eprintln!("[share-desktop] audio encoder unavailable {error}");
                let _ = ready_tx.send(false);
                return;
            }
        };
        eprintln!(
            "[share-desktop] audio loopback {} Hz {} ch",
            loopback.converter.mix.rate, loopback.converter.mix.channels
        );
        let _ = ready_tx.send(true);
        if let Err(error) = loopback.run(&stop, &mode, &tx, &mut encoder) {
            if !stop.load(Ordering::SeqCst) {
                eprintln!("[share-desktop] audio stopped {error}");
                emit_status(&app, false);
            }
        }
    });
    if spawned.is_err() {
        return None;
    }
    match ready_rx.recv_timeout(Duration::from_secs(2)) {
        Ok(true) => Some(rx),
        Ok(false) => None,
        Err(RecvTimeoutError::Timeout) => {
            eprintln!("[share-desktop] audio unavailable timed out");
            None
        }
        Err(RecvTimeoutError::Disconnected) => None,
    }
}

fn emit_status(app: &AppHandle, ready: bool) {
    let _ = app.emit("share", serde_json::json!({ "kind": "status", "text": share_status(ready) }));
}

struct Loopback {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    converter: Converter,
}

impl Loopback {
    fn open() -> Result<Self, String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| error.to_string())?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|error| error.to_string())?;
            let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|error| error.to_string())?;
            let format = client.GetMixFormat().map_err(|error| error.to_string())?;
            let mix = mix_format(format);
            let opened = mix.and_then(|mix| {
                client
                    .Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 1_000_000, 0, format, None)
                    .map_err(|error| error.to_string())?;
                Ok(mix)
            });
            CoTaskMemFree(Some(format as *const _));
            let mix = opened?;
            let capture = client.GetService::<IAudioCaptureClient>().map_err(|error| error.to_string())?;
            client.Start().map_err(|error| error.to_string())?;
            Ok(Self { client, capture, converter: Converter::new(mix) })
        }
    }

    fn run(
        &mut self,
        stop: &AtomicBool,
        mode: &watch::Receiver<Mode>,
        tx: &mpsc::Sender<Packet>,
        encoder: &mut Encoder,
    ) -> Result<(), String> {
        let mut output = [0u8; 4000];
        while !stop.load(Ordering::SeqCst) {
            if tx.is_closed() {
                return Ok(());
            }
            let silent = *mode.borrow() != Mode::Live;
            let packet = unsafe { self.capture.GetNextPacketSize().map_err(|error| error.to_string())? };
            if packet == 0 {
                thread::sleep(Duration::from_millis(5));
                continue;
            }
            let mut data = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            unsafe {
                self.capture
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|error| error.to_string())?;
            }
            let bytes = frames as usize * self.converter.mix.stride * self.converter.mix.channels;
            let silent = silent || flags & 2 != 0;
            if !data.is_null() && bytes > 0 {
                let slice = unsafe { std::slice::from_raw_parts(data, bytes) };
                self.converter.push(slice, silent);
            }
            unsafe { self.capture.ReleaseBuffer(frames).map_err(|error| error.to_string())? };
            while let Some(frame) = self.converter.pull() {
                let size = encoder.encode_float(&frame, &mut output).map_err(|error| error.to_string())?;
                if size == 0 {
                    continue;
                }
                let packet = Packet { bytes: output[..size].to_vec(), duration: Duration::from_millis(20) };
                if tx.try_send(packet).is_err() {
                    break;
                }
            }
        }
        Ok(())
    }
}

impl Drop for Loopback {
    fn drop(&mut self) {
        unsafe {
            self.client.Stop().ok();
        }
    }
}

fn mix_format(format: *mut WAVEFORMATEX) -> Result<Mix, String> {
    if format.is_null() {
        return Err("The playback device has no mix format.".into());
    }
    let header = unsafe { std::ptr::read_unaligned(format) };
    let channels = header.nChannels as usize;
    let rate = header.nSamplesPerSec;
    let bits = header.wBitsPerSample;
    let tag = header.wFormatTag;
    if channels == 0 || rate < 8_000 {
        return Err("The playback device format cannot be captured.".into());
    }
    let mut kind = match tag {
        value if value == WAVE_FORMAT_PCM as u16 && bits == 16 => Some(SampleKind::Pcm16),
        value if value == WAVE_FORMAT_PCM as u16 && bits == 32 => Some(SampleKind::Pcm32),
        value if value == WAVE_FORMAT_IEEE_FLOAT && bits == 32 => Some(SampleKind::Float),
        WAVE_FORMAT_EXTENSIBLE => None,
        _ => return Err("The playback device format cannot be captured.".into()),
    };
    if tag == WAVE_FORMAT_EXTENSIBLE {
        if header.cbSize < 22 {
            return Err("The playback device format cannot be captured.".into());
        }
        let extended = unsafe { std::ptr::read_unaligned(format as *const WAVEFORMATEXTENSIBLE) };
        let subformat = extended.SubFormat;
        kind = if subformat == PCM_SUBFORMAT && bits == 16 {
            Some(SampleKind::Pcm16)
        } else if subformat == PCM_SUBFORMAT && bits == 32 {
            Some(SampleKind::Pcm32)
        } else if subformat == FLOAT_SUBFORMAT && bits == 32 {
            Some(SampleKind::Float)
        } else {
            None
        };
    }
    let Some(kind) = kind else {
        return Err("The playback device format cannot be captured.".into());
    };
    let align = header.nBlockAlign as usize;
    let stride = if align >= channels { align / channels } else { bits as usize / 8 };
    if stride == 0 {
        return Err("The playback device format cannot be captured.".into());
    }
    Ok(Mix { channels, rate, stride, kind })
}

impl Converter {
    fn new(mix: Mix) -> Self {
        Self { mix, source: Vec::new(), cursor: 0.0 }
    }

    fn push(&mut self, bytes: &[u8], silent: bool) {
        let frame = self.mix.stride * self.mix.channels;
        if frame == 0 {
            return;
        }
        let frames = bytes.len() / frame;
        if self.source.len() > self.mix.rate as usize * 4 {
            self.source.clear();
            self.cursor = 0.0;
        }
        if silent {
            self.source.extend(std::iter::repeat(0.0).take(frames * 2));
            return;
        }
        for index in 0..frames {
            let start = index * frame;
            let left = sample_at(&self.mix, bytes, start);
            let right = if self.mix.channels > 1 {
                sample_at(&self.mix, bytes, start + self.mix.stride)
            } else {
                left
            };
            self.source.push(left);
            self.source.push(right);
        }
    }

    fn pull(&mut self) -> Option<Vec<f32>> {
        let step = self.mix.rate as f64 / RATE as f64;
        if step <= 0.0 {
            return None;
        }
        let available = (self.source.len() / 2) as f64;
        if self.cursor + FRAME as f64 * step + 1.0 > available {
            return None;
        }
        let mut frame = Vec::with_capacity(FRAME * 2);
        for index in 0..FRAME {
            let position = self.cursor + index as f64 * step;
            let at = position.floor() as usize;
            let frac = (position - at as f64) as f32;
            let base = at * 2;
            let left = self.source[base] + (self.source[base + 2] - self.source[base]) * frac;
            let right = self.source[base + 1] + (self.source[base + 3] - self.source[base + 1]) * frac;
            frame.push(left);
            frame.push(right);
        }
        self.cursor += FRAME as f64 * step;
        let drop = self.cursor.floor() as usize;
        if drop > 0 {
            let end = (drop * 2).min(self.source.len());
            self.source.drain(0..end);
            self.cursor -= drop as f64;
            if self.cursor < 0.0 {
                self.cursor = 0.0;
            }
        }
        Some(frame)
    }
}

fn sample_at(mix: &Mix, bytes: &[u8], offset: usize) -> f32 {
    if offset + mix.stride > bytes.len() {
        return 0.0;
    }
    match mix.kind {
        SampleKind::Float => f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap_or([0; 4])),
        SampleKind::Pcm16 => i16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap_or([0; 2])) as f32 / 32768.0,
        SampleKind::Pcm32 => i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap_or([0; 4])) as f32 / 2147483648.0,
    }
}
