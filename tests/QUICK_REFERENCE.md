# POM Quick Reference Card

## 📌 Page Objects at a Glance

| Page Object | File | Purpose | Key Methods |
|---|---|---|---|
| **PopupPage** | popup-page.js | Main popup UI | `openPanel()`, `openStandalone()` |
| **NetworkMockPage** | network-mock-page.js | Mock network requests | `createRule()`, `deleteRule()`, `toggleRule()` |
| **CookieManagerPage** | cookie-manager-page.js | Manage cookies | `refresh()`, `search()`, `editCookie()` |
| **PageAuditPage** | page-audit-page.js | Audit pages | `runAudit()`, `waitForAuditComplete()`, `exportAs()` |
| **HeadersPage** | headers-page.js | HTTP headers | `createRule()`, `deleteRule()`, `clearAll()` |
| **ConsolePage** | console-page.js | Console messages | `clear()`, `getMessageCount()` |
| **ToolsPage** | tools-page.js | Page tools | `activateInspector()`, `activateRuler()` |
| **UtilityPage** | utility-page.js | Utilities | `encodeBase64()`, `decodeJwt()`, `convertTimezone()` |
| **LocalStoragePage** | local-storage-page.js | Local storage | `refresh()`, `search()` |
| **GeolocationPage** | geolocation-page.js | Geolocation | `setLocation()`, `selectPreset()` |
| **EnvironmentMarkerPage** | environment-marker-page.js | Environment vars | `addVariable()`, `deleteVariable()` |
| **TextComparePage** | text-compare-page.js | Compare text | `compare()`, `swap()` |
| **JsonViewerPage** | json-viewer-page.js | View JSON | `pasteJson()`, `mode()` |
| **MarkupPage** | markup-page.js | Annotate | `waitForImage()`, `tool()` |

## 🚀 Quick Examples

### Create a Network Mock Rule
```javascript
const { NetworkMockPage } = require('./pages');
const networkMock = new NetworkMockPage(popupPage);

await networkMock.createRule({
  name: 'API Mock',
  pattern: '/api',
  status: '200',
  body: '{"data":[]}',
});
```

### Manage Cookies
```javascript
const { CookieManagerPage } = require('./pages');
const cookies = new CookieManagerPage(popupPage);

await cookies.refresh();
const count = await cookies.getCookieCount();
await cookies.search('session');
```

### Use Page Audit
```javascript
const { PageAuditPage } = require('./pages');
const audit = new PageAuditPage(popupPage);

await audit.runAudit();
await audit.waitForAuditComplete();
const status = await audit.getStatus();
```

### Utilities (Encoding, JWT, Timezone)
```javascript
const { UtilityPage } = require('./pages');
const utils = new UtilityPage(popupPage);

const encoded = await utils.encodeBase64('hello');
const decoded = await utils.decodeBase64(encoded);
const decoded_jwt = await utils.decodeJwt(token);
```

## 🔄 Using pageObjects Fixture

```javascript
const { test, expect } = require('./fixtures');

test('using pageObjects factory', async ({ popupPage, pageObjects }) => {
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  const cookies = pageObjects.createCookieManagerPage(popupPage);
  const audit = pageObjects.createPageAuditPage(popupPage);
  
  // Use page objects...
});
```

**Available factories:**
- `createNetworkMockPage(page)`
- `createCookieManagerPage(page)`
- `createPageAuditPage(page)`
- `createHeadersPage(page)`
- `createConsolePage(page)`
- `createToolsPage(page)`
- `createUtilityPage(page)`
- `createLocalStoragePage(page)`
- `createGeolocationPage(page)`
- `createEnvironmentMarkerPage(page)`
- `createTextComparePage(page)`
- `createJsonViewerPage(page)`
- `createMarkupPage(page)`

## 📋 Common Operations

### Panel Navigation
```javascript
// Open a panel
await popup.openPanel('net');

// Open standalone page (new tab)
const page = await popup.openStandalone('open-jsondiff');
```

