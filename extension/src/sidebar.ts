// Make this a module to avoid global scope conflicts
export {};

type ServerStatus = {
  id: string;
  name: string;
  version: string;
  runtime?: 'wasm' | 'js';
  entrypoint?: string;
  tools?: Array<{ name: string }>;
  running: boolean;
};

type BridgeStatus = {
  ok: boolean;
  connected: boolean;
  lastCheck: number;
  error: string | null;
};

type ProviderInfo = {
  id: string;
  type: string;
  name: string;
  configured: boolean;
  needs_api_key: boolean;
  is_local: boolean;
  is_default: boolean;
  is_type_default: boolean;
  has_api_key: boolean;
  base_url?: string;
  available?: boolean;
};

type LlmConfig = {
  version: number;
  default_model?: string;
  default_provider?: string;
  providers: Record<string, {
    id: string;
    type: string;
    name: string;
    enabled: boolean;
    has_api_key: boolean;
    base_url?: string;
    is_type_default: boolean;
  }>;
};


type ModelInfo = {
  id: string;
  provider?: string;
  owned_by?: string;
};

type ConfiguredModel = {
  name: string;
  model_id: string;
  is_default: boolean;
};

// Header elements
const headerLogo = document.getElementById('header-logo') as HTMLDivElement;

// Server elements
const serversEl = document.getElementById('servers') as HTMLDivElement;
const addBtn = document.getElementById('add') as HTMLButtonElement;
const fileInput = document.getElementById('file') as HTMLInputElement;

// Bridge status elements
const bridgeStatusIndicator = document.getElementById('bridge-status-indicator') as HTMLDivElement;
const bridgeStatusText = document.getElementById('bridge-status-text') as HTMLSpanElement;

// LLM elements
const llmPanelHeader = document.getElementById('llm-panel-header') as HTMLDivElement;
const llmPanelToggle = document.getElementById('llm-panel-toggle') as HTMLSpanElement;
const llmPanelBody = document.getElementById('llm-panel-body') as HTMLDivElement;
const llmStatusIndicator = document.getElementById('llm-status-indicator') as HTMLDivElement;
const llmStatusText = document.getElementById('llm-status-text') as HTMLSpanElement;
const configuredModelsEl = document.getElementById('configured-models') as HTMLDivElement;
const availableModelsSelect = document.getElementById('available-models') as HTMLSelectElement;
const addModelBtn = document.getElementById('add-model-btn') as HTMLButtonElement;
const providersCountEl = document.getElementById('providers-count') as HTMLSpanElement;
const detectedProvidersEl = document.getElementById('detected-providers') as HTMLDivElement;
const apiKeyConfig = document.getElementById('api-key-config') as HTMLDivElement;
const apiKeyProviderName = document.getElementById('api-key-provider-name') as HTMLSpanElement;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const apiKeySaveBtn = document.getElementById('api-key-save') as HTMLButtonElement;
const apiKeyCancelBtn = document.getElementById('api-key-cancel') as HTMLButtonElement;
const serversPanelHeader = document.getElementById('servers-panel-header') as HTMLDivElement;
const serversPanelToggle = document.getElementById('servers-panel-toggle') as HTMLSpanElement;

// Track which provider is being configured
let configuringProviderId: string | null = null;

// Cache available models
let cachedAvailableModels: ModelInfo[] = [];

// Bridge status polling
const BRIDGE_STATUS_POLL_INTERVAL = 5000; // 5 seconds

// =============================================================================
// Theme Management
// =============================================================================

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  const effectiveTheme = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  localStorage.setItem('harbor-theme', theme);
  updateThemeToggle(theme);
}

function updateThemeToggle(theme: Theme): void {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  
  const icons: Record<Theme, string> = { light: '☀️', dark: '🌙', system: '🖥️' };
  btn.textContent = icons[theme];
  btn.title = `Theme: ${theme} (click to change)`;
}

