# Firefox Quickstart

**Get Harbor running in Firefox in under 10 minutes.**

---

## Prerequisites

Before you begin, make sure you have:

| Tool | Install |
|------|---------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Rust** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Firefox 109+** | Already have it |
| **Ollama** | [ollama.com](https://ollama.com) or `brew install ollama` |

---

## Step 1: Clone the Repository

```bash
git clone --recurse-submodules https://github.com/anthropics/harbor.git
cd harbor
```

---

## Step 2: Start Ollama

Ollama provides the local LLM backend. Start the server and pull a model:

```bash
ollama serve &
ollama pull llama3.2
```

You can use other models like `mistral`, `codellama`, or `phi3` if you prefer.

**Verify Ollama is running:**

```bash
curl http://localhost:11434/api/tags
```

You should see a JSON response listing your downloaded models.

---

## Step 3: Build the Extension

The default build targets Firefox:

```bash
cd extension
npm install
npm run build
cd ..
```

This creates `extension/dist-firefox/` containing the built extension.

---

## Step 4: Build and Install the Bridge

The bridge connects the extension to Ollama and local resources:

```bash
cd bridge-rs
cargo build --release
./install.sh
cd ..
```

The install script:
- Builds the `harbor-bridge` binary
- Installs the native messaging manifest for Firefox at:
  - **macOS:** `~/Library/Application Support/Mozilla/NativeMessagingHosts/harbor_bridge.json`
  - **Linux:** `~/.mozilla/native-messaging-hosts/harbor_bridge.json`

---

## Step 5: Load the Extension in Firefox

1. Open Firefox
2. Navigate to `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Navigate to `extension/dist-firefox/` and select **`manifest.json`**

You should see "Harbor" appear in your extensions list.

---

## Step 6: Verify the Installation

1. **Open the Harbor sidebar:**
   - Press `Ctrl+B` (Windows/Linux) or `Cmd+B` (macOS) to open the sidebar
   - Click the Harbor icon to switch to the Harbor panel
   - Or click the Harbor icon in the toolbar

2. **Check the bridge connection:**
   - The sidebar should show "Bridge: Connected" (green indicator)
   - If it shows "Bridge: Disconnected", re-run `./install.sh` in the `bridge-rs` directory and restart Firefox

3. **Check the LLM provider:**
   - The sidebar should show "LLM: Ollama" or similar
   - If no LLM is found, make sure `ollama serve` is running

---

## Step 7: Run the Demos

Start the demo server:

```bash
cd demo
npm install
npm start
```

Open http://localhost:8000 in Firefox.

---

## Step 8: Try Your First Demo

Navigate to **[Getting Started](http://localhost:8000/web-agents/getting-started/)** to walk through the basics:

1. **Detect the API** — Confirms Harbor is loaded
2. **Request Permission** — Learn how permissions work
3. **Check Tools** — See what MCP tools are available
4. **Run an Agent** — Ask "What time is it?" and watch the AI use tools
5. **See the Response** — View the final answer

The demo walks you through each step interactively.

---

## Other Demos to Try

| Demo | URL | What It Shows |
|------|-----|---------------|
| **Chat Demo** | http://localhost:8000/web-agents/chat-poc/ | Full chat interface with tool calling |
| **Page Summarizer** | http://localhost:8000/web-agents/summarizer/ | AI-powered page summaries |
| **Time Agent** | http://localhost:8000/web-agents/time-agent/ | Simple tool usage example |

---

## Troubleshooting

### "Web Agent API not detected"

- Is Harbor loaded? Check `about:debugging#/runtime/this-firefox`
- Refresh the page after loading the extension
- Make sure you loaded from `dist-firefox/manifest.json`, not the source `manifest.json`

### "Bridge Disconnected" in sidebar

```bash
cd bridge-rs && ./install.sh
```

Then restart Firefox.

### "No LLM Provider Found"

```bash
ollama serve
curl http://localhost:11434/api/tags  # Should return models
```

### "No tools available"

The built-in `time-wasm` server should be available by default. If not:

1. Open the Harbor sidebar
2. Go to "MCP Servers"
3. Check if any servers are listed
4. Try reloading the extension

### Extension disappears after restart

Temporary add-ons in Firefox don't persist across browser restarts. You'll need to reload the extension each time via `about:debugging`.

For persistent installation during development, consider using [web-ext](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/).

---

## Next Steps

| What You Want | Where to Go |
|---------------|-------------|
| Build your own AI app | [QUICKSTART.md](../QUICKSTART.md#part-2-build-your-first-app) |
| Create custom MCP tools | [QUICKSTART.md](../QUICKSTART.md#part-3-create-your-own-tools) |
| Full API reference | [WEB_AGENTS_API.md](WEB_AGENTS_API.md) |
| Understand the architecture | [ARCHITECTURE.md](../ARCHITECTURE.md) |

---

## Development Workflow

For active development, use watch mode:

```bash
cd extension
npm run dev  # Rebuilds on file changes
```

After each rebuild, reload the extension in `about:debugging` by clicking the "Reload" button.
