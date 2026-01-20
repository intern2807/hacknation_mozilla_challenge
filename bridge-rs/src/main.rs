mod fs;
mod js;
mod llm;
mod native_messaging;
mod rpc;

use axum::{http::Method, routing::post, Router};
use std::env;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[tokio::main]
async fn main() {
  // Check if running in native messaging mode (launched by browser extension)
  let native_mode = env::args().any(|arg| arg == "--native-messaging");
  
  // In native messaging mode, log to file instead of stderr (which is used for protocol)
  if native_mode {
    // Set up file logging for native messaging mode
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

  // Configure CORS to allow requests from browser extensions
  let cors = CorsLayer::new()
    .allow_origin(Any)
    .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
    .allow_headers(Any);

  let app = Router::new()
    .route("/rpc", post(rpc::handle))
    .route("/rpc/stream", post(rpc::handle_stream))
    .layer(cors);

  let addr: SocketAddr = "127.0.0.1:9137".parse().expect("valid bind addr");
  tracing::info!("Harbor bridge listening on {}", addr);

  if native_mode {
    // In native messaging mode, run the HTTP server in background
    // and handle native messaging protocol on main thread
    tokio::spawn(async move {
      if let Err(e) = axum::serve(
        tokio::net::TcpListener::bind(addr).await.expect("bind"),
        app,
      )
      .await
      {
        tracing::error!("HTTP server error: {}", e);
      }
    });

    // Handle native messaging protocol (keeps process alive while extension is connected)
    native_messaging::run_native_messaging().await;
  } else {
    // Normal standalone mode
    axum::serve(tokio::net::TcpListener::bind(addr).await.expect("bind"), app)
      .await
      .expect("server");
  }
}