function initTheme(): void {
  const saved = localStorage.getItem('harbor-theme') as Theme | null;
  const theme = saved || 'system';
  applyTheme(theme);
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = localStorage.getItem('harbor-theme') as Theme | null;
    if (current === 'system' || !current) {
      applyTheme('system');
    }
  });
}

function cycleTheme(): void {
  const current = localStorage.getItem('harbor-theme') as Theme | null || 'system';
  const order: Theme[] = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(current) + 1) % order.length];
  applyTheme(next);
}

// Initialize theme on load
initTheme();

// =============================================================================
// Toast notification helper
// =============================================================================

function showToast(message: string, type: 'info' | 'error' | 'success' = 'info', duration = 3000): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type !== 'info' ? type : ''}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), duration);
}

// =============================================================================
// Header Logo - Open about:debugging or copy to clipboard
// =============================================================================

const DEBUGGING_URL = 'about:debugging#/runtime/this-firefox';

headerLogo.addEventListener('click', async () => {
  try {
    // Try to open the URL in a new tab
    // Note: Firefox extensions cannot directly open about: URLs via tabs.create
    // So we copy to clipboard as the fallback
    await navigator.clipboard.writeText(DEBUGGING_URL);
    showToast('Copied debugging URL to clipboard');
  } catch (err) {
    console.error('[Sidebar] Failed to copy to clipboard:', err);
    showToast('Failed to copy URL');
  }
});

function updateBridgeStatusUI(connected: boolean, error?: string | null): void {
  if (connected) {
    bridgeStatusIndicator.className = 'status-indicator connected';
    bridgeStatusText.className = 'status-text connected';
    bridgeStatusText.textContent = 'Connected';
  } else {
    bridgeStatusIndicator.className = 'status-indicator disconnected';
    bridgeStatusText.className = 'status-text disconnected';
    bridgeStatusText.textContent = 'Disconnected';
    if (error) {
      bridgeStatusText.title = error;
    }
  }
}

async function checkBridgeStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'bridge_check_health' }) as BridgeStatus;
    updateBridgeStatusUI(response.connected, response.error);
  } catch (err) {
    console.error('[Sidebar] Failed to check bridge status:', err);
    updateBridgeStatusUI(false, err instanceof Error ? err.message : 'Unknown error');
  }
}

