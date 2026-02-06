import { firefox } from '@playwright/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

async function main() {
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-'));
  console.log('Profile:', profileDir);
  
  const browser = await firefox.launch({
    headless: false,
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Don't wait for navigation to complete
  console.log('Navigating to about:debugging (no wait)...');
  const navPromise = page.goto('about:debugging#/runtime/this-firefox', { timeout: 60000 });
  
  // Start a timeout to check progress
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    console.log(`Tick ${i+1}: URL = ${page.url()}`);
  }
  
  // See if navigation finished
  try {
    await navPromise;
    console.log('Navigation completed');
  } catch (e) {
    console.log('Navigation error:', e.message);
  }
  
  console.log('Final URL:', page.url());
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/about-debugging.png' });
  console.log('Screenshot saved to /tmp/about-debugging.png');
  
  await browser.close();
  await fs.rm(profileDir, { recursive: true, force: true });
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
