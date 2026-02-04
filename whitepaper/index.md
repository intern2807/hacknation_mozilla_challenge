# The Web Agent API

**A Proposal for User-Controlled AI on the Web**

---

> *Your AI, your context, your choices.*

Today, AI on the web is fragmented. Users lose control. Websites struggle to offer AI features without building expensive infrastructure. This paper proposes a different path: making AI a capability the browser mediates on behalf of users—the same way browsers already mediate access to cameras, location, and storage.

**This is an invitation to collaborate.** We've built a working implementation called [Harbor](../README.md). We're proposing an open standard called the Web Agent API. We want your feedback, your use cases, your criticism, and your contributions.

---

## Contents

1. [Values](#values)
2. [The Problem](#the-problem)
3. [The Opportunity](#the-opportunity)
4. [What We Built](#what-we-built)
5. [What This Enables](#what-this-enables)
6. [How to Get Involved](#how-to-get-involved)

---

## Values

These are the principles that guide this work:

### User Agency First

Users should control their AI experience—which models they use, which providers they trust, what context they share, and with whom. AI capabilities should be resources users own and lend, not services websites control.

### Privacy by Architecture

The best privacy isn't a setting you toggle; it's infrastructure that makes tracking difficult by design. When AI runs locally or context stays in the browser, there's nothing to leak. When data must flow to external services, users should explicitly consent.

### Open Standards Over Proprietary Lock-in

No single company should own the infrastructure layer for AI on the web. We're building on open protocols (MCP) and proposing open APIs. Anyone should be able to implement this standard. Competition should happen on quality and trust, not lock-in.

### Developer Accessibility

Building AI-powered web experiences shouldn't require deep AI expertise or significant infrastructure investment. The plumbing should be platform infrastructure, not application code—just like rendering engines and network stacks.

### Transparency and Trust

Users should understand what's happening with their data and AI interactions. The permission model should be clear, understandable, and auditable. Organizations building this infrastructure should be held accountable.

---

## The Problem

### For Users: Fragmentation and Loss of Control

Your context is scattered across the internet: emails in Gmail, documents in Google Drive, purchase history on Amazon, calendar in Outlook, notes in Notion. When you want AI to help with any of it, you connect these services to third-party models directly.

Those connections happen on terms you don't set:
- **Which data gets sent** — You may not know what's being shared
- **Which model processes it** — You're stuck with whatever the website embedded
- **What gets retained** — Privacy policies vary wildly
- **Your preferences** — You repeat them to every AI you encounter

When switching between ChatGPT and Gemini, all accumulated context disappears. You're forced to use whatever model a website embeds rather than the models you've chosen and configured. You're a renter in someone else's AI infrastructure.

### For Websites: Cost and Complexity

Consider three categories of websites trying to offer AI features:

**Publishers** want to offer AI-native experiences—deep research across decades of archives, intelligent summarization, contextual recommendations. But they can't absorb the inference costs of deploying their own models.

**E-commerce and travel sites** want hyper-personalization based on user context ("find a hub compatible with my specific MacBook"). But they don't have access to that context, and building it means becoming a data company.

**SaaS applications** want sophisticated AI experiences but don't want the operational burden of model deployment, API management, and cost tracking.

Each builds the same integration from scratch—or doesn't build it at all.

### For Developers: Unnecessary Barriers

Building AI-driven web experiences currently requires:
- Deep AI expertise and API spend
- Managing model connections and authentication
- Building tool infrastructure
- Paying for inference—all before delivering actual value

This is like requiring every website to ship its own rendering engine. The plumbing should be platform infrastructure, not application code.

### Current "AI Browsers" Fall Short

Existing approaches offer two models, both limited:

**The sidebar model** houses an LLM that can summarize or query open tabs but doesn't unlock additional functionality within websites. The AI is bolted on, not integrated.

**The agentic model** (autonomous browsing agents) takes actions for you, but consumer use cases remain limited, accuracy is inconsistent, and inference costs run 100-200x higher than text queries—economics that won't survive once subsidies end.

The LLM should be integrated into the core website experience itself.

---

## The Opportunity

### Context as a Resource

A decade ago, browsers introduced permission prompts for cameras and microphones—sensitive resources that websites could request but not access without explicit user consent.

**We propose extending this model to AI and context.**

Your AI, your preferences, your accumulated context: these are resources the browser can manage on your behalf. Websites don't get access by default. They request it, you grant or deny, and the browser enforces your decision.

The browser acts as a secure repository for:
- User identity and preferences
- Credentials and authentication
- Accumulated AI context
- Tool connections and permissions

When a website needs any of these, the browser mediates that access—just as it mediates camera access today. Users stay on the site, but the site is supercharged by the user's chosen AI and accumulated context.

### Bring Your Own AI

The current model: websites embed AI, users have no choice.

**We propose flipping this.**

Websites declare their capabilities via standard mechanisms (like `<link rel="mcp-server">`). Users bring their preferred AI—Claude, GPT, local Llama, whatever they've configured and paid for. The user's AI gains new capabilities from the website's tools without the website managing any inference.

Users keep their preferences and conversation history. Data flow stays under user control. Inference is powered by the user's existing subscription or local models—the website pays nothing for AI.

**What about users without AI subscriptions?** Local inference is the practical default for the majority. This is actually an argument for the browser layer—it can intelligently route between local models (for simple tasks, privacy-sensitive contexts) and cloud models (when the user has a subscription and the task warrants it). As local model quality improves, the threshold shifts.

### Building on Open Standards

This proposal builds on the **Model Context Protocol (MCP)**, an open standard introduced by Anthropic in late 2024 that defines how AI systems connect to external tools.

Before USB, every peripheral needed its own connector. MCP is USB for AI: standardized tool definitions, structured schemas, discovery mechanisms. A growing ecosystem of MCP servers already exists—file systems, databases, search APIs, developer tools.

MCP is a starting point, not an endpoint. The architecture separates the browser API surface from the underlying tool protocol. As MCP evolves or complementary standards emerge, implementations can adapt without breaking web applications.

---

## What We Built

### Harbor: A Working Implementation

Harbor is a browser extension (Firefox and Chrome) that implements what we're calling the **Web Agent API**—the specification at the heart of this proposal.

Harbor demonstrates that this model is not just theoretically sound but practically viable.

**Architecture:**

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEB PAGE                                 │
│            window.ai / window.agent (injected APIs)             │
└───────────────────────────────┬─────────────────────────────────┘
                                │ postMessage
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER EXTENSION                             │
│  • Permission enforcement       • In-browser WASM/JS MCP        │
│  • Feature flags               • Message routing                │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Native Messaging
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RUST BRIDGE                                 │
│  • LLM provider abstraction    • Native MCP servers             │
│  • Ollama/OpenAI/Anthropic     • OAuth flows                    │
└─────────────────────────────────────────────────────────────────┘
```

### The Web Agent API

The Web Agent API defines two JavaScript surfaces available to web pages:

**`window.ai`** — Text generation, compatible with Chrome's emerging Prompt API

```javascript
const session = await window.ai.createTextSession({
  systemPrompt: "You are a helpful assistant."
});
const response = await session.prompt("Summarize this article");
```

**`window.agent`** — Tools, browser access, and autonomous agent capabilities

```javascript
// Request permissions (user sees a prompt)
await window.agent.requestPermissions({
  scopes: ['model:tools', 'mcp:tools.list', 'mcp:tools.call'],
  reason: 'Research assistant needs search access'
});

// Run an autonomous task
for await (const event of window.agent.run({
  task: 'Find recent news about renewable energy'
})) {
  if (event.type === 'token') console.log(event.token);
  if (event.type === 'final') console.log('Done:', event.output);
}
```

### Permission Model

All operations require explicit user consent. Permissions follow the patterns established for cameras and location:

| Scope | What It Allows |
|-------|----------------|
| `model:prompt` | Basic text generation |
| `model:tools` | AI with autonomous tool use |
| `mcp:tools.list` | List available tools |
| `mcp:tools.call` | Execute specific tools |
| `browser:activeTab.read` | Read page content |

Users can grant permissions once, always, or deny them. Permissions are scoped per-origin—granting access to one site doesn't affect others.

### Implementation Flexibility

The Web Agent API is a standard, not a specific implementation. Harbor demonstrates one approach (browser extension with native bridge), but others are possible:

- **Browser extension with WASM runtime** — Everything in-browser, no external processes
- **Native browser integration** — Built directly into the browser engine
- **OS-level service** — Shared across browsers and applications
- **Cloud proxy** — For lightweight clients

The architectural bet is on the pattern—browser-mediated AI with user-controlled tool access—not on any single implementation.

---

## What This Enables

### For Publishers

A news site exposes an MCP server to its 20-year archive. Readers run deep research using their own AI. The publisher pays nothing for inference—they just expose the tools.

```html
<link rel="mcp-server"
      href="https://news.example/mcp"
      title="Archive Search">
```

### For E-commerce

An e-commerce site provides product search tools. Your AI brings the context ("I own a MacBook Pro M3, prefer brand-name electronics") and surfaces compatible accessories without you re-explaining your setup.

```javascript
// User's context + website's tools
const results = await window.agent.run({
  task: 'Find a USB-C hub compatible with my laptop'
});
```

### For SaaS Applications

A SaaS application offers sophisticated AI features—document analysis, intelligent search, workflow automation—by exposing domain tools. Developers focus on their product rather than model APIs.

### Future Possibilities

The infrastructure we're proposing opens doors we haven't fully explored:

- **Privacy-preserving personalized ads** where context never leaves the device
- **Agent-to-agent coordination** for group planning and multi-party workflows
- **Portable AI identity** that persists across model switches
- **Enterprise policy control** where organizations govern AI usage through browser configuration

---

## How to Get Involved

### We Want Your Feedback

This is a proposal, not a finished standard. We're looking for:

**Use cases** — What would you build with this? What's missing?

**Technical feedback** — Is the API surface right? What's awkward or unclear?

**Security review** — What threats haven't we considered? What mitigations are we missing?

**Privacy analysis** — Are there data flows we should restrict? Permissions we should add?

**Implementation ideas** — How would this work in your browser, your platform, your context?

### Try Harbor

The best way to understand the proposal is to use it:

1. **Install Harbor** — [Quick start guide](../QUICKSTART.md)
2. **Run the demos** — See it in action with real examples
3. **Build something** — [Developer documentation](../docs/DEVELOPER_GUIDE.md)
4. **Read the spec** — [Full explainer](../spec/explainer.md)

### Contribute

- **GitHub Issues** — Report bugs, request features, ask questions
- **Pull Requests** — Fix bugs, improve docs, add features
- **Discussions** — Talk about use cases, architecture, standards

### Implement the Standard

Harbor is one implementation. We'd love to see others:

- Other browser extensions
- Native browser integrations
- OS-level implementations
- Alternative architectures

The specification is designed to be implementable independently. If you build something, let us know.

### Join the Conversation

We're not trying to own this space—we're trying to establish patterns that make user-controlled AI possible. That requires collaboration across browsers, platforms, and organizations.

If you're working on related problems, reach out. If you have concerns about the approach, share them. If you think we're solving the wrong problem, tell us.

**The web works best when it's built together.**

---

## Specification Documents

| Document | Description |
|----------|-------------|
| [Web Agent API Overview](../spec/README.md) | What the API is and why it matters |
| [Full Explainer](../spec/explainer.md) | Complete spec with Web IDL and security model |
| [Security & Privacy](../spec/security-privacy.md) | Threat model and mitigations |
| [Examples](../spec/examples/) | Working code examples |

---

## Acknowledgments

This work builds on the Model Context Protocol (MCP) developed by Anthropic, Chrome's Prompt API work, and years of browser platform evolution that established permission models for sensitive capabilities.

---

*This is a living document. Last updated: January 2026.*

*We welcome contributions, feedback, and collaboration. [Open an issue](https://github.com/anthropics/harbor/issues) or [start a discussion](https://github.com/anthropics/harbor/discussions).*
