# Page Object Model (POM) Architecture for QAKit Tests

## Start Here

1. Run the complete Playwright suite with `npm test`.
2. Run the POM examples with `npm test -- tests/example-pom-tests.spec.js`.
3. Use the `popup` fixture to navigate and `pageObjects` to create a
   feature-specific page object.
4. See the page-object inventory below for methods and examples.

```javascript
const { test, expect } = require('./fixtures');

test('creates a network mock rule', async ({ popup, popupPage, pageObjects }) => {
  await popup.openPanel('net');
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  await networkMock.createRule({ name: 'API mock', pattern: '/api' });
  expect(await networkMock.getRuleCount()).toBe(1);
});
```

## Quick Reference

| Need | Page object | Common actions |
| --- | --- | --- |
| Popup navigation | `PopupPage` | `openPanel()`, `openStandalone()` |
| Network request mocks | `NetworkMockPage` | `createRule()`, `editRule()`, `deleteRule()`, `toggleRule()` |
| Cookie manager | `CookieManagerPage` | `refresh()`, `getCookieCount()`, `editCookie()` |
| Page audit | `PageAuditPage` | `runAudit()`, `waitForAuditComplete()`, `exportAs()` |
| Header rules | `HeadersPage` | `createRule()`, `editRule()`, `deleteRule()` |
| Utility tools | `UtilityPage` | Base64, URL, JWT, date/time, timezone methods |
| Geolocation | `GeolocationPage` | `setLocation()`, `selectPreset()`, `apply()` |
| JSON viewer | `JsonViewerPage` | `pasteJson()`, `mode()` |
| Text comparison | `TextComparePage` | `compare()` |
| Markup/annotation | `MarkupPage` | `tool()`, `waitForImage()` |

For the full API, fixture details, examples, conventions, and guidance on
adding page objects, continue with **Architecture** and **Page Objects**.

## Overview

The QAKit test suite uses a **Page Object Model (POM)** architecture to improve test maintainability, readability, and reusability. Each major UI component or standalone page is represented by a page object class that encapsulates locators and business logic.

## Architecture

### Base Class: `BasePage`

All page objects inherit from `BasePage` (`tests/pages/base-page.js`), which provides common functionality:

```javascript
const { BasePage } = require('./pages/base-page');

class MyPage extends BasePage {
  constructor(page) {
    super(page);
    this.button = page.locator('#my-button');
  }

  async clickButton() {
    await this.button.click();
  }
}
```

**Common methods in BasePage:**
- `waitForNavigation(options)` - Wait for page navigation
- `close()` - Close the page
- `getCurrentUrl()` - Get the current URL
- `getTitle()` - Get page title
- `waitForSelector(selector, options)` - Wait for a selector to appear
- `isVisible(locator)` - Check if element is visible
- `isHidden(locator)` - Check if element is hidden
- `isEnabled(locator)` - Check if element is enabled
- `getText(locator)` - Get text content
- `getAttribute(locator, attribute)` - Get attribute value
- `waitFor(fn, options)` - Wait for a function to return true
- `evaluate(fn, ...args)` - Execute function in page context
- `delay(ms)` - Delay execution

## Page Objects

### Popup Page Objects

#### 1. **PopupPage** (`tests/pages/popup-page.js`)
Main popup UI with access to all extension features.

**Key methods:**
- `homeTile(tab)` - Get home tile by data-tab
- `actionTile(action)` - Get action tile by data-action
- `panel(tab)` - Get panel by name
- `subtab(group, sub)` - Get subtab element
- `openPanel(tab)` - Open a panel and wait for it to be active
- `openStandalone(action)` - Open standalone page (new tab)

**Usage:**
```javascript
const { test, expect } = require('./fixtures');

test('open network mock panel', async ({ popup }) => {
  await popup.openPanel('net');
  await expect(popup.panel('net')).toBeVisible();
});
```

#### 2. **NetworkMockPage** (`tests/pages/network-mock-page.js`)
Manage network mock rules for request interception.

**Key methods:**
- `createRule(opts)` - Create a new mock rule
- `getRuleCount()` - Get number of rules
- `getRuleByIndex(index)` - Access a rule by index
- `toggleRule(index)` - Toggle rule on/off
- `editRule(index, opts)` - Edit a rule
- `deleteRule(index)` - Delete a rule
- `isEmptyStateVisible()` - Check empty state

