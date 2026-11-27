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

// ── Unified HTTP rules (Phase 1 foundation) ───────────────────────────────
const UNIFIED_RULES_KEY = 'qakit_unified_rules_v1';
const UNIFIED_RULES_INFO_KEY = 'qakit_unified_rules_info_v1';
const UNIFIED_RULES_SCHEMA_VERSION = 1;

const DEFAULT_UNIFIED_RULES_INFO = {
  schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
  paused: false,
  groupStates: { default: true },
};

function nowIso() {
  return new Date().toISOString();
}

function makeRuleId(prefix) {
  return (prefix || 'rule') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function normalizeUnifiedRule(rule, defaults) {
  const base = defaults || {};
  const createdAt = rule.createdAt || base.createdAt || nowIso();
  return {
    id: rule.id || base.id || makeRuleId('rule'),
    type: String(rule.type || base.type || 'custom'),
    name: String(rule.name || base.name || 'Untitled Rule'),
    enabled: rule.enabled !== false,
    priority: Number.isFinite(rule.priority) ? rule.priority : (Number.isFinite(base.priority) ? base.priority : 100),
    groupId: String(rule.groupId || base.groupId || 'default'),
    source: {
      urlPattern: String(rule.source?.urlPattern || base.source?.urlPattern || '*'),
      matchType: String(rule.source?.matchType || base.source?.matchType || 'wildcard'),
      requestType: String(rule.source?.requestType || base.source?.requestType || 'all'),
    },
    action: {
      ...(base.action || {}),
      ...(rule.action || {}),
    },
    metadata: {
      ...(base.metadata || {}),
      ...(rule.metadata || {}),
    },
    createdAt,
    updatedAt: nowIso(),
  };
}

function validateRulesPack(pack) {
  if (!pack || typeof pack !== 'object') return { ok: false, error: 'pack must be an object' };
  if (pack.schema !== 'qakit-unified-rules') return { ok: false, error: 'invalid schema id' };
  if (!Array.isArray(pack.rules)) return { ok: false, error: 'rules must be an array' };

  const invalid = [];
  const seenIds = new Set();
  pack.rules.forEach((r, idx) => {
    if (!r || typeof r !== 'object') {
      invalid.push({ index: idx, reason: 'rule must be an object' });
      return;
    }
    if (!r.type || typeof r.type !== 'string') invalid.push({ index: idx, reason: 'missing rule type' });
    if (!r.name || typeof r.name !== 'string') invalid.push({ index: idx, reason: 'missing rule name' });
    if (r.id && seenIds.has(r.id)) invalid.push({ index: idx, reason: 'duplicate rule id in pack' });
    if (r.id) seenIds.add(r.id);
  });

  if (invalid.length) {
    return {
      ok: false,
      error: 'invalid rules in pack',
      invalid,
    };
  }
  return { ok: true };
}

function buildImportSummary(currentRules, incomingRules) {
  const byId = new Map((currentRules || []).map(r => [r.id, r]));
  let newCount = 0;
  let updateCount = 0;
  (incomingRules || []).forEach(r => {
    if (r.id && byId.has(r.id)) updateCount++;
    else newCount++;
  });
  return {
    currentCount: (currentRules || []).length,
    incomingCount: (incomingRules || []).length,
    newCount,
    updateCount,
  };
}

function migrateNetworkMockRulesToUnified(netRules) {
  if (!Array.isArray(netRules)) return [];
  return netRules.map((r, idx) => normalizeUnifiedRule({
    id: makeRuleId('mock'),
    type: 'mock-response',
    name: r.name || ('Mock ' + (idx + 1)),
    enabled: r.active !== false,
    priority: 300 + idx,
    groupId: 'legacy-network-mock',
    source: {
      urlPattern: r.pattern || '*',
      matchType: r.matchType || 'contains',
      requestType: 'xhr',
    },
    action: {
      responseStatus: Number.isFinite(r.responseStatus) ? r.responseStatus : 200,
      responseBody: r.responseBody ?? '{}',
    },
    metadata: {
      source: 'legacy-network-mock',
      legacyId: String(r.id || ''),
    },
  }));
}

function migrateHeaderRulesToUnified(headerRules) {
  if (!Array.isArray(headerRules)) return [];
  return headerRules.map((r, idx) => normalizeUnifiedRule({
    id: makeRuleId('header'),
    type: 'modify-header',
    name: (r.header ? 'Header: ' + r.header : 'Header Rule ' + (idx + 1)),
    enabled: r.enabled !== false,
    priority: 100 + idx,
    groupId: 'legacy-headers',
    source: {
      urlPattern: r.urlFilter || '*',
      matchType: 'wildcard',
      requestType: r.requestType || 'all',
    },
    action: {
      target: r.target || 'request',
      header: String(r.header || '').toLowerCase(),
      op: r.op || 'set',
      value: r.value || '',
    },
    metadata: {
      source: 'legacy-headers',
    },
  }));
}

async function getUnifiedRules() {
  const s = await chrome.storage.local.get(UNIFIED_RULES_KEY);
  return Array.isArray(s[UNIFIED_RULES_KEY]) ? s[UNIFIED_RULES_KEY] : [];
}

async function saveUnifiedRules(rules, infoPatch) {
  const infoStored = await chrome.storage.local.get(UNIFIED_RULES_INFO_KEY);
  const prevInfo = infoStored[UNIFIED_RULES_INFO_KEY] || {};
  const info = {
    ...DEFAULT_UNIFIED_RULES_INFO,
    ...prevInfo,
    ...(infoPatch || {}),
    schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
    lastUpdatedAt: nowIso(),
  };
  await chrome.storage.local.set({
    [UNIFIED_RULES_KEY]: rules,
    [UNIFIED_RULES_INFO_KEY]: info,
  });
  return info;
}

async function getUnifiedRulesInfo() {
  const s = await chrome.storage.local.get(UNIFIED_RULES_INFO_KEY);
  return {
    ...DEFAULT_UNIFIED_RULES_INFO,
    ...(s[UNIFIED_RULES_INFO_KEY] || {}),
    schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
  };
}

function isRuleEffectivelyEnabled(rule, info) {
  if (!rule || rule.enabled === false) return false;
  if (info?.paused) return false;
  const gid = String(rule.groupId || 'default');
  const gState = info?.groupStates?.[gid];
  return gState !== false;
}

function unifiedToHeaderRule(rule) {
  if (!rule || rule.type !== 'modify-header') return null;
  const action = rule.action || {};
  if (!action.header) return null;
  return {
    urlFilter: rule.source?.urlPattern || '*',
    header: action.header,
    value: action.value || '',
    op: action.op || 'set',
    target: action.target || 'request',
    requestType: rule.source?.requestType || 'all',
    enabled: rule.enabled !== false,
  };
}

function getHeaderRulesFromUnified(rules) {
  return (rules || [])
    .filter(r => r.type === 'modify-header')
    .map(unifiedToHeaderRule)
    .filter(Boolean);
}

async function syncUnifiedHeadersFromLegacy(headerRules) {
  const current = await getUnifiedRules();
  const keep = current.filter(r => !(r.type === 'modify-header' && r.metadata?.source === 'legacy-headers'));
  const migrated = migrateHeaderRulesToUnified(headerRules || []);
  const next = keep.concat(migrated);
  await saveUnifiedRules(next, { adaptedFromLegacyHeadersAt: nowIso() });
  return next;
}

async function syncUnifiedNetworkMockFromLegacy(netRules) {
  const current = await getUnifiedRules();
  const keep = current.filter(r => !(r.type === 'mock-response' && r.metadata?.source === 'legacy-network-mock'));
  const migrated = migrateNetworkMockRulesToUnified(netRules || []);
  const next = keep.concat(migrated);
  await saveUnifiedRules(next, { adaptedFromLegacyNetworkMockAt: nowIso() });
  return next;
}

let unifiedRulesInitializationPromise = null;

async function ensureUnifiedRulesMigrated() {
  if (!unifiedRulesInitializationPromise) {
    unifiedRulesInitializationPromise = (async () => {
      const stored = await chrome.storage.local.get([UNIFIED_RULES_KEY, UNIFIED_RULES_INFO_KEY]);
      const existing = stored[UNIFIED_RULES_KEY];
      if (Array.isArray(existing)) {
        // Ensure basic normalisation if older data exists.
        const normalized = existing.map(r => normalizeUnifiedRule(r));
        await saveUnifiedRules(normalized, {
          schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
          initializedAt: stored[UNIFIED_RULES_INFO_KEY]?.initializedAt || nowIso(),
          migratedFromLegacy: stored[UNIFIED_RULES_INFO_KEY]?.migratedFromLegacy || false,
        });
        return normalized;
      }

      const legacy = await chrome.storage.local.get(['qnet_rules', 'qa_header_rules']);
      const netRules = migrateNetworkMockRulesToUnified(legacy.qnet_rules || []);
      const headerRules = migrateHeaderRulesToUnified(legacy.qa_header_rules || []);
      const migrated = netRules.concat(headerRules);
      await saveUnifiedRules(migrated, {
        schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
        initializedAt: nowIso(),
        migratedFromLegacy: true,
        legacyCounts: {
          networkMock: netRules.length,
          headers: headerRules.length,
        },
      });
      return migrated;
    })();
  }

  const initialization = unifiedRulesInitializationPromise;
  try {
    return await initialization;
  } catch (error) {
    if (unifiedRulesInitializationPromise === initialization) {
      unifiedRulesInitializationPromise = null;
    }
    throw error;
  }
}

async function applyHeaderRulesFromUnified() {
  const rules = await getUnifiedRules();
  const info = await getUnifiedRulesInfo();
  const effective = rules.filter(r => isRuleEffectivelyEnabled(r, info));
  const headerRules = getHeaderRulesFromUnified(effective);
  await applyHeaderRules(headerRules);
}

function resourceTypesFor(requestType) {
  const allTypes = ['main_frame','sub_frame','stylesheet','script','image',
                    'font','object','xmlhttprequest','ping','csp_report',
                    'media','websocket','other'];
  const typeMap = {
    all: allTypes,
    xhr: ['xmlhttprequest'],
    doc: ['main_frame','sub_frame'],
    script: ['script'],
    image: ['image'],
  };
  return typeMap[requestType] || allTypes;
}

function conditionFromSource(source) {
  const src = source || {};
  const condition = {
    resourceTypes: resourceTypesFor(src.requestType || 'all'),
  };
  if (src.matchType === 'regex') {
    condition.regexFilter = String(src.urlPattern || '.*');
  } else {
    condition.urlFilter = String(src.urlPattern || '*');
  }
  return condition;
}

function dnrRuleFromUnified(rule, id) {
  const action = rule.action || {};
  const type = rule.type;

  if (type === 'modify-header') {
    if (!action.header) return null;
    const headerOp = action.op === 'remove' ? 'remove' : action.op === 'add' ? 'append' : 'set';
    const target = action.target || 'request';
    const headerPayload = {
      header: String(action.header).toLowerCase(),
      operation: headerOp,
      ...(headerOp !== 'remove' && action.value ? { value: String(action.value) } : {}),
    };
    const dnr = {
      id,
      priority: Number.isFinite(rule.priority) ? rule.priority : 1,
      action: { type: 'modifyHeaders' },
      condition: conditionFromSource(rule.source),
    };
    if (target === 'request' || target === 'both') dnr.action.requestHeaders = [headerPayload];
    if (target === 'response' || target === 'both') dnr.action.responseHeaders = [headerPayload];
    return dnr;
  }

  if (type === 'cancel-request') {
    return {
      id,
      priority: Number.isFinite(rule.priority) ? rule.priority : 1,
      action: { type: 'block' },
      condition: conditionFromSource(rule.source),
    };
  }

  if (type === 'redirect-request') {
    const redirectUrl = action.redirectUrl || action.to || '';
    if (!redirectUrl) return null;
    return {
      id,
      priority: Number.isFinite(rule.priority) ? rule.priority : 1,
      action: { type: 'redirect', redirect: { url: String(redirectUrl) } },
      condition: conditionFromSource(rule.source),
    };
  }

  return null;
}

async function applyDnrRules(addRules) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing.map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds, addRules: addRules || [] });
    console.log('[QAKit] DNR dynamic rules applied:', (addRules || []).length);
  } catch (e) {
    console.warn('[QAKit] Could not apply DNR rules:', e.message);
  }
}

