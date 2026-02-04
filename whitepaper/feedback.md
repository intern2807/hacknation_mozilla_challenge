# Call for Feedback

**Help shape the future of user-controlled AI on the web**

---

We've built something we think matters. But we don't have all the answers—and we're certain we've missed things. This page outlines specific areas where we're actively seeking input.

---

## What We're Looking For

### Use Cases We Haven't Considered

We designed the Web Agent API around scenarios we understood: research assistants, page summarization, shopping helpers, SaaS integrations. But the web is vast and varied.

**Questions we're asking:**
- What would you build with this that we haven't described?
- What capabilities are missing for your use case?
- Are there entire categories of applications we haven't considered?

### API Design Feedback

The `window.ai` and `window.agent` surfaces are our first attempt. They're designed to be intuitive, but intuition varies.

**Questions we're asking:**
- Is anything confusing or awkward?
- Are there operations that should be simpler?
- Are there capabilities that should be more granular?
- Should we use different patterns (ReadableStream vs AsyncIterable, etc.)?

### Security Concerns

We've thought about security, but security is hard and we're not infallible.

**Questions we're asking:**
- What attack vectors haven't we considered?
- Are our mitigations sufficient?
- Are there permission scopes that are too broad or too narrow?
- What could a malicious website do that we haven't accounted for?

### Privacy Analysis

Privacy is core to this proposal, but privacy analysis requires diverse perspectives.

**Questions we're asking:**
- Are there data flows we should restrict further?
- Are there tracking vectors we've introduced?
- Should certain operations require stronger consent mechanisms?
- Are there contexts where local-first should be enforced, not optional?

### Implementation Alternatives

Harbor is one implementation. The standard should support others.

**Questions we're asking:**
- How would this work on mobile?
- What about embedded browsers or webviews?
- How should this interact with OS-level AI services?
- Are there architectures we should explicitly support or avoid?

### Enterprise and Organizational Needs

Individual users have different needs than organizations.

**Questions we're asking:**
- What policy controls do organizations need?
- How should this interact with MDM and browser management?
- Are there compliance requirements we should consider?
- How do IT administrators want to configure this?

---

## Areas of Active Debate

These are questions we're actively debating internally. Your input would help us resolve them.

### Session Persistence

Should AI sessions be persistable across page reloads?

**Arguments for:**
- Enables long-running conversations
- Better UX for complex tasks
- Matches user mental models

**Arguments against:**
- Privacy implications of persistent context
- Complexity in permission model
- Storage and cleanup concerns

**What we'd like to know:** Would you use this? What would you build with it? What privacy controls would make you comfortable?

### Cross-Origin Context Sharing

Should there be a way for users to share context across origins?

**Arguments for:**
- Enables richer personalization
- Could reduce repetition for users
- Supports "AI identity" concept

**Arguments against:**
- Significant privacy risks
- Complex consent model
- Potential for abuse

**What we'd like to know:** Is this valuable enough to take on the risks? What consent mechanisms would make it acceptable?

### Website-Provided Models

Should websites be able to provide their own models (not just tools)?

**Arguments for:**
- Enables specialized models for specific domains
- Websites could differentiate on AI quality
- Supports fine-tuned models

**Arguments against:**
- Undermines "bring your own AI" principle
- Could be used to bypass user preferences
- Complicates the mental model

**What we'd like to know:** Is there a middle ground? Perhaps website-provided models only with explicit user opt-in?

### Payment and Identity Integration

Should the API support payment authorization or identity verification?

**Arguments for:**
- Enables AI-assisted commerce
- Could support authentication flows
- Matches other browser-mediated capabilities

**Arguments against:**
- High-risk capability with significant attack surface
- Scope creep from core AI focus
- Complex regulatory implications

**What we'd like to know:** Is this in scope? If so, what would minimal viable integration look like?

---

## How to Provide Feedback

### GitHub Issues

For specific bugs, feature requests, or concrete suggestions:

[Open an issue](https://github.com/anthropics/harbor/issues)

Please include:
- Clear description of the feedback
- Use case context where relevant
- Suggested changes if you have them

### GitHub Discussions

For broader topics, questions, or exploration:

[Start a discussion](https://github.com/anthropics/harbor/discussions)

Good discussion topics:
- Use cases and scenarios
- Alternative design approaches
- Questions about rationale
- Comparisons with other approaches

### Pull Requests

For documentation improvements, examples, or implementation changes:

[Contributing guide](../CONTRIBUTING.md)

We especially welcome:
- Example applications
- Documentation improvements
- Security improvements
- Test coverage

### Direct Contact

For sensitive security issues or private feedback:

Email: [Include appropriate contact]

---

## What Happens to Feedback

We read everything. Seriously.

- **Issues** get triaged and either addressed, scheduled, or discussed
- **Discussions** inform our thinking even when they don't result in immediate changes
- **PRs** get reviewed and merged or discussed
- **Patterns** in feedback lead to design changes

We try to respond to all feedback, though response times vary. If something is urgent, flag it clearly.

---

## Community Guidelines

We want this to be a space for constructive collaboration.

**Please:**
- Be specific and constructive
- Explain your reasoning
- Consider tradeoffs
- Assume good faith

**Please don't:**
- Dismiss without explanation
- Make demands without rationale
- Engage in personal attacks
- Derail discussions

---

*Thank you for helping us build something better.*
