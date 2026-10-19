use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Settings {
    pub server: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { server: String::new() }
    }
}

pub fn load() -> Settings {
    let Ok(text) = fs::read_to_string(path()) else {
        return Settings::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(server: &str) -> Result<(), String> {
    let path = path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let settings = Settings { server: server.trim().to_owned() };
    let text = serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(path, text).map_err(|error| error.to_string())
}

fn path() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("smart-screen-share").join("settings.json")
}
