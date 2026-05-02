// Background service worker — QAKit
// Persists events to chrome.storage.local so they survive page loads/navigation

const state = {
  events: [],
  paused: false,
  maxEvents: 3000,
  consoleErrorCount: 0,
  pendingRegionTabId: null,
  storedRegionScreenshot: null,
  _lastViewportOpen: 0,
};

// ── Per-category event caps ────────────────────────────────────────────────
// High-frequency categories are capped low so they don't crowd out signal.
// All other categories default to DEFAULT_CAT_CAP.
const CATEGORY_CAPS = {
  scroll:   20,
  keyboard: 20,
};
const DEFAULT_CAT_CAP = 200;

// Remove the oldest event of `category` if its count now exceeds the cap.
// Called immediately after pushing a new event, so we're at most 1 over.
function enforceCategoryCap(events, category) {
  const cap = CATEGORY_CAPS[category] ?? DEFAULT_CAT_CAP;
  let count = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i].category === category) count++;
  }
  if (count <= cap) return;
  for (let i = 0; i < events.length; i++) {
    if (events[i].category === category) {
      events.splice(i, 1);
      break;
    }
  }
}

// ── Restore persisted events on service worker startup ─────────────────────
async function restoreFromStorage() {
  try {
    const stored = await chrome.storage.local.get(['events', 'paused']);
    if (Array.isArray(stored.events)) {
      state.events = stored.events;
    }
    if (typeof stored.paused === 'boolean') {
      state.paused = stored.paused;
    }
  } catch (e) {
    console.warn('Failed to restore events from storage:', e.message);
  }
}

// ── Persist current state to storage ──────────────────────────────────────
// Debounced so that bursts of events (GTM-heavy pages fire 50+ events/sec)
// don't trigger one storage.local.set per event.
let _persistTimer = null;
function persistToStorage() {
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(async () => {
    try {
      await chrome.storage.local.set({
        events: state.events,
        paused: state.paused,
      });
    } catch (e) {
      console.warn('Failed to persist events to storage:', e.message);
    }
  }, 400);
}

// ── Idempotent init — consolidates handlers that previously fired twice ───
let _initDone = false;
async function initBackground() {
  if (_initDone) return;
  _initDone = true;
  await restoreFromStorage();
  await restoreHeaderRules();
  setupContextMenus();
}

// ── Extension icon management ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => { initBackground(); });
chrome.runtime.onStartup.addListener(()   => { initBackground(); });

// ── Shared helper: inject pagescripts and execute a function in MAIN world ───
async function injectAndExecOnTab(tabId, func, args) {
  try {
    const check = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => window.__qkitPageScriptsInstalled === true,
    });
    if (!check?.[0]?.result) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN', files: ['pagescripts.js'],
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func, args: args || [],
    });
  } catch(e) { console.warn('[QAKit] injectAndExecOnTab error:', e.message); }
}

