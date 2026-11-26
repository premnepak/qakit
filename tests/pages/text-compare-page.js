// @ts-check
const { expect } = require('@playwright/test');
const { BasePage } = require('./base-page');

/**
 * Page object for the Text Compare standalone tool (text-compare.html).
 * Handles text comparison operations and UI interactions.
 * Extends BasePage for common functionality.
 */
class TextComparePage extends BasePage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    super(page);
    this.left = page.locator('#tcLeft');
    this.right = page.locator('#tcRight');
    this.compareButton = page.locator('#tcCompare');
    this.compareAction = page.locator('#tcCompare, [data-action="compare"]').first();
    this.stats = page.locator('#tcStats');
    this.leftOverlay = page.locator('#tcLeftOverlay');
    this.swap = page.locator('#tcSwap');
    this.clear = page.locator('#tcClear');
    this.ignoreWhitespace = page.locator('#tcIgnoreWs');
    this.minimap = page.locator('#tcMinimap');
    this.jumpStrip = page.locator('#tcJumpStrip');
  }

  async compare(left, right) {
    await this.left.fill(left);
    await this.right.fill(right);
    if (await this.compareButton.count()) await this.compareButton.click();
    await expect(async () => {
      const stats = await this.stats.textContent();
      expect((stats || '').length).toBeGreaterThan(0);
    }).toPass({ timeout: 4000 });
  }
}

module.exports = { TextComparePage };
