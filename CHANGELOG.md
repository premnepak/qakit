# Changelog

All notable changes to QAKit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/your-username/qakit/releases/tag/v1.0.0
