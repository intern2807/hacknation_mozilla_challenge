/**
 * Playwright fixtures that load Harbor + Web Agents API extensions so every
 * page has window.ai and window.agent. Use with playwright.harbor.config.example.ts.
 *
 * Set HARBOR_EXTENSION_PATH and WEB_AGENTS_EXTENSION_PATH (paths to unpacked
 * extension directories). If unset, context launches without extensions.
 *
 * Usage in your specs:
 *   import { test, expect } from './harbor-test/fixtures/harbor.js';
 *   test('page has Web Agents API', async ({ page }) => {
 *     await page.goto('http://localhost:3000/my-app');
 *     const has = await page.evaluate(() => typeof (window as any).ai !== 'undefined');
 *     expect(has).toBe(true);
 *   });
 */

import { test as base, chromium, type BrowserContext } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';

const harborPath = process.env.HARBOR_EXTENSION_PATH || '';
const webAgentsPath = process.env.WEB_AGENTS_EXTENSION_PATH || '';
const hasExtensions = harborPath && webAgentsPath &&
  fs.existsSync(harborPath) && fs.existsSync(webAgentsPath);

export const test = base.extend<{
  context: BrowserContext;
}>({
  context: async ({}, use) => {
    const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'harbor-e2e-'));
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: !!process.env.CI,
      channel: 'chromium',
    };
    if (hasExtensions) {
      launchOptions.args = [
        `--disable-extensions-except=${harborPath},${webAgentsPath}`,
        `--load-extension=${harborPath},${webAgentsPath}`,
      ];
    }
    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    await use(context);
    await context.close();
    try {
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  },
});

export { expect } from '@playwright/test';
