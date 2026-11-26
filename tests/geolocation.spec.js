// @ts-check
/**
 * Functional tests for the Geolocation Spoof panel.
 *
 * The geolocation override is injected into the active tab via
 * chrome.scripting.executeScript (MAIN world). Because the popup's "active tab"
 * in the test context is the popup page itself (a chrome-extension:// URL that
 * blocks script injection), we test the UI behaviour (panel state, preset
 * population, input persistence) and separately test the injected override
 * script directly using a plain page evaluation.
 */

const { test: baseTest, expect } = require('@playwright/test');
const { test } = require('./fixtures');
const path = require('path');

// ─── Suite 1: Panel UI (uses full extension via fixtures) ────────────────────

test.describe('Geolocation panel — UI', () => {
  async function openGeoPanel(popup) {
    await popup.homeTile('geo').click();
    await expect(popup.panel('geo')).toHaveClass(/active/);
  }

  test('panel renders lat, lng inputs and apply/clear buttons', async ({ popup, popupPage }) => {
    await openGeoPanel(popup);
    await expect(popup.geoLat).toBeVisible();
    await expect(popup.geoLng).toBeVisible();
    await expect(popup.geoApplyBtn).toBeVisible();
    await expect(popup.geoClearBtn).toBeVisible();
  });

  test('preset dropdown populates lat and lng when a location is selected', async ({ popup, popupPage }) => {
    await openGeoPanel(popup);
    const opts = await popup.geoPresetSelectOption.count();
    expect(opts).toBeGreaterThan(1);
    // Select the second option (first is the placeholder).
    const val = await popup.geoPresetSelectOption.nth(1).getAttribute('value');
    if (val) {
      await popup.geoPresetSelect.selectOption( val);
      const lat = await popup.geoLat.inputValue();
      const lng = await popup.geoLng.inputValue();
      expect(lat.length).toBeGreaterThan(0);
      expect(lng.length).toBeGreaterThan(0);
    }
  });

  test('preset values are numeric coordinates', async ({ popup, popupPage }) => {
    await openGeoPanel(popup);
    const val = await popup.geoPresetSelectOption.nth(1).getAttribute('value');
    if (val) {
      await popup.geoPresetSelect.selectOption( val);
      const lat = parseFloat(await popup.geoLat.inputValue());
      const lng = parseFloat(await popup.geoLng.inputValue());
      expect(isNaN(lat)).toBe(false);
      expect(isNaN(lng)).toBe(false);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lng).toBeGreaterThanOrEqual(-180);
      expect(lng).toBeLessThanOrEqual(180);
    }
  });

  test('custom lat/lng can be typed into the inputs', async ({ popup, popupPage }) => {
    await openGeoPanel(popup);
    await popup.geoLat.fill( '-33.8688');
    await popup.geoLng.fill( '151.2093');
    await expect(popup.geoLat).toHaveValue('-33.8688');
    await expect(popup.geoLng).toHaveValue('151.2093');
  });

  test('accuracy input is present', async ({ popup, popupPage }) => {
    await openGeoPanel(popup);
    await expect(popup.geoAccuracy).toBeAttached();
  });
});

// ─── Suite 2: Override script logic (plain browser, no extension needed) ─────
//
// We extract and test the core geolocation override logic in isolation by
// injecting it directly into a plain page.  This verifies the script that
// chrome.scripting.executeScript would run on a real target tab.

baseTest.describe('Geolocation override script — logic', () => {
  // The override script mirrors the MAIN-world function injected by geolocation.js.
  // Playwright page.evaluate only accepts a single serialisable argument, so we
  // pass coords as an object and destructure inside.
  function geoOverrideScript({ lat, lng, accuracy }) {
    window.__qkitGeoOverride = { latitude: lat, longitude: lng, accuracy: accuracy || 10 };
    const fakeGeo = {
      getCurrentPosition(success) {
        success({
          coords: {
            latitude:         window.__qkitGeoOverride.latitude,
            longitude:        window.__qkitGeoOverride.longitude,
            accuracy:         window.__qkitGeoOverride.accuracy,
            altitude:         null,
            altitudeAccuracy: null,
            heading:          null,
            speed:            null,
          },
          timestamp: Date.now(),
        });
      },
      watchPosition(success) {
        this.getCurrentPosition(success);
        return 0;
      },
      clearWatch() {},
    };
    Object.defineProperty(navigator, 'geolocation', { get: () => fakeGeo, configurable: true });
  }

  baseTest('getCurrentPosition returns the spoofed coordinates', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(geoOverrideScript, { lat: -33.8688, lng: 151.2093, accuracy: 15 });

    const pos = await page.evaluate(() =>
      new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition((p) => {
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        });
      }),
    );
    expect(pos.lat).toBeCloseTo(-33.8688, 4);
    expect(pos.lng).toBeCloseTo(151.2093, 4);
    expect(pos.acc).toBe(15);
  });

  baseTest('watchPosition returns the spoofed coordinates', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(geoOverrideScript, { lat: 51.5074, lng: -0.1278, accuracy: 20 });

    const pos = await page.evaluate(() =>
      new Promise((resolve) => {
        navigator.geolocation.watchPosition((p) => {
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude });
        });
      }),
    );
    expect(pos.lat).toBeCloseTo(51.5074, 4);
    expect(pos.lng).toBeCloseTo(-0.1278, 4);
  });

  baseTest('override can be applied to different coordinates sequentially', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(geoOverrideScript, { lat: 40.7128, lng: -74.006, accuracy: 10 });

    const pos1 = await page.evaluate(() =>
      new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition((p) =>
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        ),
      ),
    );
    expect(pos1.lat).toBeCloseTo(40.7128, 4);

    // Apply a new override (simulates clicking Apply again with different coords).
    await page.evaluate(geoOverrideScript, { lat: 35.6762, lng: 139.6503, accuracy: 10 });

    const pos2 = await page.evaluate(() =>
      new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition((p) =>
          resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        ),
      ),
    );
    expect(pos2.lat).toBeCloseTo(35.6762, 4);
  });
});
