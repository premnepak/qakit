// @ts-check
/**
 * Functional tests for the Headers Modifier rule management UI.
 * Covers: create rule, edit, delete (single-click), toggle, operation options.
 *
 * Rules are stored in chrome.storage.local under 'qa_header_rules'.
 * beforeEach clears that key and reloads the popup so loadHeaderRules() starts fresh.
 */

const { test, expect } = require('./fixtures');

const HDR_KEY = 'qa_header_rules';

async function openHeadersPanel(popupPage) {
  await popupPage.click('.home-tile[data-tab="headers"]');
  await expect(popupPage.locator('#panel-headers')).toHaveClass(/active/);
}

async function createHeaderRule(popupPage, opts = {}) {
  const {
    urlFilter = '*',
    header    = 'X-Test-Header',
    value     = 'test-value',
    op        = 'set',
  } = opts;
  await popupPage.click('#hdrAddBtn');
  await expect(popupPage.locator('#hdrModal')).toBeVisible();
  await popupPage.fill('#hdrUrlFilter', urlFilter);
  await popupPage.fill('#hdrHeaderName', header);
  await popupPage.selectOption('#hdrOp', op);
  if (op !== 'remove') await popupPage.fill('#hdrHeaderValue', value);
  await popupPage.click('#hdrModalSave');
  await expect(popupPage.locator('#hdrModal')).toBeHidden({ timeout: 3000 });
}

test.describe('Headers Modifier — rule management', () => {
  test.beforeEach(async ({ popupPage }) => {
    await popupPage.evaluate((k) => chrome.storage.local.remove(k), HDR_KEY);
    await popupPage.reload();
    await popupPage.waitForSelector('#panel-home');
    await openHeadersPanel(popupPage);
  });

  test('empty state is shown when no rules exist', async ({ popupPage }) => {
    const list = popupPage.locator('#hdrRuleList');
    await expect(list.locator('.empty')).toBeVisible();
    await expect(list.locator('.net-rule-card')).toHaveCount(0);
  });

  test('creating a rule adds a card to the list', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'Authorization', value: 'Bearer token123' });
    await expect(popupPage.locator('#hdrRuleList .net-rule-card')).toHaveCount(1);
  });

  test('rule card shows the header name and value', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-Custom', value: 'my-value', urlFilter: '*.example.com*' });
    const card = popupPage.locator('#hdrRuleList .net-rule-card').first();
    await expect(card).toContainText('X-Custom');
    await expect(card).toContainText('my-value');
    await expect(card).toContainText('*.example.com*');
  });

  test('"remove" operation hides the value input field', async ({ popupPage }) => {
    await popupPage.click('#hdrAddBtn');
    await expect(popupPage.locator('#hdrModal')).toBeVisible();
    await popupPage.selectOption('#hdrOp', 'remove');
    await expect(popupPage.locator('#hdrValueRow')).toBeHidden();
    await popupPage.click('#hdrModalCancel');
  });

  test('"set" and "add" operations show the value input field', async ({ popupPage }) => {
    await popupPage.click('#hdrAddBtn');
    for (const op of ['set', 'add']) {
      await popupPage.selectOption('#hdrOp', op);
      await expect(popupPage.locator('#hdrValueRow')).toBeVisible();
    }
    await popupPage.click('#hdrModalCancel');
  });

  test('delete removes the rule immediately (single click)', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-Delete-Me' });
    await expect(popupPage.locator('#hdrRuleList .net-rule-card')).toHaveCount(1);
    await popupPage.click('.net-rule-btn.del');
    await expect(popupPage.locator('#hdrRuleList .net-rule-card')).toHaveCount(0);
  });

  test('toggle button changes the rule enabled state', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-Toggle' });
    const toggle = popupPage.locator('#hdrRuleList .net-rule-toggle').first();
    const wasBefore = await toggle.evaluate((el) => el.classList.contains('on'));
    await toggle.click();
    const isAfter = await toggle.evaluate((el) => el.classList.contains('on'));
    expect(isAfter).toBe(!wasBefore);
  });

  test('edit rule opens modal pre-populated with existing values', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-Editable', value: 'original', urlFilter: '*foo.com*' });
    await popupPage.click('.net-rule-btn.edit');
    await expect(popupPage.locator('#hdrModal')).toBeVisible();
    await expect(popupPage.locator('#hdrModalTitle')).toHaveText('Edit Header Rule');
    await expect(popupPage.locator('#hdrHeaderName')).toHaveValue('X-Editable');
    await expect(popupPage.locator('#hdrHeaderValue')).toHaveValue('original');
    await expect(popupPage.locator('#hdrUrlFilter')).toHaveValue('*foo.com*');
    await popupPage.click('#hdrModalCancel');
  });

  test('editing and saving a rule updates the card', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-Before', value: 'v1' });
    await popupPage.click('.net-rule-btn.edit');
    await popupPage.fill('#hdrHeaderName', 'X-After');
    await popupPage.fill('#hdrHeaderValue', 'v2');
    await popupPage.click('#hdrModalSave');
    const card = popupPage.locator('#hdrRuleList .net-rule-card').first();
    await expect(card).toContainText('X-After');
    await expect(card).toContainText('v2');
  });

  test('multiple rules are all listed', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-One',   value: '1' });
    await createHeaderRule(popupPage, { header: 'X-Two',   value: '2' });
    await createHeaderRule(popupPage, { header: 'X-Three', value: '3' });
    await expect(popupPage.locator('#hdrRuleList .net-rule-card')).toHaveCount(3);
  });

  test('Clear All button removes every rule', async ({ popupPage }) => {
    await createHeaderRule(popupPage, { header: 'X-A' });
    await createHeaderRule(popupPage, { header: 'X-B' });
    await expect(popupPage.locator('#hdrRuleList .net-rule-card')).toHaveCount(2);
    popupPage.once('dialog', (d) => d.accept());
    await popupPage.click('#hdrClearAllBtn');
    await expect(popupPage.locator('#hdrRuleList .net-rule-card')).toHaveCount(0);
  });
});
