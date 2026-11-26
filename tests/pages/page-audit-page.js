// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Page Audit panel.
 * Handles page auditing, link validation, and accessibility checks.
 */
class PageAuditPage extends BasePage {
  constructor(page) {
    super(page);
    this.runBtn = page.locator('#auditRunBtn');
    this.clearBtn = page.locator('#auditClearBtn');
    this.exportBtn = page.locator('#auditExportBtn');
    this.exportMenu = page.locator('#auditExportMenu');
    
    // Status and results
    this.scanStatus = page.locator('#auditScanStatus');
    this.spinner = page.locator('#auditSpinner');
    this.content = page.locator('#auditContent');
    this.a11yContent = page.locator('#auditA11yContent');
    
    // History
    this.historyContent = page.locator('#auditHistoryContent');
    
    // Subtabs
    this.subtab = (sub) => page.locator(`[data-auditsub="${sub}"]`);
    
    // Export options
    this.exportOption = (format) => page.locator(`[data-export-format="${format}"]`);
  }

  /**
   * Run an audit scan.
   */
  async runAudit() {
    await this.runBtn.click();
    // Wait for spinner to appear
    await this.page.waitForSelector('#auditSpinner', { state: 'visible' });
  }

  /**
   * Wait for the audit scan to complete.
   * @param {number} timeout - Timeout in milliseconds
   */
  async waitForAuditComplete(timeout = 30000) {
    // Wait for spinner to disappear
    await this.page.waitForSelector('#auditSpinner', { 
      state: 'hidden',
      timeout,
    });
  }

  /**
   * Check if audit is currently running.
   * @returns {Promise<boolean>}
   */
  async isRunning() {
    return this.isVisible(this.spinner);
  }

  /**
   * Clear the audit results.
   */
  async clearResults() {
    await this.clearBtn.click();
  }

  /**
   * Check if the audit panel has content.
   * @returns {Promise<boolean>}
   */
  async hasContent() {
    return (await this.content.count()) > 0;
  }

  /**
   * Get the current scan status text.
   * @returns {Promise<string>}
   */
  async getStatus() {
    return this.getText(this.scanStatus);
  }

  /**
   * Switch to a specific audit subtab.
   * @param {string} sub - Subtab name (e.g., 'links', 'a11y', 'history')
   */
  async switchSubtab(sub) {
    const tab = this.subtab(sub);
    await tab.click();
    await this.page.waitForTimeout(300);
  }

  /**
   * Check if the history tab has content.
   * @returns {Promise<boolean>}
   */
  async hasHistory() {
    return (await this.historyContent.count()) > 0;
  }

  /**
   * Open the export menu.
   */
  async openExportMenu() {
    await this.exportBtn.click();
    await this.page.waitForSelector('#auditExportMenu');
  }

  /**
   * Close the export menu.
   */
  async closeExportMenu() {
    // Click outside or press Escape
    await this.page.keyboard.press('Escape');
  }

  /**
   * Check if export menu is visible.
   * @returns {Promise<boolean>}
   */
  async isExportMenuVisible() {
    return this.isVisible(this.exportMenu);
  }

  /**
   * Export audit results in a specific format.
   * @param {string} format - Format name (e.g., 'json', 'csv', 'html')
   */
  async exportAs(format) {
    await this.openExportMenu();
    const option = this.exportOption(format);
    // This typically triggers a download
    await Promise.all([
      this.page.context().waitForEvent('download'),
      option.click(),
    ]);
  }

  /**
   * Get the accessibility check content.
   * @returns {Promise<string>}
   */
  async getA11yContent() {
    return this.getText(this.a11yContent);
  }

  /**
   * Get the main audit content.
   * @returns {Promise<string>}
   */
  async getAuditContent() {
    return this.getText(this.content);
  }
}

module.exports = { PageAuditPage };
