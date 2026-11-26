// @ts-check
const { test, expect } = require('./fixtures');

// ─── Popup loads ────────────────────────────────────────────────────────────

test('popup has a title and shows the home panel on open', async ({ popup, popupPage }) => {
  const title = await popupPage.title();
  expect(title.length).toBeGreaterThan(0);
  await expect(popup.panel('home')).toBeVisible();
});

test('home tiles are rendered for all major tools', async ({ popup, popupPage }) => {
  // Tiles navigate via data-tab or data-action — not the hidden tab bar
  const expectedTiles = ['ddl', 'net', 'audit', 'utils', 'cookies', 'ls', 'console', 'time', 'geo'];
  for (const tab of expectedTiles) {
    await expect(popup.homeTile(tab)).toBeAttached();
  }
  // Action tiles
  for (const action of ['open-jsondiff', 'open-textcompare', 'inspect', 'region', 'annotate']) {
    await expect(popup.actionTile(action)).toBeAttached();
  }
});

// ─── Tile navigation ─────────────────────────────────────────────────────────

test('Analytics tile opens panel-ddl', async ({ popup, popupPage }) => {
  await popup.homeTile('ddl').click();
  await expect(popup.panel('ddl')).toHaveClass(/active/);
});

test('Net Mock tile opens panel-net', async ({ popup, popupPage }) => {
  await popup.homeTile('net').click();
  await expect(popup.panel('net')).toHaveClass(/active/);
});

test('Page Audit tile opens panel-audit', async ({ popup, popupPage }) => {
  await popup.homeTile('audit').click();
  await expect(popup.panel('audit')).toHaveClass(/active/);
});

test('Encode tile opens panel-utils', async ({ popup, popupPage }) => {
  await popup.homeTile('utils').click();
  await expect(popup.panel('utils')).toHaveClass(/active/);
});

test('back button on a tool panel returns to home', async ({ popup, popupPage }) => {
  await popup.homeTile('net').click();
  await expect(popup.panel('net')).toHaveClass(/active/);
  await popup.panelNetPanelNavBack.click();
  await expect(popup.panel('home')).toBeVisible();
  // panel-net should no longer be the active overlay
  await expect(popup.panel('net')).not.toHaveClass(/active/);
});

// ─── Settings panel ─────────────────────────────────────────────────────────

test('Settings button opens the settings panel', async ({ popup, popupPage }) => {
  await popup.settingsBtn.click();
  await expect(popup.panel('settings')).toHaveClass(/active/);
});

test('theme toggle switches body to dark class', async ({ popup, popupPage }) => {
  await popup.settingsBtn.click();
  await popup.themeDarkBtn.click();
  await expect(popup.body).toHaveClass(/dark/);
});

test('theme toggle switches body back to light', async ({ popup, popupPage }) => {
  await popup.settingsBtn.click();
  await popup.themeDarkBtn.click();
  await popup.themeLightBtn.click();
  await expect(popup.body).not.toHaveClass(/dark/);
});

// ─── JSON Diff & Text Compare open in new tab ────────────────────────────────

test('JSON Viewer tile launches json-diff-tool.html in a new tab', async ({ popup, popupPage, context }) => {
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    popup.actionTile('open-jsondiff').click(),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toMatch(/json-diff-tool\.html/);
  await newPage.close();
});

test('Text Compare tile launches text-compare.html in a new tab', async ({ popup, popupPage, context }) => {
  const [newPage] = await Promise.all([
    context.waitForEvent('page'),
    popup.actionTile('open-textcompare').click(),
  ]);
  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toMatch(/text-compare\.html/);
  await newPage.close();
});

// ─── Encode panel — URL / Base64 ─────────────────────────────────────────────

test('URL encode produces encoded output', async ({ popup, popupPage }) => {
  await popup.homeTile('utils').click();
  // URL is the second sub-tab inside panel-utils (default is JWT)
  await popup.subtab('util', 'url').click();
  await popup.urlInput.fill( 'hello world');
  await popup.urlEncodeBtn.click();
  const output = await popup.urlOutput.inputValue();
  expect(output).toContain('hello%20world');
});

test('Base64 encode produces encoded output', async ({ popup, popupPage }) => {
  await popup.homeTile('utils').click();
  // Base64 is the third sub-tab inside panel-utils
  await popup.subtab('util', 'base64').click();
  await popup.b64Input.fill( 'qakit');
  await popup.b64EncodeBtn.click();
  const output = await popup.b64Output.inputValue();
  expect(output).toBe(Buffer.from('qakit').toString('base64'));
});