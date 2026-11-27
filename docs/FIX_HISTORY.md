# Fix History

Detailed log of all fixes applied to QAKit. Use this as a reference before tackling new issues — many "new" bugs turn out to be regressions of issues already solved here.

The numbering (Issue 64, Issue 65, etc.) reflects the chronological tracking from the development sessions where these fixes were made. Going forward, new fixes should reference GitHub Issue numbers.

---

## CI regression — Rules lost during first-time initialization

**Symptom:** The Playwright rules-panel test seeded 20 rules but intermittently found only 19 in the panel.

**Root cause:** The popup's initial rules read and a concurrent rule write could both enter first-time migration. Each migration read the empty storage state, and the later migration write could overwrite the newly saved rule.

**Fix:** Share one in-flight initialization promise across callers. Concurrent reads and writes now wait for the same migration; a failed initialization clears the promise so a later call can retry.

**Files touched:** `background.js`

---

## Issue 82 — Markup Annotation Editor

**Feature addition (not a bug fix)**

**Summary:** Every screenshot toast now shows a **✎ Markup** button. Clicking it opens the captured image in a dedicated `markup.html` tab — a full canvas-based annotation workspace.

**Motivation:** QA engineers need to annotate screenshots before filing bugs. Previously, users had to open an external image editor, annotate, and re-save. The new Markup Editor eliminates that round-trip entirely.

**How it works:**
1. A screenshot capture (Region, Full Page, Element, or Annotate) stores the PNG data URL in `chrome.storage.session` under a one-shot key (UUID-like ID tied to the capture timestamp).
2. The toast in the popup/pagetools renders a **✎ Markup** button alongside the existing ⬇ Download.
3. Clicking Markup dispatches a `__qkitEditScreenshot` event on the document. `content.js` forwards this as a `OPEN_MARKUP_EDITOR` message to `background.js`.
4. `background.js` opens `markup.html?id=<key>` in a new tab, then calls `chrome.downloads`-based save when the editor requests it via `FETCH_MARKUP_IMAGE` / `SAVE_MARKUP_IMAGE` messages.
5. `markup.js` loads the image, renders it on a `<canvas>`, and exposes the full annotation toolkit.

**Annotation tools shipped:**
- **Pen** — freehand strokes
- **Rectangle** — outlined box
- **Arrow** — directional arrow with arrowhead
- **Highlight** — semi-transparent colour overlay
- **Blur** — size 1–10: Gaussian blur; size 11–20: mosaic pixelation (for redaction)
- **Number** — auto-incrementing numbered circle markers for step-by-step repros
- **Text** — click-to-place text labels
- **Select** — move/resize committed shapes; Delete key removes
- **Crop** — trim canvas to a drag-selected region

**New permission:** `"downloads"` added to `manifest.json` for `chrome.downloads.download` (Save-As dialog).

**New WAR resources:** `markup.html`, `markup.js`, `markup.css` added to `web_accessible_resources` in `manifest.json`.

**Files touched:** `src/markup.html` (new), `src/markup.js` (new), `src/markup.css` (new), `src/background.js`, `src/content.js`, `src/pagetools.js`, `src/manifest.json`

---

## Issue 81 — Element Inspector freeze gesture not discoverable

**Symptom:** Users didn't realise the Element Inspector badge could be frozen by clicking the page. The existing footer hint (`⎘ copy · 📌 pin · ⌥ click = drill in · click crumb above`) used cryptic symbols and didn't mention freeze / Esc at all.

**Root cause:** Footer copy was abbreviated and assumed familiarity with the 📌 icon and ⌥ symbol.

**Fix:** Rewrote the footer hint inside `renderInspectBadge()` to spell out the gestures: `⎘ copy · Click to freeze · Esc to unfreeze / exit · Alt/⌥-click to drill in · click crumb above`. No behavioural change — click-to-freeze, Alt+click drill-down, and Esc unpin/exit all work exactly as before.