function startBridgeStatusPolling(): void {
  // Initial check
  checkBridgeStatus();
  // Periodic polling
  setInterval(checkBridgeStatus, BRIDGE_STATUS_POLL_INTERVAL);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function renderServer(server: ServerStatus): HTMLElement {
  const item = document.createElement('div');
  item.className = 'server';

  // Row 1: Header with name, badge, and action buttons
  const header = document.createElement('div');
  header.className = 'server-title';

  const nameContainer = document.createElement('span');
  nameContainer.style.display = 'flex';
  nameContainer.style.alignItems = 'center';
  nameContainer.style.gap = '6px';

  const name = document.createElement('span');
  name.textContent = server.name;
  nameContainer.appendChild(name);

  // Show runtime badge (JS or WASM)
  const runtimeBadge = document.createElement('span');
  runtimeBadge.className = 'badge badge-muted';
  runtimeBadge.textContent = server.runtime === 'js' ? 'JS' : 'WASM';
  nameContainer.appendChild(runtimeBadge);

  // Action buttons container
  const actions = document.createElement('span');
  actions.className = 'server-actions';

  if (!server.running) {
    const startButton = document.createElement('button');
    startButton.className = 'btn btn-secondary btn-sm';
    startButton.textContent = 'Start';
    startButton.addEventListener('click', async () => {
      startButton.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: 'sidebar_validate_server',
        serverId: server.id,
      });
      if (!response?.ok) {
        console.error(response?.error || 'Failed to start server');
      }
      await loadServers();
      startButton.disabled = false;
    });
    actions.appendChild(startButton);
  } else {
    const stopButton = document.createElement('button');
    stopButton.className = 'btn btn-secondary btn-sm';
    stopButton.textContent = 'Stop';
    stopButton.addEventListener('click', async () => {
      stopButton.disabled = true;
      const response = await chrome.runtime.sendMessage({
        type: 'sidebar_stop_server',
        serverId: server.id,
      });
      if (!response?.ok) {
        console.error(response?.error || 'Failed to stop server');
      }
      await loadServers();
      stopButton.disabled = false;
    });
    actions.appendChild(stopButton);
  }

  const removeButton = document.createElement('button');
  removeButton.className = 'btn btn-ghost btn-sm';
  removeButton.textContent = 'Unload';
  removeButton.addEventListener('click', async () => {
    removeButton.disabled = true;
    const response = await chrome.runtime.sendMessage({
      type: 'sidebar_remove_server',
      serverId: server.id,
    });
    if (!response?.ok) {
      console.error(response?.error || 'Failed to remove server');
    }
    await loadServers();
    removeButton.disabled = false;
  });
  actions.appendChild(removeButton);

  header.appendChild(nameContainer);
  header.appendChild(actions);

  // Row 2: Status and tools info
  const meta = document.createElement('div');
  meta.className = 'server-meta';
  
  const statusDot = document.createElement('span');
  statusDot.className = `status-dot ${server.running ? 'status-running' : 'status-stopped'}`;
  meta.appendChild(statusDot);
  
  const statusText = document.createElement('span');
  statusText.textContent = server.running ? 'Running' : 'Stopped';
  statusText.style.marginRight = '12px';
  meta.appendChild(statusText);
  
  const toolNames = (server.tools || []).map((tool) => tool.name).join(', ');
  if (toolNames.length > 0) {
    const toolsText = document.createElement('span');
    toolsText.textContent = `Tools: ${toolNames}`;
    toolsText.style.color = 'var(--color-text-muted)';
    meta.appendChild(toolsText);
  }

  item.appendChild(header);
  item.appendChild(meta);
  return item;
}

async function loadServers(): Promise<void> {
  serversEl.innerHTML = '';
  const response = await chrome.runtime.sendMessage({ type: 'sidebar_get_servers' });
  if (!response?.ok) {
    serversEl.textContent = response?.error || 'Failed to load servers';
    return;
  }
  const servers = response.servers as ServerStatus[];
  if (!servers || servers.length === 0) {
    serversEl.textContent = 'No servers installed.';
    return;
  }
  servers.forEach((server) => serversEl.appendChild(renderServer(server)));
}

// Theme toggle
const themeToggle = document.getElementById('theme-toggle');
themeToggle?.addEventListener('click', cycleTheme);

addBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    return;
  }

  let manifest: Record<string, unknown>;

  if (file.name.endsWith('.json')) {
    // Handle JSON manifest file
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      
      // Validate required fields
      if (!parsed.id && !parsed.name) {
        showToast('Invalid manifest: missing id or name');
        fileInput.value = '';
        return;
      }
      
      manifest = {
        ...parsed,
        // Generate id if not provided
        id: parsed.id || `mcp-${Date.now()}`,
        // Default runtime to 'js' if scriptBase64 or scriptUrl present
        runtime: parsed.runtime || (parsed.scriptBase64 || parsed.scriptUrl ? 'js' : 'wasm'),
        permissions: parsed.permissions || [],
      };
      
      showToast(`Loading ${manifest.runtime === 'js' ? 'JS' : 'WASM'} server: ${manifest.name || manifest.id}`);
    } catch (e) {
      console.error('Failed to parse manifest:', e);
      showToast('Failed to parse JSON manifest');
      fileInput.value = '';
      return;
    }
  } else {
    // Handle WASM file (existing behavior)
    const bytes = await file.arrayBuffer();
    manifest = {
      id: `wasm-${Date.now()}`,
      name: file.name.replace(/\.wasm$/i, ''),
      version: '0.1.0',
      runtime: 'wasm',
      entrypoint: file.name,
      moduleBytesBase64: toBase64(bytes),
      permissions: [],
      tools: [],
    };
    showToast(`Loading WASM server: ${manifest.name}`);
  }

  const response = await chrome.runtime.sendMessage({
    type: 'sidebar_install_server',
    manifest,
  });
  if (!response?.ok) {
    console.error(response?.error || 'Failed to install server');
    showToast('Failed to install server');
  }
  fileInput.value = '';
  const validate = await chrome.runtime.sendMessage({
    type: 'sidebar_validate_server',
    serverId: manifest.id,
  });
  if (!validate?.ok) {
    console.error(validate?.error || 'Failed to validate server');
    showToast('Failed to start server: ' + (validate?.error || 'unknown error'));
  } else {
    showToast('Server installed and started');
  }
  await loadServers();
});

