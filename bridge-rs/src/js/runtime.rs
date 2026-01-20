//! QuickJS runtime for executing JS MCP servers.

use super::sandbox::Capabilities;
use rquickjs::{Context, Object, Runtime};
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot};

/// Configuration for starting a JS server
pub struct JsServerConfig {
    pub id: String,
    pub code: String,
    pub env: HashMap<String, String>,
    pub capabilities: Capabilities,
}

/// Handle to a running JS server
pub struct ServerHandle {
    request_tx: mpsc::Sender<ServerRequest>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

struct ServerRequest {
    payload: serde_json::Value,
    response_tx: oneshot::Sender<Result<serde_json::Value, String>>,
}

/// Represents a running JS MCP server
pub struct JsServer;

impl ServerHandle {
    /// Send an MCP request to the server and wait for response
    pub async fn call(&self, request: serde_json::Value) -> Result<serde_json::Value, String> {
        let (response_tx, response_rx) = oneshot::channel();
        
        self.request_tx
            .send(ServerRequest {
                payload: request,
                response_tx,
            })
            .await
            .map_err(|_| "Server channel closed".to_string())?;

        response_rx
            .await
            .map_err(|_| "Response channel closed".to_string())?
    }

    /// Stop the server
    pub async fn stop(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl JsServer {
    /// Start a new JS server in a background task
    pub async fn start(config: JsServerConfig) -> Result<ServerHandle, String> {
        let (request_tx, mut request_rx) = mpsc::channel::<ServerRequest>(32);
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();

        let server_id = config.id.clone();

        // Spawn the JS runtime in a blocking task (QuickJS is not async)
        tokio::task::spawn_blocking(move || {
            let result = Self::run_server(config, &mut request_rx, &mut shutdown_rx);
            if let Err(e) = result {
                tracing::error!("JS server '{}' error: {}", server_id, e);
            }
        });

        Ok(ServerHandle {
            request_tx,
            shutdown_tx: Some(shutdown_tx),
        })
    }

    fn run_server(
        config: JsServerConfig,
        request_rx: &mut mpsc::Receiver<ServerRequest>,
        shutdown_rx: &mut oneshot::Receiver<()>,
    ) -> Result<(), String> {
        // Create QuickJS runtime
        let runtime = Runtime::new().map_err(|e| format!("Failed to create runtime: {}", e))?;
        let context = Context::full(&runtime).map_err(|e| format!("Failed to create context: {}", e))?;

        context.with(|ctx| {
            // Set up the sandbox environment
            Self::setup_sandbox(&ctx, &config.env, &config.capabilities)?;

            // Execute the server code
            ctx.eval::<(), _>(config.code.as_str())
                .map_err(|e| format!("Failed to execute server code: {}", e))?;

            Ok::<(), String>(())
        })?;

        // Message processing loop
        let rt = tokio::runtime::Handle::current();
        loop {
            // Check for shutdown signal
            match shutdown_rx.try_recv() {
                Ok(_) | Err(oneshot::error::TryRecvError::Closed) => {
                    tracing::info!("JS server '{}' shutting down", config.id);
                    break;
                }
                Err(oneshot::error::TryRecvError::Empty) => {}
            }

            // Try to receive a request (non-blocking)
            match rt.block_on(async {
                tokio::select! {
                    req = request_rx.recv() => req,
                    _ = tokio::time::sleep(std::time::Duration::from_millis(10)) => None,
                }
            }) {
                Some(request) => {
                    let response = context.with(|ctx| {
                        Self::handle_mcp_request(&ctx, request.payload)
                    });
                    let _ = request.response_tx.send(response);
                }
                None => {
                    // No request, continue loop
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
        }

        Ok(())
    }

    fn setup_sandbox(
        ctx: &rquickjs::Ctx,
        env: &HashMap<String, String>,
        capabilities: &Capabilities,
    ) -> Result<(), String> {
        let globals = ctx.globals();

        // MCP.writeLine - will be called by JS to send responses
        // We store responses in a global array that Rust will read
        ctx.eval::<(), _>(r#"
            globalThis.__mcp_responses = [];
            globalThis.__mcp_requests = [];
        "#).map_err(|e| e.to_string())?;

        // Create process.env
        let process = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
        let env_obj = Object::new(ctx.clone()).map_err(|e| e.to_string())?;
        
        for (key, value) in env {
            env_obj.set(key.as_str(), value.as_str()).map_err(|e| e.to_string())?;
        }
        
        process.set("env", env_obj).map_err(|e| e.to_string())?;
        process.set("platform", "harbor-bridge").map_err(|e| e.to_string())?;
        globals.set("process", process).map_err(|e| e.to_string())?;

        // Create console object
        ctx.eval::<(), _>(r#"
            globalThis.console = {
                log: (...args) => {},
                warn: (...args) => {},
                error: (...args) => {},
                info: (...args) => {},
                debug: (...args) => {},
            };
        "#).map_err(|e| e.to_string())?;

        // Create MCP interface
        ctx.eval::<(), _>(r#"
            globalThis.MCP = {
                readLine: function() {
                    return new Promise((resolve) => {
                        globalThis.__mcp_pendingRead = resolve;
                    });
                },
                writeLine: function(json) {
                    globalThis.__mcp_responses.push(json);
                },
            };
        "#).map_err(|e| e.to_string())?;

        // Remove dangerous globals
        ctx.eval::<(), _>(r#"
            delete globalThis.eval;
        "#).map_err(|e| e.to_string())?;

        // Set up fetch if network access is allowed
        if !capabilities.network.allowed_hosts.is_empty() {
            // Fetch will be handled synchronously via Rust callbacks
            // For now, create a placeholder that stores requests
            ctx.eval::<(), _>(r#"
                globalThis.__fetch_requests = [];
                globalThis.__fetch_responses = {};
                globalThis.__fetch_id = 0;
                
                globalThis.fetch = async function(url, options) {
                    const id = ++globalThis.__fetch_id;
                    globalThis.__fetch_requests.push({
                        id: id,
                        url: url,
                        options: options || {}
                    });
                    
                    // Wait for response (will be filled by Rust)
                    return new Promise((resolve, reject) => {
                        const check = () => {
                            const resp = globalThis.__fetch_responses[id];
                            if (resp) {
                                delete globalThis.__fetch_responses[id];
                                if (resp.error) {
                                    reject(new Error(resp.error));
                                } else {
                                    resolve({
                                        ok: resp.status >= 200 && resp.status < 300,
                                        status: resp.status,
                                        statusText: resp.statusText || '',
                                        headers: new Map(Object.entries(resp.headers || {})),
                                        text: async () => resp.body,
                                        json: async () => JSON.parse(resp.body),
                                    });
                                }
                            } else {
                                setTimeout(check, 1);
                            }
                        };
                        check();
                    });
                };
            "#).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    fn handle_mcp_request(
        ctx: &rquickjs::Ctx,
        request: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let request_json = serde_json::to_string(&request).map_err(|e| e.to_string())?;

        // Push the request to the JS side and resolve pending read
        let code = format!(r#"
            const req = '{}';
            if (globalThis.__mcp_pendingRead) {{
                const resolve = globalThis.__mcp_pendingRead;
                globalThis.__mcp_pendingRead = null;
                resolve(req);
            }} else {{
                globalThis.__mcp_requests.push(req);
            }}
        "#, request_json.replace("'", "\\'").replace("\n", "\\n"));

        ctx.eval::<(), _>(code.as_str()).map_err(|e| e.to_string())?;

        // Run the event loop to let the JS process the request
        // This is a simplified approach - in production we'd need proper async handling
        for _ in 0..1000 {
            // Check if there's a response
            let responses: Vec<String> = ctx.eval(r#"
                const r = globalThis.__mcp_responses.splice(0);
                r
            "#).map_err(|e| e.to_string())?;

            if !responses.is_empty() {
                let response_str = responses.last().unwrap();
                return serde_json::from_str(response_str)
                    .map_err(|e| format!("Invalid response JSON: {}", e));
            }

            // Small delay to allow JS to process
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        Err("Timeout waiting for server response".to_string())
    }
}
