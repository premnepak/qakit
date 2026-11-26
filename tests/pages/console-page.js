// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Console panel.
 * Handles console message capture, filtering, and display.
 */
class ConsolePage extends BasePage {
  constructor(page) {
    super(page);
    this.clearBtn = page.locator('#consoleClearBtn');
    this.refreshBtn = page.locator('#consoleRefreshBtn');
    this.content = page.locator('#auditContent');
    this.messageList = page.locator('.console-message');
  }

  /**
   * Clear console messages.
   */
  async clear() {
    await this.clearBtn.click();
  }

  /**
   * Refresh the console display.
   */
  async refresh() {
    await this.refreshBtn.click();
  }

  /**
   * Get the count of console messages.
   * @returns {Promise<number>}
   */
  async getMessageCount() {
    return this.messageList.count();
  }

  /**
   * Get all console messages.
   * @returns {Promise<string[]>}
   */
  async getAllMessages() {
    const count = await this.getMessageCount();
    const messages = [];
    for (let i = 0; i < count; i++) {
      const text = await this.getText(this.messageList.nth(i));
      if (text) messages.push(text);
    }
    return messages;
  }

  /**
   * Get a specific message by index.
   * @param {number} index
   * @returns {Promise<string>}
   */
  async getMessageByIndex(index) {
    return this.getText(this.messageList.nth(index));
  }

  /**
   * Check if console has any messages.
   * @returns {Promise<boolean>}
   */
  async hasMessages() {
    return (await this.getMessageCount()) > 0;
  }
}

module.exports = { ConsolePage };
