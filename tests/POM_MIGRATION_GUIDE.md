# POM Migration Guide for QAKit Tests

## Overview

This guide helps you migrate existing QAKit tests to use the Page Object Model (POM) architecture. The migration can be done gradually—you don't need to refactor all tests at once.

## Why Migrate?

✅ **Benefits of using POM:**
- **Better maintainability**: Changes to UI elements only affect one page object
- **Improved readability**: Test logic is clearer and more expressive
- **Reusability**: Common actions are encapsulated and reused across tests
- **Reduced duplication**: No more repeating the same locator sequences
- **Easier debugging**: Issues are easier to trace and fix
- **Better organization**: Related functionality is grouped together

## Quick Reference: Before & After

### Before (Direct Locator Access)
```javascript
test('create network mock rule', async ({ popupPage }) => {
  await popupPage.locator('#netAddBtn').click();
  await popupPage.locator('#netRuleName').fill('Test Rule');
  await popupPage.locator('#netPattern').fill('/api/test');
  await popupPage.locator('#netMatchType').selectOption('contains');
  await popupPage.locator('#netStatus').fill('200');
  await popupPage.locator('#netBodyPaste').fill('{"ok":true}');
  await popupPage.locator('#netModalSave').click();
  await popupPage.locator('#netModalOverlay').waitFor({ state: 'hidden' });
});
```

### After (Using POM)
```javascript
test('create network mock rule', async ({ popupPage, pageObjects }) => {
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  await networkMock.createRule({
    name: 'Test Rule',
    pattern: '/api/test',
    matchType: 'contains',
    status: '200',
    body: '{"ok":true}',
  });
});
```

## Migration Strategies

### Strategy 1: Gradual Migration (Recommended)

Migrate one test file at a time, starting with the most frequently used panels.

**Priority order:**
1. `net-mock.spec.js` → `NetworkMockPage`
2. `cookie-manager.spec.js` → `CookieManagerPage`
3. `page-audit.spec.js` → `PageAuditPage`
4. `headers.spec.js` → `HeadersPage`
5. `json-viewer-full.spec.js` → `JsonViewerPage`
6. `text-compare-full.spec.js` → `TextComparePage`
7. Others as time permits

### Strategy 2: Create Wrapper Methods

If you want to migrate gradually, create wrapper methods in the existing test files that use page objects internally:

```javascript
// In net-mock.spec.js
const { NetworkMockPage } = require('./pages');

async function createRule(popupPage, opts = {}) {
  const networkMock = new NetworkMockPage(popupPage);
  return networkMock.createRule(opts);
}

// Now existing tests can use it without major changes
async function openNetPanel(popup) {
  await popup.homeTile('net').click();
  await expect(popup.panel('net')).toHaveClass(/active/);
}

test('create rule', async ({ popup, popupPage }) => {
  await openNetPanel(popup);
  await createRule(popupPage, { name: 'Test' });
});
```

## Step-by-Step Migration

### Step 1: Identify the Panel/Feature

Look at which panel your test uses:
- Network Mock (`panel-net`) → `NetworkMockPage`
- Cookies (`panel-cookies`) → `CookieManagerPage`
- Audit (`panel-audit`) → `PageAuditPage`
- Utilities (`panel-utils`) → `UtilityPage`
- Etc.

### Step 2: Import the Page Object

```javascript
const { test, expect } = require('./fixtures');
const { NetworkMockPage } = require('./pages');
```

### Step 3: Refactor Test Setup

**Before:**
```javascript
async function openNetPanel(popup) {
  await popup.homeTile('net').click();
  await expect(popup.panel('net')).toHaveClass(/active/);
}

test('some test', async ({ popup, popupPage }) => {
  await openNetPanel(popup);
  // test code...
});
```

**After:**
```javascript
test('some test', async ({ popup, popupPage, pageObjects }) => {
  await popup.openPanel('net');
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  // test code...
});
```

### Step 4: Replace Locator Sequences

**Before:**
```javascript
await popupPage.locator('#netAddBtn').click();
await popupPage.locator('#netRuleName').fill(name);
await popupPage.locator('#netPattern').fill(pattern);
await popupPage.locator('#netModalSave').click();
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.createRule({ name, pattern });
```

### Step 5: Update Assertions

**Before:**
```javascript
const count = await popupPage.locator('.net-rule-card').count();
expect(count).toBe(1);
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
const count = await networkMock.getRuleCount();
expect(count).toBe(1);
```

## Common Migration Patterns

### Pattern 1: Panel Navigation

**Before:**
```javascript
await popup.homeTile('net').click();
await expect(popup.panel('net')).toHaveClass(/active/);
```

**After:**
```javascript
await popup.openPanel('net');
```

### Pattern 2: Creating Items

**Before:**
```javascript
await popup.netAddBtn.click();
await expect(popup.netModalOverlay).toBeVisible();
await popup.netRuleName.fill('Test');
await popup.netPattern.fill('/api');
await popup.netStatus.fill('200');
await popup.netModalSave.click();
await expect(popup.netModalOverlay).toBeHidden();
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.createRule({
  name: 'Test',
  pattern: '/api',
  status: '200',
});
```

### Pattern 3: Listing/Counting Items

**Before:**
```javascript
const cards = await popupPage.locator('.net-rule-card');
const count = await cards.count();
expect(count).toBe(1);
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
const count = await networkMock.getRuleCount();
expect(count).toBe(1);
```

### Pattern 4: Editing Items

**Before:**
```javascript
await popupPage.locator('.net-rule-btn.edit').first().click();
await popupPage.locator('#netRuleName').fill('Updated');
await popupPage.locator('#netModalSave').click();
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.editRule(0, { name: 'Updated' });
```

