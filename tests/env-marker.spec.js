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

async function openEnvMarkerPanel(popupPage) {
  await popupPage.click('.home-tile[data-tab="envmarker"]');
  await expect(popupPage.locator('#panel-envmarker')).toHaveClass(/active/);
}

// ─── Suite 1: Popup panel UI ─────────────────────────────────────────────────

test.describe('Env Marker — popup panel', () => {
  test('panel opens from the home tile', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    await expect(popupPage.locator('#panel-envmarker')).toBeVisible();
  });

  test('Add and Reset buttons are visible', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    await expect(popupPage.locator('#envmarkerAddBtn')).toBeVisible();
    await expect(popupPage.locator('#envmarkerResetBtn')).toBeVisible();
  });

  test('default environments are loaded into the list', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    // Wait for async loadEnvs() to render rows
    await expect(popupPage.locator('#envmarkerList .env-row')).toHaveCount(4);
  });

  test('each default environment row has an enable checkbox', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    await expect(popupPage.locator('#envmarkerList .env-enabled')).toHaveCount(4);
  });

  test('each default environment row has a delete button', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    await expect(popupPage.locator('#envmarkerList .env-delete')).toHaveCount(4);
  });

  test('default rows include STAGING, UAT, DEV environments', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    const listText = await popupPage.locator('#envmarkerList').innerText();
    expect(listText).toContain('STAGING');
    expect(listText).toContain('UAT');
    expect(listText).toContain('DEV');
  });

  test('clicking a row header expands its detail section', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    const firstHeader = popupPage.locator('#envmarkerList .env-row-header').first();
    await firstHeader.click();
    await expect(popupPage.locator('#envmarkerList .env-row').first()).toHaveClass(/expanded/);
  });

  test('deleting a row removes it from the list', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    await expect(popupPage.locator('#envmarkerList .env-row')).toHaveCount(4);
    // Delete requires a confirm() — accept it before clicking
    popupPage.once('dialog', dialog => dialog.accept());
    await popupPage.locator('#envmarkerList .env-delete').first().click();
    await expect(popupPage.locator('#envmarkerList .env-row')).toHaveCount(3);
  });

  test('Reset button restores all 4 default rows', async ({ popupPage }) => {
    await openEnvMarkerPanel(popupPage);
    // Delete one row first (accept its confirm)
    popupPage.once('dialog', dialog => dialog.accept());
    await popupPage.locator('#envmarkerList .env-delete').first().click();
    await expect(popupPage.locator('#envmarkerList .env-row')).toHaveCount(3);
    // Reset also requires a confirm
    popupPage.once('dialog', dialog => dialog.accept());
    await popupPage.click('#envmarkerResetBtn');
    await expect(popupPage.locator('#envmarkerList .env-row')).toHaveCount(4);
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
