# Harbor Test Harness for Third-Party Apps

This directory contains a **test harness** that you can **generate into your project** so you can test your app that uses the Web Agents API (`window.ai` and `window.agent`).

## Quick start: generate the harness

From the Harbor repo root:

```bash
node scripts/generate-test-harness.mjs /path/to/your/project
```

By default this creates a `harbor-test/` folder in the target project with:

- **Mock** – `window.ai` / `window.agent` test doubles for unit tests (no browser needed)
- **Playwright** – Example config and fixtures for E2E tests with Harbor extensions
- **Types** – Optional TypeScript declarations for the Web Agents API
- **README** – How to run unit and E2E tests and where to point extension paths

You can then import the mock in your tests (e.g. `import { installWebAgentsMock } from './harbor-test/mock.js'`) and run E2E using the Playwright config.

## If you're using Cursor

Point Cursor at this repo (e.g. add Harbor as a reference). The rule `.cursor/rules/third-party-testing.mdc` tells the AI to use this harness when you ask to test your Web Agents API app—it can run the generator for you or copy the relevant files into your project.

## What's in the template

| Path in template | Purpose |
|------------------|--------|
| `harness-template/README.md` | Instructions for the generated folder |
| `harness-template/mock.js` | Installable mock for `window.ai` / `window.agent` |
| `harness-template/playwright.harbor.config.example.ts` | Example Playwright config (Chrome + extensions) |
| `harness-template/fixtures/harbor.ts` | Optional fixture: page with Harbor extension paths |
| `harness-template/web-agents-api.d.ts` | TypeScript declarations for the API |

## More

- Full plan and rationale: [docs/THIRD_PARTY_TESTING_PLAN.md](../../docs/THIRD_PARTY_TESTING_PLAN.md)
- Building on the API: [docs/BUILDING_ON_WEB_AGENTS_API.md](../../docs/BUILDING_ON_WEB_AGENTS_API.md)
