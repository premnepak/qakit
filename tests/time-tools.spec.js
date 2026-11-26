// @ts-check
/**
 * Tests for the Time/Timezone panel and its underlying conversion logic.
 *
 * Two suites:
 *
 * Suite 1 — popup panel UI (uses full extension via fixtures):
 *   Verifies the panel opens correctly, the World Clock renders cities, the
 *   Epoch & Timezone sub-tab is reachable, and the key inputs are present.
 *
 * Suite 2 — epoch/timezone conversion logic (plain browser, no extension):
 *   Runs the pure conversion functions extracted from time.js directly in a
 *   page.evaluate, testing correctness without the full popup overhead.
 */

const { test: baseTest, expect } = require('@playwright/test');
const { test } = require('./fixtures');

// ─── Pure conversion helpers (mirrors time.js internals) ─────────────────────
// These are redefined here so Suite 2 can run without the extension.

function makeConversionHelpers() {
  function detectEpochUnit(val) {
    const s = String(Math.abs(val));
    if (s.length <= 11) return 's';
    if (s.length <= 14) return 'ms';
    return 'us';
  }
  function epochToMs(val, unit) {
    const n = Number(val);
    if (!isFinite(n)) return null;
    const u = unit === 'auto' ? detectEpochUnit(n) : unit;
    if (u === 's')  return n * 1000;
    if (u === 'ms') return n;
    if (u === 'us') return Math.floor(n / 1000);
    return n;
  }
  return { detectEpochUnit, epochToMs };
}

async function openTimePanel(popup) {
  await popup.homeTile('time').click();
  await expect(popup.panel('time')).toHaveClass(/active/);
}

// ─── Suite 1: Popup panel UI ─────────────────────────────────────────────────

test.describe('Time panel — UI', () => {
  test('panel opens from home tile', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await expect(popup.panel('time')).toBeVisible();
  });

  test('World Clock sub-tab is active by default', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await expect(popup.subtab('time', 'clock')).toHaveClass(/active/);
    await expect(popup.timesubClock).toHaveClass(/active/);
  });

  test('World Clock grid renders city rows', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await expect(popup.worldClockGrid).toBeVisible();
    // Grid renders .wc-row elements (one per city)
    await expect(popup.worldClockGridWcRow.first()).toBeAttached({ timeout: 3000 });
  });

  test('city filter input is visible and accepts input', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await expect(popup.clockFilter).toBeVisible();
    await popup.clockFilter.fill( 'Sydney');
    await expect(popup.clockFilter).toHaveValue('Sydney');
  });

  test('Epoch & Timezone sub-tab is reachable', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    await expect(popup.timesubTimestamp).toBeVisible();
  });

  test('epoch input and unit selector are present', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    await expect(popup.epochInput).toBeVisible();
    await expect(popup.epochUnit).toBeVisible();
  });

  test('human date input and Now button are present', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    await expect(popup.humanDateInput).toBeAttached();
    await expect(popup.humanNowBtn).toBeVisible();
  });

  test('"Now" button fills the epoch input with a current timestamp', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    await popup.epochNowBtn.click();
    const val = await popup.epochInput.inputValue();
    expect(val.length).toBeGreaterThan(0);
    expect(Number(val)).toBeGreaterThan(0);
  });

  test('timezone converter From and To selects are populated', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    const fromCount = await popup.tzFromOption.count();
    const toCount   = await popup.tzToOption.count();
    expect(fromCount).toBeGreaterThan(10);
    expect(toCount).toBeGreaterThan(10);
  });

  test('timezone swap button is visible', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    await expect(popup.tzSwapBtn).toBeVisible();
  });

  test('swap button exchanges From and To timezone values', async ({ popup, popupPage }) => {
    await openTimePanel(popup);
    await popup.subtab('time', 'timestamp').click();
    const fromBefore = await popup.tzFrom.inputValue();
    const toBefore   = await popup.tzTo.inputValue();
    await popup.tzSwapBtn.click();
    const fromAfter = await popup.tzFrom.inputValue();
    const toAfter   = await popup.tzTo.inputValue();
    expect(fromAfter).toBe(toBefore);
    expect(toAfter).toBe(fromBefore);
  });
});

// ─── Suite 2: Epoch conversion logic ─────────────────────────────────────────

baseTest.describe('Epoch conversion logic', () => {
  // Helpers run inside page.evaluate so they execute in the browser context.
  const HELPERS_SRC = `
    function detectEpochUnit(val) {
      const s = String(Math.abs(val));
      if (s.length <= 11) return 's';
      if (s.length <= 14) return 'ms';
      return 'us';
    }
    function epochToMs(val, unit) {
      const n = Number(val);
      if (!isFinite(n)) return null;
      const u = unit === 'auto' ? detectEpochUnit(n) : unit;
      if (u === 's')  return n * 1000;
      if (u === 'ms') return n;
      if (u === 'us') return Math.floor(n / 1000);
      return n;
    }
  `;

  baseTest('seconds epoch (10-digit) detects as "s"', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const unit = await page.evaluate(`(function() { ${HELPERS_SRC} return detectEpochUnit(1741783721); })()`);
    expect(unit).toBe('s');
  });

  baseTest('milliseconds epoch (13-digit) detects as "ms"', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const unit = await page.evaluate(`(function() { ${HELPERS_SRC} return detectEpochUnit(1741783721000); })()`);
    expect(unit).toBe('ms');
  });

  baseTest('microseconds epoch (16-digit) detects as "us"', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const unit = await page.evaluate(`(function() { ${HELPERS_SRC} return detectEpochUnit(1741783721000000); })()`);
    expect(unit).toBe('us');
  });

  baseTest('epochToMs converts seconds to milliseconds', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const ms = await page.evaluate(`(function() { ${HELPERS_SRC} return epochToMs(1741783721, 's'); })()`);
    expect(ms).toBe(1741783721 * 1000);
  });

  baseTest('epochToMs passes through milliseconds unchanged', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const ms = await page.evaluate(`(function() { ${HELPERS_SRC} return epochToMs(1741783721000, 'ms'); })()`);
    expect(ms).toBe(1741783721000);
  });

  baseTest('epochToMs converts microseconds to milliseconds', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const ms = await page.evaluate(`(function() { ${HELPERS_SRC} return epochToMs(1741783721000000, 'us'); })()`);
    expect(ms).toBe(1741783721000);
  });

  baseTest('epochToMs auto-detects seconds', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const ms = await page.evaluate(`(function() { ${HELPERS_SRC} return epochToMs(1741783721, 'auto'); })()`);
    expect(ms).toBe(1741783721 * 1000);
  });

  baseTest('epochToMs auto-detects milliseconds', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const ms = await page.evaluate(`(function() { ${HELPERS_SRC} return epochToMs(1741783721000, 'auto'); })()`);
    expect(ms).toBe(1741783721000);
  });

  baseTest('epochToMs returns null for non-finite input', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() { ${HELPERS_SRC} return epochToMs('not-a-number', 'auto'); })()`);
    expect(result).toBeNull();
  });

  baseTest('auto-detected epoch converts to a valid UTC date string', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${HELPERS_SRC}
      const ms = epochToMs(1700000000, 'auto');
      return new Date(ms).toISOString();
    })()`);
    // 1700000000s is 2023-11-14T22:13:20.000Z
    expect(result).toContain('2023-11-14');
  });
});
