// @ts-check
/**
 * Functional tests for the JSON Viewer standalone page (json-diff-tool.html).
 *
 * Covers: paste JSON, status validation, tree mode rendering, tree search,
 * expand/collapse, format/minify, clear, and sort-keys.
 */

const { test, expect } = require('./fixtures');
const { JsonViewerPage } = require('./pages/json-viewer-page');

const SAMPLE_JSON = JSON.stringify({
  name: 'qakit',
  version: '1.0.5',
  features: ['inspect', 'screenshot', 'audit'],
  config: { theme: 'dark', maxEvents: 3000 },
});

test.describe('JSON Viewer — functional', () => {
  test('pasting valid JSON updates the status to Valid', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await expect(viewer.textStatus).toContainText(/valid/i, { timeout: 3000 });
    await page.close();
  });

  test('pasting invalid JSON shows an error status', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson('{ bad json ,,, }');
    await expect(viewer.textStatus).not.toContainText(/valid/i, { timeout: 3000 });
    await page.close();
  });

  test('switching to Tree mode renders nodes for pasted JSON', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await viewer.mode('tree').click();
    // Tree content should no longer show the empty placeholder.
    await expect(viewer.treeEmpty).toHaveCount(0, { timeout: 3000 });
    // At least one tree node should be present.
    await expect(viewer.treeContent).not.toBeEmpty();
    await page.close();
  });

  test('tree shows top-level keys from the pasted object', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await viewer.mode('tree').click();
    await expect(viewer.treeContent).toContainText('name', { timeout: 3000 });
    await expect(viewer.treeContent).toContainText('version');
    await expect(viewer.treeContent).toContainText('features');
    await page.close();
  });

  test('Expand All reveals deeper nodes', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await viewer.mode('tree').click();
    await viewer.expandAll.click();
    // After expand, nested value "dark" (inside config) should be visible.
    await expect(viewer.treeContent).toContainText('dark', { timeout: 3000 });
    await page.close();
  });

  test('Collapse All hides nested content', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await viewer.mode('tree').click();
    await viewer.expandAll.click();
    await viewer.collapseAll.click();
    // After collapse, the nested "dark" value should no longer be visible.
    await expect(viewer.treeContent).not.toContainText('dark', { timeout: 3000 });
    await page.close();
  });

  test('tree search filters to matching keys', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await viewer.mode('tree').click();
    await viewer.treeFilter.fill( 'version');
    await viewer.treeFilter.dispatchEvent( 'input');
    // Status should show a match count.
    await expect(async () => {
      const status = await viewer.treeStatus.textContent();
      expect(status).toMatch(/\d/);
    }).toPass({ timeout: 3000 });
    await page.close();
  });

  test('tree selection and search distinguish special keys from nested paths', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(JSON.stringify({
      'a.b': { 'x[y]/~"\n': 'special-value', '': 'empty-key' },
      a: { b: 'nested-value' },
    }));
    await viewer.mode('tree').click();
    await viewer.expandAll.click();
    await viewer.treeRows.filter({ hasText: 'special-value' }).click();
    await expect(viewer.detailContent).toContainText('special-value');
    await viewer.treeRows.filter({ hasText: 'empty-key' }).click();
    await expect(viewer.detailContent).toContainText('empty-key');
    await viewer.treeRows.filter({ hasText: 'nested-value' }).click();
    await expect(viewer.detailContent).toContainText('nested-value');
    await viewer.treeFilter.fill( 'special-value');
    await expect(viewer.matchingTreeRows).toContainText('special-value');
    await viewer.matchingTreeRows.click();
    await expect(viewer.detailContent).toContainText('special-value');
    await page.close();
  });

  test('Format button pretty-prints the JSON', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    // Paste minified JSON.
    await viewer.pasteJson('{"a":1,"b":2}');
    await viewer.format.click();
    const formatted = await viewer.textArea.inputValue();
    // Pretty-printed JSON has newlines.
    expect(formatted).toContain('\n');
    await page.close();
  });

  test('Minify button compresses formatted JSON', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson('{\n  "a": 1,\n  "b": 2\n}');
    await viewer.minify.click();
    const minified = await viewer.textArea.inputValue();
    expect(minified).not.toContain('\n');
    await page.close();
  });

  test('Clear button empties the text area', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.pasteJson(SAMPLE_JSON);
    await viewer.clear.click();
    const val = await viewer.textArea.inputValue();
    expect(val).toBe('');
    await page.close();
  });

  test('tree search Previous/Next buttons are present', async ({ popup, popupPage, context }) => {
    const viewer = new JsonViewerPage(await popup.openStandalone('open-jsondiff'));
    const page = viewer.page;
    await viewer.mode('tree').click();
    await expect(viewer.searchPrevious).toBeVisible();
    await expect(viewer.searchNext).toBeVisible();
    await page.close();
  });
});
