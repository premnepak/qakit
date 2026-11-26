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

for (const ruleCount of [2, 20]) {
  test(`Rules panel scrolls to all details with ${ruleCount} existing rules`, async ({ popup, popupPage }) => {
    await popupPage.setViewportSize({ width: 420, height: 600 });
    await popupPage.evaluate(async (count) => {
      for (let i = 0; i < count; i++) {
        const result = await chrome.runtime.sendMessage({
          action: 'UPSERT_UNIFIED_RULE',
          rule: {
            id: `scroll-rule-${i}`,
            name: `Scroll rule ${i}`,
            type: 'cancel-request',
            enabled: false,
            priority: i + 1,
            groupId: 'scroll-test',
            source: { urlPattern: `*://example.com/scroll-${i}/*`, matchType: 'wildcard' },
            action: {},
          },
        });
        if (!result?.ok) throw new Error(result?.error || 'Failed to seed rules');
      }
    }, ruleCount);
    await openRulesPanel(popup);
    await expect(popup.rulesList.locator(':scope > div')).toHaveCount(ruleCount);

    // Expanded creation controls must not trap the rules below the footer.
    await popup.ruleType('modify-header').click();
    await popupPage.locator('#rulesBuilderHeaders summary').click();
    const scrollArea = popupPage.locator('#panel-rules > .net-panel');
    await scrollArea.evaluate(el => { el.scrollTop = 0; });
    const bounds = await scrollArea.boundingBox();
    if (!bounds) throw new Error('Rules panel has no visible scroll area');
    await popupPage.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await popupPage.mouse.wheel(0, 5000);
    await expect.poll(() => scrollArea.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

    const lastRule = popup.rulesList.locator(':scope > div').last();
    const lastRuleFullyVisible = () => lastRule.evaluate(el => {
      const area = el.closest('.net-panel');
      if (!area) throw new Error('Rule has no scroll container');
      const viewport = area.getBoundingClientRect();
      const rule = el.getBoundingClientRect();
      return rule.top >= viewport.top && rule.bottom <= viewport.bottom;
    });
    await expect.poll(lastRuleFullyVisible).toBe(true);
    await expect(lastRule).toContainText(`name=Scroll rule ${ruleCount - 1}`);
    await lastRule.locator('.rules-select').check();
    await expect(popup.rulesSelectedCount).toHaveText(/selected=1/);
    await popup.rulesDisableSelected.scrollIntoViewIfNeeded();
    await expect(popup.rulesDisableSelected).toBeInViewport();
    await lastRule.locator('.rules-edit').click();
    await expect(popupPage.locator('#rulesEditModal')).toBeVisible();
    await expect(popupPage.locator('#rulesEditPattern')).toHaveValue(`*://example.com/scroll-${ruleCount - 1}/*`);
    await popupPage.locator('#rulesEditCancelBtn').click();

    await popup.rulesManageSummary.click();
    await expect(popup.rulesList).toBeHidden();
    await popup.rulesManageSummary.click();
    await lastRule.scrollIntoViewIfNeeded();
    await expect.poll(lastRuleFullyVisible).toBe(true);
  });
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
