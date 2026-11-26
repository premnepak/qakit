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

async function openHeadersPanel(popup) {
  await popup.homeTile('headers').click();
  await expect(popup.panel('headers')).toHaveClass(/active/);
}

async function createHeaderRule(popup, opts = {}) {
  const {
    urlFilter = '*',
    header    = 'X-Test-Header',
    value     = 'test-value',
    op        = 'set',
  } = opts;
  await popup.hdrAddBtn.click();
  await expect(popup.hdrModal).toBeVisible();
  await popup.hdrUrlFilter.fill( urlFilter);
  await popup.hdrHeaderName.fill( header);
  await popup.hdrOp.selectOption( op);
  if (op !== 'remove') await popup.hdrHeaderValue.fill( value);
  await popup.hdrModalSave.click();
  await expect(popup.hdrModal).toBeHidden({ timeout: 3000 });
}

test.describe('Headers Modifier — rule management', () => {
  test.beforeEach(async ({ popup, popupPage }) => {
    await popupPage.evaluate((k) => chrome.storage.local.remove(k), HDR_KEY);
    await popupPage.reload();
    await popup.panel('home').waitFor();
    await openHeadersPanel(popup);
  });

  test('empty state is shown when no rules exist', async ({ popup, popupPage }) => {
    const list = popup.hdrRuleList;
    await expect(list.locator('.empty')).toBeVisible();
    await expect(list.locator('.net-rule-card')).toHaveCount(0);
  });

  test('creating a rule adds a card to the list', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'Authorization', value: 'Bearer token123' });
    await expect(popup.hdrRuleListNetRuleCard).toHaveCount(1);
  });

  test('rule card shows the header name and value', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-Custom', value: 'my-value', urlFilter: '*.example.com*' });
    const card = popup.hdrRuleListNetRuleCard.first();
    await expect(card).toContainText('X-Custom');
    await expect(card).toContainText('my-value');
    await expect(card).toContainText('*.example.com*');
  });

  test('"remove" operation hides the value input field', async ({ popup, popupPage }) => {
    await popup.hdrAddBtn.click();
    await expect(popup.hdrModal).toBeVisible();
    await popup.hdrOp.selectOption( 'remove');
    await expect(popup.hdrValueRow).toBeHidden();
    await popup.hdrModalCancel.click();
  });

  test('"set" and "add" operations show the value input field', async ({ popup, popupPage }) => {
    await popup.hdrAddBtn.click();
    for (const op of ['set', 'add']) {
      await popup.hdrOp.selectOption( op);
      await expect(popup.hdrValueRow).toBeVisible();
    }
    await popup.hdrModalCancel.click();
  });

  test('delete removes the rule immediately (single click)', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-Delete-Me' });
    await expect(popup.hdrRuleListNetRuleCard).toHaveCount(1);
    await popup.netRuleBtnDel.click();
    await expect(popup.hdrRuleListNetRuleCard).toHaveCount(0);
  });

  test('toggle button changes the rule enabled state', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-Toggle' });
    const toggle = popup.hdrRuleListNetRuleToggle.first();
    const wasBefore = await toggle.evaluate((el) => el.classList.contains('on'));
    await toggle.click();
    const isAfter = await toggle.evaluate((el) => el.classList.contains('on'));
    expect(isAfter).toBe(!wasBefore);
  });

  test('edit rule opens modal pre-populated with existing values', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-Editable', value: 'original', urlFilter: '*foo.com*' });
    await popup.netRuleBtnEdit.click();
    await expect(popup.hdrModal).toBeVisible();
    await expect(popup.hdrModalTitle).toHaveText('Edit Header Rule');
    await expect(popup.hdrHeaderName).toHaveValue('X-Editable');
    await expect(popup.hdrHeaderValue).toHaveValue('original');
    await expect(popup.hdrUrlFilter).toHaveValue('*foo.com*');
    await popup.hdrModalCancel.click();
  });

  test('editing and saving a rule updates the card', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-Before', value: 'v1' });
    await popup.netRuleBtnEdit.click();
    await popup.hdrHeaderName.fill( 'X-After');
    await popup.hdrHeaderValue.fill( 'v2');
    await popup.hdrModalSave.click();
    const card = popup.hdrRuleListNetRuleCard.first();
    await expect(card).toContainText('X-After');
    await expect(card).toContainText('v2');
  });

  test('multiple rules are all listed', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-One',   value: '1' });
    await createHeaderRule(popup, { header: 'X-Two',   value: '2' });
    await createHeaderRule(popup, { header: 'X-Three', value: '3' });
    await expect(popup.hdrRuleListNetRuleCard).toHaveCount(3);
  });

  test('Clear All button removes every rule', async ({ popup, popupPage }) => {
    await createHeaderRule(popup, { header: 'X-A' });
    await createHeaderRule(popup, { header: 'X-B' });
    await expect(popup.hdrRuleListNetRuleCard).toHaveCount(2);
    popupPage.once('dialog', (d) => d.accept());
    await popup.hdrClearAllBtn.click();
    await expect(popup.hdrRuleListNetRuleCard).toHaveCount(0);
  });
});
