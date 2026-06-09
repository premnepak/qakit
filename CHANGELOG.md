# Changelog

All notable changes to QAKit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---


## [1.0.5] — 2026-06-09

### Changed
- Version bump to **1.0.5** across extension manifests, package metadata, and user-facing pages.
- Updated help/release-policy surfaces (`help.html`, `privacy-policy.html`, `welcome.html`, `changelog.html`) to reflect the new release version.
- Updated README release references and release-status text to 1.0.5.

---


## [1.0.4] — 2026-05-10

This is the quality-verified follow-up to 1.0.2/1.0.3. Every feature has been retested end-to-end against the published extension, and a comprehensive automated regression suite has been built to protect all future releases. As advocates of quality engineering, our commitment is to ship software you can rely on.

### Fixed
- **Markup editor — "Screenshot not found" error** — the "✎ Markup" button was silently failing after the popup was closed and reopened. Root cause: the screenshot dataURL was held in an in-memory Map on the service worker, which Chrome wiped whenever the SW was terminated between taking the screenshot and the Markup tab loading. Fixed by switching to `chrome.storage.session`, which persists reliably for the lifetime of the browser session regardless of service worker restarts.

### Quality
- **Full regression test suite** — a comprehensive end-to-end test suite covering the entire extension has been built and validated alongside this release. Every future update will be run against it before shipping.
- **Complete re-verification of 1.0.2 features** — all features introduced in 1.0.2 were retested against the published extension before this release. Where 1.0.3 was a straight resubmission, 1.0.4 is the version we're confident in.

### Changed
- Various small polish improvements across the extension based on findings from the regression pass.

---

## [1.0.3] — 2026-05-09

Shortly after 1.0.2 went live on the Chrome Web Store, issues were identified that required the release to be pulled. 1.0.3 is the clean resubmission — same features as 1.0.2, no code changes. The underlying issues are addressed fully in 1.0.4.

---

## [1.0.2] — 2026-05-07

### Added
- **Markup Annotation Editor** — every screenshot toast now includes a **✎ Markup** button. Clicking it opens the captured image in a full-screen, canvas-based annotation editor in a new tab. Available tools: freehand pen, rectangle, arrow, highlight (semi-transparent marker), blur/redact (Gaussian blur at size 1–10; mosaic pixelation at size 11–20), numbered step markers (auto-increment), text labels, select/move/resize, and crop. Includes undo/redo, copy to clipboard, and Save (always triggers the OS Save-As dialog).

### Fixed
- **Keyboard shortcuts corrected** — Region Screenshot is now `Ctrl+Shift+Z` / `Cmd+Shift+Z`; Full Page Screenshot is now `Ctrl+Shift+F` / `Cmd+Shift+F`. Both shortcuts are now registered as default keys in the manifest (previously they were unset, requiring users to configure them manually). Context menu labels, tile hints, and the settings keyboard-reference table are all updated to match.
- **Ruler — multi-line persistent measurements** — a second click now _locks_ the current measurement as a permanent teal line on screen (with endpoint dots and a distance label). You can continue drawing a new measurement immediately. All locked lines stay visible until you press Esc, so you can accumulate several measurements side-by-side.
- **Screenshot Save button always shows Save-As dialog** — the ⬇ Save button in all screenshot toasts now routes through `chrome.downloads.download({ saveAs: true })`, so the OS file-picker always appears regardless of Chrome's global "Ask where to save" preference. Previously the button used a silent anchor-click download.
- **Time & Epoch — World Clock sub-tab active on first load** — opening the Time panel no longer leaves the World Clock sub-tab unselected. The bug was caused by `initSubTabs` in `popup.js` matching Page Audit's same-class buttons, which set `data-sub` to `undefined` and hid all sub-panels. Fixed by removing the duplicate call and relying on `time.js`'s own scoped initialisation.

### Changed
- **Element Inspector — Best Locators switcher** redesigned: each button now shows an inline SVG framework icon (CSS, XPath, Playwright, Cypress) with a distinct active colour per framework (green / yellow / blue / purple). Tooltips show the full framework name instead of the abbreviated "PW" / "Cy" labels.
- **Element Inspector — badge footer hint** rewritten to spell out the gestures clearly: "⎘ copy · Click to pin 📌 · Esc to unpin / exit · Alt/⌥-click to drill in · click crumb above".

---

## [1.0.1] — 2026-05-01

### Added
- Playwright end-to-end tests for popup and inspector (`tests/`)

