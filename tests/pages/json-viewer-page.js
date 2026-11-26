// @ts-check

class JsonViewerPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.textArea = page.locator('#qdTextArea');
    this.textStatus = page.locator('#qdTextStatus');
    this.textPane = page.locator('[data-mode-pane="text"]');
    this.treeContent = page.locator('#qdTreeContent');
    this.treeEmpty = page.locator('#qdTreeContent .qd-empty');
    this.treeRows = page.locator('.qd-tree-row');
    this.matchingTreeRows = page.locator('.qd-tree-row.match');
    this.detailContent = page.locator('#qdDetailContent');
    this.treeFilter = page.locator('#qdTreeFilter');
    this.treeStatus = page.locator('#qdTreeStatus');
    this.expandAll = page.locator('#qdTreeExpandAll');
    this.collapseAll = page.locator('#qdTreeCollapseAll');
    this.treeCopy = page.locator('#qdTreeCopy');
    this.searchPrevious = page.locator('#qdTreeSearchPrev');
    this.searchNext = page.locator('#qdTreeSearchNext');
    this.format = page.locator('#qdTextFormat');
    this.minify = page.locator('#qdTextMinify');
    this.clear = page.locator('#qdTextClear');
  }

  mode(name) { return this.page.locator(`.qd-mode[data-mode="${name}"]`); }

  async pasteJson(json) {
    await this.mode('text').click();
    await this.textArea.fill(json);
    await this.textArea.dispatchEvent('input');
  }
}

module.exports = { JsonViewerPage };
