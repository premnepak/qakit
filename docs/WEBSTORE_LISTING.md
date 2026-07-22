# Chrome Web Store Listing

This document contains all the copy and metadata for the QAKit Web Store listing. Update here, then paste into the Developer Dashboard.

## Item details

- **Name:** QAKit
- **Category:** Developer Tools
- **Language:** English
- **Primary contact email:** qakit.extension@gmail.com

## Short description (132 char limit)

> QAKit — All-in-one toolkit for QA engineers & developers: inspect, capture, audit, mock requests, manage cookies & storage.

(Currently 123/132 chars.)

## Detailed description

```
QAKit — All-in-one browser toolkit for QA engineers and web developers

QAKit puts the tools you reach for every day inside a single, fast popup. No more juggling DevTools tabs, command-line scripts, or half a dozen single-purpose extensions — QAKit has them in one place, designed for the way QAs and developers actually work.

Inspect & Measure
• Element Inspector shows test IDs, computed CSS, accessibility role, and the box model on hover
• Spacing Inspector visualises margin and padding with coloured guides
• Pixel Ruler for precise on-screen measurements
• Responsive Preview at common device widths

Capture
• Region, Element, and Full Page screenshots — copied to clipboard with a one-click "Save as PNG" toast
• Annotate any page before capturing (arrows, shapes, text, highlights)

Data & Network
• Live Analytics feed — captures GTM, GA4, Adobe, Adobe DataLayer, Tealium, Meta Pixel, Segment, Floodlight, and DDL events as they fire
• Network Mock — intercept HTTP requests and return custom JSON, status codes, redirects, or block them entirely
• Headers Modifier — inject auth tokens, override CORS, or customise any request/response header

Page Audit
Comprehensive scan with grades for Performance, Security, and Accessibility. Detects broken links, broken images, spelling errors, console errors, missing security headers, contrast failures, and missing alt text.

Session & Environment
• Cookie Manager • Local Storage browser • Console Errors capture
• Environment Marker — visual badge so you always know which env you're testing

Developer Utilities
JWT decoder • Base64 / URL encode/decode • Time & timezone tools • Geolocation override • JSON Viewer with tree explorer • Text Compare with side-by-side diff

Privacy first — QAKit does not collect, transmit, or sell any data. Everything stays on your device.

Built by QA engineers, for QA engineers.
```

## Single purpose statement

> QAKit is a QA and developer toolkit that provides inspection, screenshot capture, analytics monitoring, network request mocking, page auditing, and session management tools for testing web applications.

## Permission justifications

See [`PERMISSIONS.md`](PERMISSIONS.md) for the complete set, formatted ready to paste.

## Notes for testers (Microsoft / certification team — under 2,000 chars)

```
QAKit v1.0.0 — Certification Notes

QAKit is a QA/developer toolkit providing inspection, screenshot capture, analytics monitoring, network mocking, page auditing, and session management for web testing.

Key features to test:

1. Element Inspector — Click "Inspect" tile, hover over page elements. Should show test IDs, CSS, box model, accessibility role.

2. Screenshots — Click Region/Element/Full Page tiles. Region and Element should show selector overlays; Full Page should auto-stitch scrolled pages. All should copy to clipboard with "Save as PNG" toast.

3. Page Audit — Click "Audit" tile, then "Run". Should scan for broken links (HEAD requests to URLs on the page), broken images, a11y issues, console errors, spelling, security headers. Different URL = rich banner; same URL = full results.

4. Analytics — Click "Analytics" tile. Should capture GTM, GA4, Adobe Analytics, Adobe DataLayer, Tealium, Meta Pixel, Segment, Floodlight events fired by the page in real time.

5. Network Mock — Click "Net Mock" tile. Create rule: match URL pattern, return custom JSON. Reload page — rule should fire.

6. Cookies/Storage — Click "Cookies" or "Storage" tiles. Should list domain cookies and localStorage keys. Expand/collapse buttons should work.

7. Dark Mode — Click Settings, toggle ☀ Light / 🌙 Dark pill. Should switch UI theme immediately and persist.

8. Inspector deactivation — Run Inspect or Spacing, press Esc. Green border should disappear. Switch modes (Inspect → Spacing) without closing popup — green border should not persist.

9. Privacy — Open privacy-policy.html. Should explain all data stays on device (no transmission, no collection).

No telemetry, no accounts, no remote code execution. All data local.
```

## Promotional assets

- **Small promo tile** (440×280, 24-bit PNG, no alpha): [`assets/promo-tile-440x280.png`](../assets/promo-tile-440x280.png)
- **Marquee promo tile** (1400×560, 24-bit PNG, no alpha): [`assets/marquee-1400x560.png`](../assets/marquee-1400x560.png)
- **Screenshot** (1280×800): [`assets/screenshots/home-screen-1280x800.png`](../assets/screenshots/home-screen-1280x800.png)

## Privacy policy

URL: Host `src/privacy-policy.html` somewhere accessible (e.g., GitHub Pages on this repo) and submit that URL.

To enable GitHub Pages:
1. Repo Settings → Pages → Source: deploy from branch `main`, folder `/src`
2. Privacy policy will be available at `https://<your-username>.github.io/qakit/privacy-policy.html`

Alternatively, you can use the raw GitHub URL:
`https://github.com/<your-username>/qakit/blob/main/src/privacy-policy.html`

## Submission checklist

- [ ] Manifest v3 — verified
- [ ] Description ≤ 132 chars — verified (123)
- [ ] All 12 web-accessible-resources present — verified
- [ ] Icons 16×16, 48×48, 128×128 PNG — verified
- [ ] Screenshot uploaded (1280×800)
- [ ] Small promo tile uploaded (440×280)
- [ ] Marquee promo tile uploaded (1400×560)
- [ ] Privacy policy URL provided
- [ ] All permission justifications filled in
- [ ] Single purpose statement filled in
- [ ] Data usage compliance certified
- [ ] Publisher contact email entered & verified
- [ ] Notes for testers filled in (if applicable)

## Post-submission

After approval (typically 1-3 days):
1. Tag the released commit: `git tag -a v1.0.0 -m "v1.0.0 Web Store release"` and push
2. Create a GitHub Release with the zip
3. Update README badge / Web Store install link
4. Monitor user reviews and the developer dashboard for crash reports
