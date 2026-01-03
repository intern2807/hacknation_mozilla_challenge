/**
 * Harbor JS AI Provider - Permission Prompt
 * 
 * Handles the permission dialog UI and communicates decisions back to the background script.
 * Dynamically adapts to the user's Firefox theme using browser.theme API.
 */

import browser from 'webextension-polyfill';
import type { PermissionScope } from './provider/types';

// =============================================================================
// Theme Integration - Dynamic Firefox Theme Colors
// =============================================================================

interface ThemeColors {
  // Popup/Panel colors
  popup?: string;
  popup_text?: string;
  popup_border?: string;
  popup_highlight?: string;
  popup_highlight_text?: string;
  
  // Toolbar colors
  toolbar?: string;
  toolbar_text?: string;
  toolbar_field?: string;
  toolbar_field_text?: string;
  
  // Frame colors
  frame?: string;
  tab_background_text?: string;
  
  // Button colors
  button_background_hover?: string;
  button_background_active?: string;
  
  // Accent/icons
  icons?: string;
  icons_attention?: string;
  
  // Other
  ntp_background?: string;
  ntp_text?: string;
  sidebar?: string;
  sidebar_text?: string;
}

/**
 * Apply Firefox theme colors to CSS custom properties.
 * This makes the permission prompt match the user's Firefox theme.
 */
async function applyThemeColors(): Promise<void> {
  try {
    const theme = await browser.theme.getCurrent();
    const colors = theme.colors as ThemeColors | undefined;
    
    if (!colors) {
      console.log('[Permission Prompt] No theme colors available, using CSS fallbacks');
      return;
    }
    
    const root = document.documentElement;
    
    // Popup/Panel colors
    if (colors.popup) {
      root.style.setProperty('--popup-background', colors.popup);
    }
    if (colors.popup_text) {
      root.style.setProperty('--popup-text', colors.popup_text);
      // Derive secondary text color (slightly faded)
      root.style.setProperty('--text-secondary', `color-mix(in srgb, ${colors.popup_text} 70%, transparent)`);
    }
    if (colors.popup_border) {
      root.style.setProperty('--popup-border', colors.popup_border);
    }
    
    // Toolbar colors
    if (colors.toolbar) {
      root.style.setProperty('--toolbar-background', colors.toolbar);
      root.style.setProperty('--button-background', colors.toolbar);
      // Derive surface-alt from toolbar
      root.style.setProperty('--surface-alt', colors.toolbar);
    }
    if (colors.toolbar_text) {
      root.style.setProperty('--toolbar-text', colors.toolbar_text);
      root.style.setProperty('--button-text', colors.toolbar_text);
    }
    
    // Frame colors (can affect overall appearance)
    if (colors.frame) {
      root.style.setProperty('--frame-background', colors.frame);
    }
    
    // Button hover/active states
    if (colors.button_background_hover) {
      root.style.setProperty('--button-hover', colors.button_background_hover);
    }
    if (colors.button_background_active) {
      root.style.setProperty('--button-active', colors.button_background_active);
    }
    
    // Icons/Accent color - use for primary accent
    if (colors.icons_attention) {
      root.style.setProperty('--accent-color', colors.icons_attention);
      root.style.setProperty('--link-color', colors.icons_attention);
      root.style.setProperty('--focus-outline', colors.icons_attention);
    } else if (colors.icons) {
      root.style.setProperty('--link-color', colors.icons);
    }
    
    // Popup highlight for selections
    if (colors.popup_highlight) {
      root.style.setProperty('--accent-color', colors.popup_highlight);
    }
    if (colors.popup_highlight_text) {
      root.style.setProperty('--accent-text', colors.popup_highlight_text);
    }
    
    // Derive separator color from popup text
    if (colors.popup_text) {
      root.style.setProperty('--separator', `color-mix(in srgb, ${colors.popup_text} 15%, transparent)`);
    }
    
    console.log('[Permission Prompt] Applied theme colors:', colors);
  } catch (err) {
    console.warn('[Permission Prompt] Failed to get theme colors:', err);
    // CSS fallbacks will be used
  }
}

/**
 * Listen for theme changes and reapply colors.
 */
function listenForThemeChanges(): void {
  try {
    browser.theme.onUpdated.addListener((updateInfo) => {
      console.log('[Permission Prompt] Theme updated, reapplying colors');
      applyThemeColors();
    });
  } catch (err) {
    console.warn('[Permission Prompt] Could not listen for theme changes:', err);
  }
}

// Scope icons and descriptions
const SCOPE_INFO: Record<PermissionScope, { icon: string; iconClass: string; description: string }> = {
  'model:prompt': {
    icon: 'AI',
    iconClass: 'model',
    description: 'Generate text using AI models',
  },
  'model:tools': {
    icon: '⚡',
    iconClass: 'model',
    description: 'Use AI with tool calling capabilities',
  },
  'mcp:tools.list': {
    icon: '📋',
    iconClass: 'tools',
    description: 'List available MCP tools',
  },
  'mcp:tools.call': {
    icon: '🔧',
    iconClass: 'tools',
    description: 'Execute MCP tools on your behalf',
  },
  'browser:activeTab.read': {
    icon: '👁',
    iconClass: 'browser',
    description: 'Read content from the currently active browser tab',
  },
  'web:fetch': {
    icon: '🌐',
    iconClass: 'browser',
    description: 'Make web requests on your behalf (not implemented)',
  },
};

// =============================================================================
// Parse URL Parameters
// =============================================================================