### CRUD Operations (Example: Network Mock)
```javascript
// Create
await networkMock.createRule({ name: 'Test', pattern: '/api' });

// Read/List
const count = await networkMock.getRuleCount();
const rule = networkMock.getRuleByIndex(0);

// Update
await networkMock.editRule(0, { name: 'Updated' });

// Delete
await networkMock.deleteRule(0);
```

### Checking States
```javascript
await networkMock.isEmptyStateVisible();
await networkMock.isModalVisible();
await audit.isRunning();
```

## 🧩 BasePage Common Methods

```javascript
// Element checking
await page.isVisible(locator);
await page.isHidden(locator);
await page.isEnabled(locator);
await page.isDisabled(locator);

// Content access
await page.getText(locator);
await page.getAttribute(locator, 'id');

// Navigation
await page.waitForNavigation();
await page.close();

// Advanced
await page.waitFor(fn, options);
await page.evaluate(fn, ...args);
await page.delay(1000);
```

## 📚 Documentation Files

| File | Content | Size | Use When |
|------|---------|------|----------|
| **POM_ARCHITECTURE.md** | Complete reference | 16 KB | Need detailed API info |
| **POM_MIGRATION_GUIDE.md** | Migration instructions | 12 KB | Migrating existing tests |
| **POM_IMPLEMENTATION_SUMMARY.md** | Implementation overview | 11 KB | Understanding what's included |
| **example-pom-tests.spec.js** | Runnable examples | 15 KB | Learning by example |
| **README_POM.md** | Quick start guide | 8 KB | Getting started |
| **THIS FILE** | Quick reference | - | Looking up something fast |

## 🎯 Test Structure

### Before (without POM)
```javascript
test('create rule', async ({ popupPage }) => {
  await popupPage.locator('#netAddBtn').click();
  await popupPage.locator('#netRuleName').fill('Test');
  await popupPage.locator('#netPattern').fill('/api');
  await popupPage.locator('#netModalSave').click();
  // 4 lines for one operation
});
```

### After (with POM)
```javascript
test('create rule', async ({ popupPage, pageObjects }) => {
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  await networkMock.createRule({ name: 'Test', pattern: '/api' });
  // 1 line for the same operation
});
```

## ✅ Checklist for New Tests

- [ ] Import page objects: `const { NetworkMockPage } = require('./pages');`
- [ ] Create page object: `const obj = new NetworkMockPage(popupPage);`
- [ ] Use page object methods instead of locators
- [ ] Let page objects handle waits
- [ ] Use meaningful assertions
- [ ] Test one thing per test
- [ ] Use option objects for parameters

## 🚫 Common Mistakes

❌ Direct locator access:
```javascript
await popupPage.locator('#netAddBtn').click(); // Don't do this
```

✅ Use page object instead:
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.createRule({ ... }); // Do this
```

---

❌ Creating page object but not using it:
```javascript
const networkMock = new NetworkMockPage(popupPage);
await popupPage.locator('#netAddBtn').click(); // Inconsistent!
```

✅ Consistent page object usage:
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.createRule({ ... }); // Consistent
```

---

❌ Hardcoding waits:
```javascript
await popupPage.waitForTimeout(1000);
```

✅ Let page object handle waits:
```javascript
await networkMock.createRule({ ... }); // Waits built-in
```

## 🔗 Key Links

- **Main Docs**: `tests/POM_ARCHITECTURE.md`
- **Migration Guide**: `tests/POM_MIGRATION_GUIDE.md`
- **Examples**: `tests/example-pom-tests.spec.js`
- **Page Objects**: `tests/pages/`

## 📞 Need Help?

1. **Can't find a method?** → Check `POM_ARCHITECTURE.md`
2. **How do I migrate?** → Read `POM_MIGRATION_GUIDE.md`
3. **Show me examples** → Run `tests/example-pom-tests.spec.js`
4. **What can a page object do?** → Check its file in `tests/pages/`

## 🎓 Learning Path

**5 minutes:**
- Read this quick reference
- Look at a couple examples

**15 minutes:**
- Run `example-pom-tests.spec.js`
- Pick one page object to study

**30 minutes:**
- Write a test using a page object
- Try refactoring an existing test

**1 hour:**
- Read `POM_ARCHITECTURE.md`
- Complete a migration

---

**Happy testing with Page Object Model!** 🚀