// ── Context menus ─────────────────────────────────────────────────────────────
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'qakit-root',          title: 'QAKit',                    contexts: ['all'] });

    // ── Core QA actions ─────────────────────────────────────────────────────
    chrome.contextMenus.create({ id: 'qakit-inspect',       title: '🔍 Inspect Element',        contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-spacing',       title: '📐 Spacing Inspector',      contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-region',        title: '⬚ Region Screenshot',       contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-fullpage',      title: '📄 Full Page Screenshot',   contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-element-shot',  title: '🖼 Capture Element',   contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'sep1',                type:  'separator',                 contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-audit',         title: '📋 Run Page Audit',         contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-annotate',      title: '✏ Annotate Page',           contexts: ['all'], parentId: 'qakit-root' });

    // ── Copy ────────────────────────────────────────────────────────────────
    chrome.contextMenus.create({ id: 'sep2',                type:  'separator',                 contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-copy-testid',   title: '⎘ Copy Best Test Locator',  contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-copy-selector', title: '⎘ Copy CSS Selector',       contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-copy-xpath',    title: '⎘ Copy XPath',              contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-copy-html',     title: '⎘ Copy Outer HTML',         contexts: ['all'], parentId: 'qakit-root' });

    // ── Utilities ───────────────────────────────────────────────────────────
    chrome.contextMenus.create({ id: 'sep3',                type:  'separator',                 contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-jsondiff',      title: '{ } Open JSON Viewer',    contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-textcompare',   title: '⇄ Open Text Compare',     contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-clear-cookies', title: '🍪 Clear Site Cookies',     contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-hard-reload',   title: '🔄 Hard Reload (bypass cache)', contexts: ['all'], parentId: 'qakit-root' });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // JSON Viewer + Text Compare — work regardless of current page (no injection)
  if (info.menuItemId === 'qakit-jsondiff') {
    chrome.tabs.create({ url: chrome.runtime.getURL('json-diff-tool.html') });
    return;
  }
  if (info.menuItemId === 'qakit-textcompare') {
    chrome.tabs.create({ url: chrome.runtime.getURL('text-compare.html') });
    return;
  }
  if (!tab?.id || tab.url?.startsWith('chrome://')) return;
  await ensureAllInjected(tab.id);

  switch (info.menuItemId) {
    case 'qakit-inspect':
      await injectAndExecOnTab(tab.id, () => {
        // Toggle — if already active in inspect mode, turn off
        if (window.__qInspectorActive && window.__qInspectorMode === 'inspect') {
          window.__qInspectorActive = false;
          document.documentElement.style.cursor = '';
          if (typeof window.__qHideAll === 'function') window.__qHideAll();
          return;
        }
        // Activate inspect mode
        window.__qInspectorMode   = 'inspect';
        window.__qInspectorActive = true;
        document.documentElement.style.cursor = 'crosshair';
        if (typeof window.__qHideAll === 'function') window.__qHideAll();
      });
      break;

    case 'qakit-spacing':
      await injectAndExecOnTab(tab.id, () => {
        if (window.__qInspectorActive && window.__qInspectorMode === 'spacing') {
          window.__qInspectorActive = false;
          document.documentElement.style.cursor = '';
          if (typeof window.__qHideAll === 'function') window.__qHideAll();
          return;
        }
        window.__qInspectorMode   = 'spacing';
        window.__qInspectorActive = true;
        document.documentElement.style.cursor = 'crosshair';
        if (typeof window.__qHideAll === 'function') window.__qHideAll();
      });
      break;

    case 'qakit-region':
      chrome.tabs.get(tab.id, (tabInfo) => {
        if (chrome.runtime.lastError || !tabInfo) return;
        chrome.tabs.update(tab.id, { active: true }, () => {
          chrome.windows.update(tabInfo.windowId, { focused: true }, () => {
            setTimeout(() => {
              chrome.tabs.captureVisibleTab(tabInfo.windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) return;
                state.storedRegionScreenshot = dataUrl;
                state.pendingRegionTabId = tab.id;
                injectAndExecOnTab(tab.id, () => { window.__qkitStartRegionCapture?.(); });
              });
            }, 200);
          });
        });
      });
      break;

    case 'qakit-fullpage':
      captureFullPage(tab.id)
        .then(result => processFullPageCapture(tab.id, result))
        .catch(e => console.warn('[QAKit] context menu full-page failed:', e.message));
      break;

    case 'qakit-audit':
      // Handoff pattern: write intent to storage, then open popup. Popup reads
      // qakit_pending_action on init, executes, then clears the flag.
      chrome.storage.local.set({
        qakit_pending_action: 'run-audit',
        qakit_pending_tab_id: tab.id,
        qakit_pending_ts:     Date.now(),
      }).then(() => chrome.action.openPopup().catch(() => {}));
      break;

    case 'qakit-annotate':
      await injectAndExecOnTab(tab.id, () => {
        // __qkitAnnotationActive and __qkitCloseAnnotation are defined in pagescripts.js
        if (typeof window.__qkitAnnotationActive === 'function' && window.__qkitAnnotationActive()) {
          window.__qkitCloseAnnotation?.();
        } else {
          window.__qkitStartAnnotation?.();
        }
      });
      break;

    case 'qakit-copy-selector':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: info.frameId !== undefined ? [info.frameId] : undefined }, world: 'MAIN',
        func: () => {
          // Prefer the target captured by our contextmenu listener — it's the
          // actual right-clicked element. Fallback to activeElement only if
          // the listener somehow hasn't fired (shouldn't happen in practice).
          const el = window.__qkitLastContextTarget || document.activeElement;
          if (!el || !el.tagName) return;
          const parts = [];
          let curr = el;
          while (curr && curr !== document.documentElement) {
            let sel = curr.tagName.toLowerCase();
            if (curr.id) { sel = '#' + curr.id; parts.unshift(sel); break; }
            const siblings = [...(curr.parentElement?.children || [])].filter(c => c.tagName === curr.tagName);
            if (siblings.length > 1) sel += ':nth-of-type(' + (siblings.indexOf(curr) + 1) + ')';
            parts.unshift(sel);
            curr = curr.parentElement;
          }
          const selector = parts.join(' > ');
          navigator.clipboard.writeText(selector).then(() => {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0a6e51;color:#fff;padding:8px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;font-weight:600;max-width:360px;word-break:break-all';
            t.textContent = '⎘ ' + (selector.length > 60 ? selector.slice(0, 60) + '…' : selector);
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 2500);
          }).catch(() => {});
        },
      }).catch(() => {});
      break;

    case 'qakit-copy-xpath':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: info.frameId !== undefined ? [info.frameId] : undefined }, world: 'MAIN',
        func: () => {
          const el = window.__qkitLastContextTarget || document.activeElement;
          if (!el || !el.tagName) return;
          const parts = [];
          let curr = el;
          while (curr && curr.nodeType === 1) {
            let tag = curr.tagName.toLowerCase();
            const siblings = [...(curr.parentElement?.children || [])].filter(c => c.tagName === curr.tagName);
            if (siblings.length > 1) tag += '[' + (siblings.indexOf(curr) + 1) + ']';
            parts.unshift(tag);
            curr = curr.parentElement;
          }
          const xpath = '/' + parts.join('/');
          navigator.clipboard.writeText(xpath).then(() => {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0a6e51;color:#fff;padding:8px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;font-weight:600;max-width:360px;word-break:break-all';
            t.textContent = '⎘ ' + (xpath.length > 60 ? xpath.slice(0, 60) + '…' : xpath);
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 2500);
          }).catch(() => {});
        },
      }).catch(() => {});
      break;

    case 'qakit-copy-testid': {
      // Read user's custom test-id attr(s) from settings, then walk up from
      // the right-clicked element looking for the best available test locator.
      // Falls back to id → aria-label → name → role → CSS when none found.
      let customAttrs = '';
      try {
        const s = await chrome.storage.local.get('qa_tools_settings');
        customAttrs = s.qa_tools_settings?.testIdAttr || '';
      } catch (_) {}
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: info.frameId !== undefined ? [info.frameId] : undefined }, world: 'MAIN',
        func: (customAttrsStr) => {
          const DEFAULTS = ['data-testid','data-qa','data-test','data-cy','data-automation-id','data-test-id'];
          const custom = (customAttrsStr || '').split(',').map(s => s.trim()).filter(Boolean);
          const attrs = [...custom];
          DEFAULTS.forEach(a => { if (!attrs.includes(a)) attrs.push(a); });

          const startEl = window.__qkitLastContextTarget || document.activeElement;
          if (!startEl || !startEl.tagName) return;

          // Walk up to find first ancestor with any of the test attrs
          let locator = null;
          let node = startEl;
          for (let i = 0; i < 30 && node && node.tagName && node !== document.documentElement; i++) {
            for (const a of attrs) {
              if (node.hasAttribute(a)) {
                locator = {
                  attr: a,
                  value: node.getAttribute(a),
                  fromAncestor: node !== startEl,
                  ancestorTag: node !== startEl ? (node.tagName.toLowerCase() +
                    (node.id ? '#' + node.id : '') +
                    (node.classList.length ? '.' + node.classList[0] : '')) : null,
                };
                break;
              }
            }
            if (locator) break;
            node = node.parentElement;
          }

          let copy, label;
          if (locator) {
            copy  = '[' + locator.attr + '="' + locator.value + '"]';
            label = '⎘ ' + locator.attr + (locator.fromAncestor ? ' (↑ ' + locator.ancestorTag + ')' : '');
          } else {
            // Graceful fallback chain
            const el = startEl;
            if (el.id)                      { copy = '#' + el.id;                                 label = '⎘ id (no test attr found)'; }
            else if (el.getAttribute('aria-label')) { copy = '[aria-label="' + el.getAttribute('aria-label') + '"]'; label = '⎘ aria-label (no test attr)'; }
            else if (el.getAttribute('name'))       { copy = '[name="' + el.getAttribute('name') + '"]';     label = '⎘ name (no test attr)'; }
            else if (el.getAttribute('role'))       { copy = '[role="' + el.getAttribute('role') + '"]';     label = '⎘ role (no test attr)'; }
            else {
              const cls = Array.from(el.classList).slice(0, 2).join('.');
              copy = el.tagName.toLowerCase() + (cls ? '.' + cls : '');
              label = '⎘ CSS (no test attr found)';
            }
          }

          navigator.clipboard.writeText(copy).then(() => {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0a6e51;color:#fff;padding:8px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;font-weight:600;max-width:360px;word-break:break-all';
            t.textContent = label + '  →  ' + (copy.length > 80 ? copy.slice(0, 80) + '…' : copy);
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 2500);
          }).catch(() => {});
        },
        args: [customAttrs],
      }).catch(() => {});
      break;
    }

    case 'qakit-copy-html':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: info.frameId !== undefined ? [info.frameId] : undefined }, world: 'MAIN',
        func: () => {
          const el = window.__qkitLastContextTarget || document.activeElement;
          if (!el || !el.outerHTML) return;
          navigator.clipboard.writeText(el.outerHTML).then(() => {
            const bytes = new Blob([el.outerHTML]).size;
            const human = bytes < 1024 ? bytes + 'B' : (bytes / 1024).toFixed(1) + 'KB';
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0a6e51;color:#fff;padding:8px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;font-weight:600';
            t.textContent = '⎘ ' + (el.tagName.toLowerCase()) + ' outer HTML (' + human + ')';
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 2000);
          }).catch(() => {});
        },
      }).catch(() => {});
      break;

    case 'qakit-element-shot':
      // Element capture needs the same pre-capture pattern as region capture:
      // grab the visible tab PNG now (while we still have activeTab grant from
      // the right-click), stash it in state, then launch the element picker.
      // When the user clicks an element, pagescripts.js dispatches
      // __qkitElementSelected → content.js → ELEMENT_SELECTED message here,
      // which crops the stored PNG to the picked rect and injects a save toast.
      chrome.tabs.get(tab.id, (tabInfo) => {
        if (chrome.runtime.lastError || !tabInfo) return;
        chrome.tabs.update(tab.id, { active: true }, () => {
          chrome.windows.update(tabInfo.windowId, { focused: true }, () => {
            setTimeout(() => {
              chrome.tabs.captureVisibleTab(tabInfo.windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) {
                  console.warn('[QAKit] element capture: pre-capture failed:', chrome.runtime.lastError?.message);
                  return;
                }
                state.storedRegionScreenshot = dataUrl;
                state.pendingRegionTabId     = tab.id;
                // Launch the picker (no callback → it dispatches CustomEvent on click)
                injectAndExecOnTab(tab.id, () => { window.__qkitStartElementCapture?.(); });
              });
            }, 200);
          });
        });
      });
      break;

    case 'qakit-clear-cookies': {
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;
        const cookies = await chrome.cookies.getAll({ domain });
        let removed = 0;
        for (const c of cookies) {
          try {
            await chrome.cookies.remove({
              url: (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path,
              name: c.name,
              storeId: c.storeId,
            });
            removed++;
          } catch (_) {}
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: (n, host) => {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0a6e51;color:#fff;padding:8px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;font-weight:600';
            t.textContent = '🍪 Cleared ' + n + ' cookies for ' + host;
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 2500);
          },
          args: [removed, domain],
        }).catch(() => {});
      } catch (e) {
        console.warn('[QAKit] clear cookies failed:', e.message);
      }
      break;
    }

    case 'qakit-hard-reload':
      // bypassCache forces a full refresh skipping the HTTP cache.
      chrome.tabs.reload(tab.id, { bypassCache: true }).catch(() => {});
      break;
  }
});

