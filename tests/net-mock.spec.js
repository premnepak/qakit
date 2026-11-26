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

async function openNetPanel(popup) {
  await popup.homeTile('net').click();
  await expect(popup.panel('net')).toHaveClass(/active/);
}

async function createRule(popup, opts = {}) {
  const {
    name      = 'Test Rule',
    pattern   = '/api/test',
    matchType = 'contains',
    status    = '200',
    body      = '{"ok":true}',
  } = opts;
  await popup.netAddBtn.click();
  await expect(popup.netModalOverlay).toBeVisible();
  await popup.netRuleName.fill( name);
  await popup.netPattern.fill( pattern);
  await popup.netMatchType.selectOption( matchType);
  await popup.netStatus.fill( status);
  await popup.netBodyPaste.fill( body);
  await popup.netModalSave.click();
  await expect(popup.netModalOverlay).toBeHidden({ timeout: 3000 });
}

test.describe('Network Mock — rule management', () => {
  test.beforeEach(async ({ popup, popupPage }) => {
    await popupPage.evaluate((k) => chrome.storage.local.remove(k), NET_KEY);
    await popupPage.reload();
    await popup.panel('home').waitFor();
    await openNetPanel(popup);
  });

  test('mocked XHR supports event listeners, JSON responses, abort and reuse after reload', async ({ popup, popupPage, context }) => {
    const rule = {
      id: 'xhr-test', name: 'XHR test', pattern: '/api/mock', matchType: 'contains',
      responseStatus: 201, responseBody: '{"ok":true}', active: true,
    };
    await context.route('https://qakit.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Test</body></html>' }));
    const page = await context.newPage();
    await page.goto('https://qakit.test/');
    await popupPage.evaluate(async rule => {
      netRules = [rule];
      const [tab] = await chrome.tabs.query({ url: 'https://qakit.test/*' });
      await injectInterceptor(tab.id);
    }, rule);

    async function checkMock() {
      return page.evaluate(async () => {
        const events = [];
        const xhr = new XMLHttpRequest();
        const response = await new Promise(resolve => {
          xhr.addEventListener('readystatechange', () => events.push('state:' + xhr.readyState));
          xhr.addEventListener('loadstart', () => events.push('loadstart'));
          xhr.addEventListener('progress', () => events.push('progress'));
          xhr.addEventListener('load', () => events.push('load'));
          xhr.addEventListener('loadend', () => resolve({
            events: [...events], status: xhr.status, response: xhr.response,
            contentType: xhr.getResponseHeader('Content-Type'),
          }));
          xhr.open('GET', '/api/mock');
          xhr.responseType = 'json';
          xhr.send();
        });
        const aborted = await new Promise(resolve => {
          const request = new XMLHttpRequest();
          const seen = [];
          request.addEventListener('load', () => seen.push('load'));
          request.addEventListener('abort', () => seen.push('abort'));
          request.addEventListener('loadend', () => resolve(seen));
          request.open('GET', '/api/mock');
          request.send();
          request.abort();
        });
        const reused = await new Promise(resolve => {
          xhr.open('GET', '/api/mock');
          xhr.responseType = 'arraybuffer';
          xhr.onload = () => resolve(new TextDecoder().decode(xhr.response));
          xhr.send();
        });
        const fetchResult = await fetch('/api/mock').then(res => res.json());
        const unmatched = await new Promise(resolve => {
          const request = new XMLHttpRequest();
          request.open('GET', '/ordinary');
          request.onload = () => resolve(request.responseText);
          request.send();
        });
        return { response, aborted, reused, fetchResult, unmatched };
      });
    }

    const assertMock = result => {
      expect(result.response.status).toBe(201);
      expect(result.response.response).toEqual({ ok: true });
      expect(result.response.contentType).toBe('application/json');
      expect(result.response.events).toEqual(['state:1', 'loadstart', 'state:2', 'state:3', 'progress', 'state:4', 'load']);
      expect(result.aborted).toEqual(['abort']);
      expect(result.reused).toBe('{"ok":true}');
      expect(result.fetchResult).toEqual({ ok: true });
      expect(result.unmatched).toContain('<body>Test</body>');
    };
    assertMock(await checkMock());
    await popupPage.evaluate(rule => chrome.storage.local.set({ qnet_rules: [rule] }), rule);
    await page.reload();
    await page.waitForFunction(() => window.__qNetInterceptorInstalled === true);
    assertMock(await checkMock());
  });

  test('empty state is shown when no rules exist', async ({ popup, popupPage }) => {
    await expect(popup.netEmpty).toBeVisible();
    await expect(popup.netRuleCard).toHaveCount(0);
  });

  test('creating a rule adds a card to the list', async ({ popup, popupPage }) => {
    await createRule(popup, { name: 'Flights API', pattern: '/api/flights' });
    await expect(popup.netRuleCard).toHaveCount(1);
    await expect(popup.netEmpty).toBeHidden();
  });

  test('rule card shows the name, pattern, and match type', async ({ popup, popupPage }) => {
    await createRule(popup, { name: 'Search Mock', pattern: '/api/search', matchType: 'exact' });
    const card = popup.netRuleCard.first();
    await expect(card.locator('.net-rule-name')).toHaveText('Search Mock');
    await expect(card.locator('.net-rule-pattern')).toHaveText('/api/search');
    await expect(card.locator('.net-rule-match-type')).toHaveText('exact');
  });

  test('save with empty name keeps the modal open and adds no rule', async ({ popup, popupPage }) => {
    await popup.netAddBtn.click();
    await popup.netPattern.fill( '/api/x');
    // name is intentionally left empty
    await popup.netModalSave.click();
    await expect(popup.netModalOverlay).toBeVisible();
    await popup.netModalCancel.click();
    await expect(popup.netRuleCard).toHaveCount(0);
  });

  test('save with empty pattern keeps the modal open and adds no rule', async ({ popup, popupPage }) => {
    await popup.netAddBtn.click();
    await popup.netRuleName.fill( 'No pattern');
    // pattern is intentionally left empty
    await popup.netModalSave.click();
    await expect(popup.netModalOverlay).toBeVisible();
    await popup.netModalCancel.click();
    await expect(popup.netRuleCard).toHaveCount(0);
  });

  test('edit rule opens the modal pre-populated with existing values', async ({ popup, popupPage }) => {
    await createRule(popup, { name: 'Editable', pattern: '/api/edit', matchType: 'contains' });
    await popup.netRuleBtnEdit.click();
    await expect(popup.netModalOverlay).toBeVisible();
    await expect(popup.netModalTitle).toHaveText('Edit Rule');
    await expect(popup.netRuleName).toHaveValue('Editable');
    await expect(popup.netPattern).toHaveValue('/api/edit');
    await popup.netModalCancel.click();
  });

  test('editing and saving a rule updates the card', async ({ popup, popupPage }) => {
    await createRule(popup, { name: 'Before', pattern: '/api/before' });
    await popup.netRuleBtnEdit.click();
    await popup.netRuleName.fill( 'After');
    await popup.netPattern.fill( '/api/after');
    await popup.netModalSave.click();
    await expect(popup.netRuleNameElement).toHaveText('After');
    await expect(popup.netRulePattern).toHaveText('/api/after');
  });

  test('delete requires two clicks — first click shows confirm, second removes the card', async ({ popup, popupPage }) => {
    await createRule(popup);
    await expect(popup.netRuleCard).toHaveCount(1);
    // First click → confirm state
    await popup.netRuleBtnDel.click();
    await expect(popup.netRuleBtnDel).toContainText('⚠?');
    await expect(popup.netRuleCard).toHaveCount(1);
    // Second click → deleted
    await popup.netRuleBtnDel.click();
    await expect(popup.netRuleCard).toHaveCount(0);
  });

  test('toggle button changes the rule active state', async ({ popup, popupPage }) => {
    await createRule(popup);
    const toggle = popup.netRuleToggle.first();
    const wasBefore = await toggle.evaluate((el) => el.classList.contains('on'));
    await toggle.click();
    const isAfter = await toggle.evaluate((el) => el.classList.contains('on'));
    expect(isAfter).toBe(!wasBefore);
    // Toggle back
    await toggle.click();
    const isRestored = await toggle.evaluate((el) => el.classList.contains('on'));
    expect(isRestored).toBe(wasBefore);
  });

  test('status label reflects the number of rules', async ({ popup, popupPage }) => {
    await createRule(popup, { name: 'Status Rule', pattern: '/api/s' });
    await expect(popup.netStatusLabel).toContainText('1 rule');
  });

  test('multiple rules can be created and listed independently', async ({ popup, popupPage }) => {
    await createRule(popup, { name: 'Rule Alpha', pattern: '/api/alpha' });
    await createRule(popup, { name: 'Rule Beta',  pattern: '/api/beta'  });
    await createRule(popup, { name: 'Rule Gamma', pattern: '/api/gamma' });
    await expect(popup.netRuleCard).toHaveCount(3);
  });
});
