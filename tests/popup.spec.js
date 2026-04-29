// @ts-check
const { test, expect } = require('./fixtures');

// ─── Popup loads ────────────────────────────────────────────────────────────

test('popup has a title and shows the home panel on open', async ({ popupPage }) => {
  const title = await popupPage.title();
  expect(title.length).toBeGreaterThan(0);
  await expect(popupPage.locator('#panel-home')).toBeVisible();
});

test('home tiles are rendered for all major tools', async ({ popupPage }) => {
  // Tiles navigate via data-tab or data-action — not the hidden tab bar
  const expectedTiles = ['ddl', 'net', 'audit', 'utils', 'cookies', 'ls', 'console', 'time', 'geo'];
  for (const tab of expectedTiles) {
    await expect(popupPage.locator(`.home-tile[data-tab="${tab}"]`)).toBeAttached();
  }
  // Action tiles
  for (const action of ['open-jsondiff', 'open-textcompare', 'inspect', 'region', 'annotate']) {
    await expect(popupPage.locator(`.home-tile[data-action="${action}"]`)).toBeAttached();
  }
});

// ─── Tile navigation ─────────────────────────────────────────────────────────

test('Analytics tile opens panel-ddl', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="ddl"]');
  await expect(popupPage.locator('#panel-ddl')).toHaveClass(/active/);
});

test('Net Mock tile opens panel-net', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="net"]');
  await expect(popupPage.locator('#panel-net')).toHaveClass(/active/);
});

test('Page Audit tile opens panel-audit', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="audit"]');
  await expect(popupPage.locator('#panel-audit')).toHaveClass(/active/);
});

test('Encode tile opens panel-utils', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="utils"]');
  await expect(popupPage.locator('#panel-utils')).toHaveClass(/active/);
});

test('back button on a tool panel returns to home', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="net"]');
  await expect(popupPage.locator('#panel-net')).toHaveClass(/active/);
  await popupPage.click('#panel-net .panel-nav-back');
  await expect(popupPage.locator('#panel-home')).toBeVisible();
  // panel-net should no longer be the active overlay
  await expect(popupPage.locator('#panel-net')).not.toHaveClass(/active/);
});

// ─── Settings panel ─────────────────────────────────────────────────────────

test('Settings button opens the settings panel', async ({ popupPage }) => {
  await popupPage.click('#settingsBtn');
  await expect(popupPage.locator('#panel-settings')).toHaveClass(/active/);
});

test('theme toggle switches body to dark class', async ({ popupPage }) => {
  await popupPage.click('#settingsBtn');
  await popupPage.click('#themeDarkBtn');
  await expect(popupPage.locator('body')).toHaveClass(/dark/);
});

test('theme toggle switches body back to light', async ({ popupPage }) => {
  await popupPage.click('#settingsBtn');
  await popupPage.click('#themeDarkBtn');
  await popupPage.click('#themeLightBtn');
  await expect(popupPage.locator('body')).not.toHaveClass(/dark/);
});

// ─── JSON Diff & Text Compare open in new tab ────────────────────────────────

test('JSON Viewer tile launches json-diff-tool.html in a new tab', async ({ popupPage, context }) => {
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    popupPage.click('.home-tile[data-action="open-jsondiff"]'),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toMatch(/json-diff-tool\.html/);
  await newPage.close();
});

test('Text Compare tile launches text-compare.html in a new tab', async ({ popupPage, context }) => {
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    popupPage.click('.home-tile[data-action="open-textcompare"]'),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toMatch(/text-compare\.html/);
  await newPage.close();
});

// ─── Encode panel — URL / Base64 ─────────────────────────────────────────────

test('URL encode produces encoded output', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="utils"]');
  // URL is the second sub-tab inside panel-utils (default is JWT)
  await popupPage.click('.util-subtab[data-sub="url"]');
  await popupPage.fill('#urlInput', 'hello world');
  await popupPage.click('#urlEncodeBtn');
  const output = await popupPage.locator('#urlOutput').inputValue();
  expect(output).toContain('hello%20world');
});

test('Base64 encode produces encoded output', async ({ popupPage }) => {
  await popupPage.click('.home-tile[data-tab="utils"]');
  // Base64 is the third sub-tab inside panel-utils
  await popupPage.click('.util-subtab[data-sub="base64"]');
  await popupPage.fill('#b64Input', 'qakit');
  await popupPage.click('#b64EncodeBtn');
  const output = await popupPage.locator('#b64Output').inputValue();
  expect(output).toBe(Buffer.from('qakit').toString('base64'));
});