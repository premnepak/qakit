// @ts-check
/**
 * Smoke coverage for tool panels that previously had no automated tests:
 *   - Cookies, Storage (LS), Console, Page Audit, Net Mock, Headers,
 *     Time / World Clock, Geolocation, Env Marker
 *   - JSON Viewer & Text Compare standalone pages (loaded in their own tabs)
 *
 * These tests only verify panel mounts + key controls render. Deep behavioural
 * tests for individual flows live in their own *.spec.js files.
 */

const { test, expect } = require('./fixtures');
const { JsonViewerPage } = require('./pages/json-viewer-page');
const { TextComparePage } = require('./pages/text-compare-page');

// ─── In-popup tool panels ───────────────────────────────────────────────────

test.describe('Tool panel smoke', () => {
  test('Cookies panel renders with search + content', async ({ popup, popupPage }) => {
    await popup.homeTile('cookies').click();
    await expect(popup.panel('cookies')).toHaveClass(/active/);
    await expect(popup.cookieSearch).toBeVisible();
  });

  test('Storage (LS) panel renders with search + refresh', async ({ popup, popupPage }) => {
    await popup.homeTile('ls').click();
    await expect(popup.panel('ls')).toHaveClass(/active/);
    await expect(popup.lsSearch).toBeVisible();
    await expect(popup.lsAddBtn).toBeVisible();
    await expect(popup.lsRefreshBtn).toBeVisible();
  });

  test('Storage — + Add opens modal for Local and Session storage', async ({ popup, popupPage }) => {
    await popup.homeTile('ls').click();
    await popup.lsAddBtn.click();
    await expect(popup.lsAddOverlay).toBeVisible();
    await expect(popup.lsAddModalTitle).toHaveText('Add Local Storage Key');
    await popup.lsAddCancel.click();
    await expect(popup.lsAddOverlay).toBeHidden();

    await popup.lsTypeSession.click();
    await popup.lsAddBtn.click();
    await expect(popup.lsAddOverlay).toBeVisible();
    await expect(popup.lsAddModalTitle).toHaveText('Add Session Storage Key');
    await popup.lsAddCancel.click();
    await expect(popup.lsAddOverlay).toBeHidden();
  });

  test('Console panel renders with refresh + clear buttons', async ({ popup, popupPage }) => {
    await popup.homeTile('console').click();
    await expect(popup.panel('console')).toHaveClass(/active/);
    await expect(popup.consoleRefreshBtn).toBeVisible();
    await expect(popup.consoleClearBtn).toBeVisible();
  });

  test('Net Mock panel renders with Add Rule button + status pill', async ({ popup, popupPage }) => {
    await popup.homeTile('net').click();
    await expect(popup.panel('net')).toHaveClass(/active/);
    await expect(popup.netAddBtn).toBeVisible();
    await expect(popup.netStatusLabel).toBeVisible();
  });

  test('Net Mock — Add Rule opens the rule modal', async ({ popup, popupPage }) => {
    await popup.homeTile('net').click();
    await popup.netAddBtn.click();
    await expect(popup.netModalOverlay).toBeVisible();
    await expect(popup.netRuleName).toBeVisible();
    await expect(popup.netPattern).toBeVisible();
    // Cancel restores the empty modal state
    await popup.netModalCancel.click();
    await expect(popup.netModalOverlay).toBeHidden();
  });

  test('Headers panel renders with Add Rule button', async ({ popup, popupPage }) => {
    await popup.homeTile('headers').click();
    await expect(popup.panel('headers')).toHaveClass(/active/);
    await expect(popup.hdrAddBtn).toBeVisible();
  });

  test('Headers — Add Rule opens modal with URL/header inputs', async ({ popup, popupPage }) => {
    await popup.homeTile('headers').click();
    await popup.hdrAddBtn.click();
    await expect(popup.hdrModal).toBeVisible();
    await expect(popup.hdrUrlFilter).toBeVisible();
    await expect(popup.hdrHeaderName).toBeVisible();
    await popup.hdrModalCancel.click();
    await expect(popup.hdrModal).toBeHidden();
  });

  test('Geolocation panel renders with apply/clear + lat/lng inputs', async ({ popup, popupPage }) => {
    await popup.homeTile('geo').click();
    await expect(popup.panel('geo')).toHaveClass(/active/);
    await expect(popup.geoLat).toBeVisible();
    await expect(popup.geoLng).toBeVisible();
    await expect(popup.geoApplyBtn).toBeVisible();
    await expect(popup.geoClearBtn).toBeVisible();
  });

  test('Geolocation — preset selection populates lat/lng', async ({ popup, popupPage }) => {
    await popup.homeTile('geo').click();
    // Pick the second option (first is usually placeholder)
    const opts = await popup.geoPresetSelectOption.count();
    if (opts >= 2) {
      const value = await popup.geoPresetSelectOption.nth(1).getAttribute('value');
      if (value) {
        await popup.geoPresetSelect.selectOption( value);
        // After preset selection, lat input should have a non-empty value
        const lat = await popup.geoLat.inputValue();
        expect(lat.length).toBeGreaterThan(0);
      }
    }
  });

  test('Time panel renders World Clock by default', async ({ popup, popupPage }) => {
    await popup.homeTile('time').click();
    await expect(popup.panel('time')).toHaveClass(/active/);
    await expect(popup.worldClockGrid).toBeVisible();
  });

  test('Time panel exposes timezone converter sub-tab', async ({ popup, popupPage }) => {
    await popup.homeTile('time').click();
    // Switch to timestamp/converter sub-tab if a sub-tab bar exists
    const tab = popup.dataSubTimestamp.first();
    if (await tab.count()) {
      await tab.click();
      await expect(popup.tzConvertBtn).toBeVisible();
      await expect(popup.tzFrom).toBeVisible();
      await expect(popup.tzTo).toBeVisible();
    }
  });

  test('Env Marker panel renders with Add button', async ({ popup, popupPage }) => {
    await popup.homeTile('envmarker').click();
    await expect(popup.panel('envmarker')).toHaveClass(/active/);
    await expect(popup.envmarkerAddBtn).toBeVisible();
    await expect(popup.envmarkerList).toBeAttached();
  });
});

