// @ts-check
const { test, expect } = require('./fixtures');
const { PopupPage } = require('./pages/popup-page');

async function openRulesPanel(popup, restored = false) {
  if (!restored) await popup.homeTile('rules').click();
  await expect(popup.panel('rules')).toHaveClass(/active/);
  await popup.rulesManageSummary.click();
  await expect(popup.rulesList).toBeVisible();
  await popup.page.waitForFunction(() => typeof window.qakitUnifiedRulesApi === 'object');
  await popup.rulesRefresh.click();
  await expect(popup.rulesStatus).toHaveText(/\d+ rules · \d+ shown/);
}

async function createBlockRule(popup, pattern, group) {
  await popup.ruleType('cancel-request').click();
  await popup.rulesBlockPattern.fill(pattern);
  await popup.rulesBlockMatchType.selectOption('wildcard');
  await popup.rulesBuilderSummary.click();
  await popup.rulesBlockGroupId.fill(group);
  await popup.rulesQuickCreate.click();
  await expect(popup.rulesBlockPattern).toHaveValue('');
}

test('Rules panel smoke: create, duplicate, select, bulk toggle', async ({ popup }) => {
  await openRulesPanel(popup);

  // Reset visible filters for deterministic matching.
  await popup.rulesFilterText.fill('');
  await popup.rulesFilterType.selectOption('all');
  await popup.rulesSortBy.selectOption('priority-asc');
  const allChip = popup.ruleGroup('all');
  if (await allChip.count()) await allChip.first().click();

  // Create a cancel-request rule via quick create.
  const unique = 'pw-smoke-' + Date.now();
  const uniquePattern = `*://example.com/${unique}/*`;
  await createBlockRule(popup, uniquePattern, 'pw-group');
  await expect(popup.rulesComposer).toBeVisible();
  await popup.rulesRefresh.click();

  const createdRule = popup.rulesListEntries.filter({ hasText: unique }).first();
  await expect(createdRule).toBeVisible();

  // Duplicate and verify copy appears.
  await createdRule.locator('.rules-clone').click();
  await expect(popup.rulesListEntries.filter({ hasText: uniquePattern + ' (copy)' }).first()).toBeVisible();

  // Select original + copy and disable selected rules.
  const originalCheckbox = createdRule.locator('.rules-select');
  await originalCheckbox.check();

  const copyRule = popup.rulesListEntries.filter({ hasText: uniquePattern + ' (copy)' }).first();
  await copyRule.locator('.rules-select').check();

  await popup.rulesDisableSelected.click();

  // Both selected rules should now offer Enable button.
  await expect(createdRule.locator('.rules-toggle')).toHaveText(/Enable/);
  await expect(copyRule.locator('.rules-toggle')).toHaveText(/Enable/);

  // Selected counter should remain at 2 until changed.
  await expect(popup.rulesSelectedCount).toHaveText(/selected=2/);
});

test('Rules panel keeps filter prefs across popup reopen in same context', async ({ popup, popupPage, context, extensionId }) => {
  await openRulesPanel(popup);

  await popup.rulesFilterText.fill('');
  await popup.rulesFilterType.selectOption('all');
  await popup.rulesSortBy.selectOption('priority-asc');
  const allChip = popup.ruleGroup('all');
  if (await allChip.count()) await allChip.first().click();

  // Ensure a known group exists for group chip filtering.
  const unique = 'pw-prefs-' + Date.now();
  const uniquePattern = `*://example.com/${unique}/*`;
  await createBlockRule(popup, uniquePattern, 'pw-prefs-group');
  await popup.rulesRefresh.click();

  // Apply panel filters/prefs.
  await popup.rulesFilterText.fill('pw-prefs-');
  await popup.rulesFilterType.selectOption('cancel-request');
  await popup.rulesSortBy.selectOption('name-desc');
  await popup.ruleGroup('pw-prefs-group').first().waitFor();
  await popup.ruleGroup('pw-prefs-group').first().click();

  // Reopen popup page in same browser context and verify restored prefs.
  await popupPage.close();
  const reopened = await context.newPage();
  await reopened.goto(`chrome-extension://${extensionId}/popup.html`);
  const reopenedPopup = new PopupPage(reopened);
  await openRulesPanel(reopenedPopup, true);

  await expect(reopenedPopup.rulesFilterText).toHaveValue('pw-prefs-');
  await expect(reopenedPopup.rulesFilterType).toHaveValue('cancel-request');
  await expect(reopenedPopup.rulesSortBy).toHaveValue('name-desc');

  // Group filter state is reflected in status line.
  await expect(reopenedPopup.rulesStatus).toHaveText(/group pw-prefs-group/);

  await reopened.close();
});
