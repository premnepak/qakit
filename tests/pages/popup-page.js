// @ts-check
const { expect } = require('@playwright/test');

class PopupPage {
  /** @param {import('@playwright/test').Page} page */
  constructor(page) {
    this.page = page;
    this.auditA11yContent = page.locator("#auditA11yContent");
    this.auditClearBtn = page.locator("#auditClearBtn");
    this.auditContent = page.locator("#auditContent");
    this.auditExportBtn = page.locator("#auditExportBtn");
    this.auditExportMenu = page.locator("#auditExportMenu");
    this.auditHistoryContent = page.locator("#auditHistoryContent");
    this.auditRunBtn = page.locator("#auditRunBtn");
    this.auditScanStatus = page.locator("#auditScanStatus");
    this.auditSpinner = page.locator("#auditSpinner");
    this.b64DecodeBtn = page.locator("#b64DecodeBtn");
    this.b64EncodeBtn = page.locator("#b64EncodeBtn");
    this.b64Input = page.locator("#b64Input");
    this.b64Output = page.locator("#b64Output");
    this.b64UrlEncBtn = page.locator("#b64UrlEncBtn");
    this.body = page.locator("body");
    this.ckEditCancel = page.locator("#ckEditCancel");
    this.ckEditDomain = page.locator("#ckEditDomain");
    this.ckEditName = page.locator("#ckEditName");
    this.ckEditPath = page.locator("#ckEditPath");
    this.ckEditValue = page.locator("#ckEditValue");
    this.ckModalTitle = page.locator("#ckModalTitle");
    this.clockFilter = page.locator("#clockFilter");
    this.consoleClearBtn = page.locator("#consoleClearBtn");
    this.consoleRefreshBtn = page.locator("#consoleRefreshBtn");
    this.cookieAddBtn = page.locator("#cookieAddBtn");
    this.cookieCount = page.locator("#cookieCount");
    this.cookieEditOverlay = page.locator("#cookieEditOverlay");
    this.cookieList = page.locator("#cookieList");
    this.cookieRefreshBtn = page.locator("#cookieRefreshBtn");
    this.cookieSearch = page.locator("#cookieSearch");
    this.cookieToggleAllBtn = page.locator("#cookieToggleAllBtn");
    this.dataSubTimestamp = page.locator("[data-sub=\"timestamp\"]");
    this.envmarkerAddBtn = page.locator("#envmarkerAddBtn");
    this.envmarkerList = page.locator("#envmarkerList");
    this.envmarkerListEnvDelete = page.locator("#envmarkerList .env-delete");
    this.envmarkerListEnvEnabled = page.locator("#envmarkerList .env-enabled");
    this.envmarkerListEnvRow = page.locator("#envmarkerList .env-row");
    this.envmarkerListEnvRowHeader = page.locator("#envmarkerList .env-row-header");
    this.envmarkerResetBtn = page.locator("#envmarkerResetBtn");
    this.epochInput = page.locator("#epochInput");
    this.epochNowBtn = page.locator("#epochNowBtn");
    this.epochUnit = page.locator("#epochUnit");
    this.geoAccuracy = page.locator("#geoAccuracy");
    this.geoApplyBtn = page.locator("#geoApplyBtn");
    this.geoClearBtn = page.locator("#geoClearBtn");
    this.geoLat = page.locator("#geoLat");
    this.geoLng = page.locator("#geoLng");
    this.geoPresetSelect = page.locator("#geoPresetSelect");
    this.geoPresetSelectOption = page.locator("#geoPresetSelect option");
    this.hdrAddBtn = page.locator("#hdrAddBtn");
    this.hdrClearAllBtn = page.locator("#hdrClearAllBtn");
    this.hdrHeaderName = page.locator("#hdrHeaderName");
    this.hdrHeaderValue = page.locator("#hdrHeaderValue");
    this.hdrModal = page.locator("#hdrModal");
    this.hdrModalCancel = page.locator("#hdrModalCancel");
    this.hdrModalSave = page.locator("#hdrModalSave");
    this.hdrModalTitle = page.locator("#hdrModalTitle");
    this.hdrOp = page.locator("#hdrOp");
    this.hdrRuleList = page.locator("#hdrRuleList");
    this.hdrRuleListNetRuleCard = page.locator("#hdrRuleList .net-rule-card");
    this.hdrRuleListNetRuleToggle = page.locator("#hdrRuleList .net-rule-toggle");
    this.hdrUrlFilter = page.locator("#hdrUrlFilter");
    this.hdrValueRow = page.locator("#hdrValueRow");
    this.humanDateInput = page.locator("#humanDateInput");
    this.humanNowBtn = page.locator("#humanNowBtn");
    this.jwtDecodeBtn = page.locator("#jwtDecodeBtn");
    this.jwtDecodeOut = page.locator("#jwtDecodeOut");
    this.jwtEncodeBtn = page.locator("#jwtEncodeBtn");
    this.jwtEncodeOut = page.locator("#jwtEncodeOut");
    this.jwtInput = page.locator("#jwtInput");
    this.jwtPayInput = page.locator("#jwtPayInput");
    this.rulesBlockPattern = page.locator('#rulesBlockPattern');
    this.rulesBlockMatchType = page.locator('#rulesBlockMatchType');
    this.rulesBlockGroupId = page.locator('#rulesBlockGroupId');
    this.rulesBuilderSummary = page.locator('#rulesBuilderBlock summary');
    this.rulesManageSummary = page.locator('#rulesManageSection > summary');
    this.rulesList = page.locator('#rulesList');
    this.rulesListEntries = page.locator('#rulesList div');
    this.rulesStatus = page.locator('#rulesStatus');
    this.rulesRefresh = page.locator('#rulesRefreshBtn');
    this.rulesQuickCreate = page.locator('#rulesQuickCreateBtn');
    this.rulesFilterText = page.locator('#rulesFilterText');
    this.rulesFilterType = page.locator('#rulesFilterType');
    this.rulesSortBy = page.locator('#rulesSortBy');
    this.rulesComposer = page.locator('#rulesComposerBlock');
    this.rulesDisableSelected = page.locator('#rulesDisableSelectedBtn');
    this.rulesSelectedCount = page.locator('#rulesSelectedCount');
    this.screenshotToast = page.locator('#ssToast');
    this.screenshotDownload = page.locator('#ssDownloadBtn');
    this.screenshotEdit = page.locator('#ssEditBtn');
    this.screenshotDismiss = page.locator('#ssDismissBtn');
    this.screenshotPanel = page.locator('#ptsub-screenshot');
    this.screenshotFull = page.locator('#ss-fullBtn');
    this.screenshotRegion = page.locator('#ss-regionBtn');
    this.screenshotAnnotate = page.locator('#ss-annotatePageBtn');
    this.lsAddBtn = page.locator("#lsAddBtn");
    this.lsAddCancel = page.locator("#lsAddCancel");
    this.lsAddModalTitle = page.locator("#lsAddModalTitle");
    this.lsAddOverlay = page.locator("#lsAddOverlay");
    this.lsRefreshBtn = page.locator("#lsRefreshBtn");
    this.lsSearch = page.locator("#lsSearch");
    this.lsTypeSession = page.locator("#lsTypeSession");
    this.netAddBtn = page.locator("#netAddBtn");
    this.netBodyPaste = page.locator("#netBodyPaste");
    this.netEmpty = page.locator("#netEmpty");
    this.netMatchType = page.locator("#netMatchType");
    this.netModalCancel = page.locator("#netModalCancel");
    this.netModalOverlay = page.locator("#netModalOverlay");
    this.netModalSave = page.locator("#netModalSave");
    this.netModalTitle = page.locator("#netModalTitle");
    this.netPattern = page.locator("#netPattern");
    this.netRuleBtnDel = page.locator(".net-rule-btn.del");
    this.netRuleBtnEdit = page.locator(".net-rule-btn.edit");
    this.netRuleCard = page.locator(".net-rule-card");
    this.netRuleName = page.locator("#netRuleName");
    this.netRuleNameElement = page.locator(".net-rule-name");
    this.netRulePattern = page.locator(".net-rule-pattern");
    this.netRuleToggle = page.locator(".net-rule-toggle");
    this.netStatus = page.locator("#netStatus");
    this.netStatusLabel = page.locator("#netStatusLabel");
    this.panelNetPanelNavBack = page.locator("#panel-net .panel-nav-back");
    this.panelSettingsPanelNavBack = page.locator("#panel-settings .panel-nav-back");
    this.settingsBtn = page.locator("#settingsBtn");
    this.themeDarkBtn = page.locator("#themeDarkBtn");
    this.themeLightBtn = page.locator("#themeLightBtn");
    this.timesubClock = page.locator("#timesub-clock");
    this.timesubTimestamp = page.locator("#timesub-timestamp");
    this.tzConvertBtn = page.locator("#tzConvertBtn");
    this.tzFrom = page.locator("#tzFrom");
    this.tzFromOption = page.locator("#tzFrom option");
    this.tzSwapBtn = page.locator("#tzSwapBtn");
    this.tzTo = page.locator("#tzTo");
    this.tzToOption = page.locator("#tzTo option");
    this.urlDecodeBtn = page.locator("#urlDecodeBtn");
    this.urlEncodeBtn = page.locator("#urlEncodeBtn");
    this.urlFullEncBtn = page.locator("#urlFullEncBtn");
    this.urlInput = page.locator("#urlInput");
    this.urlOutput = page.locator("#urlOutput");
    this.utilsubBase64 = page.locator("#utilsub-base64");
    this.utilsubJwt = page.locator("#utilsub-jwt");
    this.utilsubUrl = page.locator("#utilsub-url");
    this.worldClockGrid = page.locator("#worldClockGrid");
    this.worldClockGridWcRow = page.locator("#worldClockGrid .wc-row");
  }

  homeTile(tab) { return this.page.locator(`.home-tile[data-tab="${tab}"]`); }
  actionTile(action) { return this.page.locator(`.home-tile[data-action="${action}"]`); }
  panel(tab) { return this.page.locator(`#panel-${tab}`); }
  subtab(group, sub) { return this.page.locator(`.${group}-subtab[data-sub="${sub}"]`); }
  auditSubtab(sub) { return this.page.locator(`[data-auditsub="${sub}"]`); }
  auditExportOption(format) { return this.page.locator(`[data-export-format="${format}"]`); }
  ruleGroup(group) { return this.page.locator(`.rules-group-chip[data-group="${group}"]`); }
  ruleType(type) { return this.page.locator(`.rules-type-tile[data-rules-type="${type}"]`); }
  elementById(id) { return this.page.locator(`#${id}`); }

  async openPanel(tab) {
    await this.homeTile(tab).click();
    await expect(this.panel(tab)).toHaveClass(/active/);
  }

  async openStandalone(action) {
    const [page] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.actionTile(action).click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    return page;
  }
}

module.exports = { PopupPage };