// ── Kick init on every service worker wake ─────────────────────────────────
// onInstalled fires once per install/update; onStartup only on browser start.
// SWs also wake for events outside those two, so we need a module-load kick too.
// initBackground is idempotent so calling it three ways is safe.
initBackground();

// ── Toolbar icon ────────────────────────────────────────────────────────
// We rely on the manifest's default_icon (16/48/128 PNGs in icons/).
// Earlier versions replaced it at runtime with the active tab's favicon,
// which hijacked the QAKit brand, used the chrome.action.setIcon API
// incorrectly (one size per call instead of all sizes at once), and
// could leave the icon blank on partial failures. Removed in v1.0.0.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'EVENT') {
    const evt = { ...msg.payload, tabId: sender.tab?.id };
    state.events.push(evt);
    if (evt.category) enforceCategoryCap(state.events, evt.category);
    if (state.events.length > state.maxEvents) state.events.shift();

    // Persist after every new event
    persistToStorage();

    // Badge is reserved for console errors only (not event count)

    // Notify popup if open
    chrome.runtime.sendMessage({ action: 'NEW_EVENT', event: evt, total: state.events.length }).catch(() => {});
  }

  if (msg.action === 'STATUS') {
    state.paused = msg.paused;
    persistToStorage();
  }

  if (msg.action === 'GET_EVENTS') {
    sendResponse({ events: state.events, paused: state.paused });
    return true;
  }

  if (msg.action === 'CLEAR_ALL') {
    state.events = [];
    chrome.storage.local.remove(['events', 'paused']);
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === 'INJECT_SPELL') {
    injectSpellBundle(sender.tab?.id || msg.tabId).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Re-inject analytics interceptor on current tab (called from Settings save)
  if (msg.action === 'REFRESH_ENV_MARKERS') {
    refreshAllEnvMarkers().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'REINJECT_ANALYTICS') {
    (async () => {
      const tabId = msg.tabId || sender.tab?.id;
      if (!tabId) { sendResponse({ ok: false }); return; }
      try {
        // Clear the in-page installed flag so the interceptor re-installs with new settings
        await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN',
          func: () => { window.__qAnalyticsInstalled = false; },
        }).catch(() => {});
        await injectAnalyticsInterceptor(tabId);
        sendResponse({ ok: true });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }

  // Header modifier rules — apply via declarativeNetRequest dynamic rules
  if (msg.action === 'APPLY_HEADER_RULES') {
    applyHeaderRules(msg.rules || []).then(() => sendResponse({ ok: true }));
    return true;
  }

  // Page scripts: inject on demand
  if (msg.action === 'INJECT_PAGE_SCRIPTS') {
    const tabId = sender.tab?.id || msg.tabId;
    if (tabId) {
      ensurePageScripts(tabId).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ error: e.message }));
      return true;
    }
    sendResponse({ ok: false });
    return;
  }

  // Full-page screenshot: orchestrate scroll+stitch
  if (msg.action === 'CAPTURE_FULL_PAGE') {
    const tabId = sender.tab?.id || msg.tabId;
    if (!tabId) { sendResponse({ error: 'no tab' }); return; }
    captureFullPage(tabId)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  // Full page capture triggered from Home tile — popup closes immediately,
  // background does the capture + stitch + toast (Fix 70)
  if (msg.action === 'CAPTURE_FULL_PAGE_AND_TOAST') {
    const tabId = msg.tabId;
    if (!tabId) { sendResponse({ ok: false }); return; }
    sendResponse({ ok: true }); // let popup close right away
    captureFullPage(tabId)
      .then(result => processFullPageCapture(tabId, result))
      .catch(e => console.warn('[QAKit] full-page tile capture failed:', e.message));
    return true;
  }

  // Store screenshot captured BEFORE popup closes — used when region selection arrives
  if (msg.action === 'STORE_REGION_SCREENSHOT') {
    state.storedRegionScreenshot = msg.dataUrl || null;
    state.pendingRegionTabId     = msg.tabId   || sender.tab?.id || null;
    sendResponse({ ok: true });
    return;
  }

  // Region selection: user has finished drawing — crop the stored screenshot
  if (msg.action === 'REGION_SELECTED') {
    const tabId  = sender.tab?.id || state.pendingRegionTabId;
    const stored = state.storedRegionScreenshot;
    state.storedRegionScreenshot = null;
    state.pendingRegionTabId     = null;

    if (!tabId) {
      console.warn('[QAKit] REGION_SELECTED: no tabId');
      sendResponse({ ok: false });
      return;
    }

    if (stored) {
      // We already have the screenshot — crop it immediately, no capture needed
      processRegionCapture(tabId, stored, msg.rect);
    } else {
      // Fallback: try to capture now (may fail in Chrome if window lost focus)
      processRegionCaptureWithDelay(tabId, msg.rect, 300);
    }
    sendResponse({ ok: true });
    return;
  }

  // Element selection: pagescripts.js dispatched __qkitElementSelected with
  // the element's bounding rect. Re-uses the region-capture pipeline (the
  // crop math is identical — rect x/y/w/h in device pixels against a stored
  // visible-tab PNG).
  if (msg.action === 'ELEMENT_SELECTED') {
    const tabId  = sender.tab?.id || state.pendingRegionTabId;
    const stored = state.storedRegionScreenshot;
    state.storedRegionScreenshot = null;
    state.pendingRegionTabId     = null;

    if (!tabId) {
      console.warn('[QAKit] ELEMENT_SELECTED: no tabId');
      sendResponse({ ok: false });
      return;
    }

    if (stored) {
      processRegionCapture(tabId, stored, msg.rect);
    } else {
      // Shouldn't happen — context-menu handler pre-captures before launching
      // the picker. Fallback to late capture with a delay.
      processRegionCaptureWithDelay(tabId, msg.rect, 300);
    }
    sendResponse({ ok: true });
    return;
  }

  // Legacy: kept for keyboard shortcut path
  if (msg.action === 'PREPARE_REGION_CAPTURE') {
    state.pendingRegionTabId = msg.tabId || sender.tab?.id || null;
    sendResponse({ ok: true });
    return;
  }

  // Fired from the Home-tab "Capture Element" tile. Mirrors the
  // context-menu qakit-element-shot flow: pre-capture visible tab, stash it,
  // then launch the in-page element picker.
  if (msg.action === 'TRIGGER_ELEMENT_CAPTURE') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) { sendResponse({ ok: false, error: 'no active tab' }); return; }
        // Ensure pagescripts.js (which defines __qkitStartElementCapture) is injected
        await ensureAllInjected(tab.id);
        // Brief delay lets the popup finish closing so the visible-tab capture
        // reflects the page without our UI overlay
        setTimeout(() => {
          chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError || !dataUrl) {
              console.warn('[QAKit] Home element capture: pre-capture failed:', chrome.runtime.lastError?.message);
              return;
            }
            state.storedRegionScreenshot = dataUrl;
            state.pendingRegionTabId     = tab.id;
            injectAndExecOnTab(tab.id, () => { window.__qkitStartElementCapture?.(); });
          });
        }, 250);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // In-page annotation screenshot — page captured visible tab, deliver to popup as annotated result
  if (msg.action === 'DELIVER_ANNOTATED_SCREENSHOT') {
    chrome.runtime.sendMessage({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl: msg.dataUrl }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  // Region/Element crop: capture visible tab + send back for cropping in popup
  if (msg.action === 'CAPTURE_VISIBLE_FOR_CROP') {
    // Small delay before capture to avoid rate limit when called quickly after other captures
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 92 }, dataUrl => {
        if (chrome.runtime.lastError) { sendResponse({ error: chrome.runtime.lastError.message }); return; }
        sendResponse({ ok: true, dataUrl });
      });
    }, 200);
    return true;
  }

  // Relay OPEN_VIEWPORT_WINDOW from page scripts (MAIN world cannot use chrome.windows directly)
  if (msg.action === 'RELAY_OPEN_VIEWPORT_WINDOW') {
    const { url, w, h } = msg;
    // Deduplicate: ignore if same URL opened within last 500ms
    const now = Date.now();
    if (state._lastViewportOpen && now - state._lastViewportOpen < 500) {
      sendResponse({ ok: true }); return;
    }
    state._lastViewportOpen = now;
    chrome.windows.create({ url, width: Math.round(w) + 16, height: Math.round(h) + 88, type: 'popup' });
    sendResponse({ ok: true });
    return;
  }

  // Crop screenshot rect and send to popup
  if (msg.action === 'CROP_AND_RETURN') {
    const { dataUrl, rect } = msg;
    // Use OffscreenCanvas to crop, then send DELIVER_CROPPED_SCREENSHOT to all popup views
    (async () => {
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const bmp  = await createImageBitmap(blob);
        const { x, y, w, h, dpr } = rect;
        const oc = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        const octx = oc.getContext('2d');
        octx.drawImage(bmp, x, y, w, h, 0, 0, oc.width, oc.height);
        const outBlob = await oc.convertToBlob({ type: 'image/png' });
        const reader  = new FileReader();
        reader.onloadend = () => {
          chrome.runtime.sendMessage({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl: reader.result }).catch(() => {});
        };
        reader.readAsDataURL(outBlob);
      } catch(e) {
        console.warn('[QAKit] CROP_AND_RETURN failed:', e.message);
      }
    })();
    sendResponse({ ok: true });
    return;
  }

  // Open viewport window at specific size (legacy alias — handled by RELAY_OPEN_VIEWPORT_WINDOW)
  if (msg.action === 'OPEN_VIEWPORT_WINDOW') {
    // Delegate to the RELAY handler to avoid double windows
    const { url, w, h } = msg;
    // Check if we already opened one very recently (within 300ms)
    const now = Date.now();
    if (state._lastViewportOpen && now - state._lastViewportOpen < 300) {
      sendResponse({ ok: true }); return;
    }
    state._lastViewportOpen = now;
    chrome.windows.create({ url, width: w + 16, height: h + 88, type: 'popup' });
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === 'EXPORT') {
    sendResponse({ data: JSON.stringify({ digitalDataLayer: state.events }, null, 2) });
    return true;
  }

  // Console error from /script or /block path — update badge
  if (msg.action === 'CONSOLE_ERROR') {
    const evt = { ...msg.payload, category: 'console_error', tabId: sender.tab?.id };
    state.events.push(evt);
    if (state.events.length > state.maxEvents) state.events.shift();
    persistToStorage();
    state.consoleErrorCount++;
    // Show error count on extension icon badge (red)
    const count = state.consoleErrorCount;
    chrome.action.setBadgeText({ text: count > 99 ? '99+' : String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#ff6b6b' });
    // Notify popup
    chrome.runtime.sendMessage({ action: 'NEW_CONSOLE_ERROR', event: evt }).catch(() => {});
    return true;
  }

  // Network mock intercept — relay to popup (replaces 2s polling from popup).
  if (msg.action === 'NET_INTERCEPTED') {
    chrome.runtime.sendMessage({ action: 'NET_INTERCEPTED', entry: msg.entry }).catch(() => {});
    return;
  }
});

