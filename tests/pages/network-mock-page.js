// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Network Mock panel.
 * Handles rule management, pattern matching, and response mocking.
 */
class NetworkMockPage extends BasePage {
  constructor(page) {
    super(page);
    // Add button and modal
    this.addBtn = page.locator('#netAddBtn');
    this.modalOverlay = page.locator('#netModalOverlay');
    this.modalTitle = page.locator('#netModalTitle');
    this.modalSave = page.locator('#netModalSave');
    this.modalCancel = page.locator('#netModalCancel');
    
    // Form fields
    this.ruleName = page.locator('#netRuleName');
    this.pattern = page.locator('#netPattern');
    this.matchType = page.locator('#netMatchType');
    this.status = page.locator('#netStatus');
    this.bodyPaste = page.locator('#netBodyPaste');
    
    // Rule list
    this.ruleCard = page.locator('.net-rule-card');
    this.ruleNameElement = page.locator('.net-rule-name');
    this.rulePattern = page.locator('.net-rule-pattern');
    this.ruleToggle = page.locator('.net-rule-toggle');
    this.ruleBtnEdit = page.locator('.net-rule-btn.edit');
    this.ruleBtnDel = page.locator('.net-rule-btn.del');
    
    // Status and empty state
    this.status = page.locator('#netStatus');
    this.statusLabel = page.locator('#netStatusLabel');
    this.empty = page.locator('#netEmpty');
  }

  /**
   * Create a new network mock rule.
   * @param {object} opts - Rule options
   * @param {string} opts.name - Rule name
   * @param {string} opts.pattern - URL pattern to match
   * @param {string} opts.matchType - Match type (contains, exact, regex)
   * @param {string|number} opts.status - HTTP status code
   * @param {string} opts.body - Response body
   */
  async createRule(opts = {}) {
    const {
      name = 'Test Rule',
      pattern = '/api/test',
      matchType = 'contains',
      status = '200',
      body = '{"ok":true}',
    } = opts;

    await this.addBtn.click();
    await this.page.waitForSelector('#netModalOverlay');
    
    await this.ruleName.fill(name);
    await this.pattern.fill(pattern);
    await this.matchType.selectOption(matchType);
    await this.status.fill(status);
    await this.bodyPaste.fill(body);
    
    await this.modalSave.click();
    await this.page.waitForSelector('#netModalOverlay', { state: 'hidden' });
  }

  /**
   * Get the count of rules currently displayed.
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
      name: this.ruleNameElement.nth(index),
      pattern: this.rulePattern.nth(index),
      toggle: this.ruleToggle.nth(index),
      editBtn: this.ruleBtnEdit.nth(index),
      deleteBtn: this.ruleBtnDel.nth(index),
    };
  }

  /**
   * Toggle a rule's active state.
   * @param {number} index
   */
  async toggleRule(index) {
    const rule = this.getRuleByIndex(index);
    await rule.toggle.click();
  }

  /**
   * Edit a rule.
   * @param {number} index
   * @param {object} opts - Updated rule options
   */
  async editRule(index, opts = {}) {
    const rule = this.getRuleByIndex(index);
    await rule.editBtn.click();
    await this.page.waitForSelector('#netModalOverlay');

    if (opts.name) await this.ruleName.fill(opts.name);
    if (opts.pattern) await this.pattern.fill(opts.pattern);
    if (opts.matchType) await this.matchType.selectOption(opts.matchType);
    if (opts.status) await this.status.fill(opts.status);
    if (opts.body) await this.bodyPaste.fill(opts.body);

    await this.modalSave.click();
    await this.page.waitForSelector('#netModalOverlay', { state: 'hidden' });
  }

  /**
   * Delete a rule (requires two clicks for confirmation).
   * @param {number} index
   */
  async deleteRule(index) {
    const rule = this.getRuleByIndex(index);
    await rule.deleteBtn.click();
    // Second click to confirm
    await rule.deleteBtn.click();
  }

  /**
   * Check if the empty state is visible.
   * @returns {Promise<boolean>}
   */
  async isEmptyStateVisible() {
    return this.isVisible(this.empty);
  }

  /**
   * Check if the modal is visible.
   * @returns {Promise<boolean>}
   */
  async isModalVisible() {
    return this.isVisible(this.modalOverlay);
  }

  /**
   * Close the modal.
   */
  async closeModal() {
    await this.modalCancel.click();
    await this.page.waitForSelector('#netModalOverlay', { state: 'hidden' });
  }
}

module.exports = { NetworkMockPage };
