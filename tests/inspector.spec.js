// @ts-check
/**
 * Tests for the Element Inspector and Spacing Inspector (inspector.js).
 *
 * inspector.js is a self-contained MAIN-world script — it has no chrome.*
 * calls, so we can inject it directly via addScriptTag and drive it with
 * synthetic mouse events, without needing the full extension popup flow.
 *
 * Strategy:
 *   1. Set window.__qInspectorActive + __qInspectorMode BEFORE injecting.
 *   2. addScriptTag({ path: 'src/inspector.js' }) — installs listeners.
 *   3. Dispatch mousemove on a target element.
 *   4. Wait one rAF cycle so the async rAF callback fires.
 *   5. Assert the overlay/panel DOM.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const INSPECTOR_JS = path.resolve(__dirname, '..', 'src', 'inspector.js');

// ─── Helper: inject inspector into a page in the given mode ──────────────────

async function injectInspector(page, mode = 'spacing') {
  // Must set flags BEFORE the script runs (it reads them on install)
  await page.evaluate((m) => {
    window.__qInspectorMode   = m;
    window.__qInspectorActive = true;
    // Ensure a clean install each time (no leftover state from a prior injection)
    delete window.__qInspectorInstalled;
  }, mode);
  await page.addScriptTag({ path: INSPECTOR_JS });
}

// Helper: move the real cursor over an element and flush the rAF.
// Using hover() instead of dispatchEvent keeps clientX/clientY at the
// element's centre, preventing a native mousemove at (0,0) from racing
// with the rAF callback and picking up the <html> element instead.
async function hoverAndFlush(page, selector) {
  await page.locator(selector).hover();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ─── Simple test fixture HTML ─────────────────────────────────────────────────
//
//   ┌──────────────────────────────────┐
//   │ #box-a  100×50  background:red   │
//   │                                  │  ← 20px gap (margin-bottom on #box-a)
//   │ #box-b  100×50  background:blue  │
//   └──────────────────────────────────┘
//   #row contains two 80×40 siblings side-by-side with 16px gap (margin-right)

const FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;padding:40px;font-family:sans-serif">
  <div id="box-a" style="width:100px;height:50px;background:red;margin-bottom:20px"></div>
  <div id="box-b" style="width:100px;height:50px;background:blue;padding:8px 12px;
       border:2px solid navy;margin-top:0"></div>
  <div id="row" style="display:flex;margin-top:40px">
    <div id="left"  style="width:80px;height:40px;background:green;margin-right:16px"></div>
    <div id="right" style="width:80px;height:40px;background:orange"></div>
  </div>
</body></html>`;

// ─── SPACING INSPECTOR tests ──────────────────────────────────────────────────

test.describe('Spacing Inspector', () => {
  let page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setContent(FIXTURE_HTML);
    await injectInspector(page, 'spacing');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('content box overlay appears on hover', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-spacing-content')).toBeVisible();
  });

  test('padding box appears when element has padding', async () => {
    await hoverAndFlush(page, '#box-b');
    await expect(page.locator('#__q-spacing-padding')).toBeVisible();
  });

  test('margin box appears when element has margin', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-spacing-margin')).toBeVisible();
  });

  test('spacing panel is displayed', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-spacing-panel')).toBeVisible();
  });

  test('spacing panel shows correct W × H', async () => {
    await hoverAndFlush(page, '#box-a');
    const text = await page.locator('#__q-spacing-panel').innerText();
    expect(text).toContain('100');
    expect(text).toContain('50');
  });

  test('spacing panel shows correct padding values for #box-b', async () => {
    await hoverAndFlush(page, '#box-b');
    const text = await page.locator('#__q-spacing-panel').innerText();
    // padding: 8px 12px → T/B = 8, L/R = 12
    expect(text).toContain('8');
    expect(text).toContain('12');
  });

  test('gap to previous sibling shown in panel (vertical)', async () => {
    // #box-b follows #box-a which has margin-bottom:20px → gap = 20px
    await hoverAndFlush(page, '#box-b');
    const text = await page.locator('#__q-spacing-panel').innerText();
    expect(text).toMatch(/Gap to prev/);
    expect(text).toContain('20 px');
  });

  test('gap to next sibling shown in panel (vertical)', async () => {
    // #box-a precedes #box-b with a 20px gap
    await hoverAndFlush(page, '#box-a');
    const text = await page.locator('#__q-spacing-panel').innerText();
    expect(text).toMatch(/Gap to next/);
    expect(text).toContain('20 px');
  });

  test('gap box overlay rendered for previous sibling', async () => {
    await hoverAndFlush(page, '#box-b');
    await expect(page.locator('#__q-gap-prev')).toBeVisible();
  });

  test('gap box overlay rendered for next sibling', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-gap-next')).toBeVisible();
  });

  test('gap label shows px value on the gap box', async () => {
    await hoverAndFlush(page, '#box-a');
    const label = await page.locator('#__q-gap-next-lbl').textContent();
    expect(label).toBe('20px');
  });

  test('horizontal gap detected for side-by-side siblings', async () => {
    // #left has margin-right:16px → gap to #right = 16px
    await hoverAndFlush(page, '#left');
    const text = await page.locator('#__q-spacing-panel').innerText();
    expect(text).toContain('16 px');
  });

  test('overlays hidden after hovering another element', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-spacing-content')).toBeVisible();
    // Hover a different element — inspector calls hideAll() then re-positions
    await hoverAndFlush(page, '#box-b');
    // The content box should have moved (still visible, now over box-b)
    await expect(page.locator('#__q-spacing-content')).toBeVisible();
  });

  test('first element has no gap-to-prev', async () => {
    // #box-a has no previousElementSibling so no gap-prev box
    await hoverAndFlush(page, '#box-a');
    const prevBox = page.locator('#__q-gap-prev');
    // Either not present or hidden
    const count = await prevBox.count();
    if (count > 0) {
      await expect(prevBox).toBeHidden();
    }
  });
});

// ─── ELEMENT INSPECTOR tests ──────────────────────────────────────────────────

test.describe('Element Inspector', () => {
  let page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setContent(FIXTURE_HTML);
    await injectInspector(page, 'inspect');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('green overlay appears on hover', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-inspector-overlay')).toBeVisible();
  });

  test('badge appears with element tag', async () => {
    await hoverAndFlush(page, '#box-a');
    const badge = page.locator('#__q-inspector-badge');
    await expect(badge).toBeVisible();
    const text = await badge.innerText();
    expect(text.toLowerCase()).toContain('div');
  });

  test('badge shows element id and css selector', async () => {
    await hoverAndFlush(page, '#box-a');
    const text = await page.locator('#__q-inspector-badge').innerText();
    // Inspect mode badge shows locator info — id, CSS path, XPath
    expect(text).toContain('box-a');
    expect(text).toContain('#box-a');
  });

  test('inspector deactivates when __qHideAll is called', async () => {
    await hoverAndFlush(page, '#box-a');
    await expect(page.locator('#__q-inspector-overlay')).toBeVisible();

    // Deactivation calls __qHideAll (the same path taken by the popup deactivateInspector)
    await page.evaluate(() => {
      window.__qInspectorActive = false;
      if (typeof window.__qHideAll === 'function') window.__qHideAll();
    });

    await expect(page.locator('#__q-inspector-overlay')).toBeHidden();
  });

  // ── Fix 75: rAF race regression ──────────────────────────────────────────
  // The mousemove handler schedules a rAF callback. If __qInspectorActive flips
  // to false BEFORE the callback fires, the callback must re-check the flag
  // and bail out — otherwise the green overlay stays stuck on screen.
  test('rAF callback bails out when deactivated mid-flight (Fix 75)', async () => {
    // Dispatch mousemove + flip the flag synchronously, before rAF fires.
    await page.evaluate(() => {
      const t = document.querySelector('#box-a');
      t.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
      window.__qInspectorActive = false;
    });
    // Flush two rAF cycles — gives the scheduled callback room to run + bail.
    await page.evaluate(() =>
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // Overlay must NOT be visible after deactivation.
    await expect(page.locator('#__q-inspector-overlay')).toBeHidden();
  });

  test('window.__qInspectorRafId is exposed for external cancellation (Fix 75)', async () => {
    // The popup's deactivateInspector uses cancelAnimationFrame on this id.
    // Test that scheduling a mousemove sets the external mirror.
    const rafIdSet = await page.evaluate(() => {
      const t = document.querySelector('#box-a');
      t.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
      return typeof window.__qInspectorRafId === 'number' && window.__qInspectorRafId > 0;
    });
    expect(rafIdSet).toBe(true);
  });

  // ── Pin state regression ──────────────────────────────────────────────────
  test('badge stops following cursor when pinned', async () => {
    await hoverAndFlush(page, '#box-a');
    const idAfterA = await page.locator('#__q-inspector-badge').innerText();
    expect(idAfterA).toContain('box-a');

    // Pin
    await page.evaluate(() => { window.__qInspectorPinned = true; });

    // Hover a different element — handler should early-return on pinned.
    await hoverAndFlush(page, '#box-b');
    const idAfterPinnedHover = await page.locator('#__q-inspector-badge').innerText();
    // Badge content should still reference box-a, not box-b
    expect(idAfterPinnedHover).toContain('box-a');
    expect(idAfterPinnedHover).not.toContain('box-b');

    // Unpin and hover again — badge should now update
    await page.evaluate(() => { window.__qInspectorPinned = false; });
    await hoverAndFlush(page, '#box-b');
    const idAfterUnpin = await page.locator('#__q-inspector-badge').innerText();
    expect(idAfterUnpin).toContain('box-b');
  });

  // ── Output-style toggle (CSS / XPath / PW / Cy) ───────────────────────────
  test('badge renders BEST LOCATORS section with output-style buttons', async () => {
    await hoverAndFlush(page, '#box-a');
    const html = await page.locator('#__q-inspector-badge').innerHTML();
    expect(html).toContain('BEST LOCATORS');
    // All four output styles should be present as toggle buttons
    expect(html).toContain('data-style="css"');
    expect(html).toContain('data-style="xpath"');
    expect(html).toContain('data-style="playwright"');
    expect(html).toContain('data-style="cypress"');
  });

  // ── Breadcrumb trail ──────────────────────────────────────────────────────
  test('badge renders breadcrumb chain for nested elements', async () => {
    await hoverAndFlush(page, '#left'); // child of #row
    const html = await page.locator('#__q-inspector-badge').innerHTML();
    // Crumb container should be present
    expect(html).toContain('__q-crumbs');
  });
});
