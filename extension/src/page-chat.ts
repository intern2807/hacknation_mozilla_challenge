/**
 * Page Chat - Injected sidebar for chatting about the current page
 * 
 * This content script injects a chat sidebar into web pages that allows
 * users to ask questions about the current page content using the Web Agent API.
 */

import browser from 'webextension-polyfill';

// Check if sidebar is already injected
if (document.getElementById('harbor-page-chat')) {
  console.log('[Harbor Page Chat] Already injected, skipping');
} else {
  initPageChat();
}

function initPageChat() {
  console.log('[Harbor Page Chat] Initializing...');

  // Create the sidebar container
  const sidebar = document.createElement('div');
  sidebar.id = 'harbor-page-chat';
  sidebar.innerHTML = getSidebarHTML();
  document.body.appendChild(sidebar);

  // Add styles
  const styles = document.createElement('style');
  styles.textContent = getSidebarCSS();
  document.head.appendChild(styles);

  // Initialize state
  let isOpen = true;
  let isConnected = false;
  let isProcessing = false;
  let pageContext = '';

  // DOM references
  const container = document.getElementById('harbor-page-chat')!;
  const toggleBtn = container.querySelector('#hpc-toggle') as HTMLButtonElement;
  const closeBtn = container.querySelector('#hpc-close') as HTMLButtonElement;
  const panel = container.querySelector('.hpc-panel') as HTMLDivElement;
  const connectBtn = container.querySelector('#hpc-connect') as HTMLButtonElement;
  const setupOverlay = container.querySelector('.hpc-setup') as HTMLDivElement;
  const setupError = container.querySelector('#hpc-setup-error') as HTMLDivElement;
  const messagesContainer = container.querySelector('#hpc-messages') as HTMLDivElement;
  const emptyState = container.querySelector('.hpc-empty') as HTMLDivElement;
  const inputArea = container.querySelector('#hpc-input') as HTMLTextAreaElement;
  const sendBtn = container.querySelector('#hpc-send') as HTMLButtonElement;
  const statusDot = container.querySelector('#hpc-status-dot') as HTMLSpanElement;
  const statusText = container.querySelector('#hpc-status-text') as HTMLSpanElement;

  // Toggle sidebar
  toggleBtn.addEventListener('click', () => {
    isOpen = !isOpen;
    panel.classList.toggle('hpc-hidden', !isOpen);
    toggleBtn.textContent = isOpen ? '💬' : '💬';
    toggleBtn.title = isOpen ? 'Hide chat' : 'Show chat';
  });

  closeBtn.addEventListener('click', () => {
    container.remove();
    styles.remove();
  });

  // Connect to Web Agent API
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="hpc-spinner"></span> Connecting...';
    setupError.style.display = 'none';

    try {
      // Check for Web Agent API
      if (!(window as any).ai || !(window as any).agent) {
        throw new Error('Web Agent API not found. Make sure Harbor is installed and enabled.');
      }

      // Request permissions
      const result = await (window as any).agent.requestPermissions({
        scopes: ['model:prompt'],
        reason: 'Chat about this page content'
      });

      if (!result.granted) {
        throw new Error('Permission denied. Please allow access to continue.');
      }

      // Test LLM
      const session = await (window as any).ai.createTextSession();
      await session.destroy();

      // Success
      isConnected = true;
      pageContext = getPageContext();

      setupOverlay.style.display = 'none';
      statusDot.classList.add('hpc-connected');
      statusText.textContent = 'Connected';
      inputArea.disabled = false;
      sendBtn.disabled = false;
      inputArea.focus();

    } catch (err: any) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Try Again';
      setupError.textContent = err.message;
      setupError.style.display = 'block';
      statusDot.classList.add('hpc-error');
      statusText.textContent = 'Error';
    }
  });

  // Get page context
  function getPageContext(): string {
    // Try to get main content
    const article = document.querySelector('article');
    const main = document.querySelector('main');
    const content = article || main || document.body;
    
    // Clean up the text
    let text = content.innerText;
    
    // Truncate if too long (keep first ~4000 chars for context window)
    if (text.length > 4000) {
      text = text.substring(0, 4000) + '\n\n[Content truncated...]';
    }
    
    return text;
  }

  // Send message
  async function sendMessage(content: string) {
    if (!content.trim() || !isConnected || isProcessing) return;

    isProcessing = true;
    sendBtn.disabled = true;
    inputArea.value = '';
    autoResize();

    addMessage('user', content);
    addThinking();

    try {
      const systemPrompt = `You are a helpful assistant that answers questions about the content on this webpage.
Be concise and helpful. Reference specific parts of the content when relevant.

Page URL: ${window.location.href}
Page Title: ${document.title}

Here is the page content:
---
${pageContext}
---`;

      const session = await (window as any).ai.createTextSession({
        systemPrompt
      });

      let responseText = '';
      let messageEl: HTMLElement | null = null;

      for await (const chunk of session.promptStreaming(content)) {
        responseText = chunk;

        if (!messageEl) {
          removeThinking();
          messageEl = addMessage('assistant', responseText);
        } else {
          updateMessageBody(messageEl, responseText);
        }
        scrollToBottom();
      }

      await session.destroy();
      removeThinking();

      if (!messageEl && !responseText) {
        addMessage('assistant', '(No response)');
      }

    } catch (err: any) {
      removeThinking();
      addMessage('assistant', `Error: ${err.message}`);
    }

    isProcessing = false;
    sendBtn.disabled = false;
    inputArea.focus();
  }

  // Message helpers
  function addMessage(role: string, content: string): HTMLElement {
    emptyState.style.display = 'none';

    const messageEl = document.createElement('div');
    messageEl.className = `hpc-message hpc-${role}`;

    const avatar = role === 'user' ? 'U' : 'H';
    const roleName = role === 'user' ? 'You' : 'Harbor';

    messageEl.innerHTML = `
      <div class="hpc-msg-header">
        <div class="hpc-avatar">${avatar}</div>
        <span class="hpc-role">${roleName}</span>
      </div>
      <div class="hpc-msg-body">${escapeHtml(content)}</div>
    `;

    messagesContainer.appendChild(messageEl);
    scrollToBottom();
    return messageEl;
  }

  function updateMessageBody(el: HTMLElement, content: string) {
    const body = el.querySelector('.hpc-msg-body');
    if (body) {
      body.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    }
  }

  function addThinking() {
    removeThinking();
    emptyState.style.display = 'none';

    const el = document.createElement('div');
    el.className = 'hpc-message hpc-assistant';
    el.id = 'hpc-thinking';
    el.innerHTML = `
      <div class="hpc-msg-header">
        <div class="hpc-avatar">H</div>
        <span class="hpc-role">Harbor</span>
      </div>
      <div class="hpc-thinking">
        <span></span><span></span><span></span>
      </div>
    `;
    messagesContainer.appendChild(el);
    scrollToBottom();
  }

  function removeThinking() {
    const el = document.getElementById('hpc-thinking');
    if (el) el.remove();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function autoResize() {
    inputArea.style.height = 'auto';
    inputArea.style.height = Math.min(inputArea.scrollHeight, 100) + 'px';
  }

  // Event listeners
  inputArea.addEventListener('input', autoResize);

  inputArea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputArea.value);
    }
  });

  sendBtn.addEventListener('click', () => {
    sendMessage(inputArea.value);
  });

  // Suggestion chips
  container.querySelectorAll('.hpc-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if (prompt && isConnected) {
        sendMessage(prompt);
      }
    });
  });

  // Check if API is available
  if ((window as any).ai && (window as any).agent) {
    statusText.textContent = 'Ready';
  } else {
    statusDot.classList.add('hpc-error');
    statusText.textContent = 'No API';
  }

  console.log('[Harbor Page Chat] Ready');
}

