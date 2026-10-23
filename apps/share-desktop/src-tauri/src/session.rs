use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::watch;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::audio::{self, Packet};
use crate::capture::{list_sources, Capturer, Frame};
use crate::encode::Encoder;
use crate::jpeg::{encode_jpeg, preview_jpeg, resting_jpeg, target_frame};
use crate::peer::{IceServer, Peer};
use crate::picture::{active_fps, active_size, screen_bitrate, Latency, Picture};
use crate::protocol::{self, answer_sdp, display_state_message, hangup_message, ice_fields, offer_message};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Live,
    Paused,
    Frozen,
}

enum Ctrl {
    Text(String),
    Hangup,
    Fail(String),
    PeerState(String),
}

struct Running {
    stop: Arc<AtomicBool>,
    ctrl: UnboundedSender<Ctrl>,
    mode: watch::Sender<Mode>,
    still: Arc<AtomicU64>,
    gain: Arc<AtomicU32>,
}

static CURRENT: Mutex<Option<Running>> = Mutex::new(None);

#[derive(Deserialize)]
struct ShareSession {
    #[serde(rename = "iceServers")]
    ice_servers: Vec<IceServer>,
}

pub fn prepare(server: &str, code: &str) -> Result<(), String> {
    let code = normalize_code(code);
    if code.len() < 4 {
        return Err("Enter the room code shown on the panel.".into());
    }
    tauri::async_runtime::block_on(fetch_session(server, &code)).map(|_| ())
}

pub fn sources() -> Result<Vec<crate::capture::SourceInfo>, String> {
    list_sources()
}

