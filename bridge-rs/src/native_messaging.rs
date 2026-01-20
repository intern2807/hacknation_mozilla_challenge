//! Native Messaging protocol handler for browser extension communication.
//!
//! The native messaging protocol uses stdin/stdout with length-prefixed JSON messages.
//! Message format: 4-byte little-endian length prefix, followed by JSON payload.
//!
//! Message types:
//! - `rpc`: RPC request from extension, expects `rpc_response` back
//! - `rpc_stream`: Streaming RPC request, sends multiple `stream` messages
//! - `ping`: Health check, responds with `status`
//! - `shutdown`: Graceful shutdown request

use std::io::{self, Read, Write};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

use crate::llm;
use crate::rpc::{self, RpcRequest};

/// Message from the browser extension
#[derive(Debug, serde::Deserialize)]
struct IncomingMessage {
    #[serde(rename = "type")]
    msg_type: String,
    
    // RPC fields
    id: Option<serde_json::Value>,
    method: Option<String>,
    #[serde(default)]
    params: serde_json::Value,
}

/// Message to the browser extension
#[derive(Debug, serde::Serialize)]
struct OutgoingMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(flatten)]
    payload: serde_json::Value,
}

/// Console log message from JS servers
#[derive(Debug, Clone, serde::Serialize)]
pub struct ConsoleLogMessage {
    pub server_id: String,
    pub level: String,
    pub message: String,
}

// Global broadcast channel for console logs
lazy_static::lazy_static! {
    static ref CONSOLE_LOG_TX: broadcast::Sender<ConsoleLogMessage> = {
        let (tx, _) = broadcast::channel(100);
        tx
    };
}

/// Get a sender for console log messages (used by JS runtime)
pub fn get_console_log_sender() -> broadcast::Sender<ConsoleLogMessage> {
    CONSOLE_LOG_TX.clone()
}

/// Read a native messaging message from stdin
fn read_message(stdin: &mut io::StdinLock) -> io::Result<Option<IncomingMessage>> {
    // Read 4-byte length prefix (little-endian)
    let mut len_bytes = [0u8; 4];
    match stdin.read_exact(&mut len_bytes) {
        Ok(_) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    
    let len = u32::from_le_bytes(len_bytes) as usize;
    
    // Sanity check on message length (max 10MB for large code transfers)
    if len > 10 * 1024 * 1024 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Message too large",
        ));
    }
    
    // Read the JSON payload
    let mut buffer = vec![0u8; len];
    stdin.read_exact(&mut buffer)?;
    
    // Parse JSON
    let message: IncomingMessage = serde_json::from_slice(&buffer)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    
    Ok(Some(message))
}

/// Write a native messaging message to stdout
fn write_message(stdout: &mut io::StdoutLock, message: &OutgoingMessage) -> io::Result<()> {
    let json = serde_json::to_vec(message)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    
    let len = json.len() as u32;
    let len_bytes = len.to_le_bytes();
    
    stdout.write_all(&len_bytes)?;
    stdout.write_all(&json)?;
    stdout.flush()?;
    
    Ok(())
}

/// Thread-safe message writer
struct MessageWriter {
    tx: mpsc::Sender<OutgoingMessage>,
}

impl MessageWriter {
    fn new() -> (Self, mpsc::Receiver<OutgoingMessage>) {
        let (tx, rx) = mpsc::channel(100);
        (Self { tx }, rx)
    }

    async fn send(&self, msg_type: &str, payload: serde_json::Value) {
        let msg = OutgoingMessage {
            msg_type: msg_type.to_string(),
            payload,
        };
        let _ = self.tx.send(msg).await;
    }

    async fn send_rpc_response(&self, id: serde_json::Value, result: Option<serde_json::Value>, error: Option<serde_json::Value>) {
        let mut payload = serde_json::json!({ "id": id });
        if let Some(r) = result {
            payload["result"] = r;
        }
        if let Some(e) = error {
            payload["error"] = e;
        }
        self.send("rpc_response", payload).await;
    }

    async fn send_stream_event(&self, id: serde_json::Value, event: serde_json::Value) {
        self.send("stream", serde_json::json!({
            "id": id,
            "event": event,
        })).await;
    }

    async fn send_console_log(&self, log: &ConsoleLogMessage) {
        self.send("console", serde_json::json!({
            "server_id": log.server_id,
            "level": log.level,
            "message": log.message,
        })).await;
    }
}

