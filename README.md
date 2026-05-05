# QAKit

> All-in-one browser toolkit for QA engineers and web developers.

**Status:** v1.0.2 — in development (queued fixes for next Chrome Web Store update)

QAKit puts the tools QA engineers and developers reach for every day into a single fast popup — element inspection, screenshot capture, analytics monitoring, network mocking, page audits, cookie management, and more — replacing half a dozen single-purpose extensions and the constant juggling of DevTools tabs.

## Features

| Category | Tools |
|---|---|
| **Inspect & Measure** | Element Inspector · Spacing Inspector · Pixel Ruler · Responsive Preview |
| **Capture** | Region Screenshot · Element Screenshot · Full Page Screenshot · Annotate |
| **Data & Network** | Live Analytics (GTM, GA4, Adobe, Tealium, Meta Pixel, Segment) · Network Mock · Headers Modifier · Page Audit |
| **Session & Environment** | Cookie Manager · Local Storage · Console Errors · Environment Marker |
| **Utilities** | JWT Decoder · Base64 / URL Encode/Decode · Time & Timezone · Geolocation Override · Page Metadata Scanner |
| **Tools** | JSON Viewer with Tree Explorer · Text Compare with Diff |

## Privacy

- ❌ No data collection
- ❌ No telemetry
- ❌ No accounts
- ❌ No remote code execution
- ❌ No advertising
- ✅ Everything stays on your device

See [`src/privacy-policy.html`](src/privacy-policy.html) for the full policy.

## Installation

### From Chrome Web Store
*(Coming soon — pending review)*

### Manual install (developer mode)
1. Download the latest release zip from [Releases](../../releases) (or `releases/qakit-v1.0.2.zip`)
2. Extract the zip
3. Open `chrome://extensions/`
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** → select the extracted folder

## Project Structure

```
qakit/
├── src/                  ← Extension source (load this folder in dev mode)
├── docs/                 ← Architecture, fix history, permissions
├── assets/               ← Web Store promotional assets
├── releases/             ← Built zip files
├── scripts/              ← Validation and packaging scripts
├── CLAUDE.md             ← Guide for Claude Code sessions
├── CHANGELOG.md          ← Version history
└── README.md             ← This file
```

## Development

### Prerequisites
- Node.js (any recent version — used only for `node --check` syntax validation)
- Bash (or compatible shell) for the scripts
- `zip` CLI tool

### Workflow

```bash
# Clone
git clone <repo-url>
cd qakit

# Make changes inside src/ ...

# Validate before commit
./scripts/validate.sh

# Build a release zip
./scripts/package.sh                  # auto-bump patch version
./scripts/package.sh --version 1.1.0  # specific version
```

### Loading in Chrome during development
1. `chrome://extensions/`
2. Enable Developer mode
3. Click **Load unpacked** → select the `src/` folder
4. After source changes, click the extension's reload icon

### Testing the build
After running `./scripts/package.sh`, the resulting `releases/qakit-vX.Y.Z.zip` should be:
1. Extracted to a fresh folder
2. Loaded as unpacked in Chrome
3. Smoke-tested across at least: Inspect, Region screenshot, Page Audit, Settings (theme toggle)

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — design decisions, navigation pattern, theme toggle, inspector race fix
- [`docs/FIX_HISTORY.md`](docs/FIX_HISTORY.md) — every fix from issues 64–80, with rationale
- [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md) — Web Store permission justifications
- [`docs/WEBSTORE_LISTING.md`](docs/WEBSTORE_LISTING.md) — listing description, certification notes
- [`CLAUDE.md`](CLAUDE.md) — rules and conventions for AI-assisted development

## Contributing

1. Read [`CLAUDE.md`](CLAUDE.md) — it documents the project's hard-won "do not break" rules
2. Read [`docs/FIX_HISTORY.md`](docs/FIX_HISTORY.md) — avoid re-introducing bugs already fixed
3. Create a branch: `git checkout -b fix/issue-N-description` or `feat/short-name`
4. Implement minimal change — no scope creep
5. Run `./scripts/validate.sh` — must pass
6. Open a PR with a clear description

## Version

**1.0.2** — see [`CHANGELOG.md`](CHANGELOG.md) for full version history.

## License

See [`LICENSE`](LICENSE).

## Contact

- **Email:** qakit.extension@gmail.com
- **Issues:** [GitHub Issues](../../issues)

---

Built with care for the QA & developer community.
