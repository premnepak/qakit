# Architecture

This document captures the design decisions, patterns, and architectural conventions of QAKit. Read this before making non-trivial changes.

## High-level structure

QAKit is a Manifest V3 Chrome extension with three main runtime contexts:

```
┌──────────────────┐  message  ┌──────────────────┐  scripting  ┌─────────────────┐
│  Popup (popup.js)│ ◄───────► │ Background (SW)  │ ──────────► │ Content scripts │
│                  │           │  background.js   │             │  + MAIN-world   │
│  - Tile actions  │           │  - chrome.* APIs │             │  - inspector.js │
│  - Settings      │           │  - DNR rules     │             │  - pagescripts  │
│  - Tool UIs      │           │  - Cookies       │             │  - console-shim │
└──────────────────┘           └──────────────────┘             └─────────────────┘
                                                                          │
                                                                          ▼
                                                                  Active web page
```

- **Popup** (`popup.html` + `popup.js`) — the UI the user sees when they click the extension icon. Re-renders on every open. Uses tiles to invoke tool panels.
- **Background service worker** (`background.js`) — persistent message router, owner of all `chrome.*` API calls that need persistent state (DNR rules, cookies, context menus, screenshot stitching).
- **Content scripts** — injected into every matching page on demand, run in the page's content script context.
- **MAIN-world scripts** (`inspector.js`, parts of `pagescripts.js`) — injected into the page's actual JavaScript context when needed (e.g., to read `dataLayer`, override `navigator.geolocation`, intercept `XMLHttpRequest`).

## Navigation pattern: Option 2 — Pure Launcher

The popup is structured as a "launcher" rather than a tab strip:

- **Tab bar is permanently hidden** (`display: none`)
- **Home is the base layer** — a tile grid (z-index: 1)
- **Tool panels are full-screen overlays** inside `.panel-area`
- **Slide-in animation** — `transform: translateX(100%) → 0` when panel opens
- **Each panel has a green ← Home button** injected top-left via `ensurePanelNav()` in `popup.js`
- **QAKit header + footer always visible** (outside `.panel-area`)
- **Settings opens via** `switchToTab('settings')` and returns to `window._prevTab` on close

Why this matters: panels don't compete with each other for tab bar space, and the user always has a single clear way to return Home.

## Home page tile layout

6 tile groups, mostly 4-column (TOOLS group is 3-column):

1. **INSPECT & MEASURE:** Inspect, Spacing, Ruler, Viewports
2. **CAPTURE:** Annotate, Region, Full Page, Element
3. **DATA & NETWORK:** Analytics, Net Mock, Headers, Page Audit
4. **SESSION & ENVIRONMENT:** Env Marker, Cookies, Storage, Console
5. **UTILITIES:** Time, Encode, Geolocation, Metadata
6. **TOOLS (3-col):** JSON Viewer ↗, Text Compare ↗, Help

Each tile is a button with an icon, name, and optional hint. Tile actions are dispatched through a switch statement in `popup.js`.

## Theme toggle (Fix 57b)

The Settings panel has a single-line theme selector:

```
🎨 Theme        ☀ Light | 🌙 Dark
```

**Implementation pattern (do not deviate):**

- Two buttons: `themeLightBtn` and `themeDarkBtn` in `popup.html`
- Active button: green background, dark text, bold (700)
- Inactive button: transparent, muted text, semi-bold (600)
- **Source of truth:** `_settings.theme` (`'light'` or `'dark'`)
- `_applyThemeSwitch(theme)` is the single function that updates both buttons + `<body>` class. Always use it; never set styles inline.
- **Click handlers wired inside `renderSettingsPanel()`** — not at module init. Reason: the panel re-renders, which destroys event listeners attached at init.
- Save handler reads `_settings.theme` directly (radio inputs were removed).

## Inspector race condition (Fix 75)

The Element Inspector overlays a green border on whatever element the cursor hovers over. Each `mousemove` schedules a `requestAnimationFrame` callback that draws the border.

**The bug:** if the user pressed Esc (or switched modes) between `mousemove` firing and the rAF callback running, the rAF callback would still execute and re-show the border — leaving a stale green outline that wouldn't go away.

**The fix has 3 parts:**

1. The rAF callback **re-checks `window.__qInspectorActive`** at its start. If false, it calls `hideAll()` and bails.
2. The Esc handler in `inspector.js` **calls `cancelAnimationFrame(rafId)`** to kill any pending callback synchronously.
3. The external deactivator (`deactivateInspector` in `popup.js`) cancels via `window.__qInspectorRafId` — a mirror of `rafId` exposed for cross-context use.

