const fs = require('fs-extra');
const path = require('path');

// Copy extension files to build directory
async function postBuild() {
  const buildDir = path.join(__dirname, '..', 'build');

  console.log('Post-build: Preparing extension files...');

  // Copy manifest.json
  await fs.copy(
    path.join(__dirname, '..', 'manifest.json'),
    path.join(buildDir, 'manifest.json')
  );
  console.log('✓ Copied manifest.json');

  // Copy background.js
  await fs.copy(
    path.join(__dirname, '..', 'background.js'),
    path.join(buildDir, 'background.js')
  );
  console.log('✓ Copied background.js');

  // Copy content.js
  await fs.copy(
    path.join(__dirname, '..', 'content.js'),
    path.join(buildDir, 'content.js')
  );
  console.log('✓ Copied content.js');

  // Rename index.html to sidebar.html
  const indexPath = path.join(buildDir, 'index.html');
  const sidebarPath = path.join(buildDir, 'sidebar.html');

  // Read the HTML, fix absolute paths to relative, then write as sidebar.html
  let html = await fs.readFile(indexPath, 'utf8');

  // Replace absolute paths like "/static/..." with relative "./static/..."
  html = html.replace(/href="\//g, 'href="./');
  html = html.replace(/src="\//g, 'src="./');

  await fs.writeFile(sidebarPath, html, 'utf8');
  await fs.remove(indexPath);
  console.log('✓ Created sidebar.html with relative paths');

  // Create icons directory if it doesn't exist
  const iconsDir = path.join(buildDir, 'icons');
  await fs.ensureDir(iconsDir);

  // Create placeholder icons (you should replace these with actual icons)
  console.log('✓ Icons directory created (add your icon files to build/icons/)');

  console.log('\n✅ Build complete! Extension is ready in the build/ directory');
  console.log('\nTo load in Firefox:');
  console.log('1. Go to about:debugging#/runtime/this-firefox');
  console.log('2. Click "Load Temporary Add-on..."');
  console.log('3. Select build/manifest.json');
}

postBuild().catch(err => {
  console.error('Post-build failed:', err);
  process.exit(1);
});
