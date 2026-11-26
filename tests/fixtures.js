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
 *   - pageObjects : utility to create page objects from popup or context pages
 */

const { test: base, chromium } = require('@playwright/test');
const path = require('path');
const { PopupPage } = require('./pages/popup-page');
const {
  NetworkMockPage,
  CookieManagerPage,
  PageAuditPage,
  HeadersPage,
  ConsolePage,
  ToolsPage,
  UtilityPage,
  LocalStoragePage,
  GeolocationPage,
  EnvironmentMarkerPage,
  TextComparePage,
  JsonViewerPage,
  MarkupPage,
} = require('./pages');

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

  /**
   * Utility fixture to create page objects for different panels.
   * This allows tests to easily instantiate and use specific page objects.
   * 
   * Usage:
   *   const networkMock = pageObjects.createNetworkMockPage(popupPage);
   *   await networkMock.createRule({ name: 'test', pattern: '/api' });
   */
  pageObjects: [async ({}, use) => {
    const factory = {
      createNetworkMockPage: (page) => new NetworkMockPage(page),
      createCookieManagerPage: (page) => new CookieManagerPage(page),
      createPageAuditPage: (page) => new PageAuditPage(page),
      createHeadersPage: (page) => new HeadersPage(page),
      createConsolePage: (page) => new ConsolePage(page),
      createToolsPage: (page) => new ToolsPage(page),
      createUtilityPage: (page) => new UtilityPage(page),
      createLocalStoragePage: (page) => new LocalStoragePage(page),
      createGeolocationPage: (page) => new GeolocationPage(page),
      createEnvironmentMarkerPage: (page) => new EnvironmentMarkerPage(page),
      createTextComparePage: (page) => new TextComparePage(page),
      createJsonViewerPage: (page) => new JsonViewerPage(page),
      createMarkupPage: (page) => new MarkupPage(page),
    };
    await use(factory);
  }, { scope: 'test' }],
});

exports.expect = require('@playwright/test').expect;