async function applyDnrRulesFromUnified() {
  const rules = await getUnifiedRules();
  const info = await getUnifiedRulesInfo();
  const effective = rules.filter(r => isRuleEffectivelyEnabled(r, info));
  const addRules = [];
  let id = 1000;
  effective.forEach(rule => {
    const dnr = dnrRuleFromUnified(rule, ++id);
    if (dnr) addRules.push(dnr);
  });
  await applyDnrRules(addRules);
}

async function recordUnifiedRuleHit(ruleType, ruleName, url) {
  if (!ruleType || !ruleName) return;
  try {
    const rules = await getUnifiedRules();
    const idx = rules.findIndex(r => r.type === ruleType && r.name === ruleName);
    if (idx < 0) return;
    const prevMeta = rules[idx].metadata || {};
    const prevDiag = prevMeta.diagnostics || {};
    const nextDiag = {
      ...prevDiag,
      hitCount: (prevDiag.hitCount || 0) + 1,
      lastMatchedAt: nowIso(),
      lastMatchedUrl: String(url || ''),
    };
    rules[idx] = normalizeUnifiedRule({
      ...rules[idx],
      metadata: {
        ...prevMeta,
        diagnostics: nextDiag,
      },
    }, rules[idx]);
    await saveUnifiedRules(rules, { diagnosticsUpdatedAt: nowIso() });
  } catch (_) {}
}

