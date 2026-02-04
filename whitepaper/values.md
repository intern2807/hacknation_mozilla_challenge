# Values and Principles

**The foundational beliefs that guide the Web Agent API**

---

This document articulates the values underlying the Web Agent API proposal. These aren't marketing language—they're constraints we use to make design decisions. When we face tradeoffs, these principles tell us which way to lean.

---

## 1. User Agency First

**Users should control their AI experience.**

This is the core principle from which everything else follows.

### What this means in practice

**Choice of AI provider.** Users decide which AI they use—local models, cloud providers, or a mix. Websites don't make this choice for them.

**Control over context.** Users decide what information websites can access. The default is no access; access requires explicit consent.

**Revocable permissions.** Any permission granted can be revoked at any time. Users aren't locked into past decisions.

**Portable preferences.** User preferences persist across websites and (where possible) across browsers. You shouldn't have to re-configure your AI experience for every site.

### What this means for design

- Every capability requires explicit user consent
- Permissions use clear language, not technical jargon
- Defaults always favor user privacy and control
- No silent data collection, no implicit access

### Tension points

User agency can conflict with convenience. A "just works" experience often means making decisions on behalf of users. We lean toward agency even when it adds friction—but we try to make the friction as low as possible while maintaining meaningful consent.

---

## 2. Privacy by Architecture

**The best privacy is infrastructure that makes tracking difficult by design.**

### What this means in practice

**Local-first AI.** When AI can run locally, data never leaves the user's device. This isn't a toggle in settings—it's the architecture.

**Data minimization.** Only the data necessary for a specific operation should be shared, and only with the user's consent.

**No retention by default.** Prompts, responses, and tool results aren't logged or persisted unless explicitly requested by the user.

**Origin isolation.** Permissions and context are scoped per-origin. Website A can't access what user shared with Website B.

### What this means for design

- Support local model execution as a first-class option
- Don't require cloud backends for basic functionality
- Design APIs that work without persistent storage
- Build in isolation by default, connection by exception

### Tension points

Privacy can conflict with functionality. Cloud models are often more capable than local ones. Cross-site context sharing could enable powerful features. We lean toward privacy—but we give users the choice to make different tradeoffs when they understand them.

---

## 3. Open Standards Over Proprietary Lock-in

**No single company should own the infrastructure layer for AI on the web.**

### What this means in practice

**Open protocols.** We build on MCP, an open protocol for tool connectivity. We propose the Web Agent API as an open standard.

**Implementation independence.** The specification is designed so anyone can implement it. Multiple implementations should be able to interoperate.

**No walled gardens.** Users shouldn't be locked into a particular browser, OS, or AI provider to use this infrastructure.

**Competitive neutrality.** The standard shouldn't advantage any particular AI provider, browser vendor, or platform.

### What this means for design

- Publish specifications openly
- Design for interoperability from the start
- Avoid features that only work with specific providers
- Welcome alternative implementations

### Tension points

Open standards move slower than proprietary ones. A single company can iterate faster than a consortium. We believe the long-term benefits of openness outweigh the short-term speed of proprietary approaches—but we're willing to ship working implementations first and standardize based on what works.

---

## 4. Developer Accessibility

**Building AI-powered web experiences shouldn't require deep AI expertise or significant infrastructure.**

### What this means in practice

**Platform infrastructure.** AI capabilities should be as accessible as `fetch()` or `localStorage`. Developers should be able to use them without understanding model architectures.

**No API key management.** Websites shouldn't need to manage AI API keys. That's the user's concern, mediated by the browser.

**No inference costs.** Websites that expose tools shouldn't pay for inference. The user's AI handles that.

**Progressive enhancement.** Websites should be able to add AI features incrementally without rebuilding from scratch.

### What this means for design

- Simple, intuitive API surfaces
- Sensible defaults that work out of the box
- Comprehensive documentation and examples
- Clear error messages and debugging tools

### Tension points

Simplicity can conflict with flexibility. Power users want fine-grained control; most developers want it to "just work." We aim for simple defaults with opt-in complexity—easy things should be easy, hard things should be possible.

---

## 5. Transparency and Trust

**Users should understand what's happening with their data and AI interactions.**

### What this means in practice

**Clear permissions.** When we ask users for consent, we explain what we're asking for in plain language.

**Auditable behavior.** Users should be able to see what data has been shared, which tools have been called, and what permissions are active.

**No dark patterns.** We don't use design tricks to get users to consent to things they don't understand.

**Accountability.** Organizations building this infrastructure should be held to public commitments about privacy and data handling.

### What this means for design

- Permission prompts explain consequences, not just capabilities
- Provide a way to review past activity
- Make it easy to revoke permissions and clear data
- Document privacy practices clearly and prominently

### Tension points

Transparency can conflict with simplicity. Showing all the details can overwhelm users; hiding them can obscure important information. We aim for layered disclosure—essential information upfront, details available on request.

---

## 6. Security by Default

**The default configuration should be secure. Unsafe options should require explicit, informed choices.**

### What this means in practice

**Principle of least privilege.** Capabilities default to off. Permissions are granted per-scope, not in bulk.

**Defense in depth.** Multiple layers of protection so a single failure doesn't compromise the system.

**Secure contexts only.** AI capabilities should only be available over HTTPS, not on insecure origins.

**Rate limiting and budgets.** Built-in protection against runaway AI operations or resource exhaustion.

### What this means for design

- No "grant all" permission options
- Tool access requires explicit allowlisting per-origin
- Built-in timeouts and call limits
- Fail closed, not open

### Tension points

Security can conflict with convenience. More security often means more friction. We lean toward security—but we try to make the secure path as smooth as possible.

---

## 7. Extensibility and Evolution

**The web changes. AI changes faster. The infrastructure should evolve without breaking what's already built.**

### What this means in practice

**Stable core, extensible edges.** The fundamental APIs should be stable; new capabilities should be addable without breaking existing code.

**Protocol agnosticism.** While we build on MCP today, the architecture should accommodate new protocols as they emerge.

**Graceful degradation.** Applications should be able to detect capabilities and adapt to what's available.

### What this means for design

- Version APIs explicitly
- Design extension points from the start
- Provide feature detection mechanisms
- Maintain backward compatibility where possible

### Tension points

Stability can conflict with improvement. Maintaining backward compatibility can prevent better designs. We commit to not breaking existing functionality without clear migration paths and reasonable timelines.

---

## Applying These Values

When we face a design decision, we ask:

1. **Does this give users more control?** (Agency)
2. **Does this minimize data exposure?** (Privacy)
3. **Can this be implemented by others?** (Openness)
4. **Can a developer use this without AI expertise?** (Accessibility)
5. **Will users understand what's happening?** (Transparency)
6. **Is the default safe?** (Security)
7. **Can this evolve without breaking?** (Extensibility)

If the answer to any of these is "no," we think hard about whether we're making the right choice.

---

## Feedback on These Values

We've articulated these values based on our current understanding. We may be missing important principles, or weighting them incorrectly, or failing to see tensions we should address.

If you think we've got something wrong—or something right that we should emphasize more—we want to hear about it.

[Open an issue](https://github.com/anthropics/harbor/issues) or [start a discussion](https://github.com/anthropics/harbor/discussions).

---

*This is a living document. Last updated: January 2026.*