### Changed
- Spacing Inspector now displays gap distance (in px) between hovered element and its sibling neighbours

---

## [1.0.0] — 2026-04-29 — Web Store submission

First public release, ready for Chrome Web Store submission.

### Added
- Privacy policy (`privacy-policy.html`) with full permission justifications
- Help guide (`help.html`) — 13 sections, ~3,900 words covering every feature
- Web Store promotional assets (440×280 small tile, 1400×560 marquee, 1280×800 screenshot)
- Console noise filter — silently drops 3 known harmless page-script warnings
- Page Audit history persistence (last 10 runs per URL)

### Fixed
- **Issue 64** — Page Audit was completely broken on Run; restored from working v0.0.27 implementation
- **Issue 69a** — Theme pill buttons were unclickable after settings panel re-open (handlers now wired inside `renderSettingsPanel()`)
- **Issue 69b** — Save Settings was silently failing due to dead DOM read of removed Visible Tabs section
- **Issue 70** — Full Page screenshot now closes popup immediately and runs capture+stitch+toast in background, matching Region/Element flow
- **Issue 71** — Annotate / Region / Full Page / Element tile actions now persist Home so reopening lands on Home
- **Issue 72a** — Cookie Manager Expand/Collapse all toggle was a no-op; rebuilt cards with collapsible `.ck-details` section
- **Issue 72b** — Local Storage Expand all required manual first click; now triggers lazy body render via `header.click()`
- **Issue 73** — Environment Marker ribbon was invisible; restored using GitHub-style positioning (`top:30px; right:-40px; transform:rotate(45deg)`)
- **Issue 75** — Element Inspector green border persisted on screen after Esc when switching modes; fixed race condition between `mousemove` rAF callback and deactivation
- **Issue 76** — Screenshot keyboard shortcuts were not firing due to Chrome conflicts; default keys removed (users configure at `chrome://extensions/shortcuts`)
- **Issue 77** — JSON Viewer Tree View was not scrollable; added `min-height: 0` to flex containers
- **Issue 78** — Page Audit History tab was always empty due to missing `urlKey` declaration that silently failed inside try/catch
- **Issue 79** — Removed "Open source transparency" callout from privacy policy
- **Issue 80** — Console Errors panel polluted by 3 harmless page-script warnings; added `NOISE_PATTERNS` filter that preserves all other capture

### Changed
- Description trimmed to 123/132 chars for Web Store listing compliance
- Manifest description rewritten for clearer feature framing

### Reverted
- **Issues 67/68/74** — Removed inspect/spacing/ruler tile-active highlights, smart viewports restore, `deactivateInspectTools()` function, and `window.close()` on inspect tile clicks. These had caused stuck green borders on websites and tiles appearing selected on Home.

### Security & Privacy
- Verified zero remote code execution
- Verified zero telemetry / analytics
- All permission justifications documented in `docs/PERMISSIONS.md`

---

## [0.0.30] — 2026-04-29 (internal)
- Privacy policy comprehensive rewrite
- Help guide v0.0.30 published
- Validation infrastructure tightened

## [0.0.29] — 2026-04-28 (internal)
- First batch of post-v0.0.28 fixes
- Reverts of inspect/spacing/ruler highlights

## [0.0.28] — 2026-04-27 (internal)
- Multiple bug fixes (54-68)
- Theme pill selector introduced

## [0.0.27] — 2026-04-26 (internal)
- Page Audit baseline (later restored as Fix 64)
- Console capture pipeline finalised

## [0.0.16] — 2026-04-23 (internal, first build)
- Initial extension scaffold
- Core tool registry

---

## Version numbering note

Internal pre-release versions (0.0.x) are kept here for historical traceability, but the public release lifecycle starts at **1.0.0**. Future versions will follow [SemVer](https://semver.org/):

- **MAJOR** — breaking UI change or removed feature
- **MINOR** — new feature added
- **PATCH** — bug fix or doc update

[1.0.5]: https://github.com/premnepak/qakit/releases/tag/v1.0.5
[1.0.4]: https://github.com/premnepak/qakit/releases/tag/v1.0.4
[1.0.3]: https://github.com/premnepak/qakit/releases/tag/v1.0.3
[1.0.2]: https://github.com/premnepak/qakit/releases/tag/v1.0.2
[1.0.1]: https://github.com/premnepak/qakit/releases/tag/v1.0.1
[1.0.0]: https://github.com/premnepak/qakit/releases/tag/v1.0.0