/// Run the native messaging event loop.
pub async fn run_native_messaging() {
    tracing::info!("Starting native messaging handler");
    
    // Create message writer
    let (writer, mut write_rx) = MessageWriter::new();
    let writer = Arc::new(writer);
    
    // Subscribe to console logs
    let mut console_rx = CONSOLE_LOG_TX.subscribe();
    
    // Spawn stdout writer task
    let write_handle = tokio::task::spawn_blocking(move || {
        let mut stdout = io::stdout().lock();
        while let Some(msg) = write_rx.blocking_recv() {
            if let Err(e) = write_message(&mut stdout, &msg) {
                tracing::error!("Failed to write message: {}", e);
                break;
            }
        }
    });

    // Send initial ready message
    writer.send("status", serde_json::json!({
        "status": "ready",
        "message": "Harbor bridge is running",
    })).await;

    // Spawn console log forwarder
    let console_writer = writer.clone();
    tokio::spawn(async move {
        while let Ok(log) = console_rx.recv().await {
            console_writer.send_console_log(&log).await;
        }
    });

    // Create channel for incoming messages
    let (msg_tx, mut msg_rx) = mpsc::channel::<IncomingMessage>(32);
    
    // Spawn stdin reader task
    tokio::task::spawn_blocking(move || {
        let mut stdin = io::stdin().lock();
        loop {
            match read_message(&mut stdin) {
                Ok(Some(msg)) => {
                    if msg_tx.blocking_send(msg).is_err() {
                        break;
                    }
                }
                Ok(None) => {
                    tracing::info!("Native messaging connection closed (EOF)");
                    break;
                }
                Err(e) => {
                    tracing::error!("Error reading native message: {}", e);
                    break;
                }
            }
        }
    });

    // Process incoming messages
    while let Some(msg) = msg_rx.recv().await {
        let writer = writer.clone();
        
        // Handle message in background task
        tokio::spawn(async move {
            handle_message(msg, writer).await;
        });
    }

    tracing::info!("Native messaging handler exiting");
    drop(write_handle);
}

/// Handle an incoming message
async fn handle_message(msg: IncomingMessage, writer: Arc<MessageWriter>) {
    tracing::debug!("Received message type: {}", msg.msg_type);

    match msg.msg_type.as_str() {
        "ping" => {
            writer.send("status", serde_json::json!({
                "status": "pong",
                "message": "Bridge is alive",
            })).await;
        }
        
        "shutdown" => {
            tracing::info!("Received shutdown request");
            std::process::exit(0);
        }
        
        "status" => {
            writer.send("status", serde_json::json!({
                "status": "ready",
                "message": "Harbor bridge is running",
            })).await;
        }
        
        "rpc" => {
            let id = msg.id.clone().unwrap_or(serde_json::Value::Null);
            let method = msg.method.clone().unwrap_or_default();
            
            // Check if this is a streaming method
            if rpc::is_streaming_method(&method) {
                handle_streaming_rpc(id, method, msg.params, writer).await;
            } else {
                handle_rpc(id, method, msg.params, writer).await;
            }
        }
        
        _ => {
            tracing::debug!("Unknown message type: {}", msg.msg_type);
        }
    }
}

/// Handle a regular RPC request
async fn handle_rpc(
    id: serde_json::Value,
    method: String,
    params: serde_json::Value,
    writer: Arc<MessageWriter>,
) {
    let request = RpcRequest { id: id.clone(), method, params };
    let response = rpc::handle(request).await;
    
    writer.send_rpc_response(
        id,
        response.result,
        response.error.map(|e| serde_json::json!({
            "code": e.code,
            "message": e.message,
        })),
    ).await;
}

/// Handle a streaming RPC request
async fn handle_streaming_rpc(
    id: serde_json::Value,
    method: String,
    params: serde_json::Value,
    writer: Arc<MessageWriter>,
) {
    match method.as_str() {
        "llm.chat_stream" => {
            let (event_tx, mut event_rx) = tokio::sync::mpsc::channel(32);
            
            // Spawn the streaming task
            let stream_id = id.clone();
            tokio::spawn(async move {
                llm::chat_stream(stream_id, params, event_tx).await;
            });
            
            // Forward events to the extension
            while let Some(event) = event_rx.recv().await {
                let event_json = serde_json::to_value(&event).unwrap_or_default();
                writer.send_stream_event(id.clone(), event_json).await;
                
                if event.event_type == "done" || event.event_type == "error" {
                    break;
                }
            }
        }
        _ => {
            writer.send_rpc_response(
                id,
                None,
                Some(serde_json::json!({
                    "code": -32601,
                    "message": format!("Unknown streaming method: {}", method),
                })),
            ).await;
        }
    }
}