pub fn start(app: AppHandle, server: String, code: String, source_id: String) -> Result<(), String> {
    let code = normalize_code(&code);
    if code.len() < 4 {
        return Err("Enter the room code shown on the panel.".into());
    }
    if !source_id.starts_with("display:") && !source_id.starts_with("window:") {
        return Err("Choose a screen to share.".into());
    }
    stop();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let (ctrl_tx, ctrl_rx) = mpsc::unbounded_channel();
    let (mode_tx, mode_rx) = watch::channel(Mode::Live);
    let still = Arc::new(AtomicU64::new(0));
    let picture = Arc::new(Mutex::new(Picture::default()));
    let direct = Arc::new(AtomicBool::new(false));
    let lan = Arc::new(AtomicBool::new(false));
    let force_key = Arc::new(AtomicBool::new(true));
    let jpeg_queued = Arc::new(AtomicUsize::new(0));
    let (jpeg_tx, jpeg_rx) = mpsc::channel(24);
    let (h264_tx, h264_rx) = mpsc::channel(3);
    let (ice_tx, mut ice_rx) = mpsc::unbounded_channel();
    let (state_tx, mut state_rx) = mpsc::unbounded_channel();
    let fail_tx = ctrl_tx.clone();
    let capture_stop = stop_flag.clone();
    let capture_picture = picture.clone();
    let capture_direct = direct.clone();
    let capture_lan = lan.clone();
    let capture_force = force_key.clone();
    let capture_still = still.clone();
    let capture_mode = mode_rx.clone();
    let audio_mode = mode_rx;
    let capture_app = app.clone();
    let capture_queued = jpeg_queued.clone();
    std::thread::Builder::new()
        .name("share-capture".into())
        .spawn(move || {
            if let Err(error) = capture_loop(
                source_id,
                capture_app,
                capture_stop,
                capture_picture,
                capture_direct,
                capture_lan,
                capture_force,
                capture_still,
                capture_mode,
                jpeg_tx,
                h264_tx,
                capture_queued,
            ) {
                if error != "stopped" {
                    let _ = fail_tx.send(Ctrl::Fail(error));
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let gain = Arc::new(AtomicU32::new(100));
    *CURRENT.lock().unwrap() = Some(Running {
        stop: stop_flag.clone(),
        ctrl: ctrl_tx.clone(),
        mode: mode_tx,
        still,
        gain: gain.clone(),
    });
    let audio_rx = audio::start(stop_flag.clone(), audio_mode, gain, app.clone());
    emit(&app, serde_json::json!({ "kind": "status", "text": audio::share_status(audio_rx.is_some()) }));
    let net_stop = stop_flag.clone();
    let net_picture = picture.clone();
    let net_direct = direct.clone();
    let net_lan = lan;
    let net_force = force_key;
    let net_app = app.clone();
    let net_ctrl = ctrl_tx.clone();
    let net_queued = jpeg_queued;
    tauri::async_runtime::spawn(async move {
        let ice_forward = net_ctrl.clone();
        let state_forward = net_ctrl.clone();
        tokio::spawn(async move {
            while let Some(message) = ice_rx.recv().await {
                if ice_forward.send(Ctrl::Text(message)).is_err() {
                    break;
                }
            }
        });
        tokio::spawn(async move {
            while let Some(state) = state_rx.recv().await {
                if state_forward.send(Ctrl::PeerState(state)).is_err() {
                    break;
                }
            }
        });
        let ended = net_app.clone();
        let reason = network_loop(
            net_app,
            server,
            code,
            net_stop,
            net_picture,
            net_direct,
            net_lan,
            net_force,
            ctrl_rx,
            jpeg_rx,
            h264_rx,
            audio_rx,
            ice_tx,
            state_tx,
            net_queued,
        )
        .await;
        if let Some(text) = reason {
            emit(&ended, serde_json::json!({ "kind": "ended", "text": text }));
        }
    });
    Ok(())
}

pub fn set_mode(mode: &str) -> Result<(), String> {
    let mode = match mode {
        "paused" => Mode::Paused,
        "frozen" => Mode::Frozen,
        "live" => Mode::Live,
        _ => return Err("Could not change the display.".into()),
    };
    let current = CURRENT.lock().unwrap();
    let Some(running) = current.as_ref() else { return Ok(()) };
    let _ = running.mode.send(mode);
    running.still.fetch_add(1, Ordering::SeqCst);
    let state = match mode {
        Mode::Live => "live",
        Mode::Paused => "paused",
        Mode::Frozen => "frozen",
    };
    let _ = running.ctrl.send(Ctrl::Text(display_state_message(state)));
    Ok(())
}

pub fn set_volume(percent: u32) {
    let current = CURRENT.lock().unwrap();
    let Some(running) = current.as_ref() else { return };
    running.gain.store(percent.min(100), Ordering::Relaxed);
}

pub fn stop() {
    if let Some(running) = CURRENT.lock().unwrap().take() {
        running.stop.store(true, Ordering::SeqCst);
        let _ = running.ctrl.send(Ctrl::Hangup);
    }
}

fn capture_loop(
    source_id: String,
    app: AppHandle,
    stop: Arc<AtomicBool>,
    picture: Arc<Mutex<Picture>>,
    direct: Arc<AtomicBool>,
    lan: Arc<AtomicBool>,
    force_key: Arc<AtomicBool>,
    still: Arc<AtomicU64>,
    mut mode_rx: watch::Receiver<Mode>,
    jpeg_tx: mpsc::Sender<Vec<u8>>,
    h264_tx: mpsc::Sender<crate::encode::Encoded>,
    jpeg_queued: Arc<AtomicUsize>,
) -> Result<(), String> {
    let mut capturer = Capturer::open(&source_id)?;
    let mut encoder: Option<Encoder> = None;
    let mut encoder_note = false;
    let mut last: Option<Frame> = None;
    let mut sent_still = 0u64;
    let mut next_due = Instant::now();
    let mut next_preview = Instant::now();
    let mut frames = 0u64;
    loop {
        if stop.load(Ordering::SeqCst) {
            return Err("stopped".into());
        }
        let mode = *mode_rx.borrow();
        let settings = picture.lock().unwrap().clone();
        let interval = Duration::from_millis(1000 / active_fps(&settings, last.as_ref().map(|frame| frame.width).unwrap_or(1920), capturer.refresh_rate()) as u64);
        let wait = next_due.saturating_duration_since(Instant::now());
        match capturer.acquire(wait.as_millis().clamp(1, 1000) as u32) {
            Ok(Some(frame)) => last = Some(frame),
            Ok(None) => {}
            Err(error) if error == "lost" => {
                capturer = Capturer::open(&source_id)?;
                continue;
            }
            Err(error) => return Err(error),
        }
        let Some(frame) = last.as_ref() else {
            if mode_rx.has_changed().unwrap_or(false) {
                let _ = mode_rx.borrow_and_update();
            }
            continue;
        };
        if Instant::now() >= next_preview {
            if let Some(preview) = preview_jpeg(&frame.bgra, frame.width, frame.height) {
                emit(&app, serde_json::json!({ "kind": "preview", "jpeg": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, preview) }));
            }
            next_preview = Instant::now() + Duration::from_millis(250);
        }
        let epoch = still.load(Ordering::SeqCst);
        if mode != Mode::Live && epoch != sent_still {
            sent_still = epoch;
            let (width, _) = active_size(frame.width, frame.height, settings.width);
            let jpeg = if mode == Mode::Paused {
                resting_jpeg(width, frame.width, frame.height)
            } else {
                encode_jpeg(&frame.bgra, frame.width, frame.height, width, settings.quality)
            };
            if let Some(jpeg) = jpeg {
                queue_jpeg(&jpeg_tx, &jpeg_queued, &settings, jpeg);
            }
        }
        if Instant::now() < next_due {
            continue;
        }
        next_due = Instant::now() + interval;
        let (target_width, target_height) = active_size(frame.width, frame.height, settings.width);
        let fps = active_fps(&settings, frame.width, capturer.refresh_rate());
        let bitrate = screen_bitrate(target_width, fps, settings.quality, lan.load(Ordering::SeqCst));
        let Some((scaled, scaled_width, scaled_height)) = target_frame(&frame.bgra, frame.width, frame.height, target_width) else {
            continue;
        };
        let _ = (target_height, scaled_height);
        if encoder.as_ref().map(|current| current.matches(scaled_width, scaled_height, fps, bitrate)) != Some(true) {
            match Encoder::open(scaled_width, scaled_height, fps, bitrate) {
                Ok(opened) => {
                    if !encoder_note {
                        eprintln!("[share-desktop] encoder {}", if opened.hardware() { "hardware" } else { "software" });
                        encoder_note = true;
                    }
                    encoder = Some(opened);
                    force_key.store(true, Ordering::SeqCst);
                }
                Err(error) => {
                    if !encoder_note {
                        eprintln!("[share-desktop] encoder unavailable {error}");
                        encoder_note = true;
                    }
                }
            }
        }
        if let Some(encoder) = encoder.as_mut() {
            if force_key.swap(false, Ordering::SeqCst) {
                encoder.force_key();
            }
            let started = Instant::now();
            match encoder.encode(&scaled) {
                Ok(Some(sample)) => {
                    frames += 1;
                    if frames == 1 || frames % 90 == 0 {
                        eprintln!(
                            "[share-desktop] encode {}ms {} path {}",
                            started.elapsed().as_millis(),
                            if sample.keyframe { "idr" } else { "delta" },
                            if lan.load(Ordering::SeqCst) { "host" } else { "other" }
                        );
                    }
                    match h264_tx.try_send(sample) {
                        Ok(()) => {}
                        Err(mpsc::error::TrySendError::Closed(_)) => return Err("stopped".into()),
                        Err(mpsc::error::TrySendError::Full(_)) => force_key.store(true, Ordering::SeqCst),
                    }
                }
                Ok(None) => {}
                Err(error) => eprintln!("[share-desktop] encode failed {error}"),
            }
        }
        if mode == Mode::Live && !direct.load(Ordering::SeqCst) {
            if let Some(jpeg) = encode_jpeg(&scaled, scaled_width, scaled_height, scaled_width, settings.quality) {
                queue_jpeg(&jpeg_tx, &jpeg_queued, &settings, jpeg);
            }
        }
    }
}

fn queue_jpeg(tx: &mpsc::Sender<Vec<u8>>, queued: &AtomicUsize, picture: &Picture, jpeg: Vec<u8>) {
    let depth = queued.load(Ordering::SeqCst);
    let drop_frame = match picture.latency {
        Latency::Skip => depth > 0,
        Latency::Queue => depth >= 24,
    };
    if drop_frame {
        return;
    }
    if tx.try_send(jpeg).is_ok() {
        queued.fetch_add(1, Ordering::SeqCst);
    }
}

async fn network_loop(
    app: AppHandle,
    server: String,
    code: String,
    stop: Arc<AtomicBool>,
    picture: Arc<Mutex<Picture>>,
    direct: Arc<AtomicBool>,
    lan: Arc<AtomicBool>,
    force_key: Arc<AtomicBool>,
    mut ctrl_rx: UnboundedReceiver<Ctrl>,
    mut jpeg_rx: mpsc::Receiver<Vec<u8>>,
    mut h264_rx: mpsc::Receiver<crate::encode::Encoded>,
    mut audio_rx: Option<mpsc::Receiver<Packet>>,
    ice_tx: UnboundedSender<String>,
    state_tx: UnboundedSender<String>,
    jpeg_queued: Arc<AtomicUsize>,
) -> Option<String> {
    let session = match fetch_session(&server, &code).await {
        Ok(session) => session,
        Err(error) => return Some(error),
    };
    let url = match protocol::signaling_url(&server, &code) {
        Ok(url) => url,
        Err(error) => return Some(error),
    };
    let socket = match connect_async(&url).await {
        Ok((socket, _)) => socket,
        Err(_) => return Some("Could not reach the room signal server.".into()),
    };
    let (mut write, mut read) = socket.split();
    emit(&app, serde_json::json!({ "kind": "status", "text": audio::share_status(audio_rx.is_some()) }));
    let mut peer: Option<Peer> = None;
    let mut remote_answer: Option<String> = None;
    let mut remote_ice = Vec::new();
    let mut answer_ready = false;
    let mut retry_at: Option<Instant> = None;
    let mut restart = false;
    let mut reason = None;
    let mut audio_warned = false;
    let sound = audio_rx.is_some();
    loop {
        if stop.load(Ordering::SeqCst) {
            let _ = write.send(Message::Text(hangup_message().into())).await;
            break;
        }
        let retry = async {
            if let Some(when) = retry_at {
                let now = Instant::now();
                if when > now {
                    tokio::time::sleep(when - now).await;
                }
            } else {
                std::future::pending::<()>().await;
            }
        };
        tokio::select! {
            biased;
            incoming = ctrl_rx.recv() => {
                match incoming {
                    Some(Ctrl::Hangup) => {
                        let _ = write.send(Message::Text(hangup_message().into())).await;
                        break;
                    }
                    Some(Ctrl::Fail(text)) => {
                        reason = Some(text);
                        break;
                    }
                    Some(Ctrl::Text(text)) => {
                        let _ = write.send(Message::Text(text.into())).await;
                    }
                    Some(Ctrl::PeerState(state)) => {
                        eprintln!("[share-desktop] peer {state}");
                        if state == "connected" {
                            retry_at = None;
                            if let Some(peer) = peer.as_ref() {
                                if let Some(host) = peer.path_is_host().await {
                                    lan.store(host, Ordering::SeqCst);
                                    eprintln!("[share-desktop] path {}", if host { "host" } else { "other" });
                                }
                            }
                        }
                        if state == "failed" {
                            direct.store(false, Ordering::SeqCst);
                            retry_at = Some(Instant::now() + Duration::from_secs(20));
                        }
                        if state == "disconnected" {
                            retry_at = Some(Instant::now() + Duration::from_secs(3));
                        }
                    }
                    None => break,
                }
            }
            message = read.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if let Some(ended) = handle_text(&text, &picture, &direct, &mut remote_answer, &mut remote_ice, &mut restart, &mut retry_at).await {
                            reason = Some(ended);
                            break;
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(_)) => {}
                    Some(Err(_)) | None => {
                        reason = Some("The panel left the share.".into());
                        break;
                    }
                }
            }
            sample = h264_rx.recv() => {
                let Some(sample) = sample else { break };
                if let Some(peer) = peer.as_ref() {
                    if peer.write(sample.bytes, sample.duration).await.is_err() {
                        direct.store(false, Ordering::SeqCst);
                    }
                }
            }
            jpeg = jpeg_rx.recv() => {
                let Some(jpeg) = jpeg else { break };
                let _ = write.send(Message::Binary(jpeg.into())).await;
                jpeg_queued.fetch_sub(1, Ordering::SeqCst);
            }
            packet = async {
                match audio_rx.as_mut() {
                    Some(rx) => rx.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                match packet {
                    Some(packet) => {
                        if let Some(peer) = peer.as_ref() {
                            if peer.write_audio(packet.bytes, packet.duration).await.is_err() && !audio_warned {
                                eprintln!("[share-desktop] audio write failed");
                                audio_warned = true;
                            }
                        }
                    }
                    None => audio_rx = None,
                }
            }
            _ = retry => {
                restart = true;
                retry_at = None;
            }
        }
        if restart {
            restart = false;
            retry_at = None;
            direct.store(false, Ordering::SeqCst);
            if let Some(current) = peer.take() {
                current.close().await;
            }
            answer_ready = false;
            match Peer::open(&session.ice_servers, force_key.clone(), ice_tx.clone(), state_tx.clone(), sound && audio_rx.is_some()).await {
                Ok(opened) => match opened.offer_sdp().await {
                    Ok(sdp) => {
                        let _ = write.send(Message::Text(offer_message(&sdp).into())).await;
                        for message in opened.release_ice() {
                            let _ = write.send(Message::Text(message.into())).await;
                        }
                        peer = Some(opened);
                    }
                    Err(error) => {
                        eprintln!("[share-desktop] offer failed {error}");
                        opened.close().await;
                        retry_at = Some(Instant::now() + Duration::from_secs(20));
                    }
                },
                Err(error) => {
                    eprintln!("[share-desktop] peer failed {error}");
                    retry_at = Some(Instant::now() + Duration::from_secs(20));
                }
            }
        }
        if let Some(current) = peer.as_ref() {
            if !answer_ready {
                if let Some(sdp) = remote_answer.clone() {
                    if current.accept_answer(sdp).await.is_ok() {
                        answer_ready = true;
                        remote_answer = None;
                    }
                }
            }
            if answer_ready {
                for (candidate, mid, line) in remote_ice.drain(..) {
                    current.add_ice(&candidate, mid, line).await.ok();
                }
            }
        }
    }
    direct.store(false, Ordering::SeqCst);
    if let Some(peer) = peer {
        peer.close().await;
    }
    let _ = write.close().await;
    reason
}

async fn handle_text(
    text: &str,
    picture: &Mutex<Picture>,
    direct: &AtomicBool,
    remote_answer: &mut Option<String>,
    remote_ice: &mut Vec<(String, Option<String>, Option<u16>)>,
    restart: &mut bool,
    retry_at: &mut Option<Instant>,
) -> Option<String> {
    let message: Value = serde_json::from_str(text).ok()?;
    let kind = message.get("type").and_then(|value| value.as_str()).unwrap_or("");
    match kind {
        "ready" => {
            direct.store(false, Ordering::SeqCst);
            *restart = true;
        }
        "config" => {
            let mut settings = picture.lock().unwrap();
            settings.apply(
                message.get("width").and_then(|value| value.as_i64()).map(|value| value as i32),
                message.get("fps").and_then(|value| value.as_u64()).map(|value| value as u32),
                message.get("quality").and_then(|value| value.as_f64()),
                message.get("latency").and_then(|value| value.as_str()),
            );
        }
        "answer" => {
            if let Some(sdp) = message.get("sdp").and_then(answer_sdp) {
                *remote_answer = Some(sdp);
            }
        }
        "ice" => {
            if let Some(candidate) = message.get("candidate").and_then(ice_fields) {
                remote_ice.push(candidate);
            }
        }
        "video-ready" => direct.store(true, Ordering::SeqCst),
        "video-stopped" => {
            direct.store(false, Ordering::SeqCst);
            *retry_at = Some(Instant::now() + Duration::from_secs(20));
        }
        "full" => return Some("This room is already showing 4 screens.".into()),
        "hangup" => return Some("The panel stopped the share.".into()),
        "peer-left" | "replaced" => return Some("The panel left the share.".into()),
        _ => {}
    }
    None
}

async fn fetch_session(server: &str, code: &str) -> Result<ShareSession, String> {
    let base = server.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Enter the control server address.".into());
    }
    let response = reqwest::get(format!("{base}/api/share/{code}"))
        .await
        .map_err(|_| "Could not reach the room signal server.".to_owned())?;
    if !response.status().is_success() {
        let body = response.json::<Value>().await.unwrap_or_default();
        let message = body.get("error").and_then(|value| value.as_str()).unwrap_or("This room code is not active");
        return Err(message.to_owned());
    }
    response.json::<ShareSession>().await.map_err(|_| "Could not start sharing".to_owned())
}

fn emit(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("share", payload);
}

fn normalize_code(value: &str) -> String {
    value.chars().filter(|character| character.is_ascii_alphanumeric()).flat_map(|character| character.to_uppercase()).collect()
}