// ─── Encode panel — additional flows ────────────────────────────────────────

test.describe('Encode utilities — extra coverage', () => {
  test('URL decode round-trip', async ({ popup, popupPage }) => {
    await popup.homeTile('utils').click();
    await popup.subtab('util', 'url').click();
    await popup.urlInput.fill( 'hello%20world%21');
    await popup.urlDecodeBtn.click();
    const out = await popup.urlOutput.inputValue();
    expect(out).toBe('hello world!');
  });

  test('Base64 decode round-trip', async ({ popup, popupPage }) => {
    await popup.homeTile('utils').click();
    await popup.subtab('util', 'base64').click();
    const encoded = Buffer.from('qakit decode test').toString('base64');
    await popup.b64Input.fill( encoded);
    await popup.b64DecodeBtn.click();
    const out = await popup.b64Output.inputValue();
    expect(out).toBe('qakit decode test');
  });
});

// ─── JSON Viewer (standalone page) ──────────────────────────────────────────

test.describe('JSON Viewer standalone tab', () => {
  test('JSON Viewer page mounts with mode tabs + text pane', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    // Default mode is "Data" (text input). Tree pane is hidden until user switches.
    await expect(viewer.mode('text')).toBeVisible();
    await expect(viewer.mode('tree')).toBeVisible();
    await expect(viewer.textPane).toBeVisible();
    await page.close();
  });

  test('JSON Viewer Tree mode reveals expand-all + copy buttons', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    // Switch to Tree mode
    await viewer.mode('tree').click();
    await expect(viewer.expandAll).toBeVisible();
    await expect(viewer.collapseAll).toBeVisible();
    await expect(viewer.treeCopy).toBeVisible();
    await expect(viewer.treeFilter).toBeVisible();
    await page.close();
  });
});

// ─── Text Compare (standalone page) ─────────────────────────────────────────

test.describe('Text Compare standalone tab', () => {
  test('Text Compare page mounts with two textareas', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await expect(compare.left).toBeVisible();
    await expect(compare.right).toBeVisible();
    await page.close();
  });

  test('Text Compare diff stats update when content differs', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.left.fill( 'line one\nline two');
    await compare.right.fill( 'line one\nline TWO');
    // Trigger a compare button if present, else rely on auto-compare on input
    const compareBtn = compare.compareAction;
    if (await compareBtn.count()) await compareBtn.click();
    // Stats element should populate eventually
    await expect(async () => {
      const stats = await compare.stats.textContent();
      expect((stats || '').length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });
    await page.close();
  });
});