**Usage:**
```javascript
const { NetworkMockPage } = require('./pages');
const networkMock = new NetworkMockPage(popupPage);

await networkMock.createRule({
  name: 'API Mock',
  pattern: '/api/users',
  matchType: 'contains',
  status: '200',
  body: '{"users":[]}',
});

const count = await networkMock.getRuleCount();
expect(count).toBe(1);
```

#### 3. **CookieManagerPage** (`tests/pages/cookie-manager-page.js`)
Manage cookies in the extension.

**Key methods:**
- `refresh()` - Refresh cookie list
- `search(keyword)` - Search cookies
- `clearSearch()` - Clear search filter
- `toggleAll()` - Toggle all cookies
- `getCookieCount()` - Get displayed cookie count
- `getCookieByIndex(index)` - Access cookie by index
- `toggleCookie(index)` - Toggle cookie enable/disable
- `expandCookie(index)` - Expand cookie details
- `editCookie(index, opts)` - Edit cookie
- `deleteCookie(index)` - Delete cookie
- `isModalVisible()` - Check if modal is open
- `getCountText()` - Get count label text

**Usage:**
```javascript
const { CookieManagerPage } = require('./pages');
const cookies = new CookieManagerPage(popupPage);

await cookies.refresh();
const count = await cookies.getCookieCount();
await cookies.search('session');
```

#### 4. **PageAuditPage** (`tests/pages/page-audit-page.js`)
Run and manage page audits (links, accessibility, SEO).

**Key methods:**
- `runAudit()` - Start an audit scan
- `waitForAuditComplete(timeout)` - Wait for scan to finish
- `isRunning()` - Check if audit is running
- `clearResults()` - Clear audit results
- `hasContent()` - Check if results exist
- `getStatus()` - Get status text
- `switchSubtab(sub)` - Switch audit subtab (links, a11y, history)
- `hasHistory()` - Check if history exists
- `openExportMenu()` - Open export options
- `exportAs(format)` - Export results (json, csv, html)
- `getA11yContent()` - Get accessibility content
- `getAuditContent()` - Get audit content

**Usage:**
```javascript
const { PageAuditPage } = require('./pages');
const audit = new PageAuditPage(popupPage);

await audit.runAudit();
await audit.waitForAuditComplete();
const status = await audit.getStatus();
```

#### 5. **HeadersPage** (`tests/pages/headers-page.js`)
Manage HTTP headers and request modification.

**Key methods:**
- `createRule(opts)` - Create a header rule
- `getRuleCount()` - Get number of rules
- `getRuleByIndex(index)` - Access rule by index
- `toggleRule(index)` - Toggle rule
- `editRule(index, opts)` - Edit a rule
- `deleteRule(index)` - Delete a rule
- `clearAll()` - Clear all rules
- `isModalVisible()` - Check if modal is open
- `closeModal()` - Close modal

**Usage:**
```javascript
const { HeadersPage } = require('./pages');
const headers = new HeadersPage(popupPage);

await headers.createRule({
  urlFilter: '/api',
  operation: 'set',
  headerName: 'X-Custom',
  headerValue: 'value123',
});
```

#### 6. **ConsolePage** (`tests/pages/console-page.js`)
Access captured console messages.

**Key methods:**
- `clear()` - Clear console
- `refresh()` - Refresh console display
- `getMessageCount()` - Get message count
- `getAllMessages()` - Get all messages as array
- `getMessageByIndex(index)` - Get specific message
- `hasMessages()` - Check if console has messages

**Usage:**
```javascript
const { ConsolePage } = require('./pages');
const console = new ConsolePage(popupPage);

const count = await console.getMessageCount();
const messages = await console.getAllMessages();
```

#### 7. **ToolsPage** (`tests/pages/tools-page.js`)
Access page tools (inspector, ruler, spacing, etc.).

**Key methods:**
- `activateInspector()` - Activate element inspector
- `activateRegionScreenshot()` - Activate region screenshot
- `activateRuler()` - Activate ruler tool
- `activateSpacing()` - Activate spacing tool
- `activateAnnotate()` - Activate annotate tool

**Usage:**
```javascript
const { ToolsPage } = require('./pages');
const tools = new ToolsPage(popupPage);

await tools.activateInspector();
```

#### 8. **UtilityPage** (`tests/pages/utility-page.js`)
Utility tools (Base64, JWT, URL encoding, timezone, etc.).

