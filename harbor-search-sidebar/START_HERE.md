# 🚀 START HERE

Welcome to Harbor Search Sidebar! This is your one-stop guide to get up and running.

## What Is This?

A Firefox browser extension that adds a **beautiful sidebar** for product search with:

- ⚡ **Fast delivery** or 💰 **cheapest price** optimization
- 📍 **Location settings** (auto-detect or manual)
- 🔒 **Privacy controls** (strict/limited/open)
- 🎯 **Right-click search** on any product page
- 🤖 **Ready for AI integration** with Harbor

## Quick Navigation

### 🏃‍♂️ Just Want to Use It?

→ **[QUICKSTART.md](QUICKSTART.md)** - Get running in 10 minutes

### 💻 First Time Developer?

→ **[SETUP.md](SETUP.md)** - Step-by-step setup for your OS (Mac/Windows/Linux)

### 🔧 Need Command Reference?

→ **[COMMANDS.md](COMMANDS.md)** - All commands in one place

### 🎨 Want to Customize?

→ **[DESIGN_GUIDE.md](DESIGN_GUIDE.md)** - Colors, fonts, and UI elements

### 🔌 Integrating with Harbor?

→ **[HARBOR_INTEGRATION.md](HARBOR_INTEGRATION.md)** - Complete integration guide

### 📚 Want Full Documentation?

→ **[README.md](README.md)** - Comprehensive guide with everything

### 🏗️ Understanding the Code?

→ **[PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)** - File organization and architecture

---

## 30-Second Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Build extension
npm run build:firefox

# 3. Load in Firefox
# Open: about:debugging#/runtime/this-firefox
# Click: "Load Temporary Add-on..."
# Select: build/manifest.json

# 4. Use it!
# Press: Cmd+Shift+H (Mac) or Ctrl+Shift+H (Windows/Linux)
```

---

## File Structure at a Glance

```
harbor-search-sidebar/
│
├── 📄 START_HERE.md          ← You are here!
├── 📖 README.md               ← Full documentation
├── 🚀 QUICKSTART.md          ← 10-minute setup
├── 🛠️ SETUP.md              ← Platform-specific setup
├── 💻 COMMANDS.md            ← Command reference
├── 🎨 DESIGN_GUIDE.md        ← UI/UX guide
├── 🔌 HARBOR_INTEGRATION.md  ← Harbor integration
├── 🏗️ PROJECT_STRUCTURE.md  ← Code organization
│
├── src/                      ← React components
│   ├── SearchSidebar.jsx     ← Main UI component
│   ├── SearchSidebar.css     ← Styling
│   ├── App.jsx               ← Root component
│   └── index.jsx             ← Entry point
│
├── public/
│   └── index.html            ← HTML template
│
├── background.js             ← Extension orchestration
├── content.js                ← Page interaction
├── manifest.json             ← Firefox extension config
├── package.json              ← Dependencies
│
└── scripts/
    └── post-build.js         ← Build processing
```

---

## What You Can Do

### ✅ Right Now

- [x] Configure search preferences (fast/cheap)
- [x] Set location (auto or manual)
- [x] Choose privacy level
- [x] Right-click to search
- [x] Keyboard shortcut access
- [x] Beautiful modern UI

### 🔜 Coming Soon

- [ ] Display search results
- [ ] Price comparison
- [ ] Product history
- [ ] AI-powered recommendations
- [ ] Chrome/Edge support

---

## Common Tasks

### Start Development
```bash
npm start                    # Dev server at localhost:3000
```

### Build Extension
```bash
npm run build:firefox        # Creates build/ directory
```

### Clean Start
```bash
npm run clean                # Remove everything
npm install                  # Fresh install
npm run build:firefox        # Build again
```

### Update After Git Pull
```bash
git pull origin main
npm install                  # In case dependencies changed
npm run build:firefox
# Reload extension in Firefox
```

---

## Need Help?

### 🐛 Something's Broken?

1. **Check [SETUP.md](SETUP.md)** - Troubleshooting section
2. **View browser console** - Press F12
3. **Check extension logs** - about:debugging → Inspect
4. **Rebuild** - `npm run build:firefox`

### 💬 Have Questions?

- **Quick answers**: Check [COMMANDS.md](COMMANDS.md)
- **Integration**: See [HARBOR_INTEGRATION.md](HARBOR_INTEGRATION.md)
- **Code structure**: Read [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

### 🤝 Want to Contribute?

→ **[CONTRIBUTING.md](CONTRIBUTING.md)** - Contribution guidelines

---

## Next Steps

Choose your path:

### Path 1: I just want to use it
1. Read [QUICKSTART.md](QUICKSTART.md)
2. Run install script or `npm run build:firefox`
3. Load in Firefox
4. Start using!

### Path 2: I want to customize it
1. Read [DESIGN_GUIDE.md](DESIGN_GUIDE.md)
2. Edit `src/SearchSidebar.css` for colors
3. Modify `src/SearchSidebar.jsx` for functionality
4. Rebuild and test

### Path 3: I want to integrate with Harbor
1. Read [HARBOR_INTEGRATION.md](HARBOR_INTEGRATION.md)
2. Install Harbor extension
3. Configure cross-extension messaging
4. Use Harbor's AI and MCP features

### Path 4: I want to contribute
1. Read [CONTRIBUTING.md](CONTRIBUTING.md)
2. Fork the repository
3. Make your changes
4. Submit a pull request

---

## Key Features Explained

### 🎯 Optimization Settings

**Fast Delivery**: Prioritizes quick shipping times
**Cheapest Price**: Finds the best deals

### 📍 Location

**Auto-detect**: Uses your browser location (requires permission)
**Manual**: Enter any city or country

### 🔒 Privacy Levels

**Strict**: No tracking, local searches only (DuckDuckGo, Qwant)
**Limited**: Essential services (Bing, Yahoo, no Google)
**Open**: All engines including Google (best coverage, less privacy)

### ⌨️ Access Methods

1. **Keyboard**: `Ctrl+Shift+H` (Windows/Linux) or `Cmd+Shift+H` (Mac)
2. **Right-click**: Context menu on any page
3. **Toolbar**: Click the Harbor icon (⚓)

---

## Version Info

- **Current Version**: 1.0.0
- **Browser Support**: Firefox 109+
- **Node.js Required**: 18+
- **React Version**: 18.2.0

---

## Quick Links

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Complete documentation |
| [QUICKSTART.md](QUICKSTART.md) | Fast setup guide |
| [SETUP.md](SETUP.md) | OS-specific instructions |
| [COMMANDS.md](COMMANDS.md) | Command reference |
| [DESIGN_GUIDE.md](DESIGN_GUIDE.md) | UI customization |
| [HARBOR_INTEGRATION.md](HARBOR_INTEGRATION.md) | Harbor integration |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Code organization |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

---

## Support

- 📖 **Documentation**: You're looking at it!
- 🐛 **Issues**: [GitHub Issues](../../issues)
- 💬 **Discussions**: [GitHub Discussions](../../discussions)
- 🔗 **Harbor**: https://github.com/r/Harbor

---

## License

MIT License - See [LICENSE](LICENSE)

---

**Ready to start?** Pick a guide above and dive in! 🎉

The most common starting point is **[QUICKSTART.md](QUICKSTART.md)** ➡️