// ── Delay then capture — gives overlay time to clear before screenshotting ──
function processRegionCaptureWithDelay(tabId, rect, delay = 400) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      console.warn('[QAKit] processRegionCaptureWithDelay: could not get tab', chrome.runtime.lastError?.message);
      return;
    }
    const windowId = tab.windowId;

    function doCapture() {
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, dataUrl => {
        if (chrome.runtime.lastError || !dataUrl) {
          console.warn('[QAKit] captureVisibleTab failed (attempt 1):', chrome.runtime.lastError?.message);
          // Retry after a longer pause
          setTimeout(() => {
            chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, dataUrl2 => {
              if (chrome.runtime.lastError || !dataUrl2) {
                console.warn('[QAKit] captureVisibleTab failed (attempt 2):', chrome.runtime.lastError?.message);
                chrome.scripting.executeScript({
                  target: { tabId }, world: 'MAIN',
                  func: () => {
                    const t = document.createElement('div');
                    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#c0392b;color:#fff;padding:12px 18px;border-radius:8px;font-family:sans-serif;font-size:13px;font-weight:700';
                    t.textContent = '⚠ QAKit: Screenshot failed — ensure the page tab is focused and try again.';
                    document.body.appendChild(t);
                    setTimeout(() => t.remove(), 5000);
                  },
                }).catch(() => {});
                return;
              }
              processRegionCapture(tabId, dataUrl2, rect);
            });
          }, 800);
          return;
        }
        processRegionCapture(tabId, dataUrl, rect);
      });
    }

    // Focus the window first, then wait for OS focus switch before capturing.
    // Chrome requires the window to be truly focused (not just flagged).
    // The update callback fires before OS focus is transferred, so we add extra delay.
    // Also ensure the tab is active in its window (required by captureVisibleTab).
    chrome.tabs.update(tabId, { active: true }, () => {
      chrome.windows.update(windowId, { focused: true }, () => {
        // 250ms after focus update + original delay to let overlay disappear
        setTimeout(doCapture, Math.max(delay, 250));
      });
    });
  });
}

