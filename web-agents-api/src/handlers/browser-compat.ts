/**
 * Browser Compatibility Layer
 * 
 * Provides cross-browser utilities for Firefox and Chrome.
 */

// Firefox uses `browser.*` APIs, Chrome uses `chrome.*`
export const browserAPI = (typeof browser !== 'undefined' ? browser : chrome) as typeof chrome;

/**
 * Execute a script in a tab, compatible with both Chrome and Firefox.
 */
export async function executeScriptInTab<T>(
  tabId: number,
  func: (...args: unknown[]) => T,
  args: unknown[] = []
): Promise<T | undefined> {
  // Try chrome.scripting first (Chrome MV3, Firefox MV3 with scripting)
  if (chrome?.scripting?.executeScript) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: func as () => T,
      args,
    });
    return results?.[0]?.result as T | undefined;
  }
  
  // Try browser.scripting (Firefox MV3)
  if (typeof browser !== 'undefined' && browser?.scripting?.executeScript) {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: func as () => T,
      args,
    });
    return results?.[0]?.result as T | undefined;
  }

  // Fallback: browser.tabs.executeScript (Firefox MV2 style, but still works)
  if (typeof browser !== 'undefined' && browser?.tabs?.executeScript) {
    const code = `(${func.toString()}).apply(null, ${JSON.stringify(args)})`;
    const results = await browser.tabs.executeScript(tabId, { code });
    return results?.[0] as T | undefined;
  }

  throw new Error('No script execution API available');
}
