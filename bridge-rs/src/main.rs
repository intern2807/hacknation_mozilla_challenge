mod fs;
mod js;
mod llm;
mod native_messaging;
mod rpc;

use std::env;

#[tokio::main]
async fn main() {
  // Check if running in native messaging mode (launched by browser extension)
  let native_mode = env::args().any(|arg| arg == "--native-messaging");
  
  // Set up logging - in native mode, log to file (stderr is used for protocol in some cases)
  if native_mode {
    let log_path = dirs::cache_dir()
      .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
      .join("harbor-bridge.log");
    
    if let Ok(file) = std::fs::OpenOptions::new()
      .create(true)
      .append(true)
      .open(&log_path)
    {
      tracing_subscriber::fmt()
        .with_writer(std::sync::Mutex::new(file))
        .with_ansi(false)
        .init();
    }
  } else {
    tracing_subscriber::fmt::init();
  }

  // Load LLM configuration from disk
  match llm::LlmConfig::load() {
    Ok(config) => {
      tracing::info!("Loaded LLM configuration");
      llm::set_config(config);
    }
    Err(e) => {
      tracing::warn!("Failed to load LLM config, using defaults: {}", e);
    }
  }

  tracing::info!("Harbor bridge starting (native_mode={})", native_mode);

  // Run native messaging handler (handles all RPC over stdio)
  native_messaging::run_native_messaging().await;
}
