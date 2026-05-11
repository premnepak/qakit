// @ts-check
/**
 * Functional tests for the Markup Editor (markup.html / markup.js).
 *
 * The editor loads its screenshot via chrome.runtime.sendMessage({ action: 'FETCH_MARKUP_IMAGE' }).
 * We intercept that message in addInitScript (runs before page scripts) and return a fake PNG,
 * bypassing the service-worker storage handoff that is tested separately.
 */

const { test, expect } = require('./fixtures');

// Minimal valid 1×1 PNG — same stand-in used across test files.
const FAKE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// All annotation tool identifiers declared in markup.js.
const TOOLS = ['select', 'pen', 'rect', 'arrow', 'highlight', 'blur', 'number', 'text', 'crop'];

/**
 * Open markup.html with a fake image injected via message interception.
 * Returns the opened page after the canvas has been initialised.
 */
async function openMarkupEditor(context, extensionId) {
  const page = await context.newPage();

  // Intercept FETCH_MARKUP_IMAGE before any page scripts run.
  await page.addInitScript((png) => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function (msg) {
      if (msg && msg.action === 'FETCH_MARKUP_IMAGE') {
        return Promise.resolve({ ok: true, entry: { dataUrl: png, prefix: 'test' } });
      }
      return orig(msg);
    };
  }, FAKE_PNG);

  // Use any id — the interceptor ignores it.
  await page.goto(`chrome-extension://${extensionId}/markup.html?id=test-mk-000`);

  // Wait for the canvas to be initialised with the loaded image dimensions.
  await page.waitForFunction(
    () => {
      const c = document.getElementById('mkCanvas');
      return c && c.width > 0 && c.height > 0;
    },
    { timeout: 6000 },
  );

  return page;
}

test.describe('Markup Editor — UI and tool controls', () => {
  test('canvas is initialised after the fake image loads', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    const dims = await page.evaluate(() => {
      const c = document.getElementById('mkCanvas');
      return { w: c.width, h: c.height };
    });
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    await page.close();
  });

  test('all annotation tool buttons are present', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    for (const tool of TOOLS) {
      await expect(page.locator(`.mk-tool[data-tool="${tool}"]`)).toBeAttached();
    }
    await page.close();
  });

  test('clicking a tool button marks it active', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    for (const tool of ['pen', 'rect', 'arrow', 'highlight', 'blur', 'number', 'text', 'select']) {
      await page.click(`.mk-tool[data-tool="${tool}"]`);
      await expect(page.locator(`.mk-tool[data-tool="${tool}"]`)).toHaveClass(/active/);
    }
    await page.close();
  });

  test('switching tools deactivates the previous tool', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    await page.click('.mk-tool[data-tool="pen"]');
    await expect(page.locator('.mk-tool[data-tool="pen"]')).toHaveClass(/active/);
    await page.click('.mk-tool[data-tool="rect"]');
    await expect(page.locator('.mk-tool[data-tool="rect"]')).toHaveClass(/active/);
    await expect(page.locator('.mk-tool[data-tool="pen"]')).not.toHaveClass(/active/);
    await page.close();
  });

  test('color picker is present and accepts a value change', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    await expect(page.locator('#mkColor')).toBeVisible();
    await page.evaluate(() => {
      const el = document.getElementById('mkColor');
      el.value = '#ff0000';
      el.dispatchEvent(new Event('input'));
    });
    const val = await page.locator('#mkColor').inputValue();
    expect(val).toBe('#ff0000');
    await page.close();
  });

  test('size slider is present and accepts a value change', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    await expect(page.locator('#mkSize')).toBeVisible();
    await expect(page.locator('#mkSizeVal')).toBeVisible();
    await page.fill('#mkSize', '8');
    await page.dispatchEvent('#mkSize', 'input');
    const label = await page.locator('#mkSizeVal').textContent();
    expect(label).toBe('8');
    await page.close();
  });

  test('undo, redo, copy, save, and done buttons are all present', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    for (const id of ['mkUndo', 'mkRedo', 'mkCopy', 'mkSave', 'mkDone']) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }
    await page.close();
  });

  test('page title includes the image dimensions', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    const title = await page.title();
    // Title format: "QAKit Markup — WxH"
    expect(title).toMatch(/QAKit Markup/);
    expect(title).toMatch(/\d+×\d+/);
    await page.close();
  });

  test('undo button is disabled when history is empty', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    // No shapes drawn — undo should be disabled, not clickable.
    await expect(page.locator('#mkUndo')).toBeDisabled();
    // Canvas should still be present and functional.
    await expect(page.locator('#mkCanvas')).toBeVisible();
    await page.close();
  });

  test('keyboard shortcut selects tools', async ({ context, extensionId }) => {
    const page = await openMarkupEditor(context, extensionId);
    // Focus the page body so key events are received.
    await page.click('body');
    const keyToolMap = { p: 'pen', r: 'rect', a: 'arrow', h: 'highlight', b: 'blur', n: 'number', t: 'text', v: 'select' };
    for (const [key, tool] of Object.entries(keyToolMap)) {
      await page.keyboard.press(key);
      await expect(page.locator(`.mk-tool[data-tool="${tool}"]`)).toHaveClass(/active/);
    }
    await page.close();
  });
});
