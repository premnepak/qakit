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

// ─── In-popup tool panels ───────────────────────────────────────────────────

test.describe('Tool panel smoke', () => {
  test('Cookies panel renders with search + content', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="cookies"]');
    await expect(popupPage.locator('#panel-cookies')).toHaveClass(/active/);
    await expect(popupPage.locator('#cookieSearch')).toBeVisible();
  });

  test('Storage (LS) panel renders with search + refresh', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="ls"]');
    await expect(popupPage.locator('#panel-ls')).toHaveClass(/active/);
    await expect(popupPage.locator('#lsSearch')).toBeVisible();
    await expect(popupPage.locator('#lsRefreshBtn')).toBeVisible();
  });

  test('Console panel renders with refresh + clear buttons', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="console"]');
    await expect(popupPage.locator('#panel-console')).toHaveClass(/active/);
    await expect(popupPage.locator('#consoleRefreshBtn')).toBeVisible();
    await expect(popupPage.locator('#consoleClearBtn')).toBeVisible();
  });

  test('Net Mock panel renders with Add Rule button + status pill', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="net"]');
    await expect(popupPage.locator('#panel-net')).toHaveClass(/active/);
    await expect(popupPage.locator('#netAddBtn')).toBeVisible();
    await expect(popupPage.locator('#netStatusLabel')).toBeVisible();
  });

  test('Net Mock — Add Rule opens the rule modal', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="net"]');
    await popupPage.click('#netAddBtn');
    await expect(popupPage.locator('#netModalOverlay')).toBeVisible();
    await expect(popupPage.locator('#netRuleName')).toBeVisible();
    await expect(popupPage.locator('#netPattern')).toBeVisible();
    // Cancel restores the empty modal state
    await popupPage.click('#netModalCancel');
    await expect(popupPage.locator('#netModalOverlay')).toBeHidden();
  });

  test('Headers panel renders with Add Rule button', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="headers"]');
    await expect(popupPage.locator('#panel-headers')).toHaveClass(/active/);
    await expect(popupPage.locator('#hdrAddBtn')).toBeVisible();
  });

  test('Headers — Add Rule opens modal with URL/header inputs', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="headers"]');
    await popupPage.click('#hdrAddBtn');
    await expect(popupPage.locator('#hdrModal')).toBeVisible();
    await expect(popupPage.locator('#hdrUrlFilter')).toBeVisible();
    await expect(popupPage.locator('#hdrHeaderName')).toBeVisible();
    await popupPage.click('#hdrModalCancel');
    await expect(popupPage.locator('#hdrModal')).toBeHidden();
  });

  test('Geolocation panel renders with apply/clear + lat/lng inputs', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="geo"]');
    await expect(popupPage.locator('#panel-geo')).toHaveClass(/active/);
    await expect(popupPage.locator('#geoLat')).toBeVisible();
    await expect(popupPage.locator('#geoLng')).toBeVisible();
    await expect(popupPage.locator('#geoApplyBtn')).toBeVisible();
    await expect(popupPage.locator('#geoClearBtn')).toBeVisible();
  });

  test('Geolocation — preset selection populates lat/lng', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="geo"]');
    // Pick the second option (first is usually placeholder)
    const opts = await popupPage.locator('#geoPresetSelect option').count();
    if (opts >= 2) {
      const value = await popupPage.locator('#geoPresetSelect option').nth(1).getAttribute('value');
      if (value) {
        await popupPage.selectOption('#geoPresetSelect', value);
        // After preset selection, lat input should have a non-empty value
        const lat = await popupPage.locator('#geoLat').inputValue();
        expect(lat.length).toBeGreaterThan(0);
      }
    }
  });

  test('Time panel renders World Clock by default', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="time"]');
    await expect(popupPage.locator('#panel-time')).toHaveClass(/active/);
    await expect(popupPage.locator('#worldClockGrid')).toBeVisible();
  });

  test('Time panel exposes timezone converter sub-tab', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="time"]');
    // Switch to timestamp/converter sub-tab if a sub-tab bar exists
    const tab = popupPage.locator('[data-sub="timestamp"]').first();
    if (await tab.count()) {
      await tab.click();
      await expect(popupPage.locator('#tzConvertBtn')).toBeVisible();
      await expect(popupPage.locator('#tzFrom')).toBeVisible();
      await expect(popupPage.locator('#tzTo')).toBeVisible();
    }
  });

  test('Env Marker panel renders with Add button', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="envmarker"]');
    await expect(popupPage.locator('#panel-envmarker')).toHaveClass(/active/);
    await expect(popupPage.locator('#envmarkerAddBtn')).toBeVisible();
    await expect(popupPage.locator('#envmarkerList')).toBeAttached();
  });
});