All three guards must remain in place. Removing any one re-introduces the bug.

## Page Audit storage model

Two `chrome.storage.local` keys:

- **`qa_audit_last`** — most recent run, full payload + pageInfo (used by "View full results")
- **`qa_audit_history`** — `{ urlKey: [run1, run2, ...] }`, max 10 lightweight summaries per URL

`auditKeyForUrl(url)` is the URL normalisation function — **must be used identically** on both write and read sides, otherwise lookups miss silently.

**Critical (Fix 78):** The history-write block in `page-audit.js` declares `urlKey` at the top of its try block:

```javascript
const urlKey = auditKeyForUrl(data.url);
```

Without this declaration, the surrounding try/catch silently swallows the `ReferenceError` and history is never written. The History tab will appear empty.

## Console Errors capture pipeline

`console-shim.js` runs in the MAIN world (injected at `document_start`) and wraps `console.error`, `console.warn`, and the `error` / `unhandledrejection` event listeners. Each captured event is dispatched as a `CustomEvent('__qConsoleError')` which the content script picks up and forwards to the popup.

**Noise filter (Fix 80):** A `NOISE_PATTERNS` regex array filters out three known harmless page-script warnings before the dedup + dispatch step. Do not expand this list without explicit user approval — adding patterns risks suppressing legitimate page errors that QAs need to see.

## Screenshot capture flow

Two timing models:

### Region capture (popup must be alive briefly)
1. User clicks Region tile
2. Popup calls `chrome.tabs.captureVisibleTab` (must happen while popup is alive)
3. Popup stores screenshot in background, injects region-selector overlay
4. After 80ms timeout, popup closes via `window.close()`
5. User drags rectangle on page → background crops → injects toast on the page

### Element / Full Page capture (background-only)
1. User clicks tile
2. Popup sends message to background (e.g., `CAPTURE_FULL_PAGE_AND_TOAST`), persists Home, calls `window.close()` immediately
3. Background runs the capture pipeline (auto-scroll for full page; element picker for element)
4. Background calls `injectScreenshotToast()` to show success toast on the page

Both flows end with the same browser-level toast (injected onto the page itself, not into the popup).

## Permissions philosophy

QAKit requests broad permissions (`<all_urls>`, `debugger`, `cookies`, etc.) because it's a general-purpose tool that must work on whatever site the user is testing. The mitigation is:

- **No remote code** — all scripts are bundled. Verified at build time.
- **No persistent network calls** — only HEAD requests during Page Audit (link checking on the audited page).
- **No telemetry** — zero analytics, zero "phone home", zero crash reporting.
- **User control** — Settings → Allowed Domains restricts which domains QAKit activates on.
- **Local storage only** — `chrome.storage.local`, never `chrome.storage.sync` (which would replicate user data to Google's servers).

The privacy policy makes all of this explicit and binding.

## Things not done (intentional)

- **No build step** — vanilla JavaScript, no bundler, no transpilation. Files in `src/` are exactly what runs.
- **No framework** — no React, no Vue, no Lit. Direct DOM manipulation throughout. Reason: smaller bundle, no runtime cost, no version churn.
- **No package.json** in `src/` — there are no JS dependencies. Node is used only for syntax validation in `scripts/validate.sh`.
- **No `chrome.storage.sync`** — explicitly local-only for privacy.

## Testing

The project has a **Playwright suite** (`tests/`, 19 spec files) that loads the unpacked extension from `src/` into a persistent Chromium context. Key pieces:

- `tests/fixtures.js` — shared fixtures: `context` (extension loaded), `extensionId` (resolved from the service worker URL), and `popupPage` (an already-opened `popup.html`). Note it launches with `headless: false` because Chrome extensions don't load in headless mode; CI runs the whole thing under `xvfb-run`.
- `tests/regressions.spec.js` — pins the high-risk fixes from `FIX_HISTORY.md` (e.g. Fix 57b theme toggle, Fix 78 Page Audit history). Keep these green or document the intentional change in `CHANGELOG.md`.
- `scripts/regression-check.js` — a static, browserless sanity check on `manifest.json` and the critical fixes (`node scripts/regression-check.js`).
- CI: `.github/workflows/validate.yml` runs `validate.sh`, then the Playwright suite, then publishes the HTML report to GitHub Pages.

Run locally with `npm test` (or `npx playwright test`); `npm run test:report` opens the last HTML report.

**Config caveat:** the `use` block in `playwright.config.js` (headless + `--load-extension` args) is effectively unused — every test builds its own context via `fixtures.js`. Don't rely on those config values.

## File ownership

See [`CLAUDE.md`](../CLAUDE.md) § File ownership for the full table.
