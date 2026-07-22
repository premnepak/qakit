// @ts-check
/**
 * Tests for analytics-interceptor.js — the MAIN-world script that patches
 * window.dataLayer, window.gtag, window.fbq, window.utag, and
 * window.analytics to dispatch __qAnalyticsEvent CustomEvents.
 *
 * Strategy: inject the script into a plain page via addScriptTag (no extension
 * needed), then simulate page-side API calls and assert on the dispatched
 * CustomEvents. This mirrors exactly what the extension does when it injects
 * the interceptor into a real tab.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const INTERCEPTOR_JS = path.resolve(__dirname, '..', 'src', 'analytics-interceptor.js');

/**
 * @param {import('@playwright/test').Page} page
 * @param {string[]} [providers]
 */
async function injectInterceptor(page, providers) {
  if (providers) {
    await page.evaluate((p) => { /** @type {any} */ (window).__qAnalyticsProviders = p; }, providers);
  }
  await page.addScriptTag({ path: INTERCEPTOR_JS });
}

// ─── GTM / dataLayer ─────────────────────────────────────────────────────────

test.describe('Analytics Interceptor — GTM / dataLayer', () => {
  test('dataLayer.push dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.dataLayer = []; });
    await injectInterceptor(page, ['gtm']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.dataLayer.push({ event: 'page_view', pagePath: '/home' });
      }),
    );

    expect(evt.event).toBe('page_view');
    expect(evt.category).toBe('GTM');
    expect(evt.data._raw.pagePath).toBe('/home');
  });

  test('events pre-existing in dataLayer are replayed on injection', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.dataLayer = [{ event: 'pre_existing', value: 42 }];
    });

    const [replayedEvt] = await Promise.all([
      page.evaluate(() =>
        new Promise((resolve) => {
          window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        }),
      ),
      page.addScriptTag({ path: INTERCEPTOR_JS }),
    ]);

    expect(replayedEvt.event).toBe('pre_existing');
    expect(replayedEvt.data._replayed).toBe(true);
  });

  test('dataLayer.push is only proxied once (idempotent re-injection)', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.dataLayer = []; });
    await injectInterceptor(page, ['gtm']);
    await injectInterceptor(page, ['gtm']); // second injection must not double-fire

    const count = await page.evaluate(async () => {
      let n = 0;
      window.addEventListener('__qAnalyticsEvent', () => n++);
      window.dataLayer.push({ event: 'test_once' });
      await new Promise(r => setTimeout(r, 50));
      return n;
    });

    expect(count).toBe(1);
  });

  test('digitalDataLayer.push dispatches with DDL category', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.digitalDataLayer = []; });
    await injectInterceptor(page, ['ddl']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.digitalDataLayer.push({ event: 'product_view', productId: 'abc' });
      }),
    );

    expect(evt.category).toBe('DDL');
    expect(evt.event).toBe('product_view');
  });

  test('push without .event field falls back to "datalayer.push"', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.dataLayer = []; });
    await injectInterceptor(page, ['gtm']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.dataLayer.push({ someKey: 'someValue' });
      }),
    );

    expect(evt.event).toBe('datalayer.push');
  });

  test('ecommerce payload is preserved on the event', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.dataLayer = []; });
    await injectInterceptor(page, ['gtm']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.dataLayer.push({ event: 'purchase', ecommerce: { transaction_id: 'T123', value: 99.99 } });
      }),
    );

    expect(evt.event).toBe('purchase');
    expect(evt.data.ecommerce.transaction_id).toBe('T123');
  });
});

// ─── GA4 / gtag ──────────────────────────────────────────────────────────────

test.describe('Analytics Interceptor — GA4', () => {
  test('gtag("event", ...) dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.gtag = function () {}; });
    await injectInterceptor(page, ['ga4']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.gtag('event', 'add_to_cart', { currency: 'USD', value: 9.99 });
      }),
    );

    expect(evt.event).toBe('add_to_cart');
    expect(evt.category).toBe('GA4');
    expect(evt.data.params.currency).toBe('USD');
  });

  test('original gtag is still called after patching', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.__origGtagArgs = null;
      window.gtag = function (...args) { window.__origGtagArgs = args; };
    });
    await injectInterceptor(page, ['ga4']);

    await page.evaluate(() => window.gtag('event', 'login', {}));
    const args = await page.evaluate(() => window.__origGtagArgs);

    expect(args[0]).toBe('event');
    expect(args[1]).toBe('login');
  });

  test('gtag defined after injection is still intercepted', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await injectInterceptor(page, ['ga4']);
    // Define gtag AFTER injection — the property setter proxy should catch it.
    await page.evaluate(() => { window.gtag = function () {}; });

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.gtag('event', 'late_bind_event', {});
      }),
    );

    expect(evt.event).toBe('late_bind_event');
    expect(evt.category).toBe('GA4');
  });
});

