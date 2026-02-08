# Harbor Product Search

A Firefox browser extension that helps you find the best deals across multiple shopping sources. Right-click any product or selected text to compare prices from Google Shopping, Amazon, DuckDuckGo, eBay, and more.

## Architecture

```
Firefox Sidebar (React) → background.js → API Server (:8765) → search.py → SerpAPI
```

- **Sidebar** (`src/SearchSidebar.jsx`): React UI with search input, delivery/privacy/location settings, and product results
- **Background script** (`background.js`): Handles context menu, messaging between sidebar and API
- **Content script** (`content.js`): Detects product pages and extracts product info
- **API server** (`src/api_server.py`): FastAPI backend that queries search providers and returns ranked results
- **Search module** (`src/search.py`): SerpAPI wrapper with multi-engine support, caching, and ranking

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Python | 3.12+ | [python.org](https://python.org) |
| uv | latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Firefox | 109+ | [mozilla.org](https://www.mozilla.org/firefox/) |
| SerpAPI key | — | [serpapi.com](https://serpapi.com) |

## Setup

### 1. Clone the repo

```bash
git clone git@github.com:intern2807/hacknation_mozilla_challenge.git
cd hacknation_mozilla_challenge
```

### 2. Install Node dependencies

```bash
npm install
```

### 3. Install Python dependencies

```bash
uv sync
```

### 4. Configure environment

Create a `.env` file in the project root:

```
SERPAPI_API_KEY=your_serpapi_key_here
```

### 5. Build the Firefox extension

```bash
npm run build
```

This outputs the built extension to the `build/` directory.

### 6. Start the API server

```bash
uv run uvicorn src.api_server:app --host 127.0.0.1 --port 8765
```

Verify it's running:

```bash
curl http://127.0.0.1:8765/health
```

### 7. Load the extension in Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Navigate to the `build/` folder and select `manifest.json`

The sidebar icon should appear and the context menu entry "Shop with Harbor" will be available on right-click.

## Usage

1. **Right-click** selected text on any page → choose **"Shop with Harbor"**
2. Or open the sidebar (Cmd+Shift+H) and type a product name in the search field
3. Set your preferences:
   - **Priority**: Fastest delivery or cheapest price
   - **Location**: Share location or enter manually
   - **Privacy**: Strict (DuckDuckGo only), Limited (+Google), or Open (all engines)
4. Click **"Let's Go"** to search

## Development

### Watch mode (auto-rebuild on changes)

```bash
# Terminal 1: React dev server
npm start

# Terminal 2: API server
uv run uvicorn src.api_server:app --host 127.0.0.1 --port 8765 --reload
```

After changes, click **"Reload"** in `about:debugging` to update the extension.

> **Tip:** If context menu text doesn't update, fully remove and re-add the extension.

### CLI search (no browser needed)

```bash
# Text search
uv run python src/search.py --q "iphone 17" --engine google_shopping --country ch --lang en

# Image search
uv run python src/search.py --image-url "https://example.com/product.jpg" --search-type products

# Replay from cached snapshot (no API calls)
uv run python src/search.py --replay data/google_shopping_iphone17.json
```

### Project structure

```
├── background.js          # Extension background script
├── content.js             # Content script (product detection)
├── manifest.json          # Firefox extension manifest (source)
├── build/                 # Built extension (load this in Firefox)
├── src/
│   ├── SearchSidebar.jsx  # React sidebar UI
│   ├── SearchSidebar.css  # Sidebar styles
│   ├── api_server.py      # FastAPI backend
│   ├── search.py          # SerpAPI search module
│   └── mcp_server.py      # MCP server (experimental)
├── data/                  # Cached API response snapshots
├── .env                   # API keys (not committed)
└── pyproject.toml         # Python dependencies
```
