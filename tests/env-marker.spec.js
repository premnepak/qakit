// @ts-check
/**
 * Tests for the Environment Marker.
 *
 * Two test suites:
 *
 * Suite 1 — popup panel UI (envmarker.js):
 *   Tests the configuration panel inside the extension popup where users
 *   manage their list of environment rules.
 *
 * Suite 2 — injected marker logic (env-marker.js):
 *   Injects env-marker.js directly into a plain page (no extension needed) and
 *   verifies the banner element rendered on the page. Mirrors exactly what
 *   background.js does when it injects the marker into a real tab.
 */

const { test: baseTest, expect } = require('@playwright/test');
const { test } = require('./fixtures');
const path = require('path');

const ENV_MARKER_JS = path.resolve(__dirname, '..', 'src', 'env-marker.js');

async function openEnvMarkerPanel(popup) {
  await popup.homeTile('envmarker').click();
  await expect(popup.panel('envmarker')).toHaveClass(/active/);
}

// ─── Suite 1: Popup panel UI ─────────────────────────────────────────────────

test.describe('Env Marker — popup panel', () => {
  test('panel opens from the home tile', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    await expect(popup.panel('envmarker')).toBeVisible();
  });

  test('Add and Reset buttons are visible', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    await expect(popup.envmarkerAddBtn).toBeVisible();
    await expect(popup.envmarkerResetBtn).toBeVisible();
  });

  test('default environments are loaded into the list', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    // Wait for async loadEnvs() to render rows
    await expect(popup.envmarkerListEnvRow).toHaveCount(4);
  });

  test('each default environment row has an enable checkbox', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    await expect(popup.envmarkerListEnvEnabled).toHaveCount(4);
  });

  test('each default environment row has a delete button', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    await expect(popup.envmarkerListEnvDelete).toHaveCount(4);
  });

  test('default rows include STAGING, UAT, DEV environments', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    const listText = await popup.envmarkerList.innerText();
    expect(listText).toContain('STAGING');
    expect(listText).toContain('UAT');
    expect(listText).toContain('DEV');
  });

  test('clicking a row header expands its detail section', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    const firstHeader = popup.envmarkerListEnvRowHeader.first();
    await firstHeader.click();
    await expect(popup.envmarkerListEnvRow.first()).toHaveClass(/expanded/);
  });

  test('deleting a row removes it from the list', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    await expect(popup.envmarkerListEnvRow).toHaveCount(4);
    // Delete requires a confirm() — accept it before clicking
    popupPage.once('dialog', dialog => dialog.accept());
    await popup.envmarkerListEnvDelete.first().click();
    await expect(popup.envmarkerListEnvRow).toHaveCount(3);
  });

  test('Reset button restores all 4 default rows', async ({ popup, popupPage }) => {
    await openEnvMarkerPanel(popup);
    // Delete one row first (accept its confirm)
    popupPage.once('dialog', dialog => dialog.accept());
    await popup.envmarkerListEnvDelete.first().click();
    await expect(popup.envmarkerListEnvRow).toHaveCount(3);
    // Reset also requires a confirm
    popupPage.once('dialog', dialog => dialog.accept());
    await popup.envmarkerResetBtn.click();
    await expect(popup.envmarkerListEnvRow).toHaveCount(4);
  });
});

// ─── Suite 2: Injected marker logic (plain page, no extension) ───────────────

baseTest.describe('Env Marker — injected banner logic', () => {
  const MARKER_ID = '__qkit-env-marker';

  async function injectMarker(page, cfg) {
    await page.evaluate((c) => { window.__qkitEnvMarker = c; }, cfg);
    await page.addScriptTag({ path: ENV_MARKER_JS });
  }

  baseTest('bar variant renders an element on the page', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'STAGING', variant: 'bar', position: 'top', color: '#ea580c', textColor: '#ffffff', opacity: 85 });
    await expect(page.locator(`#${MARKER_ID}`)).toBeVisible();
  });

  baseTest('bar variant shows the configured name', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'UAT', variant: 'bar', position: 'top', color: '#2563eb', textColor: '#ffffff', opacity: 85 });
    const text = await page.locator(`#${MARKER_ID}`).textContent();
    expect(text).toBe('UAT');
  });

  baseTest('bar at top has position fixed with top:0', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'DEV', variant: 'bar', position: 'top', color: '#dc2626', textColor: '#fff', opacity: 90 });
    const styles = await page.locator(`#${MARKER_ID}`).evaluate((el) => ({
      position: el.style.position,
      top: el.style.top,
    }));
    expect(styles.position).toBe('fixed');
    expect(styles.top).toBe('0px');
  });

  baseTest('bar at bottom has bottom:0', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'DEV', variant: 'bar', position: 'bottom', color: '#dc2626', textColor: '#fff', opacity: 90 });
    const bottom = await page.locator(`#${MARKER_ID}`).evaluate((el) => el.style.bottom);
    expect(bottom).toBe('0px');
  });

  baseTest('pill variant renders with border-radius style', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'STAGING', variant: 'pill', position: 'top-right', color: '#ea580c', textColor: '#fff', opacity: 85 });
    const radius = await page.locator(`#${MARKER_ID}`).evaluate((el) => el.style.borderRadius);
    expect(radius).toBe('999px');
  });

  baseTest('hidden config prevents rendering', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'STAGING', variant: 'bar', position: 'top', hidden: true, opacity: 85 });
    await expect(page.locator(`#${MARKER_ID}`)).toHaveCount(0);
  });

  baseTest('missing name config prevents rendering', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { variant: 'bar', position: 'top', opacity: 85 });
    await expect(page.locator(`#${MARKER_ID}`)).toHaveCount(0);
  });

  baseTest('double-click hides the marker', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'STAGING', variant: 'bar', position: 'top', color: '#ea580c', textColor: '#fff', opacity: 85 });
    await expect(page.locator(`#${MARKER_ID}`)).toBeVisible();
    await page.locator(`#${MARKER_ID}`).dblclick();
    await expect(page.locator(`#${MARKER_ID}`)).toBeHidden();
  });

  baseTest('re-injection removes the previous marker', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectMarker(page, { name: 'STAGING', variant: 'bar', position: 'top', color: '#ea580c', textColor: '#fff', opacity: 85 });
    await injectMarker(page, { name: 'UAT', variant: 'bar', position: 'top', color: '#2563eb', textColor: '#fff', opacity: 85 });
    // Only one marker should exist
    await expect(page.locator(`#${MARKER_ID}`)).toHaveCount(1);
    const text = await page.locator(`#${MARKER_ID}`).textContent();
    expect(text).toBe('UAT');
  });

  baseTest('bar variant coerces pill position to top', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    // bar + top-right is invalid — should coerce to top
    await injectMarker(page, { name: 'DEV', variant: 'bar', position: 'top-right', color: '#dc2626', textColor: '#fff', opacity: 85 });
    const top = await page.locator(`#${MARKER_ID}`).evaluate((el) => el.style.top);
    expect(top).toBe('0px');
  });
});