### Pattern 5: Deleting Items

**Before:**
```javascript
await popupPage.locator('.net-rule-btn.del').first().click();
// May need confirmation
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.deleteRule(0);
```

### Pattern 6: Toggling/Enabling Items

**Before:**
```javascript
await popupPage.locator('.net-rule-toggle').first().click();
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.toggleRule(0);
```

### Pattern 7: Modal Operations

**Before:**
```javascript
await popup.netAddBtn.click();
await expect(popup.netModalOverlay).toBeVisible();
// do stuff...
await popup.netModalCancel.click();
await expect(popup.netModalOverlay).toBeHidden();
```

**After:**
```javascript
const networkMock = new NetworkMockPage(popupPage);
await networkMock.addBtn.click();
expect(await networkMock.isModalVisible()).toBe(true);
// do stuff...
await networkMock.closeModal();
expect(await networkMock.isModalVisible()).toBe(false);
```

## Handling Special Cases

### Case 1: Custom Waiting

If a test requires custom waiting logic, add it to the page object method:

**Before:**
```javascript
await popup.netAddBtn.click();
await popupPage.waitForTimeout(500);
// manual wait
```

**After (in NetworkMockPage):**
```javascript
async createRule(opts = {}) {
  await this.addBtn.click();
  await this.page.waitForSelector('#netModalOverlay'); // Built-in wait
  // ...
}
```

### Case 2: Browser Context Operations

If you need to access the browser context:

```javascript
test('with context', async ({ context, popup, popupPage, pageObjects }) => {
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  
  // Create a test page
  const testPage = await context.newPage();
  
  // Can still access context if needed
  const cookies = await context.cookies();
});
```

### Case 3: Multiple Pages

For tests that use the popup and standalone pages:

```javascript
test('with standalone pages', async ({ popup, popupPage, pageObjects }) => {
  // Set up in popup
  await popup.openPanel('net');
  const networkMock = pageObjects.createNetworkMockPage(popupPage);
  await networkMock.createRule({ name: 'Test' });
  
  // Open standalone page
  const viewerPage = await popup.openStandalone('open-jsondiff');
  const jsonViewer = pageObjects.createJsonViewerPage(viewerPage);
  
  // Use standalone page
  await jsonViewer.pasteJson('{"test":"data"}');
  
  // Clean up
  await viewerPage.close();
});
```

## Testing During Migration

### Keep Tests Green

1. Run tests before migrating: `npm test`
2. Migrate one test file at a time
3. Run tests after each file: `npm test -- tests/my-file.spec.js`
4. Use `git diff` to review changes: `git diff tests/my-file.spec.js`

### Verify Functionality

After migration, verify:
- ✅ All tests pass
- ✅ No new warnings in test output
- ✅ Locators still work correctly
- ✅ Timing is consistent

## Troubleshooting

### Issue: Page object method isn't defined

**Solution:** Check that:
1. The method is defined in the page object class
2. The page object is correctly imported
3. The method name matches exactly

```javascript
// Check the page object has the method
const { NetworkMockPage } = require('./pages');
console.log(NetworkMockPage.prototype.createRule); // Should exist
```

### Issue: Selector not found

**Solution:** Verify the selector in the page object matches the HTML:
```javascript
// In NetworkMockPage
this.addBtn = page.locator('#netAddBtn');

// Verify selector exists
test('verify selector', async ({ popupPage }) => {
  const networkMock = new NetworkMockPage(popupPage);
  expect(await networkMock.addBtn.count()).toBeGreaterThan(0);
});
```

### Issue: Timeout waiting for element

**Solution:** Increase timeout or check if page is loaded:
```javascript
// In page object
await this.page.waitForSelector('#netModalOverlay', { timeout: 5000 });

// In test
await networkMock.createRule({ name: 'Test' });
await networkMock.page.waitForTimeout(500); // Manual wait if needed
```

### Issue: Modal not closing

**Solution:** Verify the page object method waits for the state change:
```javascript
// Good: waits for hidden
async createRule(opts = {}) {
  // ... form submission ...
  await this.page.waitForSelector('#netModalOverlay', { state: 'hidden' });
}
```

## Checklist for Migration

- [ ] Choose test file to migrate
- [ ] Import required page objects
- [ ] Add `pageObjects` fixture if using it
- [ ] Remove old helper functions (openNetPanel, createRule, etc.)
- [ ] Replace locator sequences with page object methods
- [ ] Update assertions to use page object helpers
- [ ] Run tests: `npm test -- tests/file.spec.js`
- [ ] All tests pass ✅
- [ ] Review changes and commit

## Best Practices

1. **One page object per panel/feature** - Don't mix concerns
2. **Descriptive method names** - `createRule()` not `add()`
3. **Handle waits internally** - Page object methods should wait
4. **Return useful values** - Methods should return data for assertions
5. **Keep locators private** - Prefer methods over direct access
6. **Document the page object** - Add JSDoc comments
7. **Use option objects** - Avoid multiple parameters
8. **Test your page objects** - Ensure they work correctly

## Examples by Feature

See `example-pom-tests.spec.js` for comprehensive examples of:
- Basic navigation
- Creating/editing/deleting items
- Multiple page objects
- Using the pageObjects fixture
- Setup/teardown patterns
- Standalone pages
- Async operations
- Error handling
- Multi-page tests

## Questions?

Refer to:
- `POM_ARCHITECTURE.md` - Detailed POM guide
- `example-pom-tests.spec.js` - Working examples
- Existing page objects in `tests/pages/`
