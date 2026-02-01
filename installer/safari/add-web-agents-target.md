# Web Agents Extension Target in Safari Project

The Web Agents Extension is already configured in the Xcode project and builds automatically
with the Harbor app. No manual setup is required.

## Project Structure

The Web Agents Extension files are at:
- `installer/safari/Harbor/Web Agents Extension/Resources/` - Extension resources (built from web-agents-api)
- `installer/safari/Harbor/Web Agents Extension/SafariWebExtensionHandler.swift` - Swift handler
- `installer/safari/Harbor/Web Agents Extension/Info.plist` - Extension configuration

## Building

The Safari build script handles everything:

```bash
cd installer/safari
./build.sh
```

This will:
1. Build the web-agents-api extension for Safari (`npm run build:safari`)
2. Copy the built files to `Web Agents Extension/Resources/`
3. Build the Xcode project with both extensions

## How They Work Together

- **Harbor**: Provides LLM access, MCP servers, and infrastructure
- **Web Agents API**: Injects `window.ai` API into web pages, discovers Harbor via extension messaging

The Web Agents extension uses bundle ID `org.harbor.Extension` to find and communicate with Harbor.

## Testing

1. Build the project: `./build.sh` or build in Xcode
2. Run the Harbor.app
3. In Safari:
   - Go to **Safari → Settings → Extensions**
   - You should see both:
     - **Harbor** - the infrastructure extension
     - **Web Agents API** - the web page API extension
   - Enable **both** extensions

## Troubleshooting

### "No such module" errors
Make sure SafariWebExtensionHandler.swift compiles. It should just import SafariServices.

### Extension doesn't appear in Safari
- Clean build folder (⇧⌘K) and rebuild
- Check that manifest.json is in the "Copy Bundle Resources" build phase
- Verify bundle identifier matches: `org.harbor.Web-Agents-Extension`

### Extensions don't communicate
- Both extensions must be enabled in Safari settings
- Check Safari → Develop → Web Extension Background Content for errors
- Harbor extension ID is `org.harbor.Extension`

### Build fails with duplicate symbols
- Make sure you didn't add files to both targets accidentally
- Each extension should have its own separate resources
