# Permissions

QAKit requests the following Chrome permissions. Each is used solely for the corresponding feature. This document is the canonical source for Web Store review submissions.

## Summary

| Permission | Used for |
|---|---|
| `activeTab` | Reading active tab content for inspection / capture |
| `scripting` | Injecting local extension scripts into the active tab |
| `storage` | Persisting user settings and rules locally |
| `tabs` | Identifying active tab, capturing visible area, opening tool tabs |
| `cookies` | Cookie Manager feature |
| `debugger` | Computed style + box model retrieval for inspectors |
| `declarativeNetRequest` | Network Mock feature |
| `declarativeNetRequestWithHostAccess` | Network Mock + Headers Modifier across user-chosen domains |
| `windows` | Opening JSON Viewer / Text Compare / Help in new tabs |
| `contextMenus` | Right-click shortcuts |
| `<all_urls>` host permission | Working on any site the user is testing |

## Detailed justifications (paste into Web Store submission)

### `activeTab`
> Required to read the DOM, CSS, and content of the page the user is actively testing. Used by Element Inspector, Spacing Inspector, Page Metadata, Page Audit, and screenshot capture. Only accesses the tab the user has open — never background tabs.

### `contextMenus`
> Adds QAKit shortcuts to the browser right-click menu so users can quickly trigger Element Inspector, Region Screenshot, Full Page Screenshot, and Element Capture directly from the page without opening the popup.

### `cookies`
> Required for the Cookie Manager feature, which lets users view, edit, and delete cookies for the domain they are testing. Only reads cookies for the active tab's domain. No cookies are transmitted externally.

### `debugger`
> Used by the Element Inspector and Spacing Inspector to retrieve computed styles, box model metrics, and accessibility properties for the element the user hovers over. Only attaches to the active tab while the inspection tool is running.

### `declarativeNetRequest`
> Required for the Network Mock feature, which lets users create rules to intercept HTTP requests and return custom responses (mock JSON, status codes, redirects, or blocks). Rules are user-defined and stored locally.

### `declarativeNetRequestWithHostAccess`
> Required alongside `declarativeNetRequest` so that Network Mock and Headers Modifier rules can match requests on any domain the user chooses to test. Rules only apply to URLs matching the user's configured patterns.

### Host permission (`<all_urls>`)
> QAKit is a general-purpose QA tool that must work on any website the user is testing. Host permission is required so that content scripts, inspection tools, screenshot capture, analytics monitoring, and network mocking function on all domains. Users can restrict which domains QAKit activates on via Settings → Allowed Domains.

### Remote code use
> QAKit does not load or execute any remote code. All scripts are bundled in the extension package. The `scripting` permission is used to inject local extension scripts (Element Inspector, analytics interceptor, console capture, geolocation override) into the active tab at the user's request. No code is fetched from external servers.

### `scripting`
> Required to inject QAKit's local inspection and capture scripts into the active tab when the user activates a tool. Scripts injected include: Element Inspector, Spacing Inspector, analytics event interceptor, console error capture shim, geolocation override, and screenshot region selector. All scripts are bundled locally in the extension — none are fetched remotely.

### `storage`
> Required to save user settings, Network Mock rules, Headers Modifier rules, Environment Marker configurations, Page Audit history, and analytics search filters locally using `chrome.storage.local`. No data is synced or transmitted externally.

### `tabs`
> Required to identify the active tab's URL (for domain filtering and Page Audit), capture the visible tab area for screenshots (`chrome.tabs.captureVisibleTab`), and open JSON Viewer, Text Compare, and Help in new browser tabs.

## Single purpose statement

> QAKit is a QA and developer toolkit that provides inspection, screenshot capture, analytics monitoring, network request mocking, page auditing, and session management tools for testing web applications.

## Data usage certification

QAKit's data handling complies with Chrome Web Store developer programme policies:

- ✅ No user data is collected or transmitted
- ✅ No data is sold or transferred to third parties
- ✅ No data is used for purposes unrelated to the extension's single purpose
- ✅ All data accessed (cookies, storage, page content) stays on the user's device
- ✅ No remote code execution

## Network requests made by the extension

The only outbound network requests QAKit makes on the user's behalf:

- **HEAD requests during Page Audit** — to URLs found on the page being audited, for broken-link detection. These go directly from the browser to the destination URLs; QAKit does not relay or log them.
- **No other outbound traffic.** No telemetry, no analytics, no update pings beyond what the Chrome Web Store performs for all extensions.
