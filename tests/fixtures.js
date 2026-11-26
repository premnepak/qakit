// @ts-check
/**
 * Shared Playwright fixtures for QAKit extension tests.
 *
 * Usage:
 *   const { test, expect } = require('./fixtures');
 *
 * Provides:
 *   - context  : PersistentBrowserContext with QAKit loaded
 *   - extensionId : the Chrome extension ID (for chrome-extension:// URLs)
 *   - popupPage : the underlying Playwright Page for low-level operations
 *   - popup : PopupPage object for popup locators and actions
 */

const { test: base, chromium } = require('@playwright/test');
const path = require('path');
const { PopupPage } = require('./pages/popup-page');

const extensionPath = path.resolve(__dirname, '..', 'src');

exports.test = base.extend({
  // One persistent context per test — extension is fully loaded each time.
  context: [async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Chrome extensions do not work in headless mode
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  }, { scope: 'test' }],

  // Resolves the unpacked extension ID from the service worker URL.
  extensionId: [async ({ context }, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent('serviceworker', { timeout: 10000 });
    }
    const extensionId = background.url().split('/')[2];
    await use(extensionId);
  }, { scope: 'test' }],

  // Convenience: an already-opened popup page.
  popupPage: [async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    // Wait for the popup JS to finish initialising
    await page.waitForSelector('#panel-home');
    await use(page);
  }, { scope: 'test' }],

  popup: [async ({ popupPage }, use) => {
    await use(new PopupPage(popupPage));
  }, { scope: 'test' }],
});

exports.expect = require('@playwright/test').expect;
