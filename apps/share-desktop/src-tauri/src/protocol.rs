use serde_json::{json, Value};

pub fn signaling_url(server: &str, code: &str) -> Result<String, String> {
    let trimmed = server.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter the control server address.".into());
    }
    let (scheme, rest) = if let Some(rest) = trimmed.strip_prefix("https://") {
        ("wss", rest)
    } else if let Some(rest) = trimmed.strip_prefix("wss://") {
        ("wss", rest)
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        ("ws", rest)
    } else if let Some(rest) = trimmed.strip_prefix("ws://") {
        ("ws", rest)
    } else {
        return Err("Enter the control server address.".into());
    };
    if rest.is_empty() {
        return Err("Enter the control server address.".into());
    }
    Ok(format!("{scheme}://{rest}/ws?role=sender&code={code}"))
}

pub fn offer_message(sdp: &str) -> String {
    json!({ "type": "offer", "sdp": { "type": "offer", "sdp": sdp } }).to_string()
}

pub fn ice_message(candidate: &str, sdp_mid: Option<&str>, line: Option<u16>) -> String {
    json!({
        "type": "ice",
        "candidate": {
            "candidate": candidate,
            "sdpMid": sdp_mid,
            "sdpMLineIndex": line,
        }
    })
    .to_string()
}

pub fn display_state_message(state: &str) -> String {
    json!({ "type": "display-state", "state": state }).to_string()
}

pub fn hangup_message() -> String {
    json!({ "type": "hangup" }).to_string()
}

pub fn answer_sdp(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    value.get("sdp").and_then(|entry| entry.as_str()).map(str::to_owned)
}

pub fn ice_fields(value: &Value) -> Option<(String, Option<String>, Option<u16>)> {
    let candidate = value.get("candidate")?.as_str()?.to_owned();
    if candidate.is_empty() {
        return None;
    }
    let mid = value.get("sdpMid").and_then(|entry| entry.as_str()).map(str::to_owned);
    let line = value.get("sdpMLineIndex").and_then(|entry| entry.as_u64()).map(|index| index as u16);
    Some((candidate, mid, line))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_socket_uses_the_same_sender_path_as_the_browser() {
        assert_eq!(
            signaling_url("http://localhost:4000/", "AB12CD").unwrap(),
            "ws://localhost:4000/ws?role=sender&code=AB12CD"
        );
        assert_eq!(
            signaling_url("https://room.example", "AB12CD").unwrap(),
            "wss://room.example/ws?role=sender&code=AB12CD"
        );
    }

    #[test]
    fn offer_and_ice_match_the_browser_shape() {
        let offer: Value = serde_json::from_str(&offer_message("v=0")).unwrap();
        assert_eq!(offer["type"], "offer");
        assert_eq!(offer["sdp"]["type"], "offer");
        assert_eq!(offer["sdp"]["sdp"], "v=0");
        let ice: Value = serde_json::from_str(&ice_message("candidate:1 typ host", Some("0"), Some(0))).unwrap();
        assert_eq!(ice["candidate"]["sdpMid"], "0");
        assert_eq!(ice["candidate"]["sdpMLineIndex"], 0);
    }

    #[test]
    fn answers_and_candidates_from_the_panel_decode() {
        let answer = json!({ "type": "answer", "sdp": { "type": "answer", "sdp": "v=0" } });
        assert_eq!(answer_sdp(&answer["sdp"]), Some("v=0".into()));
        let candidate = json!({ "candidate": "candidate:1", "sdpMid": "0", "sdpMLineIndex": 0 });
        assert_eq!(ice_fields(&candidate).unwrap().0, "candidate:1");
        assert!(ice_fields(&json!({ "candidate": "" })).is_none());
    }
}