// In-memory markup image store — no quota limits unlike chrome.storage.session.
// Keyed by id; entries auto-delete after 5 min. Survives only while the SW is alive,
// but that's fine: markup.html opens immediately after OPEN_IN_EDITOR fires.
const _markupImages = new Map();
// Firefox lacks chrome.storage.session; fall back to local (same 5-min TTL cleanup applies)
const _sessionStorage = chrome.storage.session ?? chrome.storage.local;

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
      // Events can arrive (EVENT handler) while this async get() is in flight on
      // a fresh SW wake. Prepend the persisted history rather than clobbering
      // those just-captured live events.
      state.events = state.events.length
        ? stored.events.concat(state.events)
        : stored.events;
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
// Returns a cached promise so callers can AWAIT init completion. This matters
// on service-worker cold-start: the SW wakes to handle a message (e.g. the
// popup's GET_EVENTS) with state.events still empty, and restoreFromStorage()
// is async. Guarding on a boolean set before the awaits would let a concurrent
// caller see "done" while the restore is still in flight, so callers must be
// able to await the SAME promise instead. (See GET_EVENTS handler.)
let _initPromise = null;
function initBackground() {
  if (!_initPromise) {
    _initPromise = (async () => {
      await restoreFromStorage();
      await ensureUnifiedRulesMigrated();
      await restoreHeaderRules();
      setupContextMenus();
    })();
  }
  return _initPromise;
}

