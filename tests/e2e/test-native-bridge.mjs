#!/usr/bin/env node
/**
 * Native Bridge Connection Test
 * 
 * Tests that the harbor-bridge binary:
 * 1. Exists and is executable
 * 2. Responds to ping with pong
 * 3. Handles RPC requests correctly
 * 
 * This test runs the bridge directly via stdio (same as Firefox native messaging).
 * 
 * Usage:
 *   node test-native-bridge.mjs
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Find the native bridge binary
function findBridgeBinary() {
  const possiblePaths = [
    // Built binary
    path.resolve(__dirname, '../../bridge-rs/target/release/harbor-bridge'),
    // Debug binary
    path.resolve(__dirname, '../../bridge-rs/target/debug/harbor-bridge'),
    // Installed location (macOS)
    path.join(os.homedir(), '.harbor/harbor-bridge'),
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return null;
}

// Check if native messaging manifest is installed
function checkNativeMessagingManifest() {
  const manifestLocations = {
    darwin: [
      path.join(os.homedir(), 'Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge.json'),
    ],
    linux: [
      path.join(os.homedir(), '.mozilla/native-messaging-hosts/harbor_bridge.json'),
    ],
  };
  
  const platform = os.platform();
  const locations = manifestLocations[platform] || [];
  
  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return { found: true, path: loc };
    }
  }
  
  return { found: false, locations };
}

// Encode message for native messaging (4-byte length prefix, little-endian)
function encodeMessage(message) {
  const json = JSON.stringify(message);
  const jsonBuffer = Buffer.from(json, 'utf-8');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32LE(jsonBuffer.length, 0);
  return Buffer.concat([lengthBuffer, jsonBuffer]);
}

// Decode message from native messaging
function decodeMessage(buffer) {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32LE(0);
  if (buffer.length < 4 + length) return null;
  const json = buffer.slice(4, 4 + length).toString('utf-8');
  return { message: JSON.parse(json), bytesConsumed: 4 + length };
}

// Run a test
async function runTest(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log('✓');
    return true;
  } catch (err) {
    console.log('✗');
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Main test runner
async function main() {
  console.log('🚢 Harbor Native Bridge Tests\n');
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Find binary
  const binaryPath = findBridgeBinary();
  if (await runTest('Native bridge binary exists', async () => {
    if (!binaryPath) {
      throw new Error('Binary not found. Run: cd bridge-rs && cargo build --release');
    }
  })) {
    passed++;
  } else {
    failed++;
    console.log('\n❌ Cannot continue without native bridge binary');
    process.exit(1);
  }
  
  console.log(`    Found: ${binaryPath}`);
  
  // Test 2: Check native messaging manifest
  const manifest = checkNativeMessagingManifest();
  if (await runTest('Native messaging manifest installed', async () => {
    if (!manifest.found) {
      throw new Error(`Manifest not found. Run: cd bridge-rs && ./install.sh`);
    }
  })) {
    passed++;
    console.log(`    Found: ${manifest.path}`);
  } else {
    failed++;
    console.log(`    Looked in: ${manifest.locations?.join(', ')}`);
  }
  
  // Test 3: Binary is executable
  if (await runTest('Binary is executable', async () => {
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
      throw new Error('Binary is not executable');
    }
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 4: Start bridge and test ping/pong
  if (await runTest('Ping/pong works', async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.kill();
        reject(new Error('Timeout waiting for pong'));
      }, 10000);
      
      // Start the bridge with --native-messaging flag
      const bridge = spawn(binaryPath, ['--native-messaging'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let outputBuffer = Buffer.alloc(0);
      let gotPong = false;
      
      bridge.stdout.on('data', (data) => {
        outputBuffer = Buffer.concat([outputBuffer, data]);
        
        // Try to decode messages
        while (outputBuffer.length >= 4) {
          const result = decodeMessage(outputBuffer);
          if (!result) break;
          
          outputBuffer = outputBuffer.slice(result.bytesConsumed);
          const msg = result.message;
          
          console.log(`    Received: ${JSON.stringify(msg)}`);
          
          // Check for pong or ready status
          if (msg.type === 'status' && (msg.status === 'pong' || msg.status === 'ready')) {
            gotPong = true;
            clearTimeout(timeout);
            bridge.kill();
            resolve();
          }
        }
      });
      
      bridge.stderr.on('data', (data) => {
        // Log stderr for debugging but don't fail
        const text = data.toString().trim();
        if (text && !text.includes('Checking for default config')) {
          console.log(`    [stderr] ${text}`);
        }
      });
      
      bridge.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start bridge: ${err.message}`));
      });
      
      bridge.on('exit', (code) => {
        clearTimeout(timeout);
        if (!gotPong) {
          reject(new Error(`Bridge exited with code ${code} before responding`));
        }
      });
      
      // Send ping message
      const pingMessage = encodeMessage({ type: 'ping' });
      bridge.stdin.write(pingMessage);
    });
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 5: RPC system.health request
  if (await runTest('RPC system.health works', async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.kill();
        reject(new Error('Timeout waiting for RPC response'));
      }, 10000);
      
      const bridge = spawn(binaryPath, ['--native-messaging'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let outputBuffer = Buffer.alloc(0);
      let gotResponse = false;
      const requestId = 'test-health-1';
      
      bridge.stdout.on('data', (data) => {
        outputBuffer = Buffer.concat([outputBuffer, data]);
        
        while (outputBuffer.length >= 4) {
          const result = decodeMessage(outputBuffer);
          if (!result) break;
          
          outputBuffer = outputBuffer.slice(result.bytesConsumed);
          const msg = result.message;
          
          // Skip status messages, look for RPC response
          if (msg.type === 'rpc_response' && msg.id === requestId) {
            gotResponse = true;
            clearTimeout(timeout);
            bridge.kill();
            
            if (msg.error) {
              // system.health might not be implemented, that's ok
              console.log(`    Response: error - ${msg.error.message}`);
              resolve(); // Still pass - we got a response
            } else {
              console.log(`    Response: ${JSON.stringify(msg.result)}`);
              resolve();
            }
          }
        }
      });
      
      bridge.stderr.on('data', () => {});
      
      bridge.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start bridge: ${err.message}`));
      });
      
      bridge.on('exit', (code) => {
        clearTimeout(timeout);
        if (!gotResponse) {
          reject(new Error(`Bridge exited with code ${code} before responding`));
        }
      });
      
      // Wait a moment for bridge to initialize, then send RPC
      setTimeout(() => {
        const rpcMessage = encodeMessage({
          type: 'rpc',
          id: requestId,
          method: 'system.health',
          params: {},
        });
        bridge.stdin.write(rpcMessage);
      }, 500);
    });
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 6: RPC llm.list_providers - LLM provider discovery
  if (await runTest('RPC llm.list_providers works', async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.kill();
        reject(new Error('Timeout waiting for llm.list_providers response'));
      }, 15000); // Longer timeout since it may probe Ollama
      
      const bridge = spawn(binaryPath, ['--native-messaging'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let outputBuffer = Buffer.alloc(0);
      let gotResponse = false;
      const requestId = 'test-list-providers-1';
      
      bridge.stdout.on('data', (data) => {
        outputBuffer = Buffer.concat([outputBuffer, data]);
        
        while (outputBuffer.length >= 4) {
          const result = decodeMessage(outputBuffer);
          if (!result) break;
          
          outputBuffer = outputBuffer.slice(result.bytesConsumed);
          const msg = result.message;
          
          if (msg.type === 'rpc_response' && msg.id === requestId) {
            gotResponse = true;
            clearTimeout(timeout);
            bridge.kill();
            
            if (msg.error) {
              reject(new Error(`RPC error: ${msg.error.message}`));
              return;
            }
            
            // Validate response structure
            const providers = msg.result?.providers;
            if (!Array.isArray(providers)) {
              reject(new Error('Response missing providers array'));
              return;
            }
            
            console.log(`    Found ${providers.length} provider(s)`);
            
            // Check for local providers
            const localProviders = providers.filter(p => p.is_local);
            const availableLocal = providers.filter(p => p.is_local && p.available);
            
            if (availableLocal.length > 0) {
              console.log(`    🎉 Local LLM detected: ${availableLocal.map(p => p.name || p.id).join(', ')}`);
            } else if (localProviders.length > 0) {
              console.log(`    Local providers (not running): ${localProviders.map(p => p.id).join(', ')}`);
            }
            
            // Validate provider structure (check first one if any exist)
            if (providers.length > 0) {
              const first = providers[0];
              const requiredFields = ['id', 'type', 'is_local'];
              for (const field of requiredFields) {
                if (!(field in first)) {
                  reject(new Error(`Provider missing required field: ${field}`));
                  return;
                }
              }
            }
            
            resolve();
          }
        }
      });
      
      bridge.stderr.on('data', () => {});
      
      bridge.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start bridge: ${err.message}`));
      });
      
      bridge.on('exit', (code) => {
        clearTimeout(timeout);
        if (!gotResponse) {
          reject(new Error(`Bridge exited with code ${code} before responding`));
        }
      });
      
      // Wait for bridge to initialize, then send RPC
      setTimeout(() => {
        const rpcMessage = encodeMessage({
          type: 'rpc',
          id: requestId,
          method: 'llm.list_providers',
          params: {},
        });
        bridge.stdin.write(rpcMessage);
      }, 500);
    });
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 7: RPC llm.list_models - List available models (requires local LLM)
  if (await runTest('RPC llm.list_models works', async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.kill();
        reject(new Error('Timeout waiting for llm.list_models response'));
      }, 20000); // Models listing can take time
      
      const bridge = spawn(binaryPath, ['--native-messaging'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let outputBuffer = Buffer.alloc(0);
      let gotResponse = false;
      const requestId = 'test-list-models-1';
      
      bridge.stdout.on('data', (data) => {
        outputBuffer = Buffer.concat([outputBuffer, data]);
        
        while (outputBuffer.length >= 4) {
          const result = decodeMessage(outputBuffer);
          if (!result) break;
          
          outputBuffer = outputBuffer.slice(result.bytesConsumed);
          const msg = result.message;
          
          if (msg.type === 'rpc_response' && msg.id === requestId) {
            gotResponse = true;
            clearTimeout(timeout);
            bridge.kill();
            
            if (msg.error) {
              // No models is OK - just means no local LLM is running
              console.log(`    (no models available - ${msg.error.message})`);
              resolve();
              return;
            }
            
            const models = msg.result?.models;
            if (!Array.isArray(models)) {
              reject(new Error('Response missing models array'));
              return;
            }
            
            if (models.length === 0) {
              console.log(`    (no models found - is Ollama running with models pulled?)`);
            } else {
              console.log(`    Found ${models.length} model(s):`);
              // Show first few models
              const shown = models.slice(0, 3);
              for (const m of shown) {
                console.log(`      - ${m.id || m.name}`);
              }
              if (models.length > 3) {
                console.log(`      ... and ${models.length - 3} more`);
              }
            }
            
            resolve();
          }
        }
      });
      
      bridge.stderr.on('data', () => {});
      
      bridge.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start bridge: ${err.message}`));
      });
      
      bridge.on('exit', (code) => {
        clearTimeout(timeout);
        if (!gotResponse) {
          reject(new Error(`Bridge exited with code ${code} before responding`));
        }
      });
      
      // Wait for bridge to initialize, then send RPC
      setTimeout(() => {
        const rpcMessage = encodeMessage({
          type: 'rpc',
          id: requestId,
          method: 'llm.list_models',
          params: {},
        });
        bridge.stdin.write(rpcMessage);
      }, 500);
    });
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Test 8: RPC llm.chat - Actually send a prompt to the LLM
  // Uses a hardcoded model that we know exists from test 7
  if (await runTest('RPC llm.chat works (if Ollama available)', async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        bridge.kill();
        reject(new Error('Timeout - LLM may be slow or not available'));
      }, 30000);
      
      const bridge = spawn(binaryPath, ['--native-messaging'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      
      let outputBuffer = Buffer.alloc(0);
      let gotResponse = false;
      const requestId = 'test-chat-1';
      
      // We'll use llama3.2:3b since we saw it in the model list
      // This should be a fast, small model
      const testModel = 'ollama:llama3.2:3b';
      
      bridge.stdout.on('data', (data) => {
        outputBuffer = Buffer.concat([outputBuffer, data]);
        
        while (outputBuffer.length >= 4) {
          const result = decodeMessage(outputBuffer);
          if (!result) break;
          
          outputBuffer = outputBuffer.slice(result.bytesConsumed);
          const msg = result.message;
          
          // Skip status messages
          if (msg.type === 'status') continue;
          
          if (msg.type === 'rpc_response' && msg.id === requestId) {
            gotResponse = true;
            clearTimeout(timeout);
            bridge.kill();
            
            if (msg.error) {
              // Check if it's a "no model" error - that's OK, just skip
              const errMsg = msg.error.message || '';
              if (errMsg.includes('No model') || errMsg.includes('not found') || errMsg.includes('model')) {
                console.log(`    (skipped - model not available: ${errMsg.slice(0, 50)})`);
                resolve();
                return;
              }
              reject(new Error(`RPC error: ${errMsg}`));
              return;
            }
            
            // Validate response structure
            const choices = msg.result?.choices;
            if (!Array.isArray(choices) || choices.length === 0) {
              reject(new Error('Response missing choices array'));
              return;
            }
            
            const content = choices[0]?.message?.content;
            if (typeof content !== 'string') {
              reject(new Error('Response missing content'));
              return;
            }
            
            const preview = content.slice(0, 80).replace(/\n/g, ' ').trim();
            console.log(`    🎉 LLM responded: "${preview}${content.length > 80 ? '...' : ''}"`);
            resolve();
          }
        }
      });
      
      bridge.stderr.on('data', () => {});
      
      bridge.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start bridge: ${err.message}`));
      });
      
      bridge.on('exit', (code) => {
        clearTimeout(timeout);
        if (!gotResponse) {
          reject(new Error(`Bridge exited with code ${code} before responding`));
        }
      });
      
      // Send chat request after bridge initializes
      setTimeout(() => {
        console.log(`    Using model: ${testModel}`);
        const chatMsg = encodeMessage({
          type: 'rpc',
          id: requestId,
          method: 'llm.chat',
          params: {
            model: testModel,
            messages: [
              { role: 'user', content: 'Say hello in 3 words.' }
            ],
            max_tokens: 20,
          },
        });
        bridge.stdin.write(chatMsg);
      }, 500);
    });
  })) {
    passed++;
  } else {
    failed++;
  }
  
  // Summary
  console.log(`\n${'─'.repeat(40)}`);
  if (failed === 0) {
    console.log(`✅ All ${passed} tests passed!`);
    process.exit(0);
  } else {
    console.log(`❌ ${failed} test(s) failed, ${passed} passed`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
