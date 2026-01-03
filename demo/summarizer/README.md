# Page Summarizer Demo

A simple demonstration of the Harbor JavaScript API that summarizes any webpage using AI.

## How It Works

This demo showcases the minimal Harbor API needed to:

1. **Request Permissions** — Ask for access to the AI model and browser tab
2. **Read Page Content** — Extract readable text from the active tab
3. **Generate Summary** — Create a text session and prompt the AI

## API Usage

```javascript
// Request permissions
await window.agent.requestPermissions({
  scopes: ['model:prompt', 'browser:activeTab.read'],
  reason: 'Summarize the current page'
});

// Get page content using Readability
const tab = await window.agent.browser.activeTab.readability();

// Create a session with a summarization prompt
const session = await window.ai.createTextSession({
  systemPrompt: 'Summarize clearly and concisely.'
});

// Generate the summary
const summary = await session.prompt(tab.text);

// Clean up
await session.destroy();
```

## Running the Demo

1. Start the demo server from the `demo/` directory:
   ```bash
   ./serve.sh
   ```

2. Open `http://localhost:8000/summarizer/` in Firefox

3. Make sure the Harbor extension is installed and a bridge is running

4. Navigate to any webpage, then click "Summarize Current Page"

## Required Permissions

| Scope | Description |
|-------|-------------|
| `model:prompt` | Basic text generation using the configured LLM |
| `browser:activeTab.read` | Read the content of the currently active tab |

## Files

- `index.html` — Complete self-contained demo with HTML, CSS, and JavaScript

