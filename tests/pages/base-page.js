// @ts-check
/**
 * Base page object providing common functionality for all pages.
 * Defines the foundation for page object inheritance.
 */

class BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
  }

  /**
   * Wait for the page to reach a specific state.
   * @param {import('@playwright/test').PageWaitForURLOptions} options
   */
  async waitForNavigation(options = {}) {
    return this.page.waitForNavigation(options);
  }

  /**
   * Close the current page.
   */
  async close() {
    return this.page.close();
  }

  /**
   * Get the current URL.
   * @returns {string}
   */
  getCurrentUrl() {
    return this.page.url();
  }

  /**
   * Get the page title.
   * @returns {string}
   */
  async getTitle() {
    return this.page.title();
  }

  /**
   * Wait for a selector to appear.
   * @param {string} selector
   * @param {object} options
   */
  async waitForSelector(selector, options = {}) {
    return this.page.waitForSelector(selector, options);
  }

  /**
   * Check if element is visible.
   * @param {import('@playwright/test').Locator} locator
   * @returns {Promise<boolean>}
   */
  async isVisible(locator) {
    return locator.isVisible().catch(() => false);
  }

  /**
   * Check if element is hidden.
   * @param {import('@playwright/test').Locator} locator
   * @returns {Promise<boolean>}
   */
  async isHidden(locator) {
    return locator.isHidden().catch(() => false);
  }

  /**
   * Check if element is enabled.
   * @param {import('@playwright/test').Locator} locator
   * @returns {Promise<boolean>}
   */
  async isEnabled(locator) {
    return locator.isEnabled().catch(() => false);
  }

  /**
   * Check if element is disabled.
   * @param {import('@playwright/test').Locator} locator
   * @returns {Promise<boolean>}
   */
  async isDisabled(locator) {
    return locator.isDisabled().catch(() => false);
  }

  /**
   * Get text content of an element.
   * @param {import('@playwright/test').Locator} locator
   * @returns {Promise<string | null>}
   */
  async getText(locator) {
    return locator.textContent();
  }

  /**
   * Get attribute value from an element.
   * @param {import('@playwright/test').Locator} locator
   * @param {string} attribute
   * @returns {Promise<string | null>}
   */
  async getAttribute(locator, attribute) {
    return locator.getAttribute(attribute);
  }

  /**
   * Wait for a function to return true.
   * @param {Function} fn
   * @param {object} options
   */
  async waitFor(fn, options = {}) {
    return this.page.waitForFunction(fn, options);
  }

  /**
   * Execute a function in the page context.
   * @param {Function} fn
   * @param {...any} args
   */
  async evaluate(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }

  /**
   * Wait for a timeout (in milliseconds).
   * @param {number} ms
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { BasePage };