// ─── Meta Pixel / fbq ────────────────────────────────────────────────────────

test.describe('Analytics Interceptor — Meta Pixel', () => {
  test('fbq("track", ...) dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.fbq = function () {}; });
    await injectInterceptor(page, ['meta']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.fbq('track', 'Purchase', { value: 50, currency: 'AUD' });
      }),
    );

    expect(evt.event).toBe('Purchase');
    expect(evt.category).toBe('Meta Pixel');
    expect(evt.data.params.currency).toBe('AUD');
  });

  test('fbq("init", ...) dispatches a pixel.init event', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.fbq = function () {}; });
    await injectInterceptor(page, ['meta']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.fbq('init', '123456789');
      }),
    );

    expect(evt.event).toBe('pixel.init');
    expect(evt.data.pixelId).toBe('123456789');
  });
});

// ─── Tealium / utag ──────────────────────────────────────────────────────────

test.describe('Analytics Interceptor — Tealium', () => {
  test('utag.link dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.utag = { link: function () {}, view: function () {}, track: function () {} };
    });
    await injectInterceptor(page, ['tealium']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.utag.link({ tealium_event: 'button_click', label: 'Buy' });
      }),
    );

    expect(evt.category).toBe('Tealium');
    expect(evt.data.data.label).toBe('Buy');
  });

  test('utag.view dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.utag = { link: function () {}, view: function () {}, track: function () {} };
    });
    await injectInterceptor(page, ['tealium']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.utag.view({ tealium_event: 'page_view', page_name: 'Home' });
      }),
    );

    expect(evt.category).toBe('Tealium');
    expect(evt.data.data.page_name).toBe('Home');
  });
});

// ─── Adobe Client Data Layer (adobeDataLayer / ACDL) ─────────────────────────

test.describe('Analytics Interceptor — Adobe Client Data Layer', () => {
  test('adobeDataLayer.push dispatches with "Adobe DL" category', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.adobeDataLayer = []; });
    await injectInterceptor(page, ['adobedl']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.adobeDataLayer.push({ event: 'cmp:show', eventInfo: { path: 'component.hero' } });
      }),
    );

    expect(evt.category).toBe('Adobe DL');
    expect(evt.event).toBe('cmp:show');
    expect(evt.data.eventInfo.path).toBe('component.hero');
  });

  test('event name falls back to eventInfo.eventName', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.adobeDataLayer = []; });
    await injectInterceptor(page, ['adobedl']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.adobeDataLayer.push({ eventInfo: { eventName: 'page.load' }, page: { name: 'Home' } });
      }),
    );

    expect(evt.event).toBe('page.load');
    expect(evt.data.page.name).toBe('Home');
  });

  test('pre-existing adobeDataLayer events are replayed on injection', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.adobeDataLayer = [{ event: 'acdl_pre', v: 1 }]; });

    const [evt] = await Promise.all([
      page.evaluate(() =>
        new Promise((resolve) => {
          window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        }),
      ),
      page.addScriptTag({ path: INTERCEPTOR_JS }),
    ]);

    expect(evt.event).toBe('acdl_pre');
    expect(evt.data._replayed).toBe(true);
  });

  test('original adobeDataLayer.push is still called after patching', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.adobeDataLayer = []; });
    await injectInterceptor(page, ['adobedl']);

    const len = await page.evaluate(() => {
      window.adobeDataLayer.push({ event: 'kept' });
      return window.adobeDataLayer.length;
    });

    expect(len).toBe(1);
  });

  test('native adobeDataLayer:event listener path fires (Manager present)', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    // Simulate a minimal ACDL Manager exposing addEventListener
    await page.evaluate(() => {
      const listeners = [];
      window.adobeDataLayer = [];
      window.adobeDataLayer.addEventListener = (type, cb) => { listeners.push({ type, cb }); };
      window.adobeDataLayer.__emit = (ev) => listeners.forEach(l => l.type === 'adobeDataLayer:event' && l.cb(ev));
    });
    await injectInterceptor(page, ['adobedl']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.adobeDataLayer.__emit({ event: 'native_evt', eventInfo: { path: 'x' } });
      }),
    );

    expect(evt.category).toBe('Adobe DL');
    expect(evt.event).toBe('native_evt');
    expect(evt.data._native).toBe(true);
  });

  test('push does not double-dispatch once native listener is active', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.adobeDataLayer = [];
      window.adobeDataLayer.addEventListener = () => {}; // Manager present → native path claimed
    });
    await injectInterceptor(page, ['adobedl']);

    const count = await page.evaluate(async () => {
      let n = 0;
      window.addEventListener('__qAnalyticsEvent', () => n++);
      // Manager present means the push-proxy must stay silent to avoid duplicates
      window.adobeDataLayer.push({ event: 'no_dupe' });
      await new Promise(r => setTimeout(r, 40));
      return n;
    });

    expect(count).toBe(0);
  });

  test('disabled adobedl provider is not patched', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.adobeDataLayer = []; });
    await injectInterceptor(page, ['gtm']); // adobedl NOT enabled

    const fired = await page.evaluate(async () => {
      let n = 0;
      window.addEventListener('__qAnalyticsEvent', () => n++);
      window.adobeDataLayer.push({ event: 'should_not_fire' });
      await new Promise(r => setTimeout(r, 40));
      return n;
    });

    expect(fired).toBe(0);
  });
});

