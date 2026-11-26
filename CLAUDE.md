# CLAUDE.md — QAKit Project Guide

> Read this file at the start of every session. It encodes project-wide rules, conventions, and "do not break" warnings learned the hard way.

## What this project is

**QAKit** is a Chrome browser extension (Manifest v3) — an all-in-one toolkit for QA engineers and web developers. It provides element inspection, screenshot capture, analytics monitoring, network mocking, page auditing, and session management tools.

- **Source code:** `src/`
- **Manifest:** `src/manifest.json`
- **Current version:** 1.1.0 (in development — 1.0.2 was reverted on CWS, resubmitted as 1.0.3)
- **Documentation:** `docs/`
- **Tech stack:** Vanilla JavaScript (no framework), Chrome Extension APIs (v3), HTML, CSS

## 🚨 Critical rules — DO NOT BREAK

These rules exist because each one was a hard-fought fix. Re-introducing the underlying bug wastes everyone's time.

### 1. Never modify `src/spell-bundle.js`
It's an 825 KB bundled spell-check library. Treat it as a black box — changes will silently corrupt the bundle.

### 2. Theme toggle pattern (Fix 57b)
The theme pill selector (`themeLightBtn` / `themeDarkBtn` in `popup.html`) has a specific implementation pattern:
- Click handlers MUST be wired **inside `renderSettingsPanel()`** in `settings.js`, not at module init. Reason: the panel re-renders, which destroys event listeners.
- Source of truth is `_settings.theme` — read/write this, not DOM state.
- Use `_applyThemeSwitch(theme)` helper to update both buttons + `<body>` class together.
- See `docs/ARCHITECTURE.md § Theme Toggle` for full details.

### 3. Inspector race condition (Fix 75)
The Element Inspector's mousemove handler schedules a `requestAnimationFrame` callback. There's a race where the callback fires after Esc has deactivated the inspector, leaving a stale green border. The fix:
- The rAF callback **must re-check `window.__qInspectorActive`** at its start and bail out if false.
- The Esc handler **must call `cancelAnimationFrame(rafId)`** to kill any pending callback.
- `window.__qInspectorRafId` is the external mirror — `popup.js` `deactivateInspector()` uses it to cancel from outside.
- Do not remove any of these guards.

### 4. Page Audit history (Fix 78)
The history-write block in `page-audit.js` references `urlKey` — this MUST be declared at the top of the try block: `const urlKey = auditKeyForUrl(data.url);`. Without it, history writes silently fail (the surrounding try/catch swallows the ReferenceError) and the History tab is always empty.

### 5. Console noise filter (Fix 80)
`console-shim.js` has a `NOISE_PATTERNS` regex array that silently drops three known harmless page-script warnings before dispatch. **Do not expand this array** without explicit user approval — adding patterns risks suppressing legitimate page errors that QAs need to see.

### 6. Inspect / Spacing / Ruler tile actions
These tile case blocks in `popup.js` are **plain `switchToTab('pagetools')` + sub-tab click**, nothing more. Do NOT add:
- Storage flag writes (`qakit_inspect_active`, `qakit_spacing_active`, `qakit_ruler_active`)
- `tile-active` CSS class application
- `window.close()` calls
- Calls to a non-existent `deactivateInspectTools()` function

These were all explicitly reverted in Issues 67/68/74 because they caused stuck green borders, misleading tile highlights on Home, and other surprising behaviour.

### 7. No remote code execution
QAKit ships zero remote code. All scripts are bundled. The Chrome Web Store privacy policy explicitly states this. Adding any `eval()`, `Function()`, dynamic script imports, or fetched-and-executed code would break that contract and fail review.

### 8. No telemetry / analytics
QAKit collects nothing. No fetch calls to first- or third-party servers other than:
- HEAD requests during Page Audit (link checking — to URLs found on the audited page itself)
- Browser-native chrome.* API calls

Do not add any "ping home", "usage analytics", or "crash reporting" code. The privacy policy guarantees this.


## ✅ Validation — run before every commit

```bash
./scripts/validate.sh
```

The script must report:
- 20 JS files clean (excluding `spell-bundle.js`)
- 5 HTML files balanced (`popup.html`, `json-diff-tool.html`, `text-compare.html`, `help.html`, `privacy-policy.html`)
- `manifest.json` valid v3
- All 12 web-accessible-resources present
- No version-string mismatches

If any of these fail, do not commit. Fix the issue first.

## 📦 Packaging

```bash
./scripts/package.sh                 # auto-bumps patch version (1.0.0 → 1.0.1)
./scripts/package.sh --version 1.1.0 # specific version
```

The script handles version bumping across all files, validation, and zip creation in `releases/`.

## 🗂 File ownership

| File | Purpose | Notes |
|---|---|---|
| `popup.html` / `popup.js` | Main popup UI + tile actions | Avoid mixing concerns — keep tool logic in tool-specific files |
| `background.js` | Service worker, all `chrome.*` API entry points | All cross-tab and persistent logic lives here |
| `content.js` | Content script — bridge between page scripts and popup | Thin layer, mostly message forwarding |
| `pagescripts.js` | MAIN-world page tools (region, element, ruler, responsive) | Has `closeAll()` for Esc handling |
| `inspector.js` | MAIN-world Element Inspector | Has rAF race-condition guards (don't merge with content.js) |
| `console-shim.js` | Console capture wrapper with noise filter | Touch only the noise filter, leave dispatch logic alone |
| `page-audit.js` | Page audit logic + history | Has known idiosyncratic `urlKey` scoping |
| `settings.js` | Settings panel render + theme toggle | Click handlers go INSIDE `renderSettingsPanel()` |
| `cookie-manager.js` | Cookie list with collapsible cards | `.ck-details` is the collapsible section |
| `network-mock.js` / `headers.js` | Net Mock + Headers Modifier | Use `chrome.declarativeNetRequest` |
| `json-diff-tool.{html,js}` | JSON Viewer (opens in new tab) | Tree view needs `min-height: 0` for scroll |
| `text-compare.{html,js}` | Text Compare (opens in new tab) | Has scroll-sync `scrollLock` flag |
| `spell-bundle.js` | Bundled spell check library | **DO NOT TOUCH** |

## 🌿 Workflow

1. **Read `docs/FIX_HISTORY.md`** before starting any fix — avoid re-introducing bugs already solved
2. **Create a branch:** `git checkout -b fix/issue-NN-short-description`
3. **Implement minimal fix only** — no scope creep, no "while I'm in here" cleanup
4. **Run `./scripts/validate.sh`** — must pass
5. **Run the tests** — `npm test` (Playwright suite in `tests/`) and, for a quick static check, `node scripts/regression-check.js`. If your change touches a high-risk fix, keep `tests/regressions.spec.js` green.
6. **Test the exact flow the user reported** — don't assume the fix works
7. **Commit:** `git commit -m "Fix #NN: short description"`
8. **Update `CHANGELOG.md`** if the fix is user-facing
9. **Push and create PR** (or merge directly if working solo)

## 🚫 Common pitfalls (learned the hard way)

- The `spell-bundle.js` file at 825 KB will appear "slow" to navigate — that's expected, it's bundled minified code, treat as immutable
- Don't assume "the v0.0.27 page-audit.js is perfect" — it has the `urlKey` scoping bug Fix 78 patched. Always run validation.
- Don't add `window.close()` to inspect/spacing/ruler tile cases — explicitly reverted
- The Chrome Extension popup re-renders panels on each open — anything wired at module init time gets lost. Wire in render functions.
- Region screenshot relies on the popup being alive briefly to call `chrome.tabs.captureVisibleTab`, then closes via `setTimeout(80)`. Don't refactor this without understanding the timing.
- Element screenshot uses background-side capture (popup closes immediately). Different timing model from Region.
- Do not add new `chrome.storage.local` keys without considering: do they need migration on upgrade? What happens if the schema changes?

## 📞 Communication style

When working on this project with the user (Prem):
- **Be concise** — Prem prefers brief, focused responses
- **Validate before claiming a fix works** — run the validate script
- **Don't make radical changes** without explicit confirmation
- **Surface uncertainty** — "this might also need X" rather than silent assumptions
- **Reference issue numbers** when relevant — they're traceable in `docs/FIX_HISTORY.md`

## 📚 Where to look first

| If you need to understand... | Read this |
|---|---|
| Architecture, design decisions | `docs/ARCHITECTURE.md` |
| All historical fixes (Issues 64-80) | `docs/FIX_HISTORY.md` |
| Permission rationale | `docs/PERMISSIONS.md` |
| Chrome Web Store listing copy | `docs/WEBSTORE_LISTING.md` |
| Contribution workflow | `README.md` |
| Version history | `CHANGELOG.md` |