**Files touched:** `src/inspector.js` (single string change in `renderInspectBadge()`)

---

## Issue 64 — Page Audit completely broken on Run

**Symptom:** Clicking "▶ Run" on the Page Audit tool did nothing — no scan started, no results, no errors.

**Root cause:** During an earlier refactor, `restoreAuditResults()` was rewritten to "always show the rich banner". The rewrite introduced two bugs:
1. Removed the `getAuditTab()` call, leaving `currentUrl` undefined and referenced
2. Deleted the same-URL auto-render branch entirely, so even when the URL matched, full results never displayed

**Fix:** Restored `page-audit.js` from the v0.0.27 release zip. That version had the working logic:
- Same URL → auto-render full results
- Different URL → show rich banner with grade, scores, chips, CWV, and "View full results →" button

**Files touched:** `page-audit.js` (full file replaced with v0.0.27 version, then version strings updated)

---

## Issue 69 — Settings panel: theme buttons unclickable + Save broken

### 69a. Theme pill buttons not clickable

**Symptom:** Clicking the ☀ Light / 🌙 Dark buttons in Settings → Theme did nothing. No visual change, no theme switch.

**Root cause:** Click handlers were attached at module init time. But the Settings panel re-renders via `renderSettingsPanel()` every time it opens — which destroys the buttons and recreates them in fresh DOM. The original event listeners point to the old (removed) DOM nodes.

**Fix:** Moved the click handler attachment inside `renderSettingsPanel()` so handlers are wired fresh on every render.

### 69b. Save Settings broken

**Symptom:** Save Settings button silently failed. No toast, no save, no feedback.

**Root cause:** The save handler still tried to read `otherVisible` from `#settingTabsContainer [data-tab-id]`. But that container was emptied when the Visible Tabs UI was removed in Fix 53. The handler hit `if (otherVisible.length === 0) { showLsToast(error); return; }` and bailed before saving anything else.

**Fix:** Removed the dead DOM read entirely. `visibleTabs` now reads from `_settings.visibleTabs` directly, preserving whatever was previously stored.

**Bonus cleanup:** Removed ~50 lines of dead tab-row rendering code that was still running but writing to the empty container, throwing silent ReferenceErrors on every settings open.

**Files touched:** `settings.js`

---

## Issue 70 — Full Page screenshot didn't close popup

**Symptom:** Clicking the Full Page tile triggered the capture but the popup stayed open. User had to manually close it.

**Root cause:** Region and Element captures close the popup immediately because the heavy work happens in the background service worker. Full Page was different — the auto-scroll and stitching were happening in the popup context, which required the popup to stay alive.

**Fix:** Added a new `CAPTURE_FULL_PAGE_AND_TOAST` message in `background.js`. The popup now sends the message, persists Home, and calls `window.close()` immediately. Background runs the full pipeline (scroll → capture → stitch → toast) on its own.

**Files touched:** `background.js`, `popup.js`

---

## Issue 71 — Tile actions don't persist Home on next open

**Symptom:** After running Annotate / Region / Full Page / Element, reopening the popup landed on a tool panel instead of Home.

**Fix:** All four screenshot tile case blocks now call `persistActiveTab('home')` before triggering and `window.close()` after.

**Files touched:** `popup.js`

---

## Issue 72 — Expand/Collapse buttons broken

### 72a. Cookie Manager expand all does nothing

**Root cause:** The toggle handler targeted `.ls-row` elements, but cookie cards use `.ls-card` (different class). The selector matched zero elements.

**Fix:** Rebuilt cookie cards with a collapsible `.ck-details` section (hidden by default). Toggle handler now targets `.ls-card` and shows/hides `.ck-details`.

### 72b. Local Storage expand all requires manual first click

**Root cause:** Local storage row bodies are lazy-rendered (only generated when the user clicks to expand a row). The toggle button just added the `expanded` class — but that class doesn't itself trigger render. So on first click, the body was still empty.