loadServers().catch((error) => {
  console.error('Failed to load servers', error);
});

// Start bridge status polling
startBridgeStatusPolling();

// =============================================================================
// Panel Toggle Logic
// =============================================================================

function setupPanelToggle(header: HTMLElement, toggle: HTMLElement, body: HTMLElement): void {
  header.addEventListener('click', () => {
    const isCollapsed = body.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed', isCollapsed);
  });
}

setupPanelToggle(llmPanelHeader, llmPanelToggle, llmPanelBody);
setupPanelToggle(serversPanelHeader, serversPanelToggle, serversEl);

// =============================================================================
// LLM Provider Management
// =============================================================================

function updateLlmHeaderStatus(availableCount: number): void {
  if (availableCount > 0) {
    llmStatusIndicator.className = 'status-indicator connected';
    llmStatusText.className = 'status-text connected';
    llmStatusText.textContent = `${availableCount} available`;
  } else {
    llmStatusIndicator.className = 'status-indicator disconnected';
    llmStatusText.className = 'status-text disconnected';
    llmStatusText.textContent = 'None available';
  }
}


function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Show API key configuration for a cloud provider
function showApiKeyConfig(providerType: string): void {
  configuringProviderId = providerType;
  apiKeyProviderName.textContent = `Configure ${capitalizeFirst(providerType)}`;
  apiKeyInput.value = '';
  apiKeyConfig.style.display = 'block';
  apiKeyInput.focus();
}

// Hide API key configuration
function hideApiKeyConfig(): void {
  configuringProviderId = null;
  apiKeyConfig.style.display = 'none';
  apiKeyInput.value = '';
}

// API Key save button
apiKeySaveBtn.addEventListener('click', async () => {
  if (!configuringProviderId || !apiKeyInput.value.trim()) return;

  apiKeySaveBtn.disabled = true;
  apiKeySaveBtn.textContent = 'Saving...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'llm_configure_provider',
      provider: configuringProviderId,
      name: capitalizeFirst(configuringProviderId),
      api_key: apiKeyInput.value.trim(),
      enabled: true,
    }) as { ok: boolean; id?: string; error?: string };
    
    if (response.ok) {
      showToast('API key saved');
      hideApiKeyConfig();
      await loadLlmProviders();
    } else {
      showToast('Failed to save: ' + (response.error || 'Unknown error'));
    }
  } catch (err) {
    showToast('Failed to save API key');
    console.error('Failed to save:', err);
  }

  apiKeySaveBtn.disabled = false;
  apiKeySaveBtn.textContent = 'Save';
});

// API Key cancel button
apiKeyCancelBtn.addEventListener('click', () => {
  hideApiKeyConfig();
});

