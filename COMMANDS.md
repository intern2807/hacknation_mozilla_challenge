# Command Reference

Quick reference for all available commands in Harbor Search Sidebar.

## Table of Contents

- [Installation Commands](#installation-commands)
- [Development Commands](#development-commands)
- [Build Commands](#build-commands)
- [Maintenance Commands](#maintenance-commands)
- [Git Commands](#git-commands)
- [Browser Commands](#browser-commands)

---

## Installation Commands

### Automated Installation

```bash
# macOS/Linux
./install.sh

# Windows (Git Bash)
bash install.sh

# Windows (PowerShell) - manual steps
npm install
npm run build:firefox
```

### Manual Installation

```bash
# Install dependencies
npm install

# Build for Firefox
npm run build:firefox

# Or step by step
npm run build
npm run post-build
```

---

## Development Commands

### Start Development Server

```bash
# Start React dev server (http://localhost:3000)
npm start

# Or
npm run dev
```

**Note**: Extension APIs won't work in dev server. Use for UI development only.

### Watch Mode

```bash
# Rebuild on file changes (planned feature)
npm run watch
```

---

## Build Commands

### Production Build

```bash
# Build optimized extension for Firefox
npm run build:firefox
```

This command:
1. Creates optimized React build
2. Copies extension files (background.js, content.js, manifest.json)
3. Renames index.html to sidebar.html
4. Creates icons directory

### Individual Build Steps

```bash
# React build only
npm run build

# Post-build processing only
npm run post-build
```

### Build Output

Check build output:
```bash
# List build files
ls -la build/

# Verify manifest
cat build/manifest.json

# Check file sizes
du -sh build/*
```

---

## Maintenance Commands

### Clean Build

```bash
# Remove build directory
rm -rf build/

# Full clean (removes node_modules too)
npm run clean
```

### Reinstall Dependencies

```bash
# Clean and reinstall everything
npm run reinstall

# Or manually
rm -rf node_modules package-lock.json
npm install
```

### Update Dependencies

```bash
# Check for updates
npm outdated

# Update all dependencies
npm update

# Update specific package
npm update react

# Install latest versions
npm install react@latest react-dom@latest
```

### Clear Cache

```bash
# Clear npm cache
npm cache clean --force

# Clear React build cache
rm -rf node_modules/.cache
```

---

## Git Commands

### Initial Setup

```bash
# Initialize repository (if not already done)
git init

# Add all files
git add .

# First commit
git commit -m "Initial commit"

# Add remote
git remote add origin https://github.com/yourusername/harbor-search-sidebar.git

# Push to GitHub
git push -u origin main
```

### Daily Workflow

```bash
# Check status
git status

# Create feature branch
git checkout -b feature/my-feature

# Stage changes
git add .

# Commit
git commit -m "feat: add new feature"

# Push branch
git push origin feature/my-feature
```

### Useful Git Commands

```bash
# View changes
git diff

# View commit history
git log --oneline

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Discard local changes
git checkout -- filename.js

# Stash changes
git stash
git stash pop

# Update from main
git checkout main
git pull
git checkout feature/my-feature
git merge main
```

---

## Browser Commands

### Firefox

#### Load Extension

1. Open Firefox
2. Navigate to: `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Select `build/manifest.json`

#### Reload Extension

1. Go to `about:debugging#/runtime/this-firefox`
2. Find your extension
3. Click "Reload"

#### Debug Extension

```bash
# View background script console
# 1. Go to about:debugging
# 2. Click "Inspect" next to extension

# View sidebar console
# 1. Open sidebar
# 2. Right-click in sidebar
# 3. Select "Inspect"
```

#### Keyboard Shortcuts

```bash
# Open sidebar
# macOS: Cmd+Shift+H
# Windows/Linux: Ctrl+Shift+H

# Open debugging
# macOS: Cmd+Shift+Option+I
# Windows/Linux: Ctrl+Shift+Alt+I

# Open browser console
# macOS: Cmd+Shift+J
# Windows/Linux: Ctrl+Shift+J

# Reload page
# macOS: Cmd+R
# Windows/Linux: Ctrl+R
```

### Firefox CLI Commands

```bash
# Open Firefox with debugging
firefox --jsconsole

# Open with profile
firefox -P "Development"

# Create new profile
firefox -P -CreateProfile "Dev"

# Open specific URL
firefox "about:debugging#/runtime/this-firefox"
```

---

## Testing Commands

### Manual Testing Checklist

```bash
# 1. Build extension
npm run build:firefox

# 2. Load in Firefox
# (use GUI - see Browser Commands above)

# 3. Test features
# - Open sidebar: Ctrl/Cmd+Shift+H
# - Right-click context menu
# - Click toolbar button
# - Configure settings
# - Click "Let's Go"

# 4. Check console for errors
# Press F12 in any browser window
```

### Automated Testing (Future)

```bash
# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

---

## Debugging Commands

### View Logs

```bash
# Build logs
npm run build:firefox 2>&1 | tee build.log

# Install logs
npm install --verbose > install.log 2>&1
```

### Check Configuration

```bash
# Node.js version
node --version

# npm version
npm --version

# List installed packages
npm list --depth=0

# Verify package.json
cat package.json | grep version

# Check environment
npm run env
```

### Analyze Bundle

```bash
# Install analyzer
npm install --save-dev webpack-bundle-analyzer

# Analyze build (requires eject)
npm run build -- --stats
```

---

## NPM Script Reference

All scripts defined in `package.json`:

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `npm start` | Start development server |
| `dev` | `npm run dev` | Alias for start |
| `build` | `npm run build` | Build React app |
| `build:firefox` | `npm run build:firefox` | Build complete Firefox extension |
| `post-build` | `npm run post-build` | Process build output |
| `test` | `npm test` | Run tests |
| `clean` | `npm run clean` | Remove build files |
| `reinstall` | `npm run reinstall` | Clean and reinstall |
| `lint` | `npm run lint` | Check code style |
| `format` | `npm run format` | Format code |

---

## File Operations

### Create Icons

```bash
# Create icons directory
mkdir -p build/icons

# Check icons
ls -lh build/icons/

# Required files:
# - icon-48.png (48x48)
# - icon-96.png (96x96)
```

### Backup Build

```bash
# Create backup
tar -czf harbor-search-sidebar-$(date +%Y%m%d).tar.gz build/

# Or zip
zip -r harbor-search-sidebar-$(date +%Y%m%d).zip build/
```

### Extract Extension

```bash
# Extract ZIP
unzip harbor-search-sidebar.zip -d extracted/

# Extract tar.gz
tar -xzf harbor-search-sidebar.tar.gz
```

---

## Environment Variables

### Set Environment Variables

```bash
# macOS/Linux
export REACT_APP_HARBOR_EXTENSION_ID="your-id"
export REACT_APP_DEBUG=true

# Windows PowerShell
$env:REACT_APP_HARBOR_EXTENSION_ID="your-id"

# Windows CMD
set REACT_APP_HARBOR_EXTENSION_ID=your-id

# Or use .env file
cp .env.example .env.local
# Edit .env.local with your values
```

### View Environment

```bash
# View all environment variables
npm run env

# View specific variable
echo $REACT_APP_HARBOR_EXTENSION_ID
```

---

## Shortcuts Summary

### Development

```bash
npm i              # Install dependencies
npm start          # Start dev server
npm run build:firefox  # Build extension
```

### Debugging

```bash
# View all logs
npm run build:firefox 2>&1 | less

# Tail build output
npm run build:firefox 2>&1 | tail -f

# Save logs
npm run build:firefox > build.log 2>&1
```

### Quick Rebuild

```bash
# One-liner rebuild and reload
npm run build:firefox && echo "Reload extension in Firefox!"
```

---

## Aliases (Optional)

Add to your shell config (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
# Harbor development aliases
alias hs-dev='cd ~/path/to/harbor-search-sidebar && npm start'
alias hs-build='cd ~/path/to/harbor-search-sidebar && npm run build:firefox'
alias hs-clean='cd ~/path/to/harbor-search-sidebar && npm run clean'
alias hs-reload='cd ~/path/to/harbor-search-sidebar && npm run reinstall'

# Quick open Firefox debugging
alias fx-debug='firefox "about:debugging#/runtime/this-firefox"'
```

Then reload:
```bash
source ~/.bashrc  # or ~/.zshrc
```

---

## Common Workflows

### New Feature Development

```bash
# 1. Create branch
git checkout -b feature/new-feature

# 2. Start dev server
npm start

# 3. Make changes in src/

# 4. Build and test
npm run build:firefox
# Load in Firefox

# 5. Commit
git add .
git commit -m "feat: add new feature"

# 6. Push
git push origin feature/new-feature
```

### Bug Fix

```bash
# 1. Create branch
git checkout -b fix/bug-description

# 2. Make changes

# 3. Test
npm run build:firefox
# Test in Firefox

# 4. Commit and push
git add .
git commit -m "fix: resolve bug"
git push origin fix/bug-description
```

### Update After Pull

```bash
# 1. Pull changes
git pull origin main

# 2. Reinstall (if package.json changed)
npm install

# 3. Rebuild
npm run build:firefox

# 4. Reload in Firefox
```

---

## Performance Tips

### Speed Up Builds

```bash
# Use npm ci for clean installs (faster than npm install)
npm ci

# Parallel build (if applicable)
npm run build -- --parallel
```

### Reduce Build Size

```bash
# Remove source maps (already done in build:firefox)
GENERATE_SOURCEMAP=false npm run build

# Check bundle size
ls -lh build/static/js/
```

---

## Help Commands

```bash
# npm help
npm help
npm help install
npm help run-script

# View package info
npm info react

# List available scripts
npm run

# View package.json
cat package.json | less
```

---

**Last Updated**: February 7, 2026
**Version**: 1.0.0