// ── Extension icon management ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  initBackground();
  const version = chrome.runtime.getManifest().version;
  if (details.reason === 'install' || (details.reason === 'update' && version === '1.1.0')) {
    // Open in background so the user's active tab never loses focus — screenshots
    // keep working immediately. User can switch to the welcome tab when ready.
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html'), active: false });
  }
});
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
    chrome.contextMenus.create({ id: 'qakit-inspect',       title: '🔍 Inspect Element  (Ctrl+⇧+Q)',        contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-spacing',       title: '📐 Spacing Inspector  (Ctrl+⇧+Y)',      contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-region',        title: '⬚ Region Screenshot  (Ctrl+⇧+Z)',       contexts: ['all'], parentId: 'qakit-root' });
    chrome.contextMenus.create({ id: 'qakit-fullpage',      title: '📄 Full Page Screenshot  (Ctrl+⇧+F)',   contexts: ['all'], parentId: 'qakit-root' });
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
          const el = window.__qkitLastContextTarget || document.activeElement;
          if (!el || !el.tagName) return;

          // Semantic/relative CSS selector (test-automation friendly)
          const TEST_A = ['data-testid','data-test','data-cy','data-qa','data-pw','data-automation-id','data-test-id'];
          function buildCss(elem) {
            if (!elem || elem === document.body) return 'body';
            if (elem.id && /^[a-zA-Z][\w-]*$/.test(elem.id)) return '#' + elem.id;
            for (const a of TEST_A) {
              if (elem.hasAttribute(a)) {
                return elem.tagName.toLowerCase() + '[' + a + '="' + elem.getAttribute(a) + '"]';
              }
            }
            const tag = elem.tagName.toLowerCase();
            const nm = elem.getAttribute('name');
            if (nm) return tag + '[name="' + nm + '"]';
            const al = elem.getAttribute('aria-label');
            if (al) return tag + '[aria-label="' + al + '"]';
            const ph = elem.getAttribute('placeholder');
            if (ph) return tag + '[placeholder="' + ph + '"]';
            function seg(node) {
              const t = node.tagName.toLowerCase();
              if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) return '#' + node.id;
              const cls = Array.from(node.classList).find(c => /^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/.test(c) && !/^\d+$/.test(c));
              if (cls && node.parentElement && node.parentElement.querySelectorAll(t + '.' + cls).length === 1) return t + '.' + cls;
              const p = node.parentElement;
              if (p) {
                const sibs = Array.from(p.children).filter(c => c.tagName === node.tagName);
                if (sibs.length === 1) return t;
                return t + ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
              }
              return t;
            }
            const parts = []; let node = elem;
            while (node && node !== document.documentElement && parts.length < 6) {
              parts.unshift(seg(node));
              const cand = parts.join(' > ');
              try { if (document.querySelectorAll(cand).length === 1) return cand; } catch(_) {}
              node = node.parentElement;
            }
            return parts.join(' > ');
          }

          const selector = buildCss(el);
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

          // Semantic/relative XPath (test-automation friendly)
          const TEST_A = ['data-testid','data-qa','data-test','data-cy','data-automation-id','data-test-id','data-pw'];
          function esc(v) { return v.replace(/"/g, '&quot;'); }
          function buildXPath(elem) {
            if (!elem || elem === document.body) return '//body';
            if (elem.id && /^[a-zA-Z][\w-]*$/.test(elem.id)) return '//*[@id="' + elem.id + '"]';
            for (const a of TEST_A) {
              if (elem.hasAttribute(a)) return '//*[@' + a + '="' + esc(elem.getAttribute(a)) + '"]';
            }
            const tag = elem.tagName.toLowerCase();
            const nm = elem.getAttribute('name');
            if (nm) return '//' + tag + '[@name="' + esc(nm) + '"]';
            const al = elem.getAttribute('aria-label');
            if (al) return '//' + tag + '[@aria-label="' + esc(al) + '"]';
            const ph = elem.getAttribute('placeholder');
            if (ph) return '//' + tag + '[@placeholder="' + esc(ph) + '"]';
            if (['button','a','label','th','h1','h2','h3','h4','h5','h6'].includes(tag)) {
              const txt = (elem.textContent || '').trim().replace(/\s+/g, ' ');
              if (txt && txt.length <= 40 && !txt.includes('"')) return '//' + tag + '[normalize-space()="' + txt + '"]';
            }
            if (tag === 'input') {
              const type = elem.getAttribute('type'), val = elem.getAttribute('value');
              if ((type === 'submit' || type === 'button' || type === 'reset') && val) {
                return '//input[@type="' + type + '" and @value="' + esc(val) + '"]';
              }
            }
            function seg(node) {
              const t = node.tagName.toLowerCase();
              const p = node.parentElement;
              if (!p) return t;
              const sibs = Array.from(p.children).filter(c => c.tagName === node.tagName);
              return sibs.length > 1 ? t + '[' + (sibs.indexOf(node) + 1) + ']' : t;
            }
            const parts = []; let node = elem;
            while (node && node.nodeType === 1 && node !== document.documentElement) {
              if (node !== elem) {
                if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) return '//*[@id="' + node.id + '"]/' + parts.join('/');
                for (const a of TEST_A) {
                  if (node.hasAttribute(a)) return '//*[@' + a + '="' + esc(node.getAttribute(a)) + '"]/' + parts.join('/');
                }
              }
              parts.unshift(seg(node));
              node = node.parentElement;
            }
            return '//' + parts.join('/');
          }

          const xpath = buildXPath(el);
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
      // Ranked candidate engine — same as inspector.js. Picks the best
      // verified-unique selector that targets the right-clicked element,
      // then formats it for the user's chosen output style.
      let customAttrs = '';
      let outputStyle = 'css';
      try {
        const s = await chrome.storage.local.get('qa_tools_settings');
        customAttrs = s.qa_tools_settings?.testIdAttr || '';
        outputStyle = s.qa_tools_settings?.locatorOutput || 'css';
      } catch (_) {}
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: info.frameId !== undefined ? [info.frameId] : undefined }, world: 'MAIN',
        func: (customAttrsStr, outStyle) => {
          const DEFAULTS = ['data-testid','data-qa','data-test','data-cy','data-automation-id','data-test-id','data-pw'];
          const custom = (customAttrsStr || '').split(',').map(s => s.trim()).filter(Boolean);
          const testAttrs = [...custom];
          DEFAULTS.forEach(a => { if (!testAttrs.includes(a)) testAttrs.push(a); });

          const startEl = window.__qkitLastContextTarget || document.activeElement;
          if (!startEl || !startEl.tagName) return;

          const JUNK = /^(?:css-[a-z0-9]+|mui-[a-z0-9]+|MuiBox-[a-z0-9]+|sc-[a-z0-9]+|jsx-\d+|emotion-[a-z0-9]+|chakra-[a-z0-9]+|ant-[a-z]+(?:-\w*)?-\d+|_[a-zA-Z0-9_]{6,}|[a-z]+-[0-9a-f]{6,}|[a-z]{1,3}\d{4,})$/;
          const isStable = c => c && c.length >= 2 && c.length <= 40 && /^[a-zA-Z][\w-]*$/.test(c) && !JUNK.test(c);
          const cleanCls = el => el && el.classList ? Array.from(el.classList).filter(isStable) : [];
          const escA = v => String(v).replace(/"/g, '\\"');
          const escX = v => String(v).replace(/"/g, '&quot;');
          const verifyCss = sel => { try { const n = document.querySelectorAll(sel).length; return { count: n, isUnique: n === 1 }; } catch (_) { return { count: 0, isUnique: false }; } };
          const verifyXp  = xp  => { try { const n = Math.round(document.evaluate('count(' + xp + ')', document, null, XPathResult.NUMBER_TYPE, null).numberValue); return { count: n, isUnique: n === 1 }; } catch (_) { return { count: 0, isUnique: false }; } };
          const matches = (sel, type, el) => {
            try {
              if (type === 'xpath') {
                const it = document.evaluate(sel, document, null, XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null);
                let n = it.iterateNext();
                while (n) { if (n === el) return true; n = it.iterateNext(); }
                return false;
              }
              return Array.from(document.querySelectorAll(sel)).indexOf(el) !== -1;
            } catch (_) { return false; }
          };
          function findAnchor(el) {
            let n = el.parentElement;
            while (n && n !== document.documentElement && n.tagName) {
              for (const a of testAttrs) { if (n.hasAttribute(a)) { const v = n.getAttribute(a); return { el: n, attr: a, sel: '[' + a + '="' + escA(v) + '"]', xp: '//*[@' + a + '="' + escX(v) + '"]' }; } }
              if (n.id && /^[a-zA-Z][\w-]*$/.test(n.id)) return { el: n, attr: 'id', sel: '#' + n.id, xp: '//*[@id="' + n.id + '"]' };
              n = n.parentElement;
            }
            return null;
          }
          function buildCandidates(el) {
            const cs = [];
            const tag = el.tagName.toLowerCase();
            const push = c => {
              const v = c.type === 'xpath' ? verifyXp(c.selector) : verifyCss(c.selector);
              c.count = v.count; c.isUnique = v.isUnique;
              if (c.count === 0) return;
              if (!matches(c.selector, c.type, el)) return;
              if (cs.some(x => x.selector === c.selector)) return;
              cs.push(c);
            };
            // Tier 1
            for (const a of testAttrs) { if (el.hasAttribute(a)) push({ tier: 1, label: a, type: 'css', selector: '[' + a + '="' + escA(el.getAttribute(a)) + '"]' }); }
            if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) push({ tier: 1, label: 'id', type: 'css', selector: '#' + el.id });
            const anchor = findAnchor(el);
            // Tier 2
            if (anchor) {
              const aria = el.getAttribute('aria-label');
              if (aria) push({ tier: 2, label: 'anchor:aria', type: 'css', anchor: anchor.attr, selector: anchor.sel + ' ' + tag + '[aria-label="' + escA(aria) + '"]' });
              if (['a','button','label','th','h1','h2','h3','h4','h5','h6','span','p','strong','em','li'].includes(tag)) {
                const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
                if (txt && txt.length <= 50 && !txt.includes('"')) push({ tier: 2, label: 'anchor:text', type: 'xpath', anchor: anchor.attr, selector: anchor.xp + '//' + tag + '[normalize-space()="' + txt + '"]' });
              }
            }
            // Tier 3
            const aria = el.getAttribute('aria-label'); if (aria) push({ tier: 3, label: 'aria-label', type: 'css', selector: tag + '[aria-label="' + escA(aria) + '"]' });
            const nm = el.getAttribute('name'); if (nm) push({ tier: 3, label: 'name', type: 'css', selector: tag + '[name="' + escA(nm) + '"]' });
            const role = el.getAttribute('role'); if (role) push({ tier: 3, label: 'role', type: 'css', selector: tag + '[role="' + escA(role) + '"]' });
            if (['a','button','label','th','h1','h2','h3','h4','h5','h6'].includes(tag)) {
              const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
              if (txt && txt.length <= 40 && !txt.includes('"')) push({ tier: 3, label: 'text', type: 'xpath', selector: '//' + tag + '[normalize-space()="' + txt + '"]' });
            }
            // Tier 4
            if (anchor) {
              push({ tier: 4, label: 'anchor:tag', type: 'css', anchor: anchor.attr, selector: anchor.sel + ' ' + tag });
              const cc = cleanCls(el);
              if (cc.length) push({ tier: 4, label: 'anchor:class', type: 'css', anchor: anchor.attr, selector: anchor.sel + ' ' + tag + '.' + cc[0] });
              const par = el.parentElement;
              if (par) { const sibs = Array.from(par.children).filter(c => c.tagName === el.tagName); if (sibs.length > 1) push({ tier: 4, label: 'anchor:nth', type: 'css', anchor: anchor.attr, selector: anchor.sel + ' ' + tag + ':nth-of-type(' + (sibs.indexOf(el) + 1) + ')' }); }
            }
            // Tier 5
            const ph = el.getAttribute('placeholder'); if (ph) push({ tier: 5, label: 'placeholder', type: 'css', selector: tag + '[placeholder="' + escA(ph) + '"]' });
            const cc2 = cleanCls(el); if (cc2.length) push({ tier: 5, label: 'class', type: 'css', selector: tag + '.' + cc2[0] });
            cs.sort((a, b) => (a.isUnique !== b.isUnique) ? (a.isUnique ? -1 : 1) : (a.tier !== b.tier ? a.tier - b.tier : a.selector.length - b.selector.length));
            return cs;
          }
          function format(cand, style) {
            if (!cand) return '';
            const sel = cand.selector;
            if (style === 'playwright') {
              let m = /^\[data-testid="(.+)"\]$/.exec(sel);
              if (m) return "page.getByTestId('" + m[1].replace(/'/g, "\\'") + "')";
              m = /^\w+\[aria-label="(.+)"\]$/.exec(sel);
              if (m) return "page.getByLabel('" + m[1].replace(/'/g, "\\'") + "')";
              m = /^\w+\[role="(.+)"\]$/.exec(sel);
              if (m) return "page.getByRole('" + m[1].replace(/'/g, "\\'") + "')";
              if (cand.type === 'xpath') return "page.locator('xpath=" + sel.replace(/'/g, "\\'") + "')";
              return "page.locator('" + sel.replace(/'/g, "\\'") + "')";
            }
            if (style === 'cypress') {
              // Cypress has no native cy.xpath() — translate text-based xpaths
              // into cy.contains() (native) and skip ones we can't express.
              if (cand.type === 'xpath') {
                let m = /^(\[[^\]]+\]|#[\w-]+)\/\/(\w+)\[normalize-space\(\)="(.+)"\]$/.exec(sel);
                if (m) {
                  return "cy.get('" + m[1].replace(/'/g, "\\'") + "').contains('" + m[2] + "', '" + m[3].replace(/'/g, "\\'") + "')";
                }
                m = /^\/\/(\w+)\[normalize-space\(\)="(.+)"\]$/.exec(sel);
                if (m) return "cy.contains('" + m[1] + "', '" + m[2].replace(/'/g, "\\'") + "')";
                return null;
              }
              return "cy.get('" + sel.replace(/'/g, "\\'") + "')";
            }
            return sel;
          }

          const candidates = buildCandidates(startEl);
          // Pick the best candidate that the active output style can express
          // natively. In Cypress mode an XPath that isn't a text query yields
          // null from format(), so we walk down the ranked list until one
          // sticks.
          let best = null, copy = null;
          for (const c of candidates) {
            const formatted = format(c, outStyle);
            if (formatted != null) { best = c; copy = formatted; break; }
          }
          let label;
          if (best) {
            const u = best.isUnique ? '✓' : '⚠ ' + best.count + '×';
            label = '⎘ ' + best.label + ' ' + u;
          } else {
            copy  = startEl.tagName.toLowerCase();
            label = '⎘ tag (no locator found)';
          }
          navigator.clipboard.writeText(copy).then(() => {
            const t = document.createElement('div');
            t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0a6e51;color:#fff;padding:8px 14px;border-radius:6px;font-family:sans-serif;font-size:13px;font-weight:600;max-width:400px;word-break:break-all';
            t.textContent = label + '  →  ' + (copy.length > 80 ? copy.slice(0, 80) + '…' : copy);
            document.body.appendChild(t);
            setTimeout(() => t.remove(), 3000);
          }).catch(() => {});
        },
        args: [customAttrs, outputStyle],
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
    // Wait for restoreFromStorage() to finish before answering. On a cold SW
    // wake this message IS what woke the worker, so state.events would still be
    // [] here — responding synchronously returns zero events even though they
    // are persisted. Awaiting init fixes the "analytics shows 0 events" refresh.
    initBackground().then(() => {
      sendResponse({ events: state.events, paused: state.paused });
    });
    return true; // keep the message channel open for the async response
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
    (async () => {
      await syncUnifiedHeadersFromLegacy(msg.rules || []);
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'SYNC_NETWORK_MOCK_RULES') {
    (async () => {
      await syncUnifiedNetworkMockFromLegacy(msg.rules || []);
      sendResponse({ ok: true });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Unified rule engine API (Phase 1 foundation)
  if (msg.action === 'GET_UNIFIED_RULES') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const data = await chrome.storage.local.get([UNIFIED_RULES_KEY, UNIFIED_RULES_INFO_KEY]);
      sendResponse({
        ok: true,
        rules: data[UNIFIED_RULES_KEY] || [],
        info: {
          ...DEFAULT_UNIFIED_RULES_INFO,
          ...(data[UNIFIED_RULES_INFO_KEY] || {}),
          schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
        },
      });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'SET_UNIFIED_RULES_PAUSED') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const currentRules = await getUnifiedRules();
      const info = await getUnifiedRulesInfo();
      info.paused = !!msg.paused;
      await saveUnifiedRules(currentRules, info);
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true, paused: info.paused });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'SET_UNIFIED_GROUP_STATE') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const groupId = String(msg.groupId || 'default');
      const enabled = msg.enabled !== false;
      const currentRules = await getUnifiedRules();
      const info = await getUnifiedRulesInfo();
      info.groupStates = { ...(info.groupStates || {}), [groupId]: enabled };
      await saveUnifiedRules(currentRules, info);
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true, groupId, enabled });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'UPSERT_UNIFIED_RULE') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const current = await getUnifiedRules();
      const incoming = msg.rule || {};
      const idx = current.findIndex(r => r.id === incoming.id);
      if (idx >= 0) {
        current[idx] = normalizeUnifiedRule(incoming, current[idx]);
      } else {
        current.push(normalizeUnifiedRule(incoming));
      }
      await saveUnifiedRules(current);
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true, rules: current });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'DELETE_UNIFIED_RULE') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const current = await getUnifiedRules();
      const next = current.filter(r => r.id !== msg.id);
      await saveUnifiedRules(next);
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true, rules: next });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'TOGGLE_UNIFIED_RULE') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const current = await getUnifiedRules();
      const idx = current.findIndex(r => r.id === msg.id);
      if (idx < 0) {
        sendResponse({ ok: false, error: 'rule not found' });
        return;
      }
      current[idx] = normalizeUnifiedRule({
        ...current[idx],
        enabled: msg.enabled !== undefined ? !!msg.enabled : !current[idx].enabled,
      }, current[idx]);
      await saveUnifiedRules(current);
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true, rules: current });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'EXPORT_UNIFIED_RULES') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const data = await chrome.storage.local.get([UNIFIED_RULES_KEY, UNIFIED_RULES_INFO_KEY]);
      const pack = {
        schema: 'qakit-unified-rules',
        schemaVersion: UNIFIED_RULES_SCHEMA_VERSION,
        exportedAt: nowIso(),
        info: data[UNIFIED_RULES_INFO_KEY] || {},
        rules: data[UNIFIED_RULES_KEY] || [],
      };
      sendResponse({ ok: true, pack });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'IMPORT_UNIFIED_RULES') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const strategy = msg.strategy === 'replace' ? 'replace' : 'merge';
      const pack = msg.pack || {};
      const validation = validateRulesPack(pack);
      if (!validation.ok) {
        sendResponse({ ok: false, error: validation.error, invalid: validation.invalid || [] });
        return;
      }
      const imported = pack.rules.map(r => normalizeUnifiedRule(r));
      let next = imported;
      if (strategy === 'merge') {
        const current = await getUnifiedRules();
        const byId = new Map(current.map(r => [r.id, r]));
        imported.forEach(r => byId.set(r.id, r));
        next = Array.from(byId.values());
      }
      await saveUnifiedRules(next, {
        importedAt: nowIso(),
        importStrategy: strategy,
      });
      await applyDnrRulesFromUnified();
      sendResponse({ ok: true, rules: next });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'DRY_RUN_IMPORT_UNIFIED_RULES') {
    (async () => {
      await ensureUnifiedRulesMigrated();
      const strategy = msg.strategy === 'replace' ? 'replace' : 'merge';
      const pack = msg.pack || {};
      const validation = validateRulesPack(pack);
      if (!validation.ok) {
        sendResponse({ ok: false, error: validation.error, invalid: validation.invalid || [] });
        return;
      }

      const current = await getUnifiedRules();
      const imported = pack.rules.map(r => normalizeUnifiedRule(r));
      const summary = buildImportSummary(current, imported);
      const nextCount = strategy === 'replace'
        ? imported.length
        : new Set(current.map(r => r.id).concat(imported.map(r => r.id))).size;

      sendResponse({
        ok: true,
        strategy,
        summary: {
          ...summary,
          nextCount,
        },
      });
    })().catch(e => sendResponse({ ok: false, error: e.message }));
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
      // Crop + inject toast; keep channel open so SW stays alive until toast is shown
      processRegionCapture(tabId, stored, msg.rect).then(() => sendResponse({ ok: true }));
      return true;
    } else {
      // Fallback: try to capture now (may fail in Chrome if window lost focus)
      processRegionCaptureWithDelay(tabId, msg.rect, 300);
      sendResponse({ ok: true });
      return;
    }
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
      processRegionCapture(tabId, stored, msg.rect).then(() => sendResponse({ ok: true }));
      return true;
    } else {
      // Shouldn't happen — context-menu handler pre-captures before launching
      // the picker. Fallback to late capture with a delay.
      processRegionCaptureWithDelay(tabId, msg.rect, 300);
      sendResponse({ ok: true });
      return;
    }
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
        // Use tabId passed from popup context — more reliable than querying from SW
        // where currentWindow is undefined after the popup closes.
        let tab = msg.tabId ? await chrome.tabs.get(msg.tabId).catch(() => null) : null;
        if (!tab) [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tab || !tab.url?.startsWith('http')) { sendResponse({ ok: false, error: 'no injectable tab' }); return; }
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
    // Use sender's windowId — captureVisibleTab(null) is unreliable from SW context.
    const wid = sender.tab?.windowId ?? null;
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(wid, { format: 'jpeg', quality: 92 }, dataUrl => {
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
    recordUnifiedRuleHit('mock-response', msg.entry?.ruleName, msg.entry?.url);
    chrome.runtime.sendMessage({ action: 'NET_INTERCEPTED', entry: msg.entry }).catch(() => {});
    return;
  }

  // Open screenshot in QAKit Markup editor (in-extension annotation page).
  // Image is stored in chrome.storage.session so it survives service-worker
  // restarts (Chrome aggressively terminates idle SW in production). The markup
  // tab retrieves it via FETCH_MARKUP_IMAGE on load and the entry is deleted.
  if (msg.action === 'OPEN_IN_EDITOR') {
    const { dataUrl, prefix, id: existingId } = msg;

    if (existingId) {
      // Fast path: image was pre-stored by injectScreenshotToast — open the tab directly.
      const url = chrome.runtime.getURL('markup.html') + '?id=' + encodeURIComponent(existingId);
      chrome.tabs.create({ url });
      sendResponse({ ok: true });
      return;
    }

    if (!dataUrl) {
      console.warn('[QAKit] OPEN_IN_EDITOR: no dataUrl provided');
      sendResponse({ ok: false });
      return;
    }
    // Store in memory first (no quota), then best-effort session storage.
    const id = 'mk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const entry = { dataUrl, prefix: prefix || 'qakit-screenshot' };
    _markupImages.set(id, entry);
    setTimeout(() => _markupImages.delete(id), 5 * 60 * 1000);
    _sessionStorage.set({ [id]: entry })
      .then(() => setTimeout(() => _sessionStorage.remove(id).catch(() => {}), 5 * 60 * 1000))
      .catch(() => {});
    const url = chrome.runtime.getURL('markup.html') + '?id=' + encodeURIComponent(id);
    chrome.tabs.create({ url });
    sendResponse({ ok: true });
    return;
  }

  // Markup page asks for its image. One-shot: the entry is removed after read.
  if (msg.action === 'FETCH_MARKUP_IMAGE') {
    const id = msg.id;
    // In-memory store is checked first — no quota issues even for large screenshots.
    const memEntry = _markupImages.get(id);
    if (memEntry) {
      _markupImages.delete(id);
      sendResponse({ ok: true, entry: memEntry });
      return;
    }
    // Fallback to session storage (covers SW-restart case for smaller images).
    _sessionStorage.get(id)
      .then(result => {
        const entry = result[id] || null;
        if (entry) _sessionStorage.remove(id);
        sendResponse({ ok: !!entry, entry });
      })
      .catch(() => sendResponse({ ok: false, entry: null }));
    return true;
  }

  // Save screenshot — always prompt for save location (saveAs: true) so the
  // user can choose where the PNG is written, regardless of their Chrome
  // "Ask where to save" preference. Checks optional downloads permission first;
  // responds with needsPermission:true so callers can prompt the user.
  if (msg.action === 'SAVE_SCREENSHOT') {
    const { dataUrl, prefix } = msg;
    chrome.permissions.contains({ permissions: ['downloads'] }, (has) => {
      if (!has) {
        sendResponse({ ok: false, needsPermission: true });
        return;
      }
      const filename = (prefix || 'qakit-screenshot') + '-' + Date.now() + '.png';
      chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: true,
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[QAKit] SAVE_SCREENSHOT: download failed:', chrome.runtime.lastError.message);
        }
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'OPEN_WELCOME_PAGE') {
    chrome.tabs.query({ url: chrome.runtime.getURL('welcome.html') }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html'), active: true });
      }
    });
    sendResponse({ ok: true });
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
    // Skip injection on extension pages — scripting API cannot target them
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.url?.startsWith('chrome-extension://') || tab.url?.startsWith('chrome://')) {
      console.warn('[QAKit] injectScreenshotToast: skipping non-injectable tab', tab?.url);
      return;
    }

    // Pre-store the image so the toast's Markup button only dispatches a small ID.
    // This avoids routing the full (potentially multi-MB) data URL through the
    // CustomEvent → content-script → sendMessage chain, which can silently fail
    // for full-page screenshots that exceed chrome.storage.session quota.
    const markupId = 'mk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    _markupImages.set(markupId, { dataUrl: pngDataUrl, prefix: downloadPrefix });
    setTimeout(() => _markupImages.delete(markupId), 5 * 60 * 1000);
    // Best-effort session storage for SW-restart resilience (quota may reject large images)
    _sessionStorage.set({ [markupId]: { dataUrl: pngDataUrl, prefix: downloadPrefix } })
      .then(() => setTimeout(() => _sessionStorage.remove(markupId).catch(() => {}), 5 * 60 * 1000))
      .catch(() => {});

    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (imgUrl, toastLabel, dlPrefix, mkId) => {
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
        saveBtn.textContent = '⬇ Save';
        saveBtn.style.cssText = [
          'flex:1;background:#0a6e51;color:#fff;border:none;border-radius:6px',
          'padding:7px 10px;font-size:13px;cursor:pointer;font-weight:700',
          'transition:background .12s',
        ].join(';');
        saveBtn.onmouseover = () => { saveBtn.style.background = '#085c44'; };
        saveBtn.onmouseout  = () => { saveBtn.style.background = '#0a6e51'; };
        saveBtn.onclick = () => {
          window.dispatchEvent(new CustomEvent('__qkitSaveScreenshot', {
            detail: { dataUrl: imgUrl, prefix: dlPrefix }
          }));
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

        // Markup button — opens the QAKit Markup editor in a new tab.
        // MAIN world has no chrome API access, so dispatch a CustomEvent that
        // content.js (isolated world) forwards to background via sendMessage.
        const editBtn = document.createElement('button');
        editBtn.textContent = '✎ Markup';
        editBtn.style.cssText = [
          'flex:1;background:#2a3a5c;color:#a0c4ff;border:1px solid rgba(160,196,255,.3)',
          'border-radius:6px;padding:7px 10px;font-size:13px;cursor:pointer;font-weight:700',
          'transition:background .12s',
        ].join(';');
        editBtn.onmouseover = () => { editBtn.style.background = '#344a72'; };
        editBtn.onmouseout  = () => { editBtn.style.background = '#2a3a5c'; };
        editBtn.onclick = () => {
          // Dispatch only the pre-stored ID — avoids routing the full data URL
          // through the event bridge, which silently fails for large screenshots.
          window.dispatchEvent(new CustomEvent('__qkitEditScreenshot', {
            detail: { id: mkId }
          }));
          toast.remove();
        };

        btns.appendChild(saveBtn);
        btns.appendChild(editBtn);
        btns.appendChild(closeBtn);
        toast.appendChild(btns);

        document.body.appendChild(toast);
        // Auto-dismiss after 15 seconds
        setTimeout(() => toast.parentNode && toast.remove(), 15000);
      },
      args: [pngDataUrl, label, downloadPrefix, markupId],
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

    const pngDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror  = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(outBlob);
    });
    chrome.runtime.sendMessage({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl: pngDataUrl }).catch(() => {});
    await injectScreenshotToast(tabId, pngDataUrl, 'Region captured', 'qakit-region');
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
    const pngDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror  = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(outBlob);
    });
    chrome.runtime.sendMessage({ action: 'DELIVER_CROPPED_SCREENSHOT', dataUrl: pngDataUrl }).catch(() => {});
    await injectScreenshotToast(tabId, pngDataUrl, 'Full page captured', 'qakit-fullpage');
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
  // Resolve windowId up-front so captureVisibleTab always gets an explicit target.
  // Using null from a service worker context is unreliable — SW has no "current window".
  const tabInfo = await chrome.tabs.get(tabId).catch(() => null);
  if (!tabInfo) throw new Error('Tab not found');
  const windowId = tabInfo.windowId;

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

  let captureError = null;
  try {
    // Scroll to top first and wait for any lazy-load reflows.
    await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: y => window.__qkitScrollTo?.(y), args: [0],
    });
    await new Promise(r => setTimeout(r, 300));
    while (scrollY < scrollHeight) {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: y => { window.scrollTo(0, y); }, args: [scrollY],
      });
      // Wait for scroll + any paint
      await new Promise(r => setTimeout(r, CAPTURE_DELAY));

      const dataUrl = await new Promise((resolve, reject) => {
        // Use JPEG quality 92 — much faster encoding than PNG for large pages.
        // Must use explicit windowId — captureVisibleTab(null) is unreliable from SW context.
        chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 92 }, url => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(url);
        });
      });
      strips.push({ dataUrl, scrollY, height: viewportHeight });
      scrollY += viewportHeight;
    }
  } catch (e) {
    captureError = e;
    throw e;
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
    }).catch(e => console.warn('[QAKit] Could not restore screenshot overlays:', e.message));
    try {
      await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: y => window.scrollTo(0, y), args: [originalScrollY],
      });
    } catch (e) {
      if (!captureError) throw e;
      console.warn('[QAKit] Could not restore scroll position:', e.message);
    }
  }

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
      const target = rule.target || 'request';

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
        },
        condition: {
          urlFilter: rule.urlFilter,
          resourceTypes,
        },
      };
      const headerPayload = {
        header: rule.header.toLowerCase(),
        operation: headerOp,
        ...(headerOp !== 'remove' && rule.value ? { value: rule.value } : {}),
      };
      if (target === 'response' || target === 'both') {
        dnrRule.action.responseHeaders = [headerPayload];
      }
      if (target === 'request' || target === 'both') {
        dnrRule.action.requestHeaders = [headerPayload];
      }
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
    if (rules.length > 0) {
      await syncUnifiedHeadersFromLegacy(rules);
    }
    // Apply from unified store so all unified DNR-capable rule types coexist.
    await applyDnrRulesFromUnified();
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
    // Inject the analytics interceptor EARLY too. Some providers fire during
    // page load — notably Adobe Client Data Layer (ACDL), which deletes event
    // items from the array after dispatch, so an interceptor that only arrives
    // at 'complete' can never see or replay them. Injecting at 'loading' lets
    // it register its hooks before those events fire. Idempotent (guarded by
    // window.__qAnalyticsInstalled); the 'complete' pass below is the backstop.
    if (allowed) injectAnalyticsInterceptor(tabId);
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
      ['gtm','ga4','ddl','wae','adobe','adobedl','tealium','meta','floodlight','segment'];

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
      func:   activeRules => { window.__qNetRules = activeRules; },
      args: [rules],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['network-interceptor.js'],
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