**Key methods:**
- `encodeBase64(input)` - Encode to Base64
- `decodeBase64(input)` - Decode Base64
- `encodeUrl(input)` - URL encode
- `decodeUrl(input)` - URL decode
- `decodeJwt(token)` - Decode JWT
- `encodeJwt(payload)` - Encode JWT
- `convertFromEpoch(epoch)` - Epoch to date
- `convertToEpoch(date)` - Date to epoch
- `setEpochToNow()` - Set to current time
- `setHumanDateToNow()` - Set date to now
- `convertTimezone(fromTz, toTz)` - Convert timezone
- `swapTimezones()` - Swap timezone conversion

**Usage:**
```javascript
const { UtilityPage } = require('./pages');
const utils = new UtilityPage(popupPage);

const encoded = await utils.encodeBase64('hello');
const decoded = await utils.decodeBase64(encoded);
```

#### 9. **LocalStoragePage** (`tests/pages/local-storage-page.js`)
Manage local storage sessions.

**Key methods:**
- `refresh()` - Refresh local storage
- `search(keyword)` - Search items
- `clearSearch()` - Clear search
- `isAddModalVisible()` - Check if add modal is open
- `closeAddModal()` - Close add modal

#### 10. **GeolocationPage** (`tests/pages/geolocation-page.js`)
Override geolocation settings.

**Key methods:**
- `setLatitude(lat)` - Set latitude
- `setLongitude(lng)` - Set longitude
- `setAccuracy(accuracy)` - Set accuracy
- `selectPreset(presetValue)` - Select preset location
- `getPresets()` - Get available presets
- `apply()` - Apply settings
- `clear()` - Clear settings
- `setLocation(opts)` - Set complete location
- `getLatitude()` - Get current latitude
- `getLongitude()` - Get current longitude
- `getAccuracy()` - Get current accuracy

**Usage:**
```javascript
const { GeolocationPage } = require('./pages');
const geo = new GeolocationPage(popupPage);

await geo.setLocation({ lat: 51.5074, lng: -0.1278, accuracy: 100 });
await geo.apply();
```

#### 11. **EnvironmentMarkerPage** (`tests/pages/environment-marker-page.js`)
Override environment variables.

**Key methods:**
- `addVariable(name, value)` - Add env variable
- `getVariableCount()` - Get count
- `toggleVariable(index)` - Toggle variable
- `deleteVariable(index)` - Delete variable
- `reset()` - Reset all variables
- `isVariableEnabled(index)` - Check if enabled

### Standalone Page Objects

#### 12. **TextComparePage** (`tests/pages/text-compare-page.js`)
Compare text files side-by-side.

**Key methods:**
- `compare(left, right)` - Compare two texts
- `swap()` - Swap left and right
- `clear()` - Clear both areas
- `ignoreWhitespace()` - Toggle whitespace ignore
- Other properties: left, right, stats, minimap, jumpStrip

**Usage:**
```javascript
const { TextComparePage } = require('./pages');
const compare = new TextComparePage(comparePage);

await compare.compare('text1', 'text2');
```

#### 13. **JsonViewerPage** (`tests/pages/json-viewer-page.js`)
View and analyze JSON data.

**Key methods:**
- `pasteJson(json)` - Paste JSON and parse
- `mode(name)` - Switch view mode (text, tree, etc.)
- Other properties: textArea, textStatus, treeContent, treeRows, etc.

**Usage:**
```javascript
const { JsonViewerPage } = require('./pages');
const viewer = new JsonViewerPage(viewerPage);

await viewer.pasteJson('{"key":"value"}');
```

#### 14. **MarkupPage** (`tests/pages/markup-page.js`)
Annotation and drawing tool.

**Key methods:**
- `waitForImage()` - Wait for canvas to load
- `tool(name)` - Select tool
- `control(id)` - Access control element
- Other properties: canvas, color, size, body

## Usage in Tests

### Basic Usage

```javascript
const { test, expect } = require('./fixtures');
const { NetworkMockPage } = require('./pages');

test('create network mock rule', async ({ popup, popupPage }) => {
  // Open panel
  await popup.openPanel('net');
  
  // Create page object
  const networkMock = new NetworkMockPage(popupPage);
  
  // Use methods
  await networkMock.createRule({
    name: 'Test Rule',
    pattern: '/api',
    status: '200',
  });
  
  // Assert
  const count = await networkMock.getRuleCount();
  expect(count).toBe(1);
});
```

### Using pageObjects Fixture

```javascript
const { test, expect } = require('./fixtures');

test('using pageObjects fixture', async ({ popup, popupPage, pageObjects }) => {
  await popup.openPanel('net');
  
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  await networkMock.createRule({ name: 'Test' });
});
```

