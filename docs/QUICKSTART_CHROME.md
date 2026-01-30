# Chrome Quickstart

**Get Harbor running in Chrome in under 10 minutes.**

---

## Prerequisites

Before you begin, make sure you have:

| Tool | Install |
|------|---------|
| **Node.js 18+** | [nodejs.org](https://nodejs.org) |
| **Rust** | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Chrome 120+** | Already have it |
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

## Step 3: Build the Extension for Chrome

Use the Chrome-specific build command:

```bash
cd extension
npm install
npm run build:chrome
cd ..
```

This creates `extension/dist-chrome/` containing the built extension.

> **Note:** Chrome uses a service worker architecture instead of background scripts, so the build process differs from Firefox.

---

## Step 4: Load the Extension in Chrome

1. Open Chrome
2. Navigate to `chrome://extensions`
3. Enable **"Developer mode"** (toggle in the top right)
4. Click **"Load unpacked"**
5. Select the `extension/dist-chrome/` folder

You should see "Harbor" appear in your extensions list. **Note the extension ID** — you'll need it in the next step.

The extension ID looks like: `abcdefghijklmnopabcdefghijklmnop`

---

## Step 5: Build and Install the Bridge

The bridge connects the extension to Ollama and local resources:

```bash
cd bridge-rs
cargo build --release
./install.sh
cd ..
```

### Important: Update the Chrome Manifest

Chrome's native messaging requires the specific extension ID. After running `install.sh`, you need to update the manifest file:

**macOS:**
```bash
nano ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/harbor_bridge.json
```

**Linux:**
```bash
nano ~/.config/google-chrome/NativeMessagingHosts/harbor_bridge.json
```

Replace the `allowed_origins` line with your extension ID:

```json
{
  "name": "harbor_bridge",
  "description": "Harbor Bridge - Local LLM and MCP server for Harbor extension",
  "path": "/path/to/harbor-bridge-native",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID_HERE/"]
}
```

**Example:** If your extension ID is `abcdefghijklmnopabcdefghijklmnop`, use:
```json
"allowed_origins": ["chrome-extension://abcdefghijklmnopabcdefghijklmnop/"]
```

After editing, **restart Chrome** for the changes to take effect.

---

## Step 6: Verify the Installation

1. **Open the Harbor panel:**
   - Click the Harbor icon in the Chrome toolbar (puzzle piece menu → Harbor)
   - Or pin it to your toolbar for easy access

2. **Check the bridge connection:**
   - The panel should show "Bridge: Connected" (green indicator)
   - If it shows "Bridge: Disconnected":
     - Verify you updated the native messaging manifest with the correct extension ID
     - Restart Chrome completely
     - Check `chrome://extensions` for any errors on the Harbor extension

3. **Check the LLM provider:**
   - The panel should show "LLM: Ollama" or similar
   - If no LLM is found, make sure `ollama serve` is running

---

## Step 7: Run the Demos

Start the demo server:

```bash
cd demo
npm install
npm start
```

Open http://localhost:8000 in Chrome.

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

- Is Harbor loaded? Check `chrome://extensions`
- Refresh the page after loading the extension
- Make sure you loaded the `dist-chrome/` folder, not `dist-firefox/` or the source folder

### "Bridge Disconnected" in panel

This is usually an extension ID mismatch. Verify:

1. Get your extension ID from `chrome://extensions`
2. Edit the native messaging manifest (see Step 5)
3. Make sure the ID matches exactly
4. Restart Chrome completely (not just the tab)

Check Chrome's native messaging logs:

```bash
# macOS
cat ~/Library/Caches/harbor-bridge.log

# Linux
cat ~/.cache/harbor-bridge.log
```

### "No LLM Provider Found"

```bash
ollama serve
curl http://localhost:11434/api/tags  # Should return models
```

### "No tools available"

The built-in `time-wasm` server should be available by default. If not:

1. Open the Harbor panel
2. Go to "MCP Servers"
3. Check if any servers are listed
4. Try reloading the extension (click the reload icon in `chrome://extensions`)

### Extension ID Changed

The extension ID can change if you:
- Remove and re-add the extension
- Load from a different directory
- Clear Chrome's extension data

If this happens, update the native messaging manifest with the new ID and restart Chrome.

---

## Chrome vs Firefox Differences

| Feature | Chrome | Firefox |
|---------|--------|---------|
| UI location | Toolbar popup | Sidebar panel |
| Background | Service worker | Background script |
| Native messaging | Requires extension ID | Uses extension ID from manifest |
| Build command | `npm run build:chrome` | `npm run build` |
| Output folder | `dist-chrome/` | `dist-firefox/` |

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
npm run dev:chrome  # Rebuilds on file changes
```

After each rebuild, reload the extension in `chrome://extensions` by clicking the reload icon (circular arrow) on the Harbor extension card.
