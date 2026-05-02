// analytics-interceptor.js — QAKit v1.0.1
// Runs in MAIN world (page context) — this is critical: content.js runs in an
// isolated world where window.dataLayer / window.gtag / window.fbq / etc. are
// different objects than what the page sees. Patching them there does nothing.
// This script patches the REAL page globals.
//
// Providers intercepted:
//   - GTM / dataLayer (window.dataLayer.push, window.digitalDataLayer.push)
//   - GA4 (window.gtag)
//   - Meta Pixel (window.fbq)
//   - Adobe Analytics (window.s.tl, window.s.t, AppMeasurement)
//   - Adobe Launch / DTM (window._satellite.track)
//   - Tealium (window.utag.link, window.utag.view, window.utag.track)
//   - Floodlight / DoubleClick (fetch URLs, img/iframe src pixels)
//   - Segment (window.analytics.track, window.analytics.page)
//
// Events are dispatched to window as __qAnalyticsEvent CustomEvents; content.js
// bridges them to background.js which stores them and relays to popup.
//
// Configuration: window.__qAnalyticsProviders (array) gates which platforms to
// patch. Set before injection by background.js.

(function () {
  if (window.__qAnalyticsInstalled) return;
  window.__qAnalyticsInstalled = true;

  const providers = Array.isArray(window.__qAnalyticsProviders) && window.__qAnalyticsProviders.length
    ? window.__qAnalyticsProviders
    : ['gtm','ga4','ddl','wae','adobe','tealium','meta','floodlight','segment'];

  let _seq = 0;
  const sessionStart = Date.now();

  function dispatch(type, category, data) {
    const evt = {
      seq:         ++_seq,
      event:       type,
      type,
      category,
      timestamp:   new Date().toISOString(),
      sessionTime: Date.now() - sessionStart,
      url:         location.href,
      data:        data || {},
      __qkitOwn:   true,
    };
    try {
      window.dispatchEvent(new CustomEvent('__qAnalyticsEvent', { detail: evt }));
    } catch (_) {}
  }

  // ── dataLayer / digitalDataLayer / custom-named DLs ─────────────────────
  // Works by replacing the array's .push with a proxy. We also replay any
  // events already pushed before we arrived (common — GTM fires gtm.js early).
  function patchDataLayer(arrayName, categoryLabel) {

    // Resolve the best event name from a pushed item.
    // Checks all common DDL conventions so nothing is silently dropped:
    //   .event        — GTM / most custom DDLs
    //   .eventName    — some enterprise/QAKit DDLs
    //   .type         — some custom schemas
    //   .action       — some custom schemas
    //   .eventInfo.eventName — W3C CEDDL spec
    //   gtm.start     — GTM container init
    // Fallback: 'datalayer.push' so even schema-less pushes are visible.
    function resolveName(item) {
      if (!item || typeof item !== 'object') return null;
      if (item.event)                           return String(item.event);
      if (item['gtm.start'])                    return 'gtm.js';
      if (item.eventName)                       return String(item.eventName);
      if (item.type)                            return String(item.type);
      if (item.action)                          return String(item.action);
      if (item.eventInfo && item.eventInfo.eventName) return String(item.eventInfo.eventName);
      return 'datalayer.push'; // capture everything — never drop silently
    }

    const proxy = (origPush, source) => {
      if (origPush && origPush.__qkitProxied) return origPush;
      const wrapped = function (...args) {
        args.forEach(item => {
          if (!item || typeof item !== 'object') return;
          if (item.__qkitOwn) return; // skip our own echoes
          const name = resolveName(item);
          if (!name) return;
          // Deep-copy the raw payload so consumers see the full ecommerce / eventDetails tree
          let raw = null;
          try { raw = JSON.parse(JSON.stringify(item)); } catch (_) { raw = { _unserialisable: true }; }
          const out = { _raw: raw };
          if (item.eventDetails)     out.eventDetails     = item.eventDetails;
          if (item.ecommerce)        out.ecommerce        = item.ecommerce;
          if (item.details)          out.details          = item.details;
          if (item.data)             out.data             = item.data;
          if (item.eventInfo)        out.eventInfo        = item.eventInfo;
          if (item.component)        out.component        = item.component;
          if (item.user)             out.user             = item.user;
          if (item.page)             out.page             = item.page;
          if (item.product)          out.product          = item.product;
          if (item.transaction)      out.transaction      = item.transaction;
          dispatch(name, source || categoryLabel, out);
        });
        return origPush.apply(this, args);
      };
      wrapped.__qkitProxied = true;
      return wrapped;
    };

    const install = (dl, source) => {
      if (!Array.isArray(dl)) return;
      if (dl.push && dl.push.__qkitProxied) return;
      dl.push = proxy(dl.push.bind(dl), source);
      // Replay events already in the array before we arrived
      dl.forEach(item => {
        if (!item || typeof item !== 'object' || item.__qkitOwn) return;
        const name = resolveName(item);
        if (!name) return;
        let raw = null;
        try { raw = JSON.parse(JSON.stringify(item)); } catch (_) { raw = null; }
        const out = { _raw: raw, _replayed: true };
        if (item.eventDetails) out.eventDetails = item.eventDetails;
        if (item.ecommerce)    out.ecommerce    = item.ecommerce;
        if (item.eventInfo)    out.eventInfo    = item.eventInfo;
        if (item.page)         out.page         = item.page;
        if (item.product)      out.product      = item.product;
        if (item.transaction)  out.transaction  = item.transaction;
        dispatch(name, source || categoryLabel, out);
      });
    };

    if (Array.isArray(window[arrayName])) install(window[arrayName], categoryLabel);

    // Watch for the array being created/replaced by the page later
    let _ref = window[arrayName];
    try {
      Object.defineProperty(window, arrayName, {
        configurable: true,
        get() { return _ref; },
        set(val) {
          _ref = val;
          if (Array.isArray(val)) install(val, categoryLabel);
        },
      });
    } catch (_) {}
  }

  if (providers.includes('gtm') || providers.includes('ddl')) {
    patchDataLayer('dataLayer',        'GTM');
    patchDataLayer('digitalDataLayer', 'DDL');
    // Some sites use custom names
    patchDataLayer('_dl',              'GTM/_dl');
  }

  // ── GA4 — gtag() ─────────────────────────────────────────────────────────
  if (providers.includes('ga4')) {
    const wrapGtag = (orig) => {
      const wrapped = function (...args) {
        try {
          const [cmd, eventName, params] = args;
          if (cmd === 'event' && eventName) {
            dispatch(eventName, 'GA4', { command: cmd, params: params || {} });
          } else if (cmd === 'config') {
            dispatch('config', 'GA4', { measurementId: eventName, params: params || {} });
          }
        } catch (_) {}
        return orig && orig.apply(this, args);
      };
      wrapped.__qkitProxied = true;
      return wrapped;
    };

    if (typeof window.gtag === 'function' && !window.gtag.__qkitProxied) {
      window.gtag = wrapGtag(window.gtag);
    }
    let _gtagRef = window.gtag;
    try {
      Object.defineProperty(window, 'gtag', {
        configurable: true,
        get() { return _gtagRef; },
        set(fn) {
          _gtagRef = (typeof fn === 'function' && !fn.__qkitProxied) ? wrapGtag(fn) : fn;
        },
      });
    } catch (_) {}
  }

  // ── Meta Pixel — fbq() ───────────────────────────────────────────────────
  if (providers.includes('meta')) {
    const wrapFbq = (orig) => {
      const wrapped = function (...args) {
        try {
          const [cmd, eventName, params] = args;
          if ((cmd === 'track' || cmd === 'trackCustom' || cmd === 'trackSingle') && eventName) {
            dispatch(eventName, 'Meta Pixel', { command: cmd, params: params || {} });
          } else if (cmd === 'init') {
            dispatch('pixel.init', 'Meta Pixel', { pixelId: eventName });
          }
        } catch (_) {}
        return orig && orig.apply(this, args);
      };
      wrapped.__qkitProxied = true;
      return wrapped;
    };

    if (typeof window.fbq === 'function' && !window.fbq.__qkitProxied) {
      window.fbq = wrapFbq(window.fbq);
    }
    let _fbqRef = window.fbq;
    try {
      Object.defineProperty(window, 'fbq', {
        configurable: true,
        get() { return _fbqRef; },
        set(fn) {
          _fbqRef = (typeof fn === 'function' && !fn.__qkitProxied) ? wrapFbq(fn) : fn;
        },
      });
    } catch (_) {}
  }

  // ── Adobe Analytics ──────────────────────────────────────────────────────
  if (providers.includes('adobe')) {
    function extractAdobeVars(s) {
      const out = {};
      for (let i = 1; i <= 250; i++) { if (s['eVar'+i]) out['eVar'+i] = s['eVar'+i]; }
      for (let i = 1; i <= 75;  i++) { if (s['prop'+i]) out['prop'+i] = s['prop'+i]; }
      for (let i = 1; i <= 5;   i++) { if (s['hier'+i]) out['hier'+i] = s['hier'+i]; }
      return out;
    }
    const patchS = (s) => {
      if (!s || s.__qkitPatched) return;
      s.__qkitPatched = true;
      if (typeof s.tl === 'function') {
        const orig = s.tl.bind(s);
        s.tl = function (el, type, name, vars) {
          dispatch(name || type || 'adobe.tl', 'Adobe', {
            linkType: type, linkName: name, pageName: s.pageName, vars: vars || {}, eVars: extractAdobeVars(s),
          });
          return orig(el, type, name, vars);
        };
      }
      if (typeof s.t === 'function') {
        const orig = s.t.bind(s);
        s.t = function () {
          dispatch('adobe.pageView', 'Adobe', {
            pageName: s.pageName, channel: s.channel, eVars: extractAdobeVars(s),
          });
          return orig();
        };
      }
    };
    const tryPatch = () => { if (window.s) patchS(window.s); };
    tryPatch();
    window.addEventListener('load', tryPatch, { once: true });
    setTimeout(tryPatch, 2000);

    // AppMeasurement constructor — wrap so new instances are patched
    if (window.AppMeasurement && !window.AppMeasurement.__qkitWrapped) {
      const Orig = window.AppMeasurement;
      window.AppMeasurement = function () {
        const inst = new Orig(...arguments);
        patchS(inst);
        return inst;
      };
      window.AppMeasurement.__qkitWrapped = true;
    }

    // Adobe Launch / DTM — _satellite.track
    const patchSatellite = () => {
      if (!window._satellite || window._satellite.__qkitPatched) return;
      window._satellite.__qkitPatched = true;
      const orig = window._satellite.track && window._satellite.track.bind(window._satellite);
      if (orig) {
        window._satellite.track = function (id, data) {
          dispatch('satellite_track', 'Adobe', { id, data: data || {} });
          return orig(id, data);
        };
      }
    };
    patchSatellite();
    window.addEventListener('load', patchSatellite, { once: true });
    setTimeout(patchSatellite, 1500);
  }

  // ── Tealium ──────────────────────────────────────────────────────────────
  if (providers.includes('tealium')) {
    const patchUtag = () => {
      if (!window.utag || window.utag.__qkitPatched) return;
      window.utag.__qkitPatched = true;
      ['link','view','track'].forEach(method => {
        if (typeof window.utag[method] !== 'function') return;
        const orig = window.utag[method].bind(window.utag);
        window.utag[method] = function (data, cb, uids) {
          try {
            dispatch(
              (data && data.tealium_event) || ('utag.' + method),
              'Tealium',
              { method, data: data || {}, account: window.utag.cfg && window.utag.cfg.account }
            );
          } catch (_) {}
          return orig(data, cb, uids);
        };
      });
    };
    patchUtag();
    window.addEventListener('load', patchUtag, { once: true });
    setTimeout(patchUtag, 2000);
  }

  // ── Floodlight / DoubleClick ─────────────────────────────────────────────
  if (providers.includes('floodlight')) {
    // Patch fetch to catch DC network calls
    const origFetch = window.fetch;
    if (origFetch && !origFetch.__qkitProxied) {
      const wrapped = function (input, init) {
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (/fls\.doubleclick\.net|dc\.doubleclick\.net|ad\.doubleclick\.net/.test(url)) {
            dispatch('floodlight_request', 'Floodlight', {
              url: url.split('?')[0],
              params: Object.fromEntries(
                new URL(url.startsWith('http') ? url : 'https:' + url).searchParams
              ),
            });
          }
        } catch (_) {}
        return origFetch.apply(this, arguments);
      };
      wrapped.__qkitProxied = true;
      window.fetch = wrapped;
    }

    // Watch img/iframe insertions for pixel tags
    const startObserver = () => {
      if (!document.body && !document.documentElement) return;
      const root = document.body || document.documentElement;
      const observer = new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes && m.addedNodes.forEach(node => {
          if (!node || (node.tagName !== 'IMG' && node.tagName !== 'IFRAME')) return;
          const src = node.src || '';
          if (/fls\.doubleclick\.net|dc\.doubleclick\.net/.test(src)) {
            try { dispatch('floodlight_pixel', 'Floodlight', { src: src.split('?')[0] }); } catch (_) {}
          }
        }));
      });
      observer.observe(root, { childList: true, subtree: true });
    };
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  // ── Segment ──────────────────────────────────────────────────────────────
  if (providers.includes('segment')) {
    const patchSegment = () => {
      if (!window.analytics || window.analytics.__qkitPatched) return;
      const a = window.analytics;
      if (typeof a.track !== 'function') return;
      a.__qkitPatched = true;
      const origTrack = a.track.bind(a);
      a.track = function (event, props) {
        dispatch(event, 'Segment', { properties: props || {} });
        return origTrack(event, props);
      };
      if (typeof a.page === 'function') {
        const origPage = a.page.bind(a);
        a.page = function (name, props) {
          dispatch('page.' + (name || 'view'), 'Segment', { properties: props || {} });
          return origPage(name, props);
        };
      }
    };
    patchSegment();
    window.addEventListener('load', patchSegment, { once: true });
    setTimeout(patchSegment, 2000);
  }

})();
