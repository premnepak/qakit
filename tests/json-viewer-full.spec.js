// @ts-check
/**
 * Functional tests for the JSON Viewer standalone page (json-diff-tool.html).
 *
 * Covers: paste JSON, status validation, tree mode rendering, tree search,
 * expand/collapse, format/minify, clear, and sort-keys.
 */

const { test, expect } = require('./fixtures');

const SAMPLE_JSON = JSON.stringify({
  name: 'qakit',
  version: '1.0.4',
  features: ['inspect', 'screenshot', 'audit'],
  config: { theme: 'dark', maxEvents: 3000 },
});

async function openJsonViewer(popupPage, context) {
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    popupPage.click('.home-tile[data-action="open-jsondiff"]'),
  ]);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function pasteJson(page, json) {
  // Ensure we are on the Data (text) tab.
  await page.click('.qd-mode[data-mode="text"]');
  await page.fill('#qdTextArea', json);
  // Dispatch input so the parser runs.
  await page.dispatchEvent('#qdTextArea', 'input');
}

test.describe('JSON Viewer — functional', () => {
  test('pasting valid JSON updates the status to Valid', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await expect(page.locator('#qdTextStatus')).toContainText(/valid/i, { timeout: 3000 });
    await page.close();
  });

  test('pasting invalid JSON shows an error status', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, '{ bad json ,,, }');
    await expect(page.locator('#qdTextStatus')).not.toContainText(/valid/i, { timeout: 3000 });
    await page.close();
  });

  test('switching to Tree mode renders nodes for pasted JSON', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await page.click('.qd-mode[data-mode="tree"]');
    // Tree content should no longer show the empty placeholder.
    await expect(page.locator('#qdTreeContent .qd-empty')).toHaveCount(0, { timeout: 3000 });
    // At least one tree node should be present.
    await expect(page.locator('#qdTreeContent')).not.toBeEmpty();
    await page.close();
  });

  test('tree shows top-level keys from the pasted object', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await page.click('.qd-mode[data-mode="tree"]');
    await expect(page.locator('#qdTreeContent')).toContainText('name', { timeout: 3000 });
    await expect(page.locator('#qdTreeContent')).toContainText('version');
    await expect(page.locator('#qdTreeContent')).toContainText('features');
    await page.close();
  });

  test('Expand All reveals deeper nodes', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await page.click('.qd-mode[data-mode="tree"]');
    await page.click('#qdTreeExpandAll');
    // After expand, nested value "dark" (inside config) should be visible.
    await expect(page.locator('#qdTreeContent')).toContainText('dark', { timeout: 3000 });
    await page.close();
  });

  test('Collapse All hides nested content', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await page.click('.qd-mode[data-mode="tree"]');
    await page.click('#qdTreeExpandAll');
    await page.click('#qdTreeCollapseAll');
    // After collapse, the nested "dark" value should no longer be visible.
    await expect(page.locator('#qdTreeContent')).not.toContainText('dark', { timeout: 3000 });
    await page.close();
  });

  test('tree search filters to matching keys', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await page.click('.qd-mode[data-mode="tree"]');
    await page.fill('#qdTreeFilter', 'version');
    await page.dispatchEvent('#qdTreeFilter', 'input');
    // Status should show a match count.
    await expect(async () => {
      const status = await page.locator('#qdTreeStatus').textContent();
      expect(status).toMatch(/\d/);
    }).toPass({ timeout: 3000 });
    await page.close();
  });

  test('Format button pretty-prints the JSON', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    // Paste minified JSON.
    await pasteJson(page, '{"a":1,"b":2}');
    await page.click('#qdTextFormat');
    const formatted = await page.locator('#qdTextArea').inputValue();
    // Pretty-printed JSON has newlines.
    expect(formatted).toContain('\n');
    await page.close();
  });

  test('Minify button compresses formatted JSON', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, '{\n  "a": 1,\n  "b": 2\n}');
    await page.click('#qdTextMinify');
    const minified = await page.locator('#qdTextArea').inputValue();
    expect(minified).not.toContain('\n');
    await page.close();
  });

  test('Clear button empties the text area', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await pasteJson(page, SAMPLE_JSON);
    await page.click('#qdTextClear');
    const val = await page.locator('#qdTextArea').inputValue();
    expect(val).toBe('');
    await page.close();
  });

  test('tree search Previous/Next buttons are present', async ({ popupPage, context }) => {
    const page = await openJsonViewer(popupPage, context);
    await page.click('.qd-mode[data-mode="tree"]');
    await expect(page.locator('#qdTreeSearchPrev')).toBeVisible();
    await expect(page.locator('#qdTreeSearchNext')).toBeVisible();
    await page.close();
  });
});