**Fix:** Toggle now calls `header.click()` which triggers the row's own click handler (which lazy-renders the body and shows it).

**Files touched:** `cookie-manager.js`, `popup.js`

---

## Issue 73 — Environment Marker ribbon invisible

**Symptom:** Selecting "Ribbon" style in Env Marker — nothing appeared on the page.

**Root cause:** A previous attempt at corner positioning used negative offsets like `top: -60px; left: -60px`. Combined with the `transform: rotate(45deg)` and `transform-origin: center`, the ribbon ended up positioned outside the viewport entirely. The `overflow: hidden` on the body clipped any visible portion.

**Fix:** Switched to the standard GitHub-style corner ribbon technique:
- `top: 30px` (positive, inside viewport)
- `right: -40px` (slightly off-screen so the ribbon crosses the corner)
- `width: 160px`
- `transform: rotate(45deg)` (or `-45deg` depending on corner)
- `transform-origin: center center` (rotate around middle, not edge)

Each of the four corners has its own offset/rotation combination.

**Files touched:** `env-marker.js`

---

## Issue 75 — Inspector green border persists after Esc

**Symptom:** Run Element Inspector, then switch to Spacing Inspector, then press Esc — the green border stayed on whatever element was last hovered.

**Root cause:** Race condition between `mousemove` events and deactivation.

The `mousemove` handler schedules a `requestAnimationFrame` callback that draws the green overlay. If the user pressed Esc (or switched modes via `deactivateInspector()`) **between** the `mousemove` firing and the rAF callback running (a sub-16ms window), the rAF callback would still execute. The Esc handler had already hidden the overlay, but the rAF callback re-shows it via `positionOverlay()`. Result: stale green border.

**Fix (3 parts):**

1. The rAF callback now re-checks `window.__qInspectorActive` at its start. If false, it calls `hideAll()` and bails out.
2. The Esc handler in `inspector.js` calls `cancelAnimationFrame(rafId)` synchronously, killing any pending callback.
3. `popup.js`'s `deactivateInspector()` cancels via `window.__qInspectorRafId` — a mirror of `rafId` exposed for cross-context cancellation.

All three guards are required. Removing any single one re-introduces the bug.

**Files touched:** `inspector.js`, `popup.js`

---

## Issue 76 — Screenshot keyboard shortcuts not firing

**Symptom:** `Ctrl+Shift+U` (Region) and `Ctrl+Shift+K` (Full Page) were not triggering. The two inspect shortcuts (`Q`, `Y`) worked fine.

**Root cause:** `Ctrl+Shift+U` is bound by Chrome on some platforms (text input methods on Linux/Windows). `Ctrl+Shift+K` is sometimes bound by other extensions. When Chrome detects a conflict, the extension shortcut is silently ignored.

**Fix (v1):** Removed the `suggested_key` defaults for `capture-region` and `capture-fullpage` in `manifest.json`. The commands are still registered, so users can manually configure their preferred shortcut at `chrome://extensions/shortcuts`. Avoids the conflict.

**Fix (v2):** Re-assigned to conflict-free keys: `Ctrl+Shift+Z` (Region) and `Ctrl+Shift+F` (Full Page). These are not bound by Chrome or Windows. `mac` variants use `Command+Shift+Z` and `Command+Shift+F`.

**Files touched:** `manifest.json`, `help.html`

---

## Issue 77 — JSON Viewer Tree View not scrollable

**Symptom:** Loading a large JSON in Tree View — the tree extended below the viewport but couldn't be scrolled.

**Root cause:** Standard CSS flex pitfall. `.qd-tree-pane` had `flex: 1` but no `min-height: 0`, so the flex child wouldn't shrink below its content size. Result: the inner `.qd-tree-content` (which had `overflow: auto`) couldn't actually scroll because its parent expanded to fit.

**Fix:** Added `min-height: 0` to both `.qd-tree-pane` and `.qd-tree-content`. Also added `overflow: hidden` to `.qd-tree-pane` to ensure the scroll happens at the inner content level.