async function loadLlmProviders(): Promise<void> {
  try {
    // Load configured models, available models, and providers in parallel
    const [configuredModelsRes, modelsRes, providersRes] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'llm_list_configured_models' }) as Promise<{
        ok: boolean;
        models?: ConfiguredModel[];
        error?: string;
      }>,
      chrome.runtime.sendMessage({ type: 'llm_list_models' }) as Promise<{
        ok: boolean;
        models?: ModelInfo[];
        error?: string;
      }>,
      chrome.runtime.sendMessage({ type: 'llm_list_providers' }) as Promise<{
        ok: boolean;
        providers?: ProviderInfo[];
        error?: string;
      }>,
    ]);

    // Handle configured models
    const configuredModels = configuredModelsRes.ok ? (configuredModelsRes.models || []) : [];
    renderConfiguredModels(configuredModels);

    // Handle available models for dropdown
    const availableModels = modelsRes.ok ? (modelsRes.models || []) : [];
    cachedAvailableModels = availableModels;
    renderAvailableModelsDropdown(availableModels, configuredModels);

    // Handle providers
    const providers = providersRes.ok ? (providersRes.providers || []) : [];
    const availableCount = providers.filter(p => p.available || (p.is_local && p.configured)).length;
    
    providersCountEl.textContent = String(availableCount);
    renderProviders(providers);

    // Update header status based on configured models
    if (configuredModels.length > 0) {
      llmStatusIndicator.className = 'status-indicator connected';
      llmStatusText.className = 'status-text connected';
      llmStatusText.textContent = `${configuredModels.length} model${configuredModels.length > 1 ? 's' : ''}`;
    } else if (availableModels.length > 0) {
      llmStatusIndicator.className = 'status-indicator connecting';
      llmStatusText.className = 'status-text connecting';
      llmStatusText.textContent = 'No models configured';
    } else {
      llmStatusIndicator.className = 'status-indicator disconnected';
      llmStatusText.className = 'status-text disconnected';
      llmStatusText.textContent = 'No models';
    }
    
  } catch (err) {
    console.error('[Sidebar] Failed to load LLM data:', err);
    llmStatusIndicator.className = 'status-indicator disconnected';
    llmStatusText.className = 'status-text disconnected';
    llmStatusText.textContent = 'Offline';
    configuredModelsEl.innerHTML = '<div class="no-models">Bridge not connected</div>';
  }
}

