import { build, context } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

const isWatch = process.argv.includes('--watch');
const isChrome = process.argv.includes('--chrome');

const common = {
  bundle: true,
  sourcemap: true,
  format: isChrome ? 'esm' : 'iife',  // Chrome service workers need ESM
  target: ['es2022'],
  outdir: 'dist',
  outbase: 'src',
  logLevel: 'info',
};

const entryPoints = [
  'src/background.ts',
  'src/content-script.ts',
  'src/injected.ts',
  'src/permission-prompt.ts',
  'src/sidebar.ts',
];

async function copyStatic() {
  await mkdir('dist', { recursive: true });
  await copyFile('src/permission-prompt.html', 'dist/permission-prompt.html');
  await copyFile('src/sidebar.html', 'dist/sidebar.html');
  await copyFile('src/design-tokens.css', 'dist/design-tokens.css');
  
  // Copy appropriate manifest
  if (isChrome) {
    await copyFile('manifest.chrome.json', 'dist/../manifest.json');
    console.log('[Web Agents API] Using Chrome manifest');
  }
}

if (isWatch) {
  const ctx = await context({
    ...common,
    entryPoints,
  });
  await ctx.watch();
  await copyStatic();
  console.log('[Web Agents API] esbuild watch started');
} else {
  await build({
    ...common,
    entryPoints,
  });
  await copyStatic();
}
