// @ts-check
/**
 * Functional tests for Network Mock rule management.
 * Covers: create, edit, delete (two-click confirm), toggle, status label, empty state.
 *
 * Rules are stored in chrome.storage.local under 'qnet_rules'.
 * beforeEach clears that key and reloads the popup so loadRules() starts fresh.
 */

const { test, expect } = require('./fixtures');

const NET_KEY = 'qnet_rules';

async function openNetPanel(popupPage) {
  await popupPage.click('.home-tile[data-tab="net"]');
  await expect(popupPage.locator('#panel-net')).toHaveClass(/active/);
}

async function createRule(popupPage, opts = {}) {
  const {
    name      = 'Test Rule',
    pattern   = '/api/test',
    matchType = 'contains',
    status    = '200',
    body      = '{"ok":true}',
  } = opts;
  await popupPage.click('#netAddBtn');
  await expect(popupPage.locator('#netModalOverlay')).toBeVisible();
  await popupPage.fill('#netRuleName', name);
  await popupPage.fill('#netPattern', pattern);
  await popupPage.selectOption('#netMatchType', matchType);
  await popupPage.fill('#netStatus', status);
  await popupPage.fill('#netBodyPaste', body);
  await popupPage.click('#netModalSave');
  await expect(popupPage.locator('#netModalOverlay')).toBeHidden({ timeout: 3000 });
}

test.describe('Network Mock — rule management', () => {
  test.beforeEach(async ({ popupPage }) => {
    await popupPage.evaluate((k) => chrome.storage.local.remove(k), NET_KEY);
    await popupPage.reload();
    await popupPage.waitForSelector('#panel-home');
    await openNetPanel(popupPage);
  });

  test('empty state is shown when no rules exist', async ({ popupPage }) => {
    await expect(popupPage.locator('#netEmpty')).toBeVisible();
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(0);
  });

  test('creating a rule adds a card to the list', async ({ popupPage }) => {
    await createRule(popupPage, { name: 'Flights API', pattern: '/api/flights' });
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(1);
    await expect(popupPage.locator('#netEmpty')).toBeHidden();
  });

  test('rule card shows the name, pattern, and match type', async ({ popupPage }) => {
    await createRule(popupPage, { name: 'Search Mock', pattern: '/api/search', matchType: 'exact' });
    const card = popupPage.locator('.net-rule-card').first();
    await expect(card.locator('.net-rule-name')).toHaveText('Search Mock');
    await expect(card.locator('.net-rule-pattern')).toHaveText('/api/search');
    await expect(card.locator('.net-rule-match-type')).toHaveText('exact');
  });

  test('save with empty name keeps the modal open and adds no rule', async ({ popupPage }) => {
    await popupPage.click('#netAddBtn');
    await popupPage.fill('#netPattern', '/api/x');
    // name is intentionally left empty
    await popupPage.click('#netModalSave');
    await expect(popupPage.locator('#netModalOverlay')).toBeVisible();
    await popupPage.click('#netModalCancel');
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(0);
  });

  test('save with empty pattern keeps the modal open and adds no rule', async ({ popupPage }) => {
    await popupPage.click('#netAddBtn');
    await popupPage.fill('#netRuleName', 'No pattern');
    // pattern is intentionally left empty
    await popupPage.click('#netModalSave');
    await expect(popupPage.locator('#netModalOverlay')).toBeVisible();
    await popupPage.click('#netModalCancel');
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(0);
  });

  test('edit rule opens the modal pre-populated with existing values', async ({ popupPage }) => {
    await createRule(popupPage, { name: 'Editable', pattern: '/api/edit', matchType: 'contains' });
    await popupPage.click('.net-rule-btn.edit');
    await expect(popupPage.locator('#netModalOverlay')).toBeVisible();
    await expect(popupPage.locator('#netModalTitle')).toHaveText('Edit Rule');
    await expect(popupPage.locator('#netRuleName')).toHaveValue('Editable');
    await expect(popupPage.locator('#netPattern')).toHaveValue('/api/edit');
    await popupPage.click('#netModalCancel');
  });

  test('editing and saving a rule updates the card', async ({ popupPage }) => {
    await createRule(popupPage, { name: 'Before', pattern: '/api/before' });
    await popupPage.click('.net-rule-btn.edit');
    await popupPage.fill('#netRuleName', 'After');
    await popupPage.fill('#netPattern', '/api/after');
    await popupPage.click('#netModalSave');
    await expect(popupPage.locator('.net-rule-name')).toHaveText('After');
    await expect(popupPage.locator('.net-rule-pattern')).toHaveText('/api/after');
  });

  test('delete requires two clicks — first click shows confirm, second removes the card', async ({ popupPage }) => {
    await createRule(popupPage);
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(1);
    // First click → confirm state
    await popupPage.click('.net-rule-btn.del');
    await expect(popupPage.locator('.net-rule-btn.del')).toContainText('⚠?');
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(1);
    // Second click → deleted
    await popupPage.click('.net-rule-btn.del');
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(0);
  });

  test('toggle button changes the rule active state', async ({ popupPage }) => {
    await createRule(popupPage);
    const toggle = popupPage.locator('.net-rule-toggle').first();
    const wasBefore = await toggle.evaluate((el) => el.classList.contains('on'));
    await toggle.click();
    const isAfter = await toggle.evaluate((el) => el.classList.contains('on'));
    expect(isAfter).toBe(!wasBefore);
    // Toggle back
    await toggle.click();
    const isRestored = await toggle.evaluate((el) => el.classList.contains('on'));
    expect(isRestored).toBe(wasBefore);
  });

  test('status label reflects the number of rules', async ({ popupPage }) => {
    await createRule(popupPage, { name: 'Status Rule', pattern: '/api/s' });
    await expect(popupPage.locator('#netStatusLabel')).toContainText('1 rule');
  });

  test('multiple rules can be created and listed independently', async ({ popupPage }) => {
    await createRule(popupPage, { name: 'Rule Alpha', pattern: '/api/alpha' });
    await createRule(popupPage, { name: 'Rule Beta',  pattern: '/api/beta'  });
    await createRule(popupPage, { name: 'Rule Gamma', pattern: '/api/gamma' });
    await expect(popupPage.locator('.net-rule-card')).toHaveCount(3);
  });
});
