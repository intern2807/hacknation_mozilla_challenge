/**
 * Browser Interaction Handlers
 * 
 * Handles page interaction (click, fill, scroll, screenshot, etc.)
 */

import type { RequestContext, HandlerResponse } from './types';
import { errorResponse, successResponse } from './types';
import { hasPermission } from './permission-handlers';
import { executeScriptInTab } from './browser-compat';

// =============================================================================
// Click Handler
// =============================================================================

export async function handleBrowserClick(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.interact')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.interact required');
  }

  const { ref } = ctx.payload as { ref: string };
  if (!ref) {
    return errorResponse(ctx.id, 'ERR_INVALID_REQUEST', 'Missing ref parameter');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const result = await executeScriptInTab<{ success: boolean; error?: string }>(
      ctx.tabId,
      (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) {
          return { success: false, error: `Element not found: ${selector}` };
        }
        if (el instanceof HTMLElement) {
          if ((el as HTMLButtonElement).disabled) {
            return { success: false, error: `Element is disabled: ${selector}` };
          }
          el.click();
          if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return { success: true };
        }
        return { success: false, error: 'Element is not clickable' };
      },
      [ref]
    );

    if (!result) {
      return errorResponse(ctx.id, 'ERR_INTERNAL', 'Script execution failed');
    }
    if (!result.success) {
      return errorResponse(ctx.id, 'ERR_ELEMENT_NOT_FOUND', result.error || 'Click failed');
    }
    return successResponse(ctx.id, { success: true });
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'Click failed');
  }
}

// =============================================================================
// Fill Handler
// =============================================================================

export async function handleBrowserFill(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.interact')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.interact required');
  }

  const { ref, value } = ctx.payload as { ref: string; value: string };
  if (!ref) {
    return errorResponse(ctx.id, 'ERR_INVALID_REQUEST', 'Missing ref parameter');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const result = await executeScriptInTab<{ success: boolean; error?: string }>(
      ctx.tabId,
      (selector: string, fillValue: string) => {
        const el = document.querySelector(selector);
        if (!el) {
          return { success: false, error: `Element not found: ${selector}` };
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = fillValue;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        }
        if (el instanceof HTMLElement && el.isContentEditable) {
          el.textContent = fillValue;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: 'Element is not fillable' };
      },
      [ref, value ?? '']
    );

    if (!result) {
      return errorResponse(ctx.id, 'ERR_INTERNAL', 'Script execution failed');
    }
    if (!result.success) {
      return errorResponse(ctx.id, 'ERR_ELEMENT_NOT_FOUND', result.error || 'Fill failed');
    }
    return successResponse(ctx.id, { success: true });
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'Fill failed');
  }
}

// =============================================================================
// Select Handler
// =============================================================================

export async function handleBrowserSelect(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.interact')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.interact required');
  }

  const { ref, value } = ctx.payload as { ref: string; value: string };
  if (!ref) {
    return errorResponse(ctx.id, 'ERR_INVALID_REQUEST', 'Missing ref parameter');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const result = await executeScriptInTab<{ success: boolean; error?: string }>(
      ctx.tabId,
      (selector: string, selectValue: string) => {
        const el = document.querySelector(selector);
        if (!el) {
          return { success: false, error: `Element not found: ${selector}` };
        }
        if (el instanceof HTMLSelectElement) {
          el.value = selectValue;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true };
        }
        return { success: false, error: 'Element is not a select' };
      },
      [ref, value ?? '']
    );

    if (!result) {
      return errorResponse(ctx.id, 'ERR_INTERNAL', 'Script execution failed');
    }
    if (!result.success) {
      return errorResponse(ctx.id, 'ERR_ELEMENT_NOT_FOUND', result.error || 'Select failed');
    }
    return successResponse(ctx.id, { success: true });
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'Select failed');
  }
}

// =============================================================================
// Scroll Handler
// =============================================================================

export async function handleBrowserScroll(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.interact')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.interact required');
  }

  const { direction, amount } = ctx.payload as { direction: 'up' | 'down' | 'left' | 'right'; amount?: number };
  if (!direction) {
    return errorResponse(ctx.id, 'ERR_INVALID_REQUEST', 'Missing direction parameter');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const result = await executeScriptInTab<{ success: boolean }>(
      ctx.tabId,
      (dir: string, scrollAmount: number) => {
        const px = scrollAmount || 300;
        switch (dir) {
          case 'up': window.scrollBy(0, -px); break;
          case 'down': window.scrollBy(0, px); break;
          case 'left': window.scrollBy(-px, 0); break;
          case 'right': window.scrollBy(px, 0); break;
        }
        return { success: true };
      },
      [direction, amount ?? 300]
    );

    if (!result) {
      return errorResponse(ctx.id, 'ERR_INTERNAL', 'Script execution failed');
    }
    return successResponse(ctx.id, { success: true });
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'Scroll failed');
  }
}