// ── Shared toast: shows captured PNG with Save/Copy on the page ──────────
// Used by processRegionCapture and processFullPageCapture. Kept in one place
// so the visual and behavior stay identical.
async function injectScreenshotToast(tabId, pngDataUrl, label, downloadPrefix) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (imgUrl, toastLabel, dlPrefix) => {
        // Copy to clipboard
        fetch(imgUrl)
          .then(r => r.blob())
          .then(b => navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]))
          .catch(() => {});

        // Remove stale toast
        document.getElementById('__qkit-save-toast')?.remove();

        const toast = document.createElement('div');
        toast.id = '__qkit-save-toast';
        toast.style.cssText = [
          'position:fixed;bottom:24px;right:24px;z-index:2147483647',
          'background:#1a1a2e;color:#e0e0f0;border:1px solid rgba(0,229,160,.4)',
          'border-radius:10px;padding:12px 16px;min-width:260px;max-width:340px',
          'box-shadow:0 8px 32px rgba(0,0,0,.6)',
          'font-family:-apple-system,"Segoe UI",sans-serif;font-size:13px',
          'display:flex;flex-direction:column;gap:8px',
          'animation:__qkIn .2s ease-out',
        ].join(';');

        const styleEl = document.createElement('style');
        styleEl.textContent = '@keyframes __qkIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}';
        toast.appendChild(styleEl);

        // Header row: thumbnail + text
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:10px';

        const thumb = document.createElement('img');
        thumb.src = imgUrl;
        thumb.style.cssText = 'width:64px;height:48px;object-fit:cover;border-radius:4px;border:1px solid rgba(255,255,255,.15);flex-shrink:0';

        const txt = document.createElement('div');
        txt.innerHTML =
          '<div style="font-weight:700;font-size:14px;color:#00e5a0;margin-bottom:3px">📸 ' + toastLabel + '</div>' +
          '<div style="font-size:12px;color:#8a9ab0">✓ Copied to clipboard</div>';

        hdr.appendChild(thumb);
        hdr.appendChild(txt);
        toast.appendChild(hdr);

        // Buttons row
        const btns = document.createElement('div');
        btns.style.cssText = 'display:flex;gap:6px';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '⬇ Save as PNG';
        saveBtn.style.cssText = [
          'flex:1;background:#0a6e51;color:#fff;border:none;border-radius:6px',
          'padding:7px 10px;font-size:13px;cursor:pointer;font-weight:700',
          'transition:background .12s',
        ].join(';');
        saveBtn.onmouseover = () => { saveBtn.style.background = '#085c44'; };
        saveBtn.onmouseout  = () => { saveBtn.style.background = '#0a6e51'; };
        saveBtn.onclick = () => {
          const a = document.createElement('a');
          a.href = imgUrl;
          a.download = dlPrefix + '-' + Date.now() + '.png';
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast.remove();
        };

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = [
          'background:rgba(255,255,255,.08);color:#ccc',
          'border:1px solid rgba(255,255,255,.15);border-radius:6px',
          'padding:7px 12px;font-size:13px;cursor:pointer',
        ].join(';');
        closeBtn.onclick = () => toast.remove();

        btns.appendChild(saveBtn);
        btns.appendChild(closeBtn);
        toast.appendChild(btns);

        document.body.appendChild(toast);
        // Auto-dismiss after 15 seconds
        setTimeout(() => toast.parentNode && toast.remove(), 15000);
      },
      args: [pngDataUrl, label, downloadPrefix],
    });
  } catch (e) {
    console.warn('[QAKit] injectScreenshotToast failed:', e.message);
  }
}

// ── Process region capture: crop dataUrl to rect, copy to clipboard, inject toast ──
async function processRegionCapture(tabId, dataUrl, rect) {
  try {
    const res  = await fetch(dataUrl);
    const blob = await res.blob();
    const bmp  = await createImageBitmap(blob);
    const { x, y, w, h, dpr } = rect;
    const oc   = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    const octx = oc.getContext('2d');
    octx.drawImage(bmp, x, y, w, h, 0, 0, oc.width, oc.height);
    const outBlob = await oc.convertToBlob({ type: 'image/png' });

    const reader = new FileReader();
    reader.onloadend = async () => {
      const pngDataUrl = reader.result;
      // Deliver to popup if open
      chrome.runtime.sendMessage({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl: pngDataUrl }).catch(() => {});
      await injectScreenshotToast(tabId, pngDataUrl, 'Region captured', 'qakit-region');
    };
    reader.readAsDataURL(outBlob);
  } catch (e) {
    console.warn('[QAKit] processRegionCapture: crop failed:', e.message);
  }
}

