// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Environment Marker panel.
 * Handles environment variable override.
 */
class EnvironmentMarkerPage extends BasePage {
  constructor(page) {
    super(page);
    this.addBtn = page.locator('#envmarkerAddBtn');
    this.resetBtn = page.locator('#envmarkerResetBtn');
    this.list = page.locator('#envmarkerList');
    
    // Env variable rows
    this.envRow = page.locator('.env-row');
    this.envRowHeader = page.locator('.env-row-header');
    this.envEnabled = page.locator('.env-enabled');
    this.envDelete = page.locator('.env-delete');
  }

  /**
   * Add a new environment variable.
   * @param {string} name
   * @param {string} value
   */
  async addVariable(name, value) {
    await this.addBtn.click();
    // Look for input fields in a modal or inline
    const nameInput = this.page.locator('input[placeholder*="name"], input[name*="name"]').first();
    const valueInput = this.page.locator('input[placeholder*="value"], input[name*="value"]').first();
    
    if (await nameInput.count()) {
      await nameInput.fill(name);
      await valueInput.fill(value);
      
      const saveBtn = this.page.locator('button:has-text("Save"), button:has-text("Add")').first();
      if (await saveBtn.count()) {
        await saveBtn.click();
      }
    }
  }

  /**
   * Get the count of environment variables.
   * @returns {Promise<number>}
   */
  async getVariableCount() {
    return this.envRow.count();
  }

  /**
   * Toggle an environment variable by index.
   * @param {number} index
   */
  async toggleVariable(index) {
    const enabled = this.envEnabled.nth(index);
    await enabled.click();
  }

  /**
   * Delete an environment variable by index.
   * @param {number} index
   */
  async deleteVariable(index) {
    const deleteBtn = this.envDelete.nth(index);
    await deleteBtn.click();
  }

  /**
   * Reset all environment variables.
   */
  async reset() {
    await this.resetBtn.click();
  }

  /**
   * Check if a variable is enabled by index.
   * @param {number} index
   * @returns {Promise<boolean>}
   */
  async isVariableEnabled(index) {
    const checkbox = this.envEnabled.nth(index);
    return checkbox.isChecked();
  }
}

module.exports = { EnvironmentMarkerPage };