function parseParams(): { promptId: string; origin: string; scopes: PermissionScope[]; reason: string; tools: string[] } {
  const params = new URLSearchParams(window.location.search);
  
  const promptId = params.get('promptId') || '';
  const origin = params.get('origin') || 'Unknown origin';
  const reason = params.get('reason') || '';
  
  let scopes: PermissionScope[] = [];
  try {
    scopes = JSON.parse(params.get('scopes') || '[]');
  } catch {
    console.error('Failed to parse scopes');
  }
  
  let tools: string[] = [];
  try {
    const toolsParam = params.get('tools');
    if (toolsParam) {
      tools = JSON.parse(toolsParam);
    }
  } catch {
    console.error('Failed to parse tools');
  }
  
  return { promptId, origin, scopes, reason, tools };
}

// =============================================================================
// Render UI
// =============================================================================

function renderUI(): void {
  const { origin, scopes, reason, tools } = parseParams();
  
  // Set origin
  const originEl = document.getElementById('origin');
  if (originEl) {
    originEl.textContent = origin;
  }
  
  // Set reason if provided
  const reasonContainer = document.getElementById('reason-container');
  const reasonEl = document.getElementById('reason');
  if (reason && reasonContainer && reasonEl) {
    reasonEl.textContent = reason;
    reasonContainer.style.display = 'block';
  }
  
  // Render scopes
  const scopeList = document.getElementById('scope-list');
  if (scopeList) {
    scopeList.innerHTML = scopes.map(scope => {
      const info = SCOPE_INFO[scope] || {
        icon: '?',
        iconClass: 'model',
        description: scope,
      };
      
      return `
        <div class="scope-item">
          <div class="scope-icon ${info.iconClass}">${info.icon}</div>
          <div class="scope-info">
            <div class="scope-name">${escapeHtml(scope)}</div>
            <div class="scope-description">${escapeHtml(info.description)}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Render tools section if mcp:tools.call is requested and tools are available
  if (scopes.includes('mcp:tools.call') && tools.length > 0) {
    renderToolsUI(tools);
  }
}

function renderToolsUI(tools: string[]): void {
  const section = document.getElementById('tools-section');
  const list = document.getElementById('tools-list');
  if (!section || !list) return;
  
  section.style.display = 'block';
  
  list.innerHTML = tools.map(tool => {
    const slashIndex = tool.indexOf('/');
    const serverId = slashIndex > -1 ? tool.slice(0, slashIndex) : 'unknown';
    const toolName = slashIndex > -1 ? tool.slice(slashIndex + 1) : tool;
    
    return `
      <label class="tool-item">
        <input type="checkbox" class="tool-checkbox" value="${escapeHtml(tool)}" checked>
        <div class="tool-info">
          <div class="tool-name">${escapeHtml(toolName)}</div>
          <div class="tool-server">${escapeHtml(serverId)}</div>
        </div>
      </label>
    `;
  }).join('');
  
  // Add select all / none handlers
  document.getElementById('select-all')?.addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('.tool-checkbox').forEach(cb => {
      cb.checked = true;
    });
  });
  
  document.getElementById('select-none')?.addEventListener('click', () => {
    list.querySelectorAll<HTMLInputElement>('.tool-checkbox').forEach(cb => {
      cb.checked = false;
    });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// Decision Handling
// =============================================================================

function getSelectedTools(): string[] | undefined {
  const { tools } = parseParams();
  if (tools.length === 0) return undefined;
  
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.tool-checkbox:checked');
  const selected = Array.from(checkboxes).map(cb => cb.value);
  
  // If all tools are selected, return undefined (means all allowed)
  if (selected.length === tools.length) {
    return undefined;
  }
  
  return selected;
}

async function sendDecision(decision: 'allow-once' | 'allow-always' | 'deny'): Promise<void> {
  const { promptId, tools } = parseParams();
  
  console.log('[Permission Prompt] Sending decision:', { promptId, decision });
  
  // Get selected tools (only relevant if not denying)
  let allowedTools: string[] | undefined;
  if (decision !== 'deny' && tools.length > 0) {
    allowedTools = getSelectedTools();
    
    // If no tools selected but tools were available, show warning
    const checkboxes = document.querySelectorAll<HTMLInputElement>('.tool-checkbox:checked');
    if (checkboxes.length === 0) {
      const proceed = confirm('No tools selected. The site will not be able to call any tools. Continue?');
      if (!proceed) return;
      allowedTools = []; // Empty array means no tools allowed
    }
  }
  
  try {
    // Send decision to background script
    const response = await browser.runtime.sendMessage({
      type: 'provider_permission_response',
      promptId,
      decision,
      allowedTools,
    });
    console.log('[Permission Prompt] Response received:', response);
    
    // Close this popup window
    window.close();
  } catch (err) {
    console.error('[Permission Prompt] Failed to send permission decision:', err);
    // Show error to user
    alert('Failed to save permission decision. Please close this window and try again.');
  }
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupListeners(): void {
  document.getElementById('allow-always')?.addEventListener('click', () => {
    sendDecision('allow-always');
  });
  
  document.getElementById('allow-once')?.addEventListener('click', () => {
    sendDecision('allow-once');
  });
  
  document.getElementById('deny')?.addEventListener('click', () => {
    sendDecision('deny');
  });
  
  // Handle window close (treat as deny)
  window.addEventListener('beforeunload', () => {
    // Note: We can't reliably send async messages here, so the background
    // script should have a timeout to handle cases where the user just closes the window
  });
}

// =============================================================================
// Initialize
// =============================================================================

async function init(): Promise<void> {
  // Apply Firefox theme colors dynamically
  await applyThemeColors();
  listenForThemeChanges();
  
  // Render UI and setup event listeners
  renderUI();
  setupListeners();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