// ── Process full-page capture: stitch strips, copy to clipboard, inject toast ──
// Fixes the long-standing silent failure when full-page screenshot was triggered
// from the context menu or keyboard shortcut (the DELIVER_FULL_PAGE_STRIPS
// message had no listener). Now stitches in the SW and shows an in-page toast.
async function processFullPageCapture(tabId, captureResult) {
  try {
    const { strips, totalHeight, viewportWidth, viewportHeight, dpr } = captureResult;
    if (!Array.isArray(strips) || strips.length === 0) {
      console.warn('[QAKit] processFullPageCapture: no strips to stitch');
      return;
    }
    const W = Math.round(viewportWidth * dpr);
    const H = Math.round(totalHeight   * dpr);
    const oc = new OffscreenCanvas(Math.max(1, W), Math.max(1, H));
    const octx = oc.getContext('2d');

    for (const strip of strips) {
      const resp = await fetch(strip.dataUrl);
      const blob = await resp.blob();
      const bmp  = await createImageBitmap(blob);
      const destY = Math.round(strip.scrollY * dpr);
      const rem   = H - destY;
      const srcH  = Math.min(bmp.height, rem);
      octx.drawImage(bmp, 0, 0, bmp.width, srcH, 0, destY, bmp.width, srcH);
    }

    const outBlob = await oc.convertToBlob({ type: 'image/png' });
    const reader  = new FileReader();
    reader.onloadend = async () => {
      const pngDataUrl = reader.result;
      // Also deliver to popup if it happens to be open
      chrome.runtime.sendMessage({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl: pngDataUrl }).catch(() => {});
      await injectScreenshotToast(tabId, pngDataUrl, 'Full page captured', 'qakit-fullpage');
    };
    reader.readAsDataURL(outBlob);
  } catch (e) {
    console.warn('[QAKit] processFullPageCapture: stitch failed:', e.message);
  }
}

// ── Inject pagescripts.js into page on demand ────────────────────────────
async function ensurePageScripts(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => window.__qkitPageScriptsInstalled === true,
    });
    if (res?.[0]?.result) return; // already installed
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      files: ['pagescripts.js'],
    });
  } catch(e) {
    console.warn('[QAKit] ensurePageScripts failed:', e.message);
  }
}

async function ensureInspector(tabId) {
  // inspector.js carries the Element Inspector + Spacing Inspector overlays.
  // Previously only the popup's Inspect button injected it, so right-click →
  // Inspect Element on a fresh page did nothing. We now inject lazily from
  // context-menu handlers too.
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => window.__qInspectorInstalled === true,
    });
    if (res?.[0]?.result) return;
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      files: ['inspector.js'],
    });
  } catch(e) {
    console.warn('[QAKit] ensureInspector failed:', e.message);
  }
}

async function ensureAnalyticsInterceptor(tabId) {
  // analytics-interceptor.js runs in MAIN world and patches window.dataLayer,
  // gtag, fbq, adobe, etc. Required because content.js (isolated world) cannot
  // patch page globals. Safe to call repeatedly — has its own install guard.
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => window.__qAnalyticsInstalled === true,
    });
    if (res?.[0]?.result) return;
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      files: ['analytics-interceptor.js'],
    });
  } catch(e) {
    console.warn('[QAKit] ensureAnalyticsInterceptor failed:', e.message);
  }
}

async function ensureAllInjected(tabId) {
  // Single entry point used by context-menu handlers. Guarantees that every
  // page-side QAKit script required by any menu item is present before the
  // handler runs. All three are idempotent (guarded by install flags).
  await Promise.all([
    ensurePageScripts(tabId),
    ensureInspector(tabId),
  ]);
}

// ── Full-page scroll-and-stitch screenshot ────────────────────────────────
// 1. Get page dimensions from content
// 2. Loop: scroll to each strip, capture, collect dataUrls
// 3. Stitch on an offscreen canvas via OffscreenCanvas (SW context)
// 4. Return final dataUrl
async function captureFullPage(tabId) {
  await ensurePageScripts(tabId);

  const dimRes = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => window.__qkitGetFullPageDimensions?.(),
  });
  const dim = dimRes?.[0]?.result;
  if (!dim) throw new Error('Could not get page dimensions');

  const { scrollHeight, viewportHeight, dpr, originalScrollY } = dim;
  const strips = [];
  let scrollY = 0;

  // Scroll to top first and wait for any lazy-load reflows
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: y => window.__qkitScrollTo?.(y), args: [0],
  });
  await new Promise(r => setTimeout(r, 300));

  // Chrome allows ~2 captureVisibleTab calls/sec (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND).
  // We wait 600ms between captures to stay well within the limit.
  const CAPTURE_DELAY = 620;

  // FIX 8+9: Hide QAKit annotation toolbar and indicator bar for the duration
  // of the stitch. Without this, the toolbar (position:fixed) appears in EVERY
  // strip at the bottom, and the green indicator bar appears at the top of
  // every page segment. We hide via visibility:hidden (not display:none) so
  // layout doesn't shift.
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      const ids = ['__qkit-annot-toolbar', '__qkit-annot-indicator',
                   '__qkit-region-overlay', '__qkit-ruler-overlay',
                   '__qkit-element-picker-overlay', '__qkit-responsive-overlay'];
      window.__qkitHiddenElements = [];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.style.visibility !== 'hidden') {
          window.__qkitHiddenElements.push({ id, prev: el.style.visibility });
          el.style.visibility = 'hidden';
        }
      });
    },
  }).catch(() => {});

  try {
    while (scrollY < scrollHeight) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: y => { window.scrollTo(0, y); }, args: [scrollY],
      });
      // Wait for scroll + any paint
      await new Promise(r => setTimeout(r, CAPTURE_DELAY));

      const dataUrl = await new Promise((resolve, reject) => {
        // Use JPEG quality 92 — much faster encoding than PNG for large pages
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 92 }, url => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(url);
        });
      });
      strips.push({ dataUrl, scrollY, height: viewportHeight });
      scrollY += viewportHeight;
    }
  } finally {
    // Always restore hidden elements even if the capture loop threw
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => {
        (window.__qkitHiddenElements || []).forEach(({ id, prev }) => {
          const el = document.getElementById(id);
          if (el) el.style.visibility = prev || '';
        });
        window.__qkitHiddenElements = null;
      },
    }).catch(() => {});
  }

  // Restore original scroll
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: y => window.scrollTo(0, y), args: [originalScrollY],
  });

  return { strips, totalHeight: scrollHeight, viewportWidth: dim.viewportWidth, viewportHeight, dpr };
}

// ── Header modifier via declarativeNetRequest ────────────────────────────
// Converts user header rules into declarativeNetRequest dynamic rules.
// Requires "declarativeNetRequest" and "declarativeNetRequestWithHostAccess" permissions.
async function applyHeaderRules(rules) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;

  try {
    // Remove all existing dynamic rules first
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.map(r => r.id);

    const addRules = [];
    let ruleId = 1000; // Start from 1000 to avoid collision with static rules

    rules.filter(r => r.enabled).forEach(rule => {
      ruleId++;
      const headerOp = rule.op === 'remove' ? 'remove' :
                       rule.op === 'add'    ? 'append'  : 'set';

      // Determine resource types
      const allTypes = ['main_frame','sub_frame','stylesheet','script','image',
                        'font','object','xmlhttprequest','ping','csp_report',
                        'media','websocket','other'];
      const typeMap = {
        all:     allTypes,
        xhr:     ['xmlhttprequest'],
        doc:     ['main_frame','sub_frame'],
        script:  ['script'],
        image:   ['image'],
      };
      const resourceTypes = typeMap[rule.requestType] || allTypes;

      const dnrRule = {
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: rule.header.toLowerCase(),
            operation: headerOp,
            ...(headerOp !== 'remove' && rule.value ? { value: rule.value } : {}),
          }],
        },
        condition: {
          urlFilter: rule.urlFilter,
          resourceTypes,
        },
      };
      addRules.push(dnrRule);
    });

    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules });
    console.log('[QAKit] Header rules applied:', addRules.length);
  } catch(e) {
    console.warn('[QAKit] Could not apply header rules:', e.message);
  }
}

