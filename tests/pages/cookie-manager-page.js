// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Cookie Manager panel.
 * Handles cookie display, filtering, editing, and deletion.
 */
class CookieManagerPage extends BasePage {
  constructor(page) {
    super(page);
    this.addBtn = page.locator('#cookieAddBtn');
    this.refreshBtn = page.locator('#cookieRefreshBtn');
    this.search = page.locator('#cookieSearch');
    this.toggleAllBtn = page.locator('#cookieToggleAllBtn');
    this.count = page.locator('#cookieCount');
    this.list = page.locator('#cookieList');
    this.editOverlay = page.locator('#cookieEditOverlay');
    this.modalTitle = page.locator('#ckModalTitle');
    
    // Edit modal fields
    this.editName = page.locator('#ckEditName');
    this.editValue = page.locator('#ckEditValue');
    this.editDomain = page.locator('#ckEditDomain');
    this.editPath = page.locator('#ckEditPath');
    this.editCancel = page.locator('#ckEditCancel');
    
    // Cookie card elements
    this.cookieCard = page.locator('.ck-details');
    this.cookieCardLabel = page.locator('.ck-details summary');
  }

  /**
   * Refresh the cookie list.
   */
  async refresh() {
    await this.refreshBtn.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Search cookies by keyword.
   * @param {string} keyword
   */
  async search(keyword) {
    await this.search.clear();
    await this.search.fill(keyword);
  }

  /**
   * Clear the search filter.
   */
  async clearSearch() {
    await this.search.clear();
  }

  /**
   * Toggle all cookies on/off.
   */
  async toggleAll() {
    await this.toggleAllBtn.click();
  }

  /**
   * Get the number of displayed cookies.
   * @returns {Promise<number>}
   */
  async getCookieCount() {
    return this.cookieCard.count();
  }

  /**
   * Get a specific cookie by index.
   * @param {number} index
   * @returns {object}
   */
  getCookieByIndex(index) {
    return {
      card: this.cookieCard.nth(index),
      label: this.cookieCardLabel.nth(index),
    };
  }

  /**
   * Toggle a cookie's enable/disable state.
   * @param {number} index
   */
  async toggleCookie(index) {
    const cookie = this.getCookieByIndex(index);
    const enabled = cookie.card.locator('.ck-enabled');
    await enabled.click();
  }

  /**
   * Expand a cookie card to view details.
   * @param {number} index
   */
  async expandCookie(index) {
    const cookie = this.getCookieByIndex(index);
    await cookie.label.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Edit a cookie by index.
   * @param {number} index
   * @param {object} opts - Fields to update
   */
  async editCookie(index, opts = {}) {
    const cookie = this.getCookieByIndex(index);
    const editBtn = cookie.card.locator('.ck-edit');
    await editBtn.click();
    
    await this.page.waitForSelector('#cookieEditOverlay');
    
    if (opts.name) await this.editName.fill(opts.name);
    if (opts.value) await this.editValue.fill(opts.value);
    if (opts.domain) await this.editDomain.fill(opts.domain);
    if (opts.path) await this.editPath.fill(opts.path);
    
    // Save is implicit when clicking outside or pressing Enter
    // For now, we'll look for a save button in the edit overlay
    const saveBtn = this.editOverlay.locator('button:has-text("Save")');
    if (await saveBtn.count()) {
      await saveBtn.click();
    }
    
    await this.page.waitForSelector('#cookieEditOverlay', { state: 'hidden' });
  }

  /**
   * Delete a cookie by index.
   * @param {number} index
   */
  async deleteCookie(index) {
    const cookie = this.getCookieByIndex(index);
    const deleteBtn = cookie.card.locator('.ck-delete');
    await deleteBtn.click();
  }

  /**
   * Close the edit modal.
   */
  async closeModal() {
    await this.editCancel.click();
    await this.page.waitForSelector('#cookieEditOverlay', { state: 'hidden' });
  }

  /**
   * Check if the edit modal is visible.
   * @returns {Promise<boolean>}
   */
  async isModalVisible() {
    return this.isVisible(this.editOverlay);
  }

  /**
   * Get the count label text.
   * @returns {Promise<string>}
   */
  async getCountText() {
    return this.getText(this.count);
  }
}

module.exports = { CookieManagerPage };
