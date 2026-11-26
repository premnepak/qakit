// @ts-check
const { BasePage } = require('./base-page');

/**
 * Page object for the Tools panel (Inspector, Ruler, Spacing, etc.).
 * Handles page tools activation and control.
 */
class ToolsPage extends BasePage {
  constructor(page) {
    super(page);
    this.inspectBtn = page.locator('.home-tile[data-action="inspect"]');
    this.regionBtn = page.locator('.home-tile[data-action="region"]');
    this.rulerBtn = page.locator('.home-tile[data-action="ruler"]');
    this.spacingBtn = page.locator('.home-tile[data-action="spacing"]');
    this.annotateBtn = page.locator('.home-tile[data-action="annotate"]');
  }

  /**
   * Activate the Element Inspector tool.
   */
  async activateInspector() {
    await this.inspectBtn.click();
  }

  /**
   * Activate the Region Screenshot tool.
   */
  async activateRegionScreenshot() {
    await this.regionBtn.click();
  }

  /**
   * Activate the Ruler tool.
   */
  async activateRuler() {
    await this.rulerBtn.click();
  }

  /**
   * Activate the Spacing tool.
   */
  async activateSpacing() {
    await this.spacingBtn.click();
  }

  /**
   * Activate the Annotate tool.
   */
  async activateAnnotate() {
    await this.annotateBtn.click();
  }
}

module.exports = { ToolsPage };
