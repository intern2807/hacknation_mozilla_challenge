# Web Agent Control Demos (Extension 2)

Self-contained demos that exercise active-tab interaction APIs. Each step increases complexity and uses the same-tab security model.

## Demos

- **Basic Actions** (`step-1-basic-actions/`) — Click, fill, and select on a simple form.
- **Multi-step Form** (`step-2-multi-step-form/`) — Validation + delayed transitions with `waitForSelector`.
- **Research Agent** (`step-4-research-agent/`) — Multi-tab research: search Google, open results in new tabs, extract content, and synthesize with AI.

## APIs Covered

### Active Tab (same-page)
- `agent.browser.activeTab.click(selector)`
- `agent.browser.activeTab.fill(selector, value)`
- `agent.browser.activeTab.select(selector, value)`
- `agent.browser.activeTab.scroll(options)`
- `agent.browser.activeTab.waitForSelector(selector)`

### Tab Management (multi-tab)
- `agent.browser.tabs.create({ url, active })` — Create new tabs
- `agent.browser.tabs.list()` — List all tabs
- `agent.browser.tabs.close(tabId)` — Close a spawned tab
- `agent.browser.tab.readability(tabId)` — Extract content from a spawned tab
- `agent.browser.tab.navigate(tabId, url)` — Navigate a spawned tab

## Permissions & Flags

- `browser:activeTab.interact` — Required for click/fill/select/scroll.
- `browser:activeTab.read` — Required for `waitForSelector` and `readability` on active tab.
- `browser:tabs.create` — Required for creating and controlling spawned tabs.
- `browser:tabs.read` — Required for listing tabs.
- Feature flag: `browserInteraction` must be enabled for active-tab interactions.
- Feature flag: `browserControl` must be enabled for tab management APIs.