// Re-apply header rules on service worker startup
async function restoreHeaderRules() {
  try {
    const s = await chrome.storage.local.get('qa_header_rules');
    const rules = s.qa_header_rules || [];
    if (rules.length > 0) await applyHeaderRules(rules);
  } catch {}
}

// ── Domain matching using saved settings ─────────────────────────────────
// Called on every relevant tab event. Reads settings from storage each time
// to stay in sync with user changes without needing a service worker restart.
async function isAllowedDomain(url) {
  if (!url || url.startsWith('chrome://') || url.startsWith('about:')) return false;
  try {
    const stored  = await chrome.storage.local.get('qa_tools_settings');
    const rawDomains = (stored.qa_tools_settings?.domains || '').trim();
    // Req 5: empty domains = work on all domains
    if (!rawDomains) return true;
    const hostname = new URL(url).hostname;
    const patterns = rawDomains.split(',').map(s => s.trim()).filter(Boolean);
    if (!patterns.length) return true;
    return patterns.some(pat => {
      const regex = new RegExp(pat.replace(/\./g, '\\.').replace(/\*/g, '.*'));
      return regex.test(hostname);
    });
  } catch { return false; }
}

// Badge management, network mock and console shim re-injection
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const allowed = tab.url ? await isAllowedDomain(tab.url) : false;

  // Reset badge on page navigation
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '' });
    if (allowed) {
      state.consoleErrorCount = 0;
    }
    // Install LCP observer early so it catches the entry before user lands
    if (allowed) injectLcpObserver(tabId);
  }

  // Inject on page complete for allowed domains
  if (changeInfo.status === 'complete' && allowed) {
    reInjectNetworkMock(tabId);
    injectConsoleShim(tabId);
    injectAnalyticsInterceptor(tabId);
  }
  // Env Marker: inject regardless of "allowed domains" — users want the label
  // everywhere they've configured a rule, including in-dev environments.
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
    injectEnvMarker(tabId, tab.url);
  }
});

// ── Environment Marker injection ─────────────────────────────────────────
// Reads stored environments, finds the first one whose pattern matches the
// current URL, and injects env-marker.js with the matching config.
async function injectEnvMarker(tabId, url) {
  try {
    const s = await chrome.storage.local.get('qakit_env_marker_envs');
    const envs = Array.isArray(s.qakit_env_marker_envs) ? s.qakit_env_marker_envs : [];
    if (!envs.length) return;
    const match = findMatchingEnv(envs, url);
    // Seed the config global, then inject the marker script which reads it
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      args: [match],
      func: (cfg) => { window.__qkitEnvMarker = cfg; },
    }).catch(() => {});
    // Inject the marker script (it checks for cfg presence)
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', files: ['env-marker.js'],
    }).catch(() => {});
  } catch (_) {}
}

function findMatchingEnv(envs, url) {
  for (const env of envs) {
    if (!env.enabled) continue;
    if (!env.pattern) continue;
    const pattern = env.pattern.trim();
    if (!pattern) continue;
    try {
      if (pattern.startsWith('regex:')) {
        const re = new RegExp(pattern.slice(6));
        if (re.test(url)) return env;
      } else {
        // Simple wildcard match against hostname or URL
        const hostname = new URL(url).hostname;
        // Convert * to .* and anchor, then test against hostname AND full URL
        const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
        if (re.test(hostname) || re.test(url)) return env;
      }
    } catch (_) {}
  }
  return null;
}

// Refresh env markers on all tabs — called when user saves settings
async function refreshAllEnvMarkers() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('about:')) {
        injectEnvMarker(t.id, t.url);
      }
    }
  } catch (_) {}
}

// A-9 Inject a PerformanceObserver for LCP so audit has a reliable value.
// The observer writes the latest entry into window.__qakitLCP. We install in
// MAIN world on 'loading' (page documentStart-ish) so it's running before FCP.
async function injectLcpObserver(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func: () => {
        if (window.__qakitLCPInstalled) return;
        window.__qakitLCPInstalled = true;
        window.__qakitLCP = { value: 0, element: null };
        try {
          const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              window.__qakitLCP = {
                value: entry.startTime,
                element: entry.element || null,
              };
            }
          });
          obs.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (_) {}
      },
    });
  } catch (_) {}
}

// ── Inject spell bundle on demand (called by popup when audit tab opens) ────
async function injectSpellBundle(tabId) {
  try {
    const already = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => typeof window.QASpell !== 'undefined',
    });
    if (already?.[0]?.result) return; // already loaded
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      files: ['spell-bundle.js'],
    });
    // Pre-warm the dictionary so first audit is fast
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => { if (window.QASpell) window.QASpell.load(); },
    });
  } catch(e) {
    console.warn('[QAKit] Could not inject spell bundle:', e.message);
  }
}

// ── Inject console shim into MAIN world ───────────────────────────────────
// Reads consolePaths from settings and sets window.__qConsolePaths before
// injecting console-shim.js, so paths are configurable without reloading.
async function injectConsoleShim(tabId) {
  try {
    // Read configured paths from settings
    const stored = await chrome.storage.local.get('qa_tools_settings');
    const rawPaths = stored.qa_tools_settings?.consolePaths || '/scripts/,/blocks/';
    const paths = rawPaths.split(',').map(s => s.trim()).filter(Boolean);

    // First: set the paths in MAIN world
    await chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func: (consolePaths) => { window.__qConsolePaths = consolePaths; },
      args:   [paths],
    });

    // Then: inject the shim (it will read window.__qConsolePaths)
    await chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      files:  ['console-shim.js'],
    });
  } catch(e) {
    console.warn('[QAKit] Could not inject console shim:', e.message);
  }
}

// ── Inject analytics interceptor into MAIN world ──────────────────────────
// Runs BEFORE reInjectNetworkMock/console-shim on every allowed-domain page
// load. Reads the user's analyticsProviders setting, sets
// window.__qAnalyticsProviders as a gate, then injects the interceptor.
// The interceptor itself is idempotent via window.__qAnalyticsInstalled.
async function injectAnalyticsInterceptor(tabId) {
  try {
    const stored    = await chrome.storage.local.get('qa_tools_settings');
    const providers = stored.qa_tools_settings?.analyticsProviders ||
      ['gtm','ga4','ddl','wae','adobe','tealium','meta','floodlight','segment'];

    // Set providers in MAIN world first
    await chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func:   (p) => { window.__qAnalyticsProviders = p; },
      args:   [providers],
    });

    // Then inject the interceptor file
    await chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      files:  ['analytics-interceptor.js'],
    });
  } catch(e) {
    console.warn('[QAKit] Could not inject analytics interceptor:', e.message);
  }
}

