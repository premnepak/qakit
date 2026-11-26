// @ts-check

class MarkupPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.canvas = page.locator('#mkCanvas');
    this.color = page.locator('#mkColor');
    this.size = page.locator('#mkSize');
    this.sizeValue = page.locator('#mkSizeVal');
    this.body = page.locator('body');
  }

  tool(name) { return this.page.locator(`.mk-tool[data-tool="${name}"]`); }
  control(id) { return this.page.locator(`#${id}`); }

  async waitForImage() {
    await this.page.waitForFunction(() => {
      const canvas = document.getElementById('mkCanvas');
      return canvas && canvas.width > 0 && canvas.height > 0;
    }, { timeout: 6000 });
  }
}

module.exports = { MarkupPage };