function getSidebarHTML(): string {
  return `
    <button id="hpc-toggle" class="hpc-toggle" title="Chat about this page">💬</button>
    <div class="hpc-panel">
      <div class="hpc-header">
        <div class="hpc-header-left">
          <div class="hpc-logo">⚓</div>
          <div class="hpc-header-text">
            <div class="hpc-title">Harbor</div>
            <div class="hpc-subtitle">Chat about this page</div>
          </div>
        </div>
        <div class="hpc-header-right">
          <span id="hpc-status-dot" class="hpc-dot"></span>
          <span id="hpc-status-text" class="hpc-status">Checking...</span>
          <button id="hpc-close" class="hpc-close" title="Close">×</button>
        </div>
      </div>
      
      <div class="hpc-setup">
        <div class="hpc-setup-content">
          <div class="hpc-setup-icon">💬</div>
          <h3 class="hpc-setup-title">Chat About This Page</h3>
          <p class="hpc-setup-desc">Ask questions about the content on this page.</p>
          <button id="hpc-connect" class="hpc-connect-btn">Connect to AI</button>
          <div id="hpc-setup-error" class="hpc-error-msg" style="display: none;"></div>
        </div>
      </div>
      
      <div id="hpc-messages" class="hpc-messages">
        <div class="hpc-empty">
          <div class="hpc-empty-icon">💭</div>
          <h4>Ask Me Anything</h4>
          <p>I can help you understand this page.</p>
          <div class="hpc-chips">
            <button class="hpc-chip" data-prompt="Summarize this page in 3 bullet points">📝 Summarize</button>
            <button class="hpc-chip" data-prompt="What is the main topic of this page?">🎯 Main topic</button>
            <button class="hpc-chip" data-prompt="What are the key takeaways from this page?">💡 Key takeaways</button>
          </div>
        </div>
      </div>
      
      <div class="hpc-input-area">
        <textarea id="hpc-input" placeholder="Ask about this page..." rows="1" disabled></textarea>
        <button id="hpc-send" class="hpc-send-btn" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function getSidebarCSS(): string {
  return `
    #harbor-page-chat {
      --hpc-bg: #0e0e14;
      --hpc-surface: #1a1a24;
      --hpc-border: rgba(255,255,255,0.1);
      --hpc-text: #f0f0f5;
      --hpc-text-dim: #a0a0b0;
      --hpc-text-muted: #606070;
      --hpc-accent: #8b5cf6;
      --hpc-accent-glow: rgba(139,92,246,0.25);
      --hpc-success: #22c55e;
      --hpc-error: #ef4444;
      --hpc-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --hpc-mono: ui-monospace, 'SF Mono', monospace;
      
      position: fixed;
      top: 0;
      right: 0;
      height: 100vh;
      z-index: 2147483647;
      font-family: var(--hpc-font);
      font-size: 14px;
      line-height: 1.5;
      color: var(--hpc-text);
    }
    
    .hpc-toggle {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--hpc-accent), #ec4899);
      border: none;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 4px 20px var(--hpc-accent-glow);
      transition: all 0.2s;
      z-index: 1;
    }
    
    .hpc-toggle:hover {
      transform: scale(1.1);
    }
    
    .hpc-panel {
      position: absolute;
      top: 0;
      right: 0;
      width: 360px;
      height: 100vh;
      background: var(--hpc-bg);
      border-left: 1px solid var(--hpc-border);
      display: flex;
      flex-direction: column;
      transition: transform 0.3s ease;
    }
    
    .hpc-panel.hpc-hidden {
      transform: translateX(100%);
    }
    
    .hpc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--hpc-border);
      background: var(--hpc-surface);
    }
    
    .hpc-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .hpc-logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--hpc-accent), #ec4899);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    
    .hpc-title {
      font-weight: 700;
      font-size: 15px;
    }
    
    .hpc-subtitle {
      font-size: 11px;
      color: var(--hpc-text-muted);
    }
    
    .hpc-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--hpc-text-muted);
    }
    
    .hpc-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--hpc-text-muted);
    }
    
    .hpc-dot.hpc-connected {
      background: var(--hpc-success);
    }
    
    .hpc-dot.hpc-error {
      background: var(--hpc-error);
    }
    
    .hpc-close {
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: var(--hpc-text-muted);
      font-size: 18px;
      cursor: pointer;
      border-radius: 4px;
      margin-left: 4px;
    }
    
    .hpc-close:hover {
      background: var(--hpc-surface);
      color: var(--hpc-text);
    }
    
    .hpc-setup {
      position: absolute;
      inset: 0;
      top: 56px;
      background: rgba(14,14,20,0.98);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    
    .hpc-setup-content {
      text-align: center;
      padding: 24px;
      max-width: 280px;
    }
    
    .hpc-setup-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, var(--hpc-accent), #ec4899);
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      margin: 0 auto 16px;
      box-shadow: 0 0 30px var(--hpc-accent-glow);
    }
    
    .hpc-setup-title {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    
    .hpc-setup-desc {
      font-size: 14px;
      color: var(--hpc-text-dim);
      margin: 0 0 20px;
    }
    
    .hpc-connect-btn {
      width: 100%;
      padding: 12px 20px;
      background: linear-gradient(135deg, var(--hpc-accent), #a855f7);
      border: none;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    
    .hpc-connect-btn:hover:not(:disabled) {
      filter: brightness(1.1);
      box-shadow: 0 0 20px var(--hpc-accent-glow);
    }
    
    .hpc-connect-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .hpc-error-msg {
      margin-top: 16px;
      padding: 12px;
      background: rgba(239,68,68,0.15);
      border-radius: 8px;
      color: var(--hpc-error);
      font-size: 13px;
    }
    
    .hpc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    
    .hpc-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
    }
    
    .hpc-empty-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--hpc-accent), #ec4899);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      margin-bottom: 12px;
      opacity: 0.8;
    }
    
    .hpc-empty h4 {
      font-size: 16px;
      margin: 0 0 4px;
    }
    
    .hpc-empty p {
      font-size: 13px;
      color: var(--hpc-text-muted);
      margin: 0 0 16px;
    }
    
    .hpc-chips {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    
    .hpc-chip {
      padding: 10px 14px;
      background: var(--hpc-surface);
      border: 1px solid var(--hpc-border);
      border-radius: 8px;
      color: var(--hpc-text-dim);
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s;
    }
    
    .hpc-chip:hover {
      background: rgba(255,255,255,0.05);
      border-color: var(--hpc-accent);
      color: var(--hpc-text);
    }
    
    .hpc-message {
      margin-bottom: 16px;
      animation: hpc-fadeIn 0.2s ease;
    }
    
    @keyframes hpc-fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .hpc-msg-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    
    .hpc-avatar {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
    }
    
    .hpc-user .hpc-avatar {
      background: linear-gradient(135deg, var(--hpc-accent), #a855f7);
      color: white;
    }
    
    .hpc-assistant .hpc-avatar {
      background: var(--hpc-surface);
      border: 1px solid var(--hpc-border);
      color: var(--hpc-text-dim);
    }
    
    .hpc-role {
      font-size: 12px;
      font-weight: 600;
    }
    
    .hpc-msg-body {
      margin-left: 32px;
      font-size: 13px;
      line-height: 1.6;
      color: var(--hpc-text-dim);
    }
    
    .hpc-thinking {
      display: flex;
      gap: 4px;
      margin-left: 32px;
    }
    
    .hpc-thinking span {
      width: 6px;
      height: 6px;
      background: var(--hpc-accent);
      border-radius: 50%;
      animation: hpc-pulse 1.2s infinite;
    }
    
    .hpc-thinking span:nth-child(2) { animation-delay: 0.15s; }
    .hpc-thinking span:nth-child(3) { animation-delay: 0.3s; }
    
    @keyframes hpc-pulse {
      0%, 100% { opacity: 0.3; transform: scale(0.8); }
      50% { opacity: 1; transform: scale(1); }
    }
    
    .hpc-input-area {
      display: flex;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--hpc-border);
      background: var(--hpc-surface);
    }
    
    #hpc-input {
      flex: 1;
      background: var(--hpc-bg);
      border: 1px solid var(--hpc-border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--hpc-text);
      font-size: 13px;
      font-family: var(--hpc-font);
      resize: none;
      min-height: 20px;
      max-height: 100px;
    }
    
    #hpc-input:focus {
      outline: none;
      border-color: var(--hpc-accent);
      box-shadow: 0 0 0 3px var(--hpc-accent-glow);
    }
    
    #hpc-input::placeholder {
      color: var(--hpc-text-muted);
    }
    
    #hpc-input:disabled {
      opacity: 0.5;
    }
    
    .hpc-send-btn {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, var(--hpc-accent), #a855f7);
      border: none;
      border-radius: 8px;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    
    .hpc-send-btn:hover:not(:disabled) {
      filter: brightness(1.1);
    }
    
    .hpc-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .hpc-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: hpc-spin 0.8s linear infinite;
    }
    
    @keyframes hpc-spin {
      to { transform: rotate(360deg); }
    }
    
    /* Scrollbar */
    .hpc-messages::-webkit-scrollbar {
      width: 6px;
    }
    
    .hpc-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .hpc-messages::-webkit-scrollbar-thumb {
      background: var(--hpc-border);
      border-radius: 3px;
    }
    
    /* Mobile */
    @media (max-width: 768px) {
      .hpc-panel {
        width: 100%;
      }
    }
  `;
}