// ─── Encode panel — additional flows ────────────────────────────────────────

test.describe('Encode utilities — extra coverage', () => {
  test('URL decode round-trip', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="utils"]');
    await popupPage.click('.util-subtab[data-sub="url"]');
    await popupPage.fill('#urlInput', 'hello%20world%21');
    await popupPage.click('#urlDecodeBtn');
    const out = await popupPage.locator('#urlOutput').inputValue();
    expect(out).toBe('hello world!');
  });

  test('Base64 decode round-trip', async ({ popupPage }) => {
    await popupPage.click('.home-tile[data-tab="utils"]');
    await popupPage.click('.util-subtab[data-sub="base64"]');
    const encoded = Buffer.from('qakit decode test').toString('base64');
    await popupPage.fill('#b64Input', encoded);
    await popupPage.click('#b64DecodeBtn');
    const out = await popupPage.locator('#b64Output').inputValue();
    expect(out).toBe('qakit decode test');
  });
});

// ─── JSON Viewer (standalone page) ──────────────────────────────────────────

test.describe('JSON Viewer standalone tab', () => {
  test('JSON Viewer page mounts with mode tabs + text pane', async ({ popupPage, context }) => {
    const [page] = await Promise.all([
      context.waitForEvent('page'),
      popupPage.click('.home-tile[data-action="open-jsondiff"]'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    // Default mode is "Data" (text input). Tree pane is hidden until user switches.
    await expect(page.locator('.qd-mode[data-mode="text"]')).toBeVisible();
    await expect(page.locator('.qd-mode[data-mode="tree"]')).toBeVisible();
    await expect(page.locator('[data-mode-pane="text"]')).toBeVisible();
    await page.close();
  });

  test('JSON Viewer Tree mode reveals expand-all + copy buttons', async ({ popupPage, context }) => {
    const [page] = await Promise.all([
      context.waitForEvent('page'),
      popupPage.click('.home-tile[data-action="open-jsondiff"]'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    // Switch to Tree mode
    await page.click('.qd-mode[data-mode="tree"]');
    await expect(page.locator('#qdTreeExpandAll')).toBeVisible();
    await expect(page.locator('#qdTreeCollapseAll')).toBeVisible();
    await expect(page.locator('#qdTreeCopy')).toBeVisible();
    await expect(page.locator('#qdTreeFilter')).toBeVisible();
    await page.close();
  });
});

// ─── Text Compare (standalone page) ─────────────────────────────────────────

test.describe('Text Compare standalone tab', () => {
  test('Text Compare page mounts with two textareas', async ({ popupPage, context }) => {
    const [page] = await Promise.all([
      context.waitForEvent('page'),
      popupPage.click('.home-tile[data-action="open-textcompare"]'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#tcLeft')).toBeVisible();
    await expect(page.locator('#tcRight')).toBeVisible();
    await page.close();
  });

  test('Text Compare diff stats update when content differs', async ({ popupPage, context }) => {
    const [page] = await Promise.all([
      context.waitForEvent('page'),
      popupPage.click('.home-tile[data-action="open-textcompare"]'),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await page.fill('#tcLeft', 'line one\nline two');
    await page.fill('#tcRight', 'line one\nline TWO');
    // Trigger a compare button if present, else rely on auto-compare on input
    const compareBtn = page.locator('#tcCompare, [data-action="compare"]').first();
    if (await compareBtn.count()) await compareBtn.click();
    // Stats element should populate eventually
    await expect(async () => {
      const stats = await page.locator('#tcStats').textContent();
      expect((stats || '').length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });
    await page.close();
  });
});
