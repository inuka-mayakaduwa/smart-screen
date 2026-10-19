use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType};
use webrtc::rtp_transceiver::RTCPFeedback;
use webrtc::rtcp::header::PacketType;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

use crate::protocol;

#[derive(Clone, Debug, Deserialize)]
pub struct IceServer {
    pub urls: IceUrls,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub credential: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum IceUrls {
    One(String),
    Many(Vec<String>),
}

impl IceUrls {
    fn list(&self) -> Vec<String> {
        match self {
            Self::One(url) => vec![url.clone()],
            Self::Many(urls) => urls.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct IceJson {
    candidate: String,
    #[serde(rename = "sdpMid")]
    sdp_mid: Option<String>,
    #[serde(rename = "sdpMLineIndex")]
    sdp_mline_index: Option<u16>,
}

pub struct Peer {
    connection: Arc<webrtc::peer_connection::RTCPeerConnection>,
    track: Arc<TrackLocalStaticSample>,
    pending_ice: Arc<Mutex<Vec<String>>>,
    ice_open: Arc<AtomicBool>,
}

impl Peer {
    pub async fn open(servers: &[IceServer], force_key: Arc<AtomicBool>, ice_tx: tokio::sync::mpsc::UnboundedSender<String>, state_tx: tokio::sync::mpsc::UnboundedSender<String>) -> Result<Self, String> {
        let mut media = MediaEngine::default();
        media
            .register_codec(
                RTCRtpCodecParameters {
                    capability: RTCRtpCodecCapability {
                        mime_type: MIME_TYPE_H264.to_owned(),
                        clock_rate: 90000,
                        channels: 0,
                        sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f".into(),
                        rtcp_feedback: vec![
                            RTCPFeedback { typ: "goog-remb".into(), parameter: "".into() },
                            RTCPFeedback { typ: "ccm".into(), parameter: "fir".into() },
                            RTCPFeedback { typ: "nack".into(), parameter: "".into() },
                            RTCPFeedback { typ: "nack".into(), parameter: "pli".into() },
                        ],
                    },
                    payload_type: 102,
                    stats_id: "h264".into(),
                },
                RTPCodecType::Video,
            )
            .map_err(|error| error.to_string())?;
        let mut registry = Registry::new();
        registry = register_default_interceptors(registry, &mut media).map_err(|error| error.to_string())?;
        let api = APIBuilder::new().with_media_engine(media).with_interceptor_registry(registry).build();
        let config = RTCConfiguration {
            ice_servers: servers
                .iter()
                .filter(|server| !server.urls.list().is_empty())
                .map(|server| RTCIceServer {
                    urls: server.urls.list(),
                    username: server.username.clone(),
                    credential: server.credential.clone(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        let connection = Arc::new(api.new_peer_connection(config).await.map_err(|error| error.to_string())?);
        let track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_H264.to_owned(),
                clock_rate: 90000,
                channels: 0,
                sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f".into(),
                rtcp_feedback: vec![],
            },
            "video".into(),
            "screen".into(),
        ));
        let sender = connection
            .add_track(Arc::clone(&track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(|error| error.to_string())?;
        let force = force_key.clone();
        tokio::spawn(async move {
            let mut buffer = vec![0u8; 1500];
            while let Ok((packets, _)) = sender.read(&mut buffer).await {
                for packet in packets {
                    let header = packet.header();
                    let feedback = header.packet_type == PacketType::PayloadSpecificFeedback && (header.count == 1 || header.count == 4);
                    if feedback {
                        force.store(true, Ordering::SeqCst);
                    }
                }
            }
        });
        let pending_ice = Arc::new(Mutex::new(Vec::new()));
        let ice_open = Arc::new(AtomicBool::new(false));
        let pending = pending_ice.clone();
        let open = ice_open.clone();
        connection.on_ice_candidate(Box::new(move |candidate| {
            let pending = pending.clone();
            let open = open.clone();
            let ice_tx = ice_tx.clone();
            Box::pin(async move {
                let Some(candidate) = candidate else { return };
                let Ok(init) = candidate.to_json() else { return };
                let message = protocol::ice_message(&init.candidate, init.sdp_mid.as_deref(), init.sdp_mline_index);
                if open.load(Ordering::SeqCst) {
                    let _ = ice_tx.send(message);
                } else {
                    pending.lock().unwrap().push(message);
                }
            })
        }));
        let states = state_tx.clone();
        connection.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            let states = states.clone();
            let label = state.to_string();
            Box::pin(async move {
                let _ = states.send(label);
            })
        }));
        Ok(Self { connection, track, pending_ice, ice_open })
    }

    pub async fn offer_sdp(&self) -> Result<String, String> {
        let offer = self.connection.create_offer(None).await.map_err(|error| error.to_string())?;
        self.connection.set_local_description(offer).await.map_err(|error| error.to_string())?;
        self.connection
            .local_description()
            .await
            .map(|description| description.sdp)
            .ok_or_else(|| "Could not start the video path.".to_owned())
    }

    pub fn release_ice(&self) -> Vec<String> {
        self.ice_open.store(true, Ordering::SeqCst);
        std::mem::take(&mut *self.pending_ice.lock().unwrap())
    }

    pub async fn accept_answer(&self, sdp: String) -> Result<(), String> {
        let description = RTCSessionDescription::answer(sdp).map_err(|error| error.to_string())?;
        self.connection.set_remote_description(description).await.map_err(|error| error.to_string())
    }

    pub async fn add_ice(&self, candidate: &str, sdp_mid: Option<String>, line: Option<u16>) -> Result<(), String> {
        let init = IceJson { candidate: candidate.to_owned(), sdp_mid, sdp_mline_index: line };
        let value = serde_json::to_value(&init).map_err(|error| error.to_string())?;
        let parsed = serde_json::from_value(value).map_err(|error| error.to_string())?;
        self.connection.add_ice_candidate(parsed).await.map_err(|error| error.to_string())
    }

    pub async fn write(&self, bytes: Vec<u8>, duration: Duration) -> Result<(), String> {
        self.track
            .write_sample(&Sample {
                data: Bytes::from(bytes),
                duration,
                ..Default::default()
            })
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn path_is_host(&self) -> Option<bool> {
        let report = self.connection.get_stats().await;
        let mut remote_id = None;
        let mut local_id = None;
        for stats in report.reports.values() {
            if let webrtc::stats::StatsReportType::CandidatePair(pair) = stats {
                if format!("{:?}", pair.state) == "Succeeded" {
                    remote_id = Some(pair.remote_candidate_id.clone());
                    local_id = Some(pair.local_candidate_id.clone());
                    break;
                }
            }
        }
        let remote_kind = candidate_kind(&report, remote_id.as_deref(), true);
        let local_kind = candidate_kind(&report, local_id.as_deref(), false);
        let kind = if remote_kind.is_empty() { local_kind } else { remote_kind };
        if kind.is_empty() { None } else { Some(kind == "host") }
    }

    pub async fn close(self) {
        self.connection.close().await.ok();
    }
}

fn candidate_kind(report: &webrtc::stats::StatsReport, id: Option<&str>, remote: bool) -> String {
    let Some(id) = id else { return String::new() };
    for stats in report.reports.values() {
        let candidate = if remote {
            if let webrtc::stats::StatsReportType::RemoteCandidate(candidate) = stats { Some(candidate) } else { None }
        } else if let webrtc::stats::StatsReportType::LocalCandidate(candidate) = stats {
            Some(candidate)
        } else {
            None
        };
        if let Some(candidate) = candidate {
            if candidate.id == id {
                return candidate.candidate_type.to_string();
            }
        }
    }
    String::new()
}
