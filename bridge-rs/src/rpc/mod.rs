//! RPC request handling for the native messaging bridge.

use serde::{Deserialize, Serialize};

use crate::{fs, js, llm, mcp, oauth};

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

impl RpcResponse {
  pub fn success(id: serde_json::Value, result: serde_json::Value) -> Self {
    RpcResponse {
      id,
      result: Some(result),
      error: None,
    }
  }

  pub fn error(id: serde_json::Value, error: RpcError) -> Self {
    RpcResponse {
      id,
      result: None,
      error: Some(error),
    }
  }
}

/// Handle an RPC request and return a response.
pub async fn handle(request: RpcRequest) -> RpcResponse {
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

    // OAuth
    "oauth.start_flow" => oauth::rpc_start_flow(request.params.clone()).await,
    "oauth.get_tokens" => oauth::rpc_get_tokens(request.params.clone()).await,
    "oauth.status" => oauth::rpc_status(request.params.clone()).await,
    "oauth.revoke" => oauth::rpc_revoke(request.params.clone()).await,
    "oauth.list_providers" => oauth::rpc_list_providers(request.params.clone()).await,
    "oauth.get_credentials_status" => oauth::rpc_get_credentials_status(request.params.clone()).await,
    "oauth.set_credentials" => oauth::rpc_set_credentials(request.params.clone()).await,
    "oauth.remove_credentials" => oauth::rpc_remove_credentials(request.params.clone()).await,

    // MCP tool registry (for Safari compatibility)
    "mcp.register_tools" => mcp::register_tools(request.params.clone()).await,
    "mcp.unregister_tools" => mcp::unregister_tools(request.params.clone()).await,
    "mcp.list_tools" => mcp::list_tools().await,
    "mcp.call_tool" => mcp::call_tool(request.params.clone()).await,
    "mcp.poll_pending_calls" => mcp::poll_pending_calls().await,
    "mcp.submit_call_result" => mcp::submit_call_result(request.params.clone()).await,

    _ => Err(RpcError {
      code: -32601,
      message: format!("Unknown method: {}", request.method),
    }),
  };

  match result {
    Ok(value) => RpcResponse::success(request.id, value),
    Err(error) => RpcResponse::error(request.id, error),
  }
}

/// Check if a method is a streaming method
pub fn is_streaming_method(method: &str) -> bool {
  matches!(method, "llm.chat_stream")
}