// =============================================================================
// Screenshot Handler
// =============================================================================

export async function handleBrowserScreenshot(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.screenshot')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.screenshot required');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const tabsApi = (typeof browser !== 'undefined' ? browser.tabs : chrome.tabs);
    const dataUrl = await tabsApi.captureVisibleTab({ format: 'png' });
    return successResponse(ctx.id, { dataUrl });
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'Screenshot failed');
  }
}

// =============================================================================
// Get Elements Handler
// =============================================================================

type ElementInfo = {
  ref: string;
  tag: string;
  type?: string;
  text?: string;
  placeholder?: string;
  value?: string;
  role?: string;
};

export async function handleBrowserGetElements(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.read')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.read required');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const result = await executeScriptInTab<ElementInfo[]>(
      ctx.tabId,
      () => {
        const elements: ElementInfo[] = [];
        const selectors = [
          'a[href]', 'button', 'input', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[onclick]', '[contenteditable="true"]',
        ];

        const seen = new Set<Element>();
        
        for (const selector of selectors) {
          for (const el of document.querySelectorAll(selector)) {
            if (seen.has(el)) continue;
            seen.add(el);

            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;

            let ref = '';
            if (el.id) {
              ref = `#${el.id}`;
            } else {
              const parts: string[] = [];
              let current: Element | null = el;
              while (current && current !== document.body) {
                let pathSelector = current.tagName.toLowerCase();
                if (current.id) {
                  pathSelector = `#${current.id}`;
                  parts.unshift(pathSelector);
                  break;
                }
                const parent = current.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
                  if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    pathSelector += `:nth-of-type(${index})`;
                  }
                }
                parts.unshift(pathSelector);
                current = parent;
              }
              ref = parts.join(' > ');
            }

            const info: ElementInfo = { ref, tag: el.tagName.toLowerCase() };

            if (el instanceof HTMLInputElement) {
              info.type = el.type;
              if (el.placeholder) info.placeholder = el.placeholder;
              if (el.value && el.type !== 'password') info.value = el.value;
            } else if (el instanceof HTMLTextAreaElement) {
              if (el.placeholder) info.placeholder = el.placeholder;
            } else if (el instanceof HTMLSelectElement) {
              info.value = el.value;
            }

            const text = el.textContent?.trim().slice(0, 100);
            if (text) info.text = text;

            const role = el.getAttribute('role');
            if (role) info.role = role;

            elements.push(info);
          }
        }

        return elements;
      },
      []
    );

    if (!result) {
      return errorResponse(ctx.id, 'ERR_INTERNAL', 'Script execution failed');
    }
    return successResponse(ctx.id, result);
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'GetElements failed');
  }
}

// =============================================================================
// Readability Handler
// =============================================================================

type ReadabilityResult = {
  title: string;
  url: string;
  content: string;
  length: number;
};

export async function handleBrowserReadability(ctx: RequestContext): HandlerResponse {
  if (!await hasPermission(ctx.origin, 'browser:activeTab.read')) {
    return errorResponse(ctx.id, 'ERR_PERMISSION_DENIED', 'Permission browser:activeTab.read required');
  }

  if (!ctx.tabId) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', 'No tab context available');
  }

  try {
    const result = await executeScriptInTab<ReadabilityResult>(
      ctx.tabId,
      () => {
        const title = document.title;
        const url = window.location.href;
        
        const mainSelectors = ['main', 'article', '[role="main"]', '.content', '#content', '.post', '.article'];
        let content = '';
        
        for (const selector of mainSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            content = el.textContent?.trim() || '';
            break;
          }
        }
        
        if (!content) {
          content = document.body.textContent?.trim() || '';
        }
        
        content = content.replace(/\s+/g, ' ').trim();
        
        return {
          title,
          url,
          content: content.slice(0, 50000),
          length: content.length,
        };
      },
      []
    );

    if (!result) {
      return errorResponse(ctx.id, 'ERR_INTERNAL', 'Script execution failed');
    }
    return successResponse(ctx.id, result);
  } catch (e) {
    return errorResponse(ctx.id, 'ERR_INTERNAL', e instanceof Error ? e.message : 'Readability extraction failed');
  }
}
