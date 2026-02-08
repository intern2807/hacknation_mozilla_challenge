# Setup Guide

Platform-specific instructions for setting up Harbor Search Sidebar.

## Table of Contents

- [macOS Setup](#macos-setup)
- [Windows Setup](#windows-setup)
- [Linux Setup](#linux-setup)
- [Troubleshooting](#troubleshooting)

---

## macOS Setup

### Prerequisites

1. **Install Node.js**
   ```bash
   # Option 1: Using Homebrew (recommended)
   brew install node
   
   # Option 2: Download from nodejs.org
   # Visit https://nodejs.org/ and download macOS installer
   ```

2. **Verify Installation**
   ```bash
   node --version  # Should be 18.0.0 or higher
   npm --version
   ```

3. **Install Firefox**
   ```bash
   # Using Homebrew
   brew install --cask firefox
   
   # Or download from https://www.mozilla.org/firefox/
   ```

### Installation

1. **Clone or Download the Project**
   ```bash
   cd ~/Downloads
   # Extract if downloaded as ZIP
   cd harbor-search-sidebar
   ```

2. **Run Installation Script**
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. **Or Manual Installation**
   ```bash
   npm install
   npm run build:firefox
   ```

### Load in Firefox

1. Open Firefox
2. Press `Cmd+Shift+Alt+I` or navigate to: `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Navigate to project folder
5. Select `build/manifest.json`

### Usage

- **Open sidebar**: `Cmd+Shift+H`
- **Context menu**: Right-click → "Search with Harbor"
- **Toolbar**: Click Harbor icon

---

## Windows Setup

### Prerequisites

1. **Install Node.js**
   - Download from: https://nodejs.org/
   - Run installer (choose LTS version)
   - Check "Add to PATH" during installation

2. **Verify Installation**
   ```powershell
   node --version
   npm --version
   ```

3. **Install Firefox**
   - Download from: https://www.mozilla.org/firefox/
   - Run installer

### Installation

#### Option 1: Using PowerShell

1. **Open PowerShell**
   - Press `Win+X`
   - Select "Windows PowerShell" or "Terminal"

2. **Navigate to Project**
   ```powershell
   cd Downloads\harbor-search-sidebar
   ```

3. **Install and Build**
   ```powershell
   npm install
   npm run build:firefox
   ```

#### Option 2: Using Git Bash

```bash
cd ~/Downloads/harbor-search-sidebar
./install.sh
```

### Load in Firefox

1. Open Firefox
2. Press `Ctrl+Shift+Alt+I` or type in address bar: `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Navigate to project folder
5. Select `build\manifest.json`

### Usage

- **Open sidebar**: `Ctrl+Shift+H`
- **Context menu**: Right-click → "Search with Harbor"
- **Toolbar**: Click Harbor icon

### Windows-Specific Notes

- Use backslashes `\` for paths in Windows
- PowerShell may require execution policy changes:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
  ```

---

## Linux Setup

### Prerequisites

1. **Install Node.js**

   **Ubuntu/Debian:**
   ```bash
   # Using NodeSource repository
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

   **Fedora:**
   ```bash
   sudo dnf install nodejs
   ```

   **Arch Linux:**
   ```bash
   sudo pacman -S nodejs npm
   ```

2. **Verify Installation**
   ```bash
   node --version
   npm --version
   ```

3. **Install Firefox**
   ```bash
   # Ubuntu/Debian
   sudo apt install firefox
   
   # Fedora
   sudo dnf install firefox
   
   # Arch
   sudo pacman -S firefox
   ```

### Installation

1. **Navigate to Project**
   ```bash
   cd ~/Downloads/harbor-search-sidebar
   ```

2. **Run Installation Script**
   ```bash
   chmod +x install.sh
   ./install.sh
   ```

3. **Or Manual Installation**
   ```bash
   npm install
   npm run build:firefox
   ```

### Load in Firefox

1. Open Firefox
2. Press `Ctrl+Shift+Alt+I` or navigate to: `about:debugging#/runtime/this-firefox`
3. Click **"Load Temporary Add-on..."**
4. Navigate to project folder
5. Select `build/manifest.json`

### Usage

- **Open sidebar**: `Ctrl+Shift+H`
- **Context menu**: Right-click → "Search with Harbor"
- **Toolbar**: Click Harbor icon

---

## Troubleshooting

### Node.js Not Found

**Symptoms**: `command not found: node` or `'node' is not recognized`

**Solution**:
- Restart terminal/PowerShell after installing Node.js
- Verify installation: Download from https://nodejs.org/
- Check PATH environment variable includes Node.js

### npm install Fails

**Symptoms**: Permission errors or network issues

**macOS/Linux Solution**:
```bash
# Don't use sudo! Instead fix npm permissions:
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Then retry
npm install
```

**Windows Solution**:
```powershell
# Run as Administrator or:
npm cache clean --force
npm install
```

### Build Fails

**Symptoms**: `build:firefox` script errors

**Solution**:
1. Delete node_modules and package-lock.json
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

2. Check Node.js version (must be 18+)
   ```bash
   node --version
   ```

3. Try building manually:
   ```bash
   npm run build
   node scripts/post-build.js
   ```

### Extension Won't Load

**Symptoms**: Firefox shows error when loading manifest.json

**Solutions**:

1. **Check manifest.json exists**
   ```bash
   ls build/manifest.json
   ```

2. **Rebuild extension**
   ```bash
   npm run build:firefox
   ```

3. **Check Firefox version** (must be 109+)
   - Open `about:support`
   - Check "Version" field

4. **Check manifest syntax**
   ```bash
   cat build/manifest.json | head -20
   ```

### Sidebar Won't Open

**Symptoms**: Keyboard shortcut doesn't work

**Solutions**:

1. **Check extension is loaded**
   - Go to `about:debugging#/runtime/this-firefox`
   - Extension should appear in list

2. **Try alternative methods**
   - Click toolbar icon
   - Use context menu (right-click)

3. **Reload extension**
   - In `about:debugging`, click "Reload"
   - Refresh any open tabs

4. **Check keyboard shortcut conflicts**
   - Go to `about:addons`
   - Click gear icon → "Manage Extension Shortcuts"

### Icons Don't Appear

**Symptoms**: Broken icon images

**Solution**:
1. Add icon files to `build/icons/`:
   - icon-48.png (48x48 pixels)
   - icon-96.png (96x96 pixels)

2. Generate icons online:
   - https://www.favicon-generator.org/
   - Upload any image, download 48x48 and 96x96

3. Or continue without icons (extension still works)

### Permission Errors

**Symptoms**: "Extension does not have permission"

**Solution**:
1. Check manifest.json has required permissions
2. Reload extension in `about:debugging`
3. Clear browser cache and restart Firefox

### Build Directory Missing

**Symptoms**: `build/manifest.json` not found

**Solution**:
```bash
# Check if build directory exists
ls -la build/

# If missing, rebuild
npm run build:firefox

# Verify files
ls build/
```

Should contain:
- manifest.json
- background.js
- content.js
- popup.html
- popup.js
- sidebar.html
- static/ (CSS, JS)
- icons/ (optional)

### Development Server Won't Start

**Symptoms**: `npm start` fails

**Solution**:
1. Check port 3000 isn't in use:
   ```bash
   # macOS/Linux
   lsof -i :3000
   
   # Windows
   netstat -ano | findstr :3000
   ```

2. Kill process using port 3000 or set different port:
   ```bash
   PORT=3001 npm start
   ```

3. Clear cache:
   ```bash
   rm -rf node_modules/.cache
   npm start
   ```

### Cross-Platform Issues

#### Path Separators
- **Windows**: Use `\` (backslash)
- **macOS/Linux**: Use `/` (forward slash)
- **Node.js**: Use `path.join()` for cross-platform

#### Line Endings
If you see `^M` characters:
```bash
# Convert CRLF to LF (macOS/Linux)
dos2unix filename

# Or use git
git config --global core.autocrlf input
```

#### File Permissions
```bash
# macOS/Linux: Make scripts executable
chmod +x install.sh
chmod +x scripts/*.js
```

---

## Getting Additional Help

### Check Logs

1. **Browser Console** (F12 in Firefox)
   - Look for JavaScript errors
   - Check network requests

2. **Extension Debugging**
   - Go to `about:debugging`
   - Click "Inspect" next to extension
   - View background script console

3. **Build Logs**
   ```bash
   npm run build:firefox 2>&1 | tee build.log
   ```

### Resources

- **Firefox Extension Docs**: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions
- **React Docs**: https://react.dev/
- **Node.js Docs**: https://nodejs.org/docs/

### Report Issues

If you encounter problems not listed here:

1. Check existing issues on GitHub
2. Open a new issue with:
   - Operating system and version
   - Node.js version (`node --version`)
   - Firefox version
   - Complete error message
   - Steps to reproduce

---

## Next Steps

After successful installation:

1. 📖 Read the [Quick Start Guide](QUICKSTART.md)
2. 🔧 Explore [Harbor Integration](HARBOR_INTEGRATION.md)
3. 🎨 Check the [Design Guide](DESIGN_GUIDE.md)
4. 💻 Review [Project Structure](PROJECT_STRUCTURE.md)

Happy coding! 🚀