// ─── Segment / analytics ─────────────────────────────────────────────────────

test.describe('Analytics Interceptor — Segment', () => {
  test('analytics.track dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.analytics = { track: function () {}, page: function () {} };
    });
    await injectInterceptor(page, ['segment']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.analytics.track('Order Completed', { orderId: 'O-999' });
      }),
    );

    expect(evt.category).toBe('Segment');
    expect(evt.data.properties.orderId).toBe('O-999');
  });

  test('analytics.page dispatches a __qAnalyticsEvent', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => {
      window.analytics = { track: function () {}, page: function () {} };
    });
    await injectInterceptor(page, ['segment']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.analytics.page('Home', { url: 'https://example.com' });
      }),
    );

    expect(evt.category).toBe('Segment');
  });
});

// ─── Event structure ─────────────────────────────────────────────────────────

test.describe('Analytics Interceptor — event envelope', () => {
  test('dispatched event contains required envelope fields', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.dataLayer = []; });
    await injectInterceptor(page, ['gtm']);

    const evt = await page.evaluate(() =>
      new Promise((resolve) => {
        window.addEventListener('__qAnalyticsEvent', (e) => resolve(e.detail), { once: true });
        window.dataLayer.push({ event: 'envelope_check' });
      }),
    );

    expect(typeof evt.seq).toBe('number');
    expect(evt.seq).toBeGreaterThan(0);
    expect(typeof evt.timestamp).toBe('string');
    expect(typeof evt.sessionTime).toBe('number');
    expect(typeof evt.url).toBe('string');
    expect(evt.__qkitOwn).toBe(true);
  });

  test('seq increments with successive events', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.dataLayer = []; });
    await injectInterceptor(page, ['gtm']);

    const [e1, e2] = await page.evaluate(() =>
      new Promise((resolve) => {
        const captured = [];
        window.addEventListener('__qAnalyticsEvent', (e) => {
          captured.push(e.detail);
          if (captured.length === 2) resolve(captured);
        });
        window.dataLayer.push({ event: 'first' });
        window.dataLayer.push({ event: 'second' });
      }),
    );

    expect(e2.seq).toBe(e1.seq + 1);
  });

  test('disabled provider is not patched', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    await page.evaluate(() => { window.gtag = function () {}; });
    // Only gtm enabled — ga4 must NOT be patched
    await injectInterceptor(page, ['gtm']);

    const fired = await page.evaluate(async () => {
      let n = 0;
      window.addEventListener('__qAnalyticsEvent', () => n++);
      window.gtag('event', 'should_not_fire', {});
      await new Promise(r => setTimeout(r, 40));
      return n;
    });

    expect(fired).toBe(0);
  });
});
