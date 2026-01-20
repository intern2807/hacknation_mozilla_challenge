use axum::{
  extract::Json,
  http::StatusCode,
  response::{
    sse::{Event, KeepAlive, Sse},
    IntoResponse,
  },
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, pin::Pin};

use crate::{fs, js, llm};

type SseStream = Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
  pub id: serde_json::Value,
  pub method: String,
  #[serde(default)]
  pub params: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
  pub id: serde_json::Value,
  pub result: Option<serde_json::Value>,
  pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RpcError {
  pub code: i64,
  pub message: String,
}

pub async fn handle(Json(request): Json<RpcRequest>) -> impl IntoResponse {
  let result = match request.method.as_str() {
    // System
    "system.health" => Ok(serde_json::json!({ "status": "ok" })),

    // LLM operations
    "llm.health" => llm::health().await,
    "llm.list_models" => llm::list_models().await,
    "llm.chat" => llm::chat(request.params.clone()).await,

    // LLM configuration
    "llm.list_providers" => llm::list_providers().await,
    "llm.list_provider_types" => llm::list_provider_types().await,
    "llm.check_provider" => llm::check_provider_status(request.params.clone()).await,
    "llm.configure_provider" => llm::configure_provider(request.params.clone()).await,
    "llm.add_provider" => llm::add_provider(request.params.clone()).await,
    "llm.remove_provider" => llm::remove_provider(request.params.clone()).await,
    "llm.set_default_provider" => llm::set_default_provider(request.params.clone()).await,
    "llm.set_type_default" => llm::set_type_default(request.params.clone()).await,
    "llm.get_config" => llm::get_configuration().await,
    "llm.set_default_model" => llm::set_default_model(request.params.clone()).await,
    
    // Configured models (named aliases)
    "llm.list_configured_models" => llm::list_configured_models().await,
    "llm.add_configured_model" => llm::add_configured_model(request.params.clone()).await,
    "llm.remove_configured_model" => llm::remove_configured_model(request.params.clone()).await,
    "llm.set_configured_model_default" => llm::set_configured_model_default(request.params.clone()).await,

    // Filesystem
    "fs.read" => fs::read(request.params.clone()).await,
    "fs.write" => fs::write(request.params.clone()).await,
    "fs.list" => fs::list(request.params.clone()).await,

    // JavaScript MCP servers
    "js.start_server" => js::start_server(request.params.clone()).await,
    "js.stop_server" => js::stop_server(request.params.clone()).await,
    "js.call" => js::call_server(request.params.clone()).await,
    "js.list_servers" => js::list_servers().await,

    _ => Err(RpcError {
      code: -32601,
      message: format!("Unknown method: {}", request.method),
    }),
  };

  let response = match result {
    Ok(value) => RpcResponse {
      id: request.id,
      result: Some(value),
      error: None,
    },
    Err(error) => RpcResponse {
      id: request.id,
      result: None,
      error: Some(error),
    },
  };

  (StatusCode::OK, Json(response))
}

/// Handle streaming RPC requests (SSE)
pub async fn handle_stream(
  Json(request): Json<RpcRequest>,
) -> Sse<SseStream> {
  let stream: SseStream = match request.method.as_str() {
    "llm.chat_stream" => {
      llm::chat_stream(request.id.clone(), request.params.clone()).await
    }
    _ => {
      // For non-streaming methods, return error as single event
      let error_stream = futures::stream::once(async move {
        let event_data = serde_json::json!({
          "id": request.id,
          "error": {
            "code": -32601,
            "message": format!("Unknown streaming method: {}", request.method)
          }
        });
        Ok::<_, Infallible>(Event::default().data(event_data.to_string()))
      });
      Box::pin(error_stream)
    }
  };
  Sse::new(stream).keep_alive(KeepAlive::default())
}
