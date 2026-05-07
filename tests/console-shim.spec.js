// @ts-check
/**
 * Tests for console-shim.js — the MAIN-world console capture layer.
 *
 * Critical regression: Fix 80 (NOISE_PATTERNS).
 * The shim must silently drop a fixed set of harmless page-script warnings
 * before they reach the __qConsoleError CustomEvent — adding a noise pattern
 * by accident would suppress real errors QAs need to see.
 *
 * Strategy:
 *   1. Inject src/console-shim.js into a blank page.
 *   2. Listen for __qConsoleError events.
 *   3. Trigger console.error/.warn with various inputs.
 *   4. Assert which ones flow through and which are dropped.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const SHIM_JS = path.resolve(__dirname, '..', 'src', 'console-shim.js');

test.describe('Console shim — capture & noise filter', () => {
  let page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
    // Set up the event capture BEFORE injecting the shim
    await page.evaluate(() => {
      window.__capturedEvents = [];
      window.addEventListener('__qConsoleError', (e) => {
        window.__capturedEvents.push(e.detail);
      });
    });
    await page.addScriptTag({ path: SHIM_JS });
  });

  test.afterEach(async () => { await page.close(); });

  // Helper: trigger console call + flush microtask + return captured events
  async function trigger(method, msg) {
    return page.evaluate(({ m, s }) => {
      // eslint-disable-next-line no-console
      console[m](s);
      return new Promise(r => queueMicrotask(() => r(window.__capturedEvents.slice())));
    }, { m: method, s: msg });
  }

  test('console.error is captured and dispatched', async () => {
    const events = await trigger('error', 'Uncaught TypeError: foo is not a function');
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('console.error');
    expect(events[0].message).toContain('TypeError');
  });

  test('console.warn matching error keywords is captured', async () => {
    const events = await trigger('warn', 'Failed to fetch — TypeError: bad URL');
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('console.warn');
  });

  test('console.warn without error keywords is dropped', async () => {
    const events = await trigger('warn', 'Hello world, nothing alarming here');
    expect(events.length).toBe(0);
  });

  // ── Fix 80: NOISE_PATTERNS regression ─────────────────────────────────────
  test('noise pattern — @babel/polyfill loaded multiple times — dropped', async () => {
    const events = await trigger('error', '@babel/polyfill is loaded more than once');
    expect(events.length).toBe(0);
  });

  test('noise pattern — DEPRECATED JS — dropped', async () => {
    const events = await trigger('error', 'DEPRECATED JS - AJS old API');
    expect(events.length).toBe(0);
  });

  test('noise pattern — MaxListeners warning — dropped', async () => {
    const events = await trigger('error',
      'MaxListenersExceededWarning: Possible EventEmitter memory leak detected');
    expect(events.length).toBe(0);
  });

  test('noise pattern — IndexedDB timed out — dropped', async () => {
    const events = await trigger('error', 'IndexedDB timed out fetching value');
    expect(events.length).toBe(0);
  });

  test('legitimate ReferenceError still flows through (not over-filtered)', async () => {
    const events = await trigger('error',
      'Uncaught ReferenceError: someUserVariable is not defined');
    expect(events.length).toBe(1);
  });

  // ── Dedup ──────────────────────────────────────────────────────────────────
  test('duplicate identical errors are deduplicated', async () => {
    await page.evaluate(() => {
      // eslint-disable-next-line no-console
      console.error('Uncaught ReferenceError: dup is not defined');
      // eslint-disable-next-line no-console
      console.error('Uncaught ReferenceError: dup is not defined');
      // eslint-disable-next-line no-console
      console.error('Uncaught ReferenceError: dup is not defined');
    });
    // Flush microtasks
    await page.evaluate(() => new Promise(r => queueMicrotask(r)));
    const events = await page.evaluate(() => window.__capturedEvents);
    expect(events.length).toBe(1);
  });
});