// Render configured models list
function renderConfiguredModels(models: ConfiguredModel[]): void {
  configuredModelsEl.innerHTML = '';
  
  if (models.length === 0) {
    configuredModelsEl.innerHTML = '<div class="no-models">No models configured. Add one below.</div>';
    return;
  }
  
  for (const model of models) {
    const el = document.createElement('div');
    el.className = `configured-model ${model.is_default ? 'is-default' : ''}`;
    
    el.innerHTML = `
      <div class="configured-model-info">
        <div class="configured-model-name">
          ${model.name}
          ${model.is_default ? '<span class="badge badge-success">Default</span>' : ''}
        </div>
        <div class="configured-model-id">${model.model_id}</div>
      </div>
      <div class="configured-model-actions">
        <button class="btn btn-ghost btn-sm test-model-btn" data-model="${model.model_id}" title="Test connection">⚡</button>
        ${!model.is_default ? `<button class="btn btn-ghost btn-sm set-default-model-btn" data-name="${model.name}" title="Set as default">★</button>` : ''}
        <button class="btn btn-ghost btn-sm remove-model-btn" data-name="${model.name}" title="Remove">✕</button>
      </div>
    `;
    
    configuredModelsEl.appendChild(el);
  }
  
  // Event listeners
  configuredModelsEl.querySelectorAll('.test-model-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const modelId = (btn as HTMLElement).dataset.model;
      if (!modelId) return;
      
      const originalText = btn.textContent;
      btn.textContent = '...';
      (btn as HTMLButtonElement).disabled = true;
      
      try {
        const result = await chrome.runtime.sendMessage({ 
          type: 'llm_test_model', 
          model: modelId 
        }) as { ok: boolean; response?: string; error?: string };
        
        if (result.ok) {
          showToast(`✓ Model works! Response: "${result.response?.slice(0, 50)}..."`, 'success');
        } else {
          showToast(`✗ Test failed: ${result.error}`, 'error');
        }
      } catch (err) {
        showToast(`✗ Test failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        btn.textContent = originalText;
        (btn as HTMLButtonElement).disabled = false;
      }
    });
  });
  
  configuredModelsEl.querySelectorAll('.set-default-model-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = (btn as HTMLElement).dataset.name;
      if (!name) return;
      await chrome.runtime.sendMessage({ type: 'llm_set_configured_model_default', name });
      await loadLlmProviders();
    });
  });
  
  configuredModelsEl.querySelectorAll('.remove-model-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = (btn as HTMLElement).dataset.name;
      if (!name) return;
      await chrome.runtime.sendMessage({ type: 'llm_remove_configured_model', name });
      await loadLlmProviders();
      showToast(`Removed "${name}"`);
    });
  });
}

// Render available models dropdown
function renderAvailableModelsDropdown(models: ModelInfo[], configured: ConfiguredModel[]): void {
  const configuredIds = new Set(configured.map(c => c.model_id));
  
  availableModelsSelect.innerHTML = '<option value="">Select a model to add...</option>';
  
  // Filter out already configured models
  const available = models.filter(m => !configuredIds.has(m.id));
  
  if (available.length === 0) {
    availableModelsSelect.innerHTML = '<option value="">No more models available</option>';
    addModelBtn.disabled = true;
    return;
  }
  
  for (const model of available) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.id;
    availableModelsSelect.appendChild(option);
  }
}

// Render providers list
function renderProviders(providers: ProviderInfo[]): void {
  detectedProvidersEl.innerHTML = '';
  
  const localProviders = providers.filter(p => p.is_local);
  const cloudProviders = providers.filter(p => !p.is_local);
  
  for (const provider of [...localProviders, ...cloudProviders]) {
    const isAvailable = provider.available || (provider.is_local && provider.configured);
    const needsConfig = !provider.is_local && !provider.has_api_key;
    
    const el = document.createElement('div');
    el.className = `detected-provider ${isAvailable ? 'available' : needsConfig ? 'needs-config' : 'unavailable'}`;
    
    let statusText = '';
    let statusClass = '';
    if (isAvailable) {
      statusText = '● Running';
      statusClass = 'available';
    } else if (provider.is_local) {
      statusText = '○ Not detected';
      statusClass = 'unavailable';
    } else if (needsConfig) {
      statusText = '○ Needs API key';
      statusClass = 'needs-config';
    } else {
      statusText = '● Ready';
      statusClass = 'available';
    }
    
    let actionHtml = '';
    if (needsConfig) {
      actionHtml = `<button class="btn btn-secondary btn-sm configure-provider-btn" data-provider="${provider.type}">Configure</button>`;
    }
    
    el.innerHTML = `
      <div class="detected-provider-info">
        <div class="detected-provider-name">${provider.name}</div>
        <div class="detected-provider-status ${statusClass}">${statusText}</div>
      </div>
      <div class="detected-provider-action">${actionHtml}</div>
    `;
    
    detectedProvidersEl.appendChild(el);
  }
  
  // Event listeners for configure buttons
  detectedProvidersEl.querySelectorAll('.configure-provider-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const providerType = (btn as HTMLElement).dataset.provider;
      if (providerType) showApiKeyConfig(providerType);
    });
  });
}

// Available models dropdown change handler
availableModelsSelect.addEventListener('change', () => {
  addModelBtn.disabled = !availableModelsSelect.value;
});

// Add model button
addModelBtn.addEventListener('click', async () => {
  const modelId = availableModelsSelect.value;
  if (!modelId) return;
  
  addModelBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'llm_add_configured_model',
      model_id: modelId,
    }) as { ok: boolean; name?: string; error?: string };
    
    if (response.ok) {
      showToast(`Added "${response.name}"`);
      await loadLlmProviders();
    } else {
      showToast('Failed to add model');
    }
  } catch (err) {
    showToast('Failed to add model');
  }
  addModelBtn.disabled = false;
});

// Load LLM providers on startup
loadLlmProviders().catch((error) => {
  console.error('Failed to load LLM providers', error);
});

// =============================================================================
// Permissions Panel
// =============================================================================

const permissionsPanelHeader = document.getElementById('permissions-panel-header') as HTMLDivElement;
const permissionsPanelToggle = document.getElementById('permissions-panel-toggle') as HTMLSpanElement;
const permissionsList = document.getElementById('permissions-list') as HTMLDivElement;
const refreshPermissionsBtn = document.getElementById('refresh-permissions-btn') as HTMLButtonElement;

type PermissionStatusEntry = {
  origin: string;
  scopes: Record<string, string>;
  allowedTools?: string[];
};

async function loadPermissions(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'list_all_permissions' }) as {
      type: string;
      permissions?: PermissionStatusEntry[];
    };

    if (response?.permissions) {
      renderPermissions(response.permissions);
    }
  } catch (err) {
    console.error('[Sidebar] Failed to load permissions:', err);
    permissionsList.innerHTML = '<div class="empty-state">Failed to load permissions.</div>';
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderPermissions(permissions: PermissionStatusEntry[]): void {
  if (permissions.length === 0) {
    permissionsList.innerHTML = '<div class="empty-state">No site permissions granted yet.</div>';
    return;
  }

  permissionsList.innerHTML = permissions.map((perm) => {
    const grantedScopes = Object.entries(perm.scopes)
      .filter(([, status]) => status === 'granted-always' || status === 'granted-once')
      .map(([scope, status]) => ({ scope, status }));

    const deniedScopes = Object.entries(perm.scopes)
      .filter(([, status]) => status === 'denied')
      .map(([scope]) => scope);

    const scopeBadges = [
      ...grantedScopes.map(({ scope, status }) => {
        const label = scope.split(':')[1] || scope;
        const isOnce = status === 'granted-once';
        const badgeClass = isOnce ? 'permission-scope-badge temporary' : 'permission-scope-badge';
        const suffix = isOnce ? ' <span class="permission-temp-label">⏱</span>' : '';
        return `<span class="${badgeClass}">${escapeHtml(label)}${suffix}</span>`;
      }),
      ...deniedScopes.map((scope) => {
        const label = scope.split(':')[1] || scope;
        return `<span class="permission-scope-badge denied">${escapeHtml(label)} ✕</span>`;
      }),
    ].join('');

    let toolsHtml = '';
    if (perm.allowedTools && perm.allowedTools.length > 0) {
      const toolBadges = perm.allowedTools.map((tool) => {
        const toolName = tool.split('/')[1] || tool;
        return `<span class="permission-tool-badge">${escapeHtml(toolName)}</span>`;
      }).join('');

      toolsHtml = `
        <div class="permission-tools-section">
          <div class="permission-tools-title">Allowed Tools</div>
          <div class="permission-tools-list">${toolBadges}</div>
        </div>
      `;
    }

    return `
      <div class="permission-origin-item" data-origin="${escapeHtml(perm.origin)}">
        <div class="permission-origin-header">
          <span class="permission-origin-name">${escapeHtml(perm.origin)}</span>
        </div>
        <div class="permission-scopes">
          ${scopeBadges || '<span style="color: var(--color-text-muted); font-size: 11px;">No scopes</span>'}
        </div>
        ${toolsHtml}
        <div class="permission-actions">
          <button class="btn btn-sm btn-danger revoke-permissions-btn" data-origin="${escapeHtml(perm.origin)}">Revoke All</button>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners for revoke buttons
  permissionsList.querySelectorAll('.revoke-permissions-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const origin = (btn as HTMLElement).dataset.origin!;
      if (!confirm(`Revoke all permissions for ${origin}?`)) return;

      try {
        await chrome.runtime.sendMessage({ type: 'revoke_origin_permissions', origin });
        await loadPermissions();
        showToast('Permissions revoked');
      } catch (err) {
        console.error('[Sidebar] Failed to revoke permissions:', err);
        showToast('Failed to revoke permissions', 'error');
      }
    });
  });
}

