// content.js — QAKit Analytics Recorder + localStorage bridge
(() => {
  // Skip browser-internal pages
  if (!location.href.startsWith('http')) return;

  // Prevent double-injection
  if (window.__qkitRecorderActive) return;
  window.__qkitRecorderActive = true;

  // ── Runtime domain filtering ────────────────────────────────────────────
  // content.js is now injected on <all_urls> but respects the user's
  // domain filter setting. We read the setting once at boot; if the current
  // URL doesn't match we skip analytics recording (but still handle LS/cookie
  // messages which are always needed by the popup).
  let _recordingAllowed = true; // default true; overridden below

  function _domainAllowed(url, rawSetting) {
    if (!rawSetting || rawSetting.trim() === '*' || rawSetting.trim() === '') return true;
    try {
      const hostname = new URL(url).hostname;
      return rawSetting.split(',').map(s => s.trim()).filter(Boolean).some(pat => {
        const rx = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return rx.test(hostname);
      });
    } catch { return false; }
  }

  // Check domain setting async — uses chrome.storage so we don't block
  chrome.storage.local.get('qa_tools_settings', (stored) => {
    const domains = stored?.qa_tools_settings?.domains ?? '*';
    _recordingAllowed = _domainAllowed(location.href, domains);
    if (_recordingAllowed) window._qRec?.start();
  });

  // ── Console error bridge — listens for events dispatched by console-shim.js ──
  // console-shim.js is injected into MAIN world by background.js on every page load.
  // It wraps console.error in the page context and dispatches CustomEvents.
  // This isolated-world content script listens and forwards to background.
  // Pure event-driven — no polling, no flicker.
  window.addEventListener('__qConsoleError', (e) => {
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          action: 'CONSOLE_ERROR',
          payload: {
            seq:       Date.now(),
            event:     'console_error',
            type:      e.detail.type,
            timestamp: e.detail.timestamp,
            url:       e.detail.url,
            data: {
              message:   e.detail.message,
              path:      e.detail.path,
              sourceUrl: e.detail.sourceUrl,
            }
          }
        }).catch(() => {});
      }
    } catch (_) {}
  });

  // ── digitalDataLayer bootstrap ──────────────────────────────────────────
  window.digitalDataLayer = window.digitalDataLayer || [];

  // ── Recorder ────────────────────────────────────────────────────────────
  class AnalyticsRecorder {
    constructor() {
      this.running = false;
      this.paused = false;
      this.sessionStart = Date.now();
      this._seq = 0;
      this._listeners = [];
    }

    _record(type, category, data) {
      if (!this.running || this.paused) return;
      const evt = {
        seq:         ++this._seq,
        event:       type,
        type,
        category,
        timestamp:   new Date().toISOString(),
        sessionTime: Date.now() - this.sessionStart,
        url:         location.href,
        data,
        __qkitOwn:   true,  // MUST be set before pushing to avoid proxy infinite loop
      };
      // Use the original Array.prototype.push to bypass our proxy entirely
      Array.prototype.push.call(window.digitalDataLayer, evt);
      this._listeners.forEach(fn => fn(evt));

      // Forward to extension background
      // Guard against "Extension context invalidated" when extension is reloaded
      try {
        if (chrome.runtime?.id) {
          chrome.runtime.sendMessage({ action: 'EVENT', payload: evt }).catch(() => {});
        }
      } catch (e) {
        // Context invalidated — stop recording silently
        this.running = false;
      }
    }

    onEvent(fn) { this._listeners.push(fn); }

    // Dead analytics interceptors moved to analytics-interceptor.js (MAIN world).

    // ── Extract data-wae-* attributes from an element ───────────────────
    _extractWae(el) {
      // Walk up the DOM tree — the data-wae-event may be on a parent element
      const target = el.closest('[data-wae-event]') || el;
      const wae = {};
      for (const attr of target.attributes) {
        if (attr.name.startsWith('data-wae-')) {
          // Convert data-wae-current-culture → currentCulture (camelCase)
          const key = attr.name
            .replace('data-wae-', '')
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          wae[key] = attr.value;
        }
      }
      return Object.keys(wae).length ? wae : null;
    }

    // ── Handlers ────────────────────────────────────────────────────────
    _onClick = (e) => {
      const el     = e.target;
      const anchor = el.closest('a') || (el.tagName === 'A' ? el : null);
      const wae    = this._extractWae(el);

      // Compute link_text and link_url from the event data
      const link_text = (el.textContent || el.innerText || '').trim().slice(0, 120) || null;
      const link_url  = anchor?.href || el.href || null;

      // Use data-wae-event as the event name when available
      const eventName = wae?.event || 'click';

      this._record(eventName, 'click', {
        // ── WAE analytics attributes ─────────────────────────────────────
        ...(wae ? { wae } : {}),
        // ── Details-style fields (mirrors dataLayerPush shape) ────
        details: {
          link_text,
          link_url,
          ...(wae?.currentCulture  ? { current_culture: wae.currentCulture }  : {}),
          ...(wae?.targetCulture   ? { target_culture:  wae.targetCulture  }  : {}),
        },
        // ── Element context ──────────────────────────────────────────────
        tag:   el.tagName,
        id:    el.id || null,
        class: (el.className && typeof el.className === 'string')
                 ? el.className.split(' ').filter(Boolean).slice(0, 3).join(' ')
                 : null,
      });
    };

    _onKeydown = (e) => {
      // Skip bare modifier keys
      if (['Control','Shift','Alt','Meta'].includes(e.key)) return;
      this._record('keydown', 'keyboard', {
        key:   e.key,
        code:  e.code,
        ctrl:  e.ctrlKey,
        shift: e.shiftKey,
        alt:   e.altKey,
        meta:  e.metaKey,
      });
    };

    _onPopstate = () => {
      this._record('popstate', 'navigation', { url: location.href });
    };

    _onError = (e) => {
      this._record('error', 'error', {
        message: e.message,
        source:  e.filename,
        line:    e.lineno,
        col:     e.colno,
      });
    };

    _onUnhandledRejection = (e) => {
      this._record('unhandledrejection', 'error', { reason: String(e.reason).slice(0, 200) });
    };

    _onVisibility = () => {
      this._record('visibilitychange', 'visibility', { state: document.visibilityState });
    };

    _onScroll = (() => {
      let t;
      return () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const maxScroll = (document.body?.scrollHeight ?? 0) - innerHeight;
          this._record('scroll', 'scroll', {
            scrollY: Math.round(scrollY),
            depth:   maxScroll > 0 ? Math.round((scrollY / maxScroll) * 100) + '%' : '0%',
          });
        }, 400);
      };
    })();

    _patchHistory() {
      ['pushState', 'replaceState'].forEach(method => {
        const orig = history[method];
        history[method] = (...args) => {
          orig.apply(history, args);
          this._record(method, 'navigation', { url: location.href, title: document.title });
        };
      });
    }

    // ── Public API ──────────────────────────────────────────────────────
    start() {
      if (this.running) return;
      this.running = true;
      this._patchHistory();
      // NOTE: dataLayer / gtag / fbq / s.tl / utag / _satellite patching has
      // been moved to analytics-interceptor.js (MAIN world). Patching from the
      // isolated content-script world does nothing because `window` here is a
      // different global than the page sees. The interceptor dispatches
      // __qAnalyticsEvent which we bridge to background via the EVENT action
      // (see the bridge listener at the bottom of this file).
      document.addEventListener('click',            this._onClick,      true);
      document.addEventListener('keydown',          this._onKeydown,    true);
      window.addEventListener('popstate',           this._onPopstate);
      window.addEventListener('error',              this._onError);
      window.addEventListener('unhandledrejection', this._onUnhandledRejection);
      document.addEventListener('visibilitychange', this._onVisibility);
      window.addEventListener('scroll',             this._onScroll, { passive: true });

      this._record('session_start', 'lifecycle', {
        userAgent: navigator.userAgent,
        language:  navigator.language,
        viewport:  `${innerWidth}x${innerHeight}`,
        referrer:  document.referrer || null,
      });
    }

    pause() {
      this.paused = true;
      try { if (chrome.runtime?.id) chrome.runtime.sendMessage({ action: 'STATUS', paused: true  }).catch(() => {}); } catch(e) {}
    }
    resume() {
      this.paused = false;
      try { if (chrome.runtime?.id) chrome.runtime.sendMessage({ action: 'STATUS', paused: false }).catch(() => {}); } catch(e) {}
    }
    stop()   { this.running = false; }

    track(name, data = {}) { this._record(name, 'custom', data); }
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  window._qRec = new AnalyticsRecorder();
  // NOTE: actual start() is triggered by _domainAllowed check above.
  // On domains that match, the storage callback calls window._qRec.start().

  // ── Listen for popup commands ────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'PAUSE')  window._qRec.pause();
    if (msg.action === 'RESUME') window._qRec.resume();
    if (msg.action === 'CLEAR')  { window.digitalDataLayer.length = 0; window._qRec._seq = 0; }
    if (msg.action === 'PING')   return true;

    // ── Scan all localStorage keys ────────────────────────────────────────
    if (msg.action === 'SCAN_LS_URLS') {
      const targetKeys = msg.targetKeys || [];
      const found = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        // If targetKeys specified, only include those; otherwise include all
        if (targetKeys.length === 0 || targetKeys.includes(k)) {
          let parsed = null;
          try { parsed = JSON.parse(v); } catch { parsed = v; }
          found[k] = { raw: v, parsed, found: true };
        }
      }
      // Always include all target keys (even absent ones)
      targetKeys.forEach(k => {
        if (!found[k]) found[k] = { raw: null, parsed: null, found: false };
      });
      sendResponse({ ls: found, currentUrl: location.href });
      return true;
    }

    // ── Load (re-read) specific keys ────────────────────────────────────
    if (msg.action === 'GET_LS') {
      const keys = msg.keys || ['dismissed_alerts', 'redirectPopupSelection', 'qff_soft_identity', 'recentAirports'];
      const result = {};
      keys.forEach(key => {
        const raw = localStorage.getItem(key);
        let parsed = null;
        try { parsed = raw !== null ? JSON.parse(raw) : null; } catch { parsed = raw; }
        result[key] = { raw, found: raw !== null, parsed };
      });
      sendResponse({ ls: result });
      return true;
    }

    // ── Write / edit a key ───────────────────────────────────────────────
    if (msg.action === 'SET_LS') {
      try {
        localStorage.setItem(msg.key, msg.value);
        const raw = localStorage.getItem(msg.key);
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        sendResponse({ ok: true, raw, parsed });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    // ── Delete a key ─────────────────────────────────────────────────────
    if (msg.action === 'DELETE_LS') {
      try {
        localStorage.removeItem(msg.key);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }
  }); // end chrome.runtime.onMessage.addListener

  // ── CustomEvent bridges: MAIN world → isolated world → background ──────────
  // pagescripts.js (MAIN world) cannot reliably use chrome.runtime callbacks,
  // so it dispatches CustomEvents on window. This isolated-world content script
  // catches them and forwards to background via chrome.runtime.sendMessage.

  // Bridge 1: Annotation 📸 button — capture visible tab and deliver to popup.
  // FIX: Hide annotation toolbar + indicator bar (and any other QAKit
  // overlays) before capture, then restore after. Without this the toolbar
  // is visible in every screenshot because it's position:fixed.
  window.addEventListener('__qkitCaptureAnnotated', () => {
    try {
      if (!chrome.runtime?.id) return;
      const ids = ['__qkit-annot-toolbar', '__qkit-annot-indicator',
                   '__qkit-region-overlay', '__qkit-ruler-overlay',
                   '__qkit-element-picker-overlay'];
      const hidden = [];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          hidden.push({ el, prev: el.style.visibility });
          el.style.visibility = 'hidden';
        }
      });
      // Force reflow so visibility change paints before capture
      void document.body.offsetWidth;
      // Small delay for the paint to commit before the background captures
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_FOR_CROP' }, res => {
          // Restore toolbar immediately — before error handling, so user never
          // sees the page without it
          hidden.forEach(({ el, prev }) => { el.style.visibility = prev || ''; });
          if (chrome.runtime.lastError) return;
          if (res?.dataUrl) {
            chrome.runtime.sendMessage({ action: 'DELIVER_ANNOTATED_SCREENSHOT', dataUrl: res.dataUrl }).catch(() => {});
          }
        });
      }, 80);
    } catch(_) {}
  });

  // Bridge 2: Region capture selection — forward rect to background
  window.addEventListener('__qkitRegionSelected', (e) => {
    try {
      if (!chrome.runtime?.id) {
        // Extension context was invalidated (e.g. extension reloaded without page refresh).
        // Show an inline notice so the user knows to refresh the page.
        const msg = document.createElement('div');
        msg.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#b91c1c;color:#fff;font:600 13px/-apple-system,sans-serif;padding:10px 20px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.5)';
        msg.textContent = '⚠ QAKit: please refresh this page to take screenshots';
        document.body?.appendChild(msg);
        setTimeout(() => msg.remove(), 5000);
        return;
      }
      chrome.runtime.sendMessage({ action: 'REGION_SELECTED', rect: e.detail }).catch(() => {});
    } catch(_) {}
  });

  // Bridge 3: Responsive viewport — open URL in a popup window
  // Guard: prevent duplicate fires within 500ms (debounce)
  let _lastViewportOpen = 0;
  window.addEventListener('__qkitOpenViewport', (e) => {
    const now = Date.now();
    if (now - _lastViewportOpen < 500) return; // deduplicate rapid fires
    _lastViewportOpen = now;
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ action: 'RELAY_OPEN_VIEWPORT_WINDOW', ...e.detail }).catch(() => {});
    } catch(_) {}
  });

  // Bridge 4: Network mock intercept — MAIN world dispatches on mock hit.
  // Forward to background which broadcasts NET_INTERCEPTED to popup.
  window.addEventListener('__qNetIntercepted', (e) => {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ action: 'NET_INTERCEPTED', entry: e.detail }).catch(() => {});
    } catch(_) {}
  });

  // Bridge 5: Element capture selection — pagescripts.js fires on click.
  // Forward the rect to background which crops the pre-captured screenshot.
  window.addEventListener('__qkitElementSelected', (e) => {
    try {
      if (!chrome.runtime?.id) return;
      chrome.runtime.sendMessage({ action: 'ELEMENT_SELECTED', rect: e.detail }).catch(() => {});
    } catch(_) {}
  });

  // Bridge 6: Analytics events from the MAIN-world interceptor.
  // analytics-interceptor.js patches window.dataLayer / gtag / fbq / etc. and
  // dispatches __qAnalyticsEvent on the page window. We bridge to background
  // via the standard EVENT action so storage + popup relay behaves identically
  // to clicks and other DOM-captured events.
  window.addEventListener('__qAnalyticsEvent', (e) => {
    try {
      if (!chrome.runtime?.id) return;
      const ev = e.detail || {};
      chrome.runtime.sendMessage({ action: 'EVENT', payload: ev }).catch(() => {});
    } catch(_) {}
  });

  // Bridge 7: Screenshot "Edit" button — MAIN-world toast dispatches this
  // CustomEvent because it has no direct chrome API access. Forward to
  // background which downloads silently and opens in the default image editor.
  window.addEventListener('__qkitEditScreenshot', (e) => {
    try {
      if (!chrome.runtime?.id) return;
      const { dataUrl, prefix, id } = e.detail || {};
      if (id) {
        // Fast path: background pre-stored the image by ID — send only the ID.
        chrome.runtime.sendMessage({ action: 'OPEN_IN_EDITOR', id }).catch(() => {});
      } else if (dataUrl) {
        chrome.runtime.sendMessage({ action: 'OPEN_IN_EDITOR', dataUrl, prefix }).catch(() => {});
      }
    } catch(_) {}
  });

  // Bridge 8: Screenshot "Save" button — forwards to background which uses
  // chrome.downloads.download({ saveAs: true }) so the OS "Save As" dialog
  // always appears, independent of Chrome's global download preference.
  // If the downloads permission is not yet granted, background opens the
  // welcome page directly so the user can enable it.
  window.addEventListener('__qkitSaveScreenshot', (e) => {
    try {
      if (!chrome.runtime?.id) return;
      const { dataUrl, prefix } = e.detail || {};
      chrome.runtime.sendMessage({ action: 'SAVE_SCREENSHOT', dataUrl, prefix }, (resp) => {
        if (resp?.needsPermission) {
          chrome.runtime.sendMessage({ action: 'OPEN_WELCOME_PAGE' }).catch(() => {});
        }
      });
    } catch(_) {}
  });

})();
