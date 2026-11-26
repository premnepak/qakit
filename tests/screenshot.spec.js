// @ts-check
/**
 * Regression tests for screenshot toast UI and the Edit button feature.
 *
 * Three suites:
 *
 *  1. Page-injected toast (injectScreenshotToast inner func)
 *  2. Popup showScreenshotToast (via DELIVER_CROPPED_SCREENSHOT)
 *  3. Screenshots sub-panel UI
 *
 * Edit button behaviour:
 *   Clicking Edit sends OPEN_IN_EDITOR to background.js.
 *   Background calls chrome.downloads.download({ saveAs: false }) which is an
 *   extension-privileged call that bypasses Chrome's "Ask where to save" browser
 *   setting. When complete, chrome.downloads.open() launches the default editor.
 *   A page-side <a download> click (used previously) does NOT bypass that setting
 *   and caused a save dialog — that approach has been removed.
 */

const { test: baseTest, expect } = require('@playwright/test');
const { test } = require('./fixtures');
const { PopupPage } = require('./pages/popup-page');

// Minimal valid 1×1 PNG data URL — used as a stand-in for real captures.
const FAKE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('full-page capture restores scroll position when a strip capture fails', async ({ context, extensionId }) => {
  const worker = context.serviceWorkers().find(sw => sw.url().includes(extensionId));
  const result = await worker.evaluate(async () => {
    const originalGet = chrome.tabs.get;
    const originalCapture = chrome.tabs.captureVisibleTab;
    const originalExecute = chrome.scripting.executeScript;
    const originalEnsure = ensurePageScripts;
    const calls = [];
    try {
      chrome.tabs.get = async () => ({ windowId: 1 });
      ensurePageScripts = async () => {};
      chrome.scripting.executeScript = async options => {
        calls.push({ fn: String(options.func), args: options.args });
        if (String(options.func).includes('__qkitGetFullPageDimensions')) {
          return [{ result: { scrollHeight: 1000, viewportHeight: 500, viewportWidth: 800, dpr: 1, originalScrollY: 250 } }];
        }
        return [];
      };
      chrome.tabs.captureVisibleTab = () => { throw new Error('capture failed'); };
      let error;
      try { await captureFullPage(1); } catch (e) { error = e.message; }
      return { error, calls };
    } finally {
      chrome.tabs.get = originalGet;
      chrome.tabs.captureVisibleTab = originalCapture;
      chrome.scripting.executeScript = originalExecute;
      ensurePageScripts = originalEnsure;
    }
  });
  expect(result.error).toBe('capture failed');
  expect(result.calls.at(-1).args).toEqual([250]);
  expect(result.calls.at(-1).fn).toContain('window.scrollTo');
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: inject the page-toast DOM into a plain Playwright page.
// Mirrors the `func` argument of injectScreenshotToast in src/background.js.
// Only the functional parts (button labels, onclick handlers, id) are included;
// visual styling is omitted for brevity.
// ─────────────────────────────────────────────────────────────────────────────
async function createPageToast(page, imgUrl = FAKE_PNG, toastLabel = 'Region captured', dlPrefix = 'qakit-region', mkId = 'mk_test_001') {
  await page.evaluate(([imgUrl, toastLabel, dlPrefix, mkId]) => {
    // Remove stale toast (deduplication — same logic as injectScreenshotToast)
    document.getElementById('__qkit-save-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = '__qkit-save-toast';
    document.body.appendChild(toast);

    // Header
    const txt = document.createElement('div');
    txt.innerHTML = '<span id="__qkit-toast-label">📸 ' + toastLabel + '</span>';
    toast.appendChild(txt);

    // Buttons (exact textContent and onclick behaviour from background.js)
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '⬇ Save';
    saveBtn.onclick = () => {
      window.dispatchEvent(new CustomEvent('__qkitSaveScreenshot', {
        detail: { dataUrl: imgUrl, prefix: dlPrefix },
      }));
      toast.remove();
    };

    const editBtn = document.createElement('button');
    editBtn.textContent = '✎ Markup';
    // Dispatches only the pre-stored ID — mirrors background.js injectScreenshotToast.
    // The full data URL is never routed through the event bridge (avoids storage quota
    // failures for large full-page screenshots).
    editBtn.onclick = () => {
      window.dispatchEvent(new CustomEvent('__qkitEditScreenshot', {
        detail: { id: mkId },
      }));
      toast.remove();
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => toast.remove();

    toast.appendChild(saveBtn);
    toast.appendChild(editBtn);
    toast.appendChild(closeBtn);
  }, [imgUrl, toastLabel, dlPrefix, mkId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Page-injected toast
// No extension needed — uses the built-in baseTest fixture (plain browser).
// ─────────────────────────────────────────────────────────────────────────────
baseTest.describe('Page-injected screenshot toast (injectScreenshotToast)', () => {
  let page;

  baseTest.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
  });

  baseTest.afterEach(async () => {
    await page.close();
  });

  baseTest('renders the toast with the capture label', async () => {
    await createPageToast(page, FAKE_PNG, 'Full page captured', 'qakit-fullpage');
    const label = await page.locator('#__qkit-toast-label').textContent();
    expect(label).toContain('Full page captured');
  });

  baseTest('shows the "⬇ Save" button', async () => {
    await createPageToast(page);
    await expect(page.locator('#__qkit-save-toast button:has-text("⬇ Save")')).toBeVisible();
  });

  baseTest('shows the "✎ Markup" button', async () => {
    await createPageToast(page);
    await expect(page.locator('#__qkit-save-toast button:has-text("Markup")')).toBeVisible();
  });

  baseTest('shows the "✕" dismiss button', async () => {
    await createPageToast(page);
    await expect(page.locator('#__qkit-save-toast button:has-text("✕")')).toBeVisible();
  });

  baseTest('Edit button dispatches __qkitEditScreenshot with pre-stored id (not dataUrl)', async () => {
    await createPageToast(page, FAKE_PNG, 'Test capture', 'qakit-region', 'mk_abc123');

    // Step 1: register a listener that stores the event detail on window
    await page.evaluate(() => {
      window.__editDetail = null;
      window.addEventListener('__qkitEditScreenshot', (e) => { window.__editDetail = e.detail; }, { once: true });
    });
    // Step 2: click Markup via Playwright (text-based locator, safe even after toast removal)
    await page.click('#__qkit-save-toast button:has-text("Markup")');
    // Step 3: read the stored detail
    const detail = await page.evaluate(() => window.__editDetail);

    expect(detail).not.toBeNull();
    // Must dispatch only the pre-stored ID — never the raw data URL through the event bridge.
    expect(detail.id).toBe('mk_abc123');
    expect(detail.dataUrl).toBeUndefined();
  });

  baseTest('Edit button dispatches __qkitEditScreenshot with id only (no prefix in event)', async () => {
    await createPageToast(page, FAKE_PNG, 'Test capture', 'qakit-element', 'mk_xyz789');

    await page.evaluate(() => {
      window.__editDetail = null;
      window.addEventListener('__qkitEditScreenshot', (e) => { window.__editDetail = e.detail; }, { once: true });
    });
    await page.click('#__qkit-save-toast button:has-text("Markup")');
    const detail = await page.evaluate(() => window.__editDetail);

    expect(detail).not.toBeNull();
    expect(detail.id).toBe('mk_xyz789');
    // Prefix is stored server-side with the image — not sent through the event bridge.
    expect(detail.prefix).toBeUndefined();
  });

  baseTest('Edit button removes the toast after dispatching event', async () => {
    await createPageToast(page);
    // Register listener so the CustomEvent is consumed and doesn't hang
    await page.evaluate(() => {
      window.addEventListener('__qkitEditScreenshot', () => {}, { once: true });
    });
    await page.click('#__qkit-save-toast button:has-text("Markup")');
    await expect(page.locator('#__qkit-save-toast')).toHaveCount(0);
  });

  baseTest('Dismiss button (✕) removes the toast', async () => {
    await createPageToast(page);
    await page.click('#__qkit-save-toast button:has-text("✕")');
    await expect(page.locator('#__qkit-save-toast')).toHaveCount(0);
  });

  baseTest('calling toast twice replaces the first (no duplicate toasts)', async () => {
    await createPageToast(page, FAKE_PNG, 'First capture', 'qakit-region');
    await createPageToast(page, FAKE_PNG, 'Second capture', 'qakit-region');
    // Only one toast should exist
    await expect(page.locator('#__qkit-save-toast')).toHaveCount(1);
    // And it should be the latest one
    const label = await page.locator('#__qkit-toast-label').textContent();
    expect(label).toContain('Second capture');
  });

  baseTest('Save button dispatches __qkitSaveScreenshot and removes the toast', async () => {
    await createPageToast(page, FAKE_PNG, 'Test capture', 'qakit-region');
    await page.evaluate(() => {
      window.__saveDetail = null;
      window.addEventListener('__qkitSaveScreenshot', (e) => { window.__saveDetail = e.detail; }, { once: true });
    });
    await page.click('#__qkit-save-toast button:has-text("⬇ Save")');
    const detail = await page.evaluate(() => window.__saveDetail);
    expect(detail).not.toBeNull();
    expect(detail.dataUrl).toBe(FAKE_PNG);
    expect(detail.prefix).toBe('qakit-region');
    // Toast dismissed after dispatch
    await expect(page.locator('#__qkit-save-toast')).toHaveCount(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Popup showScreenshotToast
// Requires the full extension — uses fixtures.js test.
// Strategy: use addInitScript to intercept chrome.runtime.onMessage.addListener
// and capture the handler registered by pagetools.js. Then call it directly
// from the test, which invokes showScreenshotToast with a fake dataUrl.
// This is more reliable than trying to route messages via the service worker.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Popup showScreenshotToast (via DELIVER_CROPPED_SCREENSHOT)', () => {
  // Helper: open popup with the message handler interceptor installed.
  async function openPopupWithInterceptor(context, extensionId) {
    const popupPage = await context.newPage();
    // Intercept chrome.runtime.onMessage.addListener BEFORE popup scripts run.
    // Saves every registered handler to window.__qkitMsgHandlers[].
    await popupPage.addInitScript(() => {
      window.__qkitMsgHandlers = [];
      const origAdd = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
      chrome.runtime.onMessage.addListener = function (fn) {
        window.__qkitMsgHandlers.push(fn);
        return origAdd(fn);
      };
    });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await new PopupPage(popupPage).panel('home').waitFor();
    return popupPage;
  }

  // Helper: simulate delivering DELIVER_CROPPED_SCREENSHOT to the popup.
  async function deliverScreenshot(popupPage, dataUrl, label = 'Test capture') {
    await popupPage.evaluate(([dataUrl, label]) => {
      (window.__qkitMsgHandlers || []).forEach(fn => {
        try {
          fn({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl, label }, {}, () => {});
        } catch (_) {}
      });
    }, [dataUrl, label]);
    // Small settle time for the DOM to update
    await popupPage.waitForTimeout(100);
  }

  test('toast appears in popup with correct label', async ({ context, extensionId }) => {
    const popupPage = await openPopupWithInterceptor(context, extensionId);
    const popup = new PopupPage(popupPage);
    await deliverScreenshot(popupPage, FAKE_PNG, 'Region captured');
    await expect(popup.screenshotToast).toBeVisible({ timeout: 3000 });
    const text = await popup.screenshotToast.innerText();
    expect(text).toContain('Region captured');
    await popupPage.close();
  });

  test('popup toast has Download button', async ({ context, extensionId }) => {
    const popupPage = await openPopupWithInterceptor(context, extensionId);
    const popup = new PopupPage(popupPage);
    await deliverScreenshot(popupPage, FAKE_PNG);
    await expect(popup.screenshotDownload).toBeVisible({ timeout: 3000 });
    await popupPage.close();
  });

  test('popup toast has Markup button', async ({ context, extensionId }) => {
    const popupPage = await openPopupWithInterceptor(context, extensionId);
    const popup = new PopupPage(popupPage);
    await deliverScreenshot(popupPage, FAKE_PNG);
    await expect(popup.screenshotEdit).toBeVisible({ timeout: 3000 });
    expect(await popup.screenshotEdit.textContent()).toContain('Markup');
    await popupPage.close();
  });

  test('popup toast has dismiss button', async ({ context, extensionId }) => {
    const popupPage = await openPopupWithInterceptor(context, extensionId);
    const popup = new PopupPage(popupPage);
    await deliverScreenshot(popupPage, FAKE_PNG);
    await expect(popup.screenshotDismiss).toBeVisible({ timeout: 3000 });
    await popupPage.close();
  });

  test('popup toast dismiss button removes the toast', async ({ context, extensionId }) => {
    const popupPage = await openPopupWithInterceptor(context, extensionId);
    const popup = new PopupPage(popupPage);
    await deliverScreenshot(popupPage, FAKE_PNG);
    await popup.screenshotToast.waitFor({ timeout: 3000 });
    await popup.screenshotDismiss.click();
    await expect(popup.screenshotToast).toHaveCount(0);
    await popupPage.close();
  });

  test('second DELIVER message replaces the first toast (no duplicate)', async ({ context, extensionId }) => {
    const popupPage = await openPopupWithInterceptor(context, extensionId);
    const popup = new PopupPage(popupPage);
    await deliverScreenshot(popupPage, FAKE_PNG, 'First');
    await popup.screenshotToast.waitFor({ timeout: 3000 });
    await deliverScreenshot(popupPage, FAKE_PNG, 'Second');
    await expect(popup.screenshotToast).toHaveCount(1);
    await popupPage.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: Screenshots sub-panel UI
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Screenshots sub-panel UI', () => {
  // Navigate to the screenshots sub-panel programmatically.
  // The Region/Annotate home tiles call window.close() to launch capture mode,
  // so the popup closes on click — we cannot use them for UI panel testing.
  // Instead we call switchToTab('pagetools') (popup.js global) then click
  // the hidden screenshot sub-tab button directly.
  async function goToScreenshots(popup) {
    await popup.page.evaluate(() => {
      if (typeof switchToTab === 'function') switchToTab('pagetools');
    });
    await expect(popup.panel('pagetools')).toHaveClass(/active/, { timeout: 3000 });
    await popup.page.evaluate(() => {
      document.querySelector('.pt-subtab[data-sub="screenshot"]')?.click();
    });
    await expect(popup.screenshotPanel).toBeVisible({ timeout: 3000 });
  }

  test('pagetools panel becomes active after switchToTab call', async ({ popup, popupPage }) => {
    await popupPage.evaluate(() => {
      if (typeof switchToTab === 'function') switchToTab('pagetools');
    });
    await expect(popup.panel('pagetools')).toHaveClass(/active/, { timeout: 3000 });
  });

  test('screenshot sub-tab button is present in pagetools panel', async ({ popup, popupPage }) => {
    await popupPage.evaluate(() => {
      if (typeof switchToTab === 'function') switchToTab('pagetools');
    });
    await expect(popup.subtab('pt', 'screenshot')).toBeAttached();
  });

  test('screenshots sub-panel is visible after sub-tab navigation', async ({ popup }) => {
    await goToScreenshots(popup);
    await expect(popup.screenshotPanel).toBeVisible();
  });

  test('Full Page capture button is present', async ({ popup }) => {
    await goToScreenshots(popup);
    await expect(popup.screenshotFull).toBeVisible();
  });

  test('Region capture button is present', async ({ popup }) => {
    await goToScreenshots(popup);
    await expect(popup.screenshotRegion).toBeVisible();
  });

  test('Annotate Page button is present', async ({ popup }) => {
    await goToScreenshots(popup);
    await expect(popup.screenshotAnnotate).toBeVisible();
  });
});