**Files touched:** `json-diff-tool.html`

---

## Issue 78 — Page Audit History tab always empty

**Symptom:** Run audits multiple times, switch to History tab — always blank.

**Root cause:** Silent failure. The history-write block referenced `urlKey` but never declared it:

```javascript
try {
  const h = await chrome.storage.local.get(AUDIT_HISTORY_KEY);
  const history = h[AUDIT_HISTORY_KEY] || {};
  const runs = history[urlKey] || [];  // ← urlKey undefined
  // ...
} catch(_) {}  // ← silently swallows ReferenceError
```

The surrounding `try/catch(_) {}` swallowed the `ReferenceError`, so history was never saved and the History tab was always empty. **This bug was present in v0.0.27 too** — restored as part of Fix 64 — and only revealed itself when the History tab was tested.

**Fix:** Declared `urlKey` at the top of the try block: `const urlKey = auditKeyForUrl(data.url);`. Also added `console.warn` to the catch so future failures are visible.

**Files touched:** `page-audit.js`

---

## Issue 79 — Privacy policy: remove "Open source transparency" callout

**Reason:** User feedback — the callout suggesting users could inspect the source via `chrome://extensions/` was deemed misleading for a Web Store listing (where users typically don't have access to unpacked source).

**Fix:** Removed the callout block.

**Files touched:** `privacy-policy.html`

---

## Issue 80 — Console panel polluted by harmless page-script warnings

**Symptom:** Console Errors panel showed three repeating warnings from the page being tested:
- "New element is longer than 100 characters. Skipping."
- "Hovered element is invalid or has no innerText."
- "New element is the same as the last element in the array. Skipping."

These came from a third-party script on the test page, not from QAKit itself. They cluttered the panel without providing useful information.

**Fix:** Added `NOISE_PATTERNS` regex array at the top of `console-shim.js` with the three patterns. Filter runs **before** the dedup + dispatch step. The actual capture pipeline is unchanged — every other warning, error, and uncaught exception still flows through normally.

**Important constraint:** This filter must NOT be expanded without explicit user approval. Adding patterns risks suppressing legitimate page errors that QAs need to see.

**Files touched:** `console-shim.js`

---

## Reverted: Issues 67 / 68 / 74

These were attempts to add "smart" behaviour to the inspect/spacing/ruler/viewports tiles:

- **67a/67b** — Tile-active highlights on Home (green border on whichever inspector is currently running)
- **68a/68b** — Auto-restore Viewports tab if user had it open last
- **74** — Mutual exclusion of inspect tools via `deactivateInspectTools()` function

**Why reverted:** They had unintended consequences:
- Stuck green borders on website elements after Esc
- Misleading "selected" highlights on Home tiles even when tools weren't actually active
- Esc deactivation wasn't properly clearing the storage flags, so the highlights got out of sync with reality
- The `qakit_responsive_active` flag never got cleared, causing the popup to keep returning to Viewports

**Reverted:** All `qakit_*_active` storage flag writes, all `tile-active` CSS, the `deactivateInspectTools()` function, the `updateInspectTileHighlights()` function, the smart viewports restore logic, and `window.close()` from inspect/spacing/ruler tiles. They went back to plain `switchToTab('pagetools')` calls.

**Files touched (reverted):** `popup.js`, `pagetools.js`, `popup.html`

**Lesson:** Don't add cross-cutting "smart" behaviour without a clear teardown story. Each "active" flag must be cleared in every code path that deactivates the tool, including Esc, popup close, navigation, page reload, and the user clicking another tile.

---

## Format for future fixes

When adding a new fix, follow this template:

```markdown
## Issue #NN — Short title

**Symptom:** What the user observed.

**Root cause:** What was actually wrong (technical detail).

**Fix:** What was changed and why this approach.

**Files touched:** Comma-separated list.

(Optional) **Constraints:** Anything that must NOT change in future.
```
