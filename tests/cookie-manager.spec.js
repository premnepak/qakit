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

async function openCookiePanel(popup) {
  await popup.homeTile('cookies').click();
  await expect(popup.panel('cookies')).toHaveClass(/active/);
}

// ─── Panel UI ────────────────────────────────────────────────────────────────

test.describe('Cookie Manager — panel UI', () => {
  test('panel opens from the home tile', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.panel('cookies')).toBeVisible();
  });

  test('filter input is visible', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieSearch).toBeVisible();
  });

  test('Refresh button is visible', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieRefreshBtn).toBeVisible();
  });

  test('Expand/Collapse toggle button is visible', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieToggleAllBtn).toBeVisible();
  });

  test('cookie count label is present in the toolbar', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieCount).toBeAttached();
  });

  test('cookie list container is present', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieList).toBeAttached();
  });
});

// ─── Cookie Edit Modal ────────────────────────────────────────────────────────

test.describe('Cookie Manager — edit modal', () => {
  test('edit modal is hidden by default', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieEditOverlay).toBeHidden();
  });

  test('edit modal has Name, Value, Domain and Path fields', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    // Reveal the modal directly to check its structure
    await popupPage.evaluate(() => {
      document.getElementById('cookieEditOverlay').style.display = 'flex';
    });
    await expect(popup.ckEditName).toBeVisible();
    await expect(popup.ckEditValue).toBeVisible();
    await expect(popup.ckEditDomain).toBeVisible();
    await expect(popup.ckEditPath).toBeVisible();
  });

  test('edit modal Cancel button closes the overlay', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await popupPage.evaluate(() => {
      document.getElementById('cookieEditOverlay').style.display = 'flex';
    });
    await popup.ckEditCancel.click();
    await expect(popup.cookieEditOverlay).toBeHidden();
  });

  test('edit modal Path field defaults to "/"', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.ckEditPath).toHaveValue('/');
  });

  test('+ Add button opens modal in Add Cookie mode and Cancel closes it', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await expect(popup.cookieAddBtn).toBeVisible();
    await popup.cookieAddBtn.click();
    await expect(popup.cookieEditOverlay).toBeVisible();
    await expect(popup.ckModalTitle).toHaveText('Add Cookie');
    await expect(popup.ckEditName).toHaveValue('');
    await expect(popup.ckEditValue).toHaveValue('');
    await expect(popup.ckEditPath).toHaveValue('/');
    await popup.ckEditCancel.click();
    await expect(popup.cookieEditOverlay).toBeHidden();
  });
});

// ─── Filter behaviour ────────────────────────────────────────────────────────

test.describe('Cookie Manager — filter', () => {
  test('typing in the filter input updates its value', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await popup.cookieSearch.fill( 'session');
    await expect(popup.cookieSearch).toHaveValue('session');
  });

  test('clearing the filter input works', async ({ popup, popupPage }) => {
    await openCookiePanel(popup);
    await popup.cookieSearch.fill( 'abc');
    await popup.cookieSearch.fill( '');
    await expect(popup.cookieSearch).toHaveValue('');
  });
});
