// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Headers & Network Mock panel.
 * Handles HTTP header modification and manipulation.
 */
class HeadersPage extends BasePage {
  constructor(page) {
    super(page);
    this.addBtn = page.locator('#hdrAddBtn');
    this.clearAllBtn = page.locator('#hdrClearAllBtn');
    
    // Modal
    this.modal = page.locator('#hdrModal');
    this.modalTitle = page.locator('#hdrModalTitle');
    this.modalSave = page.locator('#hdrModalSave');
    this.modalCancel = page.locator('#hdrModalCancel');
    
    // Form fields
    this.urlFilter = page.locator('#hdrUrlFilter');
    this.operation = page.locator('#hdrOp');
    this.headerName = page.locator('#hdrHeaderName');
    this.headerValue = page.locator('#hdrHeaderValue');
    this.valueRow = page.locator('#hdrValueRow');
    
    // Rule list
    this.ruleList = page.locator('#hdrRuleList');
    this.ruleCard = page.locator('.net-rule-card');
    this.ruleToggle = page.locator('.net-rule-toggle');
  }

  /**
   * Create a new header rule.
   * @param {object} opts - Rule options
   * @param {string} opts.urlFilter - URL pattern to filter on
   * @param {string} opts.operation - Operation type (set, remove, etc.)
   * @param {string} opts.headerName - Header name
   * @param {string} opts.headerValue - Header value (optional for remove)
   */
  async createRule(opts = {}) {
    const {
      urlFilter = '/api',
      operation = 'set',
      headerName = 'X-Custom-Header',
      headerValue = 'value',
    } = opts;

    await this.addBtn.click();
    await this.page.waitForSelector('#hdrModal');

    await this.urlFilter.fill(urlFilter);
    await this.operation.selectOption(operation);
    await this.headerName.fill(headerName);
    
    if (headerValue) {
      await this.headerValue.fill(headerValue);
    }

    await this.modalSave.click();
    await this.page.waitForSelector('#hdrModal', { state: 'hidden' });
  }

  /**
   * Get the count of header rules.
   * @returns {Promise<number>}
   */
  async getRuleCount() {
    return this.ruleCard.count();
  }

  /**
   * Get a specific rule by index.
   * @param {number} index
   * @returns {object}
   */
  getRuleByIndex(index) {
    return {
      card: this.ruleCard.nth(index),
      toggle: this.ruleToggle.nth(index),
      editBtn: this.ruleCard.nth(index).locator('.net-rule-btn.edit'),
      deleteBtn: this.ruleCard.nth(index).locator('.net-rule-btn.del'),
    };
  }

  /**
   * Toggle a header rule.
   * @param {number} index
   */
  async toggleRule(index) {
    const rule = this.getRuleByIndex(index);
    await rule.toggle.click();
  }

  /**
   * Edit a header rule.
   * @param {number} index
   * @param {object} opts - Updated fields
   */
  async editRule(index, opts = {}) {
    const rule = this.getRuleByIndex(index);
    await rule.editBtn.click();
    await this.page.waitForSelector('#hdrModal');

    if (opts.urlFilter) await this.urlFilter.fill(opts.urlFilter);
    if (opts.operation) await this.operation.selectOption(opts.operation);
    if (opts.headerName) await this.headerName.fill(opts.headerName);
    if (opts.headerValue) await this.headerValue.fill(opts.headerValue);

    await this.modalSave.click();
    await this.page.waitForSelector('#hdrModal', { state: 'hidden' });
  }

  /**
   * Delete a header rule.
   * @param {number} index
   */
  async deleteRule(index) {
    const rule = this.getRuleByIndex(index);
    await rule.deleteBtn.click();
    // May require confirmation
    const confirmBtn = this.page.locator('button:has-text("Confirm")');
    if (await confirmBtn.count()) {
      await confirmBtn.click();
    }
  }

  /**
   * Clear all header rules.
   */
  async clearAll() {
    await this.clearAllBtn.click();
  }

  /**
   * Check if the modal is visible.
   * @returns {Promise<boolean>}
   */
  async isModalVisible() {
    return this.isVisible(this.modal);
  }

  /**
   * Close the modal.
   */
  async closeModal() {
    await this.modalCancel.click();
    await this.page.waitForSelector('#hdrModal', { state: 'hidden' });
  }
}

module.exports = { HeadersPage };