async function reInjectNetworkMock(tabId) {
  try {
    const stored = await chrome.storage.local.get('qnet_rules');
    const rules  = (stored.qnet_rules || []).filter(r => r.active);
    if (rules.length === 0) return; // No active rules — nothing to inject

    await chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func:   (activeRules) => {
        // Guard: re-set rules if already installed (e.g. soft navigation)
        window.__qNetRules = activeRules;
        if (window.__qNetInterceptorInstalled) return;
        window.__qNetInterceptorInstalled = true;
        window.__qNetLog = [];

        function matchRule(url, rule) {
          try {
            switch (rule.matchType) {
              case 'contains': return url.includes(rule.pattern);
              case 'exact':    return url === rule.pattern;
              case 'regex':    return new RegExp(rule.pattern).test(url);
              case 'path': {
                const up = new URL(url).pathname;
                const pp = rule.pattern.startsWith('http') ? new URL(rule.pattern).pathname : rule.pattern;
                return up === pp;
              }
              default: return url.includes(rule.pattern);
            }
          } catch { return false; }
        }

        function findMatch(url) {
          return (window.__qNetRules || []).find(r => r.active && matchRule(url, r)) || null;
        }

        function logIt(url, rule, status) {
          const e = { url, ruleName: rule.name, status, timestamp: new Date().toISOString() };
          window.__qNetLog.unshift(e);
          if (window.__qNetLog.length > 100) window.__qNetLog.pop();
          window.dispatchEvent(new CustomEvent('__qNetIntercepted', { detail: e }));
        }

        // Wrap fetch
        const origFetch = window.fetch;
        window.fetch = async function(input, init) {
          const url = typeof input === 'string' ? input : (input?.url || String(input));
          const rule = findMatch(url);
          if (rule) {
            logIt(url, rule, rule.responseStatus || 200);
            return new Response(
              typeof rule.responseBody === 'string' ? rule.responseBody : JSON.stringify(rule.responseBody),
              { status: rule.responseStatus || 200, headers: { 'Content-Type': 'application/json', 'X-Mocked-By': 'QA-Tools' } }
            );
          }
          return origFetch.apply(this, arguments);
        };

        // Wrap XHR
        const OrigXHR = window.XMLHttpRequest;
        function MockXHR() {
          const xhr = new OrigXHR();
          let _url = '';
          const origOpen = xhr.open.bind(xhr);
          const origSend = xhr.send.bind(xhr);
          xhr.open = function(m, url, ...r) { _url = url; return origOpen(m, url, ...r); };
          xhr.send = function(body) {
            const rule = findMatch(_url);
            if (rule) {
              setTimeout(() => {
                const mb = typeof rule.responseBody === 'string' ? rule.responseBody : JSON.stringify(rule.responseBody);
                Object.defineProperties(xhr, {
                  readyState:  { get: () => 4, configurable: true },
                  status:      { get: () => rule.responseStatus || 200, configurable: true },
                  statusText:  { get: () => 'OK', configurable: true },
                  responseText:{ get: () => mb, configurable: true },
                  response:    { get: () => mb, configurable: true },
                });
                logIt(_url, rule, rule.responseStatus || 200);
                xhr.onreadystatechange && xhr.onreadystatechange();
                xhr.onload && xhr.onload();
              }, 0);
              return;
            }
            return origSend(body);
          };
          return xhr;
        }
        Object.setPrototypeOf(MockXHR.prototype, OrigXHR.prototype);
        window.XMLHttpRequest = MockXHR;
        console.log('%c[QAKit] Network interceptor active (' + activeRules.length + ' rule' + (activeRules.length > 1 ? 's' : '') + ')', 'color:#00e5a0;font-weight:bold');
      },
      args: [rules],
    });
  } catch(e) {
    console.warn('[QAKit] Could not inject network mock:', e.message);
  }
}

// ── Keyboard shortcut commands ────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('http')) return;

  // Local alias for convenience — uses the tab from this listener's closure
  const injectAndExec = (func, args) => injectAndExecOnTab(tab.id, func, args);

  switch (command) {
    case 'toggle-inspector':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: () => {
          window.__qInspectorMode   = 'inspect';
          window.__qInspectorActive = !window.__qInspectorActive;
          if (!window.__qInspectorActive) {
            document.documentElement.style.cursor = '';
            window.dispatchEvent(new CustomEvent('__qInspectorOff'));
          } else {
            document.documentElement.style.cursor = 'crosshair';
          }
        },
      }).catch(() => {});
      // Also inject if not yet installed
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: () => window.__qInspectorInstalled || false,
        });
        if (!res?.[0]?.result) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'MAIN', files: ['inspector.js'],
          });
        }
      } catch(_) {}
      break;

    case 'toggle-spacing':
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: () => {
          window.__qInspectorMode   = 'spacing';
          window.__qInspectorActive = !window.__qInspectorActive;
          if (!window.__qInspectorActive) document.documentElement.style.cursor = '';
          else document.documentElement.style.cursor = 'crosshair';
        },
      }).catch(() => {});
      try {
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN',
          func: () => window.__qInspectorInstalled || false,
        });
        if (!res?.[0]?.result) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id }, world: 'MAIN', files: ['inspector.js'],
          });
        }
      } catch(_) {}
      break;

    case 'capture-region':
      // Pre-capture the screenshot using the tab's windowId.
      // Keyboard shortcuts don't grant activeTab permission, but host_permissions
      // (<all_urls>) allows captureVisibleTab with an explicit windowId.
      chrome.tabs.get(tab.id, (tabInfo) => {
        if (chrome.runtime.lastError || !tabInfo) return;
        chrome.tabs.update(tab.id, { active: true }, () => {
          chrome.windows.update(tabInfo.windowId, { focused: true }, () => {
            setTimeout(() => {
              chrome.tabs.captureVisibleTab(tabInfo.windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError || !dataUrl) {
                  console.warn('[QAKit] shortcut region pre-capture failed:', chrome.runtime.lastError?.message);
                  return;
                }
                state.storedRegionScreenshot = dataUrl;
                state.pendingRegionTabId = tab.id;
                injectAndExec(() => { window.__qkitStartRegionCapture(); });
              });
            }, 200);
          });
        });
      });
      break;

    case 'capture-fullpage':
      // Full page capture via background
      captureFullPage(tab.id)
        .then(result => processFullPageCapture(tab.id, result))
        .catch(e => console.warn('[QAKit] shortcut full-page capture failed:', e.message));
      break;

    case 'toggle-annotate':
      await injectAndExec(() => {
        if (window.__qkitAnnotationActive?.()) {
          window.__qkitCloseAnnotation?.();
        } else {
          window.__qkitStartAnnotation?.();
        }
      });
      break;
  }
});