// Setup permissions panel toggle
setupPanelToggle(permissionsPanelHeader, permissionsPanelToggle, permissionsList);

// Refresh permissions button
refreshPermissionsBtn?.addEventListener('click', async (e) => {
  e.stopPropagation();
  refreshPermissionsBtn.disabled = true;
  await loadPermissions();
  refreshPermissionsBtn.disabled = false;
});

// Listen for permission changes from background
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'permissions_changed') {
    loadPermissions();
  }
  return false;
});

// Load permissions on startup
loadPermissions();

// =============================================================================
// Quick Actions Panel
// =============================================================================

const quickActionsHeader = document.getElementById('quick-actions-header') as HTMLDivElement;
const quickActionsToggle = document.getElementById('quick-actions-toggle') as HTMLSpanElement;
const quickActionsBody = document.getElementById('quick-actions-body') as HTMLDivElement;
const chatAboutPageBtn = document.getElementById('chat-about-page-btn') as HTMLButtonElement;
const openDirectoryBtn = document.getElementById('open-directory-btn') as HTMLButtonElement;
const openChatBtn = document.getElementById('open-chat-btn') as HTMLButtonElement;
const reloadExtensionBtn = document.getElementById('reload-extension-btn') as HTMLButtonElement;

// Set up panel toggle
setupPanelToggle(quickActionsHeader, quickActionsToggle, quickActionsBody);

