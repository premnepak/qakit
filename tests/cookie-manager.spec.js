// @ts-check
/**
 * Tests for the Cookie Manager panel.
 *
 * Cookie reads/writes require chrome.cookies API permission and a real page
 * domain, which are not available in the extension popup's own origin.
 * These tests cover the panel UI — toolbar, filter, and the empty/loading
 * state that renders before the user clicks Refresh.
 */

const { test, expect } = require('./fixtures');

async function openCookiePanel(popupPage) {
  await popupPage.click('.home-tile[data-tab="cookies"]');
  await expect(popupPage.locator('#panel-cookies')).toHaveClass(/active/);
}

// ─── Panel UI ────────────────────────────────────────────────────────────────

test.describe('Cookie Manager — panel UI', () => {
  test('panel opens from the home tile', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#panel-cookies')).toBeVisible();
  });

  test('filter input is visible', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#cookieSearch')).toBeVisible();
  });

  test('Refresh button is visible', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#cookieRefreshBtn')).toBeVisible();
  });

  test('Expand/Collapse toggle button is visible', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#cookieToggleAllBtn')).toBeVisible();
  });

  test('cookie count label is present in the toolbar', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#cookieCount')).toBeAttached();
  });

  test('cookie list container is present', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#cookieList')).toBeAttached();
  });
});

// ─── Cookie Edit Modal ────────────────────────────────────────────────────────

test.describe('Cookie Manager — edit modal', () => {
  test('edit modal is hidden by default', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#cookieEditOverlay')).toBeHidden();
  });

  test('edit modal has Name, Value, Domain and Path fields', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    // Reveal the modal directly to check its structure
    await popupPage.evaluate(() => {
      document.getElementById('cookieEditOverlay').style.display = 'flex';
    });
    await expect(popupPage.locator('#ckEditName')).toBeVisible();
    await expect(popupPage.locator('#ckEditValue')).toBeVisible();
    await expect(popupPage.locator('#ckEditDomain')).toBeVisible();
    await expect(popupPage.locator('#ckEditPath')).toBeVisible();
  });

  test('edit modal Cancel button closes the overlay', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await popupPage.evaluate(() => {
      document.getElementById('cookieEditOverlay').style.display = 'flex';
    });
    await popupPage.click('#ckEditCancel');
    await expect(popupPage.locator('#cookieEditOverlay')).toBeHidden();
  });

  test('edit modal Path field defaults to "/"', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await expect(popupPage.locator('#ckEditPath')).toHaveValue('/');
  });
});

// ─── Filter behaviour ────────────────────────────────────────────────────────

test.describe('Cookie Manager — filter', () => {
  test('typing in the filter input updates its value', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await popupPage.fill('#cookieSearch', 'session');
    await expect(popupPage.locator('#cookieSearch')).toHaveValue('session');
  });

  test('clearing the filter input works', async ({ popupPage }) => {
    await openCookiePanel(popupPage);
    await popupPage.fill('#cookieSearch', 'abc');
    await popupPage.fill('#cookieSearch', '');
    await expect(popupPage.locator('#cookieSearch')).toHaveValue('');
  });
});
