// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Local Storage panel.
 * Handles local storage session management.
 */
class LocalStoragePage extends BasePage {
  constructor(page) {
    super(page);
    this.addBtn = page.locator('#lsAddBtn');
    this.refreshBtn = page.locator('#lsRefreshBtn');
    this.search = page.locator('#lsSearch');
    this.addOverlay = page.locator('#lsAddOverlay');
    this.addModalTitle = page.locator('#lsAddModalTitle');
    this.addCancel = page.locator('#lsAddCancel');
    this.typeSession = page.locator('#lsTypeSession');
  }

  /**
   * Refresh local storage.
   */
  async refresh() {
    await this.refreshBtn.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Search local storage items.
   * @param {string} keyword
   */
  async search(keyword) {
    await this.search.fill(keyword);
  }

  /**
   * Clear the search filter.
   */
  async clearSearch() {
    await this.search.clear();
  }

  /**
   * Check if the add modal is visible.
   * @returns {Promise<boolean>}
   */
  async isAddModalVisible() {
    return this.isVisible(this.addOverlay);
  }

  /**
   * Close the add modal.
   */
  async closeAddModal() {
    await this.addCancel.click();
    await this.page.waitForSelector('#lsAddOverlay', { state: 'hidden' });
  }
}

module.exports = { LocalStoragePage };