### Chaining Operations

```javascript
test('multiple operations', async ({ popup, popupPage }) => {
  await popup.openPanel('cookies');
  
  const cookies = new CookieManagerPage(popupPage);
  await cookies.refresh();
  await cookies.search('session');
  
  const count = await cookies.getCookieCount();
  expect(count).toBeGreaterThan(0);
});
```

## Best Practices

### 1. **Keep Page Objects Focused**
Each page object should represent a single page or panel. Don't mix unrelated functionality.

```javascript
// Good - focused on network mocking
class NetworkMockPage extends BasePage {
  async createRule(opts) { ... }
}

// Bad - mixing too many concerns
class MixedPage extends BasePage {
  async createNetworkRule() { ... }
  async editCookie() { ... }
  async runAudit() { ... }
}
```

### 2. **Use Descriptive Method Names**
Method names should clearly describe what they do.

```javascript
// Good
await networkMock.createRule();
await cookies.getCookieCount();
await audit.waitForAuditComplete();

// Bad
await networkMock.create();
await cookies.getCount();
await audit.wait();
```

### 3. **Encapsulate Locators**
Keep locators as class properties, not exposed in test code.

```javascript
// Good
class NetworkMockPage {
  constructor(page) {
    this.addBtn = page.locator('#netAddBtn');
  }
  
  async createRule() {
    await this.addBtn.click();
  }
}

// Bad - exposing locators
test('create rule', async ({ popupPage }) => {
  await popupPage.locator('#netAddBtn').click();
  // Locator IDs are implementation details
});
```

### 4. **Return Meaningful Values**
Methods should return data that's useful for assertions.

```javascript
// Good
const count = await networkMock.getRuleCount();
expect(count).toBe(1);

// Bad
await networkMock.getRuleCount(); // No return value used
```

### 5. **Handle Waits Implicitly**
Page objects should handle necessary waits internally.

```javascript
// Good
async createRule(opts) {
  await this.addBtn.click();
  await this.page.waitForSelector('#hdrModal');
  // User doesn't need to manage waits
}

// Bad
// User must manage waits
await networkMock.createRule();
await popupPage.waitForSelector('#netModalOverlay');
```

### 6. **Use Consistent Option Objects**
Use option objects for methods with multiple parameters.

```javascript
// Good
await networkMock.createRule({
  name: 'Test',
  pattern: '/api',
  matchType: 'contains',
  status: '200',
});

// Bad - hard to remember parameter order
await networkMock.createRule('Test', '/api', 'contains', '200');
```

## Migration Guide

### Converting Old Tests

**Before:**
```javascript
test('create rule', async ({ popupPage }) => {
  await popupPage.locator('#netAddBtn').click();
  await popupPage.locator('#netRuleName').fill('Test');
  await popupPage.locator('#netPattern').fill('/api');
  await popupPage.locator('#netModalSave').click();
});
```

**After:**
```javascript
test('create rule', async ({ popupPage, pageObjects }) => {
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  await networkMock.createRule({
    name: 'Test',
    pattern: '/api',
  });
});
```

## Adding New Page Objects

1. Create a new file: `tests/pages/my-feature-page.js`
2. Extend `BasePage`
3. Add locators in constructor
4. Add business logic methods
5. Export the class
6. Add to `tests/pages/index.js`
7. Add fixture factory to `tests/fixtures.js`

**Template:**
```javascript
// @ts-check
const { BasePage } = require('./base-page');

class MyFeaturePage extends BasePage {
  constructor(page) {
    super(page);
    this.button = page.locator('#my-button');
  }

  async clickButton() {
    await this.button.click();
  }
}

module.exports = { MyFeaturePage };
```

## Testing Page Objects

Page objects themselves can be tested to ensure they work correctly:

```javascript
const { test, expect } = require('./fixtures');
const { NetworkMockPage } = require('./pages');

test.describe('NetworkMockPage', () => {
  test('createRule method fills form and submits', async ({ popupPage }) => {
    const networkMock = new NetworkMockPage(popupPage);
    await networkMock.createRule({ name: 'Test' });
    
    expect(await networkMock.getRuleCount()).toBe(1);
  });
});
```

## References

- [Playwright Page Object Model Guide](https://playwright.dev/docs/pom)
- [Selenium Page Object Model](https://www.selenium.dev/documentation/test_practices/encouraged/page_object_models/)
- QAKit Source: `src/`
- Test Directory: `tests/`