// Chat About Page button - injects page chat sidebar into current tab
chatAboutPageBtn.addEventListener('click', async () => {
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showToast('No active tab found');
      return;
    }
    
    // Check if we can inject into this tab
    if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('moz-extension://') || tab.url?.startsWith('about:')) {
      showToast('Cannot chat on this page');
      return;
    }
    
    console.log('[Sidebar] Opening page chat on tab:', tab.id);
    
    // Send message to background to inject page-chat
    const response = await chrome.runtime.sendMessage({
      type: 'open_page_chat',
      tabId: tab.id,
    }) as { ok: boolean; error?: string };
    
    if (!response.ok) {
      showToast(response.error || 'Failed to open chat');
    }
  } catch (err) {
    console.error('[Sidebar] Failed to open page chat:', err);
    showToast('Failed to open page chat');
  }
});

// Open Directory button - opens the MCP server directory
openDirectoryBtn.addEventListener('click', async () => {
  try {
    const directoryUrl = chrome.runtime.getURL('dist/directory.html');
    console.log('[Sidebar] Opening directory at:', directoryUrl);
    await chrome.tabs.create({ url: directoryUrl });
  } catch (err) {
    console.error('[Sidebar] Failed to open directory:', err);
    showToast('Failed to open directory');
  }
});

// Open Chat button - opens the chat demo in a new tab
openChatBtn.addEventListener('click', async () => {
  try {
    // The demo is at the extension root level
    const chatUrl = chrome.runtime.getURL('demo/chat-poc/index.html');
    console.log('[Sidebar] Opening chat at:', chatUrl);
    await chrome.tabs.create({ url: chatUrl });
  } catch (err) {
    console.error('[Sidebar] Failed to open chat:', err);
    showToast('Failed to open chat');
  }
});

// Reload Extension button
reloadExtensionBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.reload();
  } catch (err) {
    console.error('[Sidebar] Failed to reload:', err);
    showToast('Failed to reload extension');
  }
});
