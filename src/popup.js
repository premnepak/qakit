// popup.js — QAKit

const CATEGORY_COLORS = {
  // DOM events (content.js)
  click:        '#00c9ff',
  keyboard:     '#ffd700',
  navigation:   '#00e5a0',
  error:        '#ff6b6b',
  custom:       '#b06bff',
  lifecycle:    '#ff9f43',
  visibility:   '#1e90ff',
  scroll:       '#a0a0c0',
  // Analytics interceptor (analytics-interceptor.js)
  GTM:          '#ff6ec7',
  DDL:          '#f97316',
  GA4:          '#4ade80',
  'Meta Pixel': '#1877f2',
  Adobe:        '#e2231a',
  'Adobe DL':   '#b81d13',
  Tealium:      '#00b5ad',
  Floodlight:   '#fbbc04',
  Segment:      '#52bd95',
  // Legacy names kept for backwards compat with stored events
  dataLayer:    '#ff6ec7',
  'GTM/dataLayer': '#ff6ec7',
  console_error:'#ff6b6b',
};

// ── LS target keys (only these are shown) ─────────────────────────────────────
let LS_TARGET_KEYS = [
  'dismissed_alerts',
  'redirectPopupSelection',
  'qff_soft_identity',
  'recentAirports',
];

// Session storage target keys — synced from settings (settingSsKeys). Empty = show all.
let SS_TARGET_KEYS = [];

// Which web-storage area the Storage panel is currently showing.
// 'local' → localStorage; 'session' → sessionStorage. Each honours its own target-key filter.
let _storeType = 'local';
function storeLabel(t) { return (t || _storeType) === 'session' ? 'Session Storage' : 'Local Storage'; }
function storeApiName(t) { return (t || _storeType) === 'session' ? 'sessionStorage' : 'localStorage'; }
function storeTargetKeys(t) { return (t || _storeType) === 'session' ? SS_TARGET_KEYS : LS_TARGET_KEYS; }

let allEvents  = [];
let paused     = false;
let searchQuery   = '';
let searchParsed  = { include: [], exclude: [], mode: 'or' };  // Fix 26 — parsed criteria
let platformQuery = ''; // platform filter from ddlPlatformFilter dropdown
let eventTypeQuery = ''; // event type filter from ddlEventTypeFilter dropdown
let isAllowedTab = false;

let activeTab  = 'pagetools';

// Storage keys for analytics filters
const ANALYTICS_FILTER_KEYS = {
  search: 'qakit_analytics_search',
  platform: 'qakit_analytics_platform',
  eventType: 'qakit_analytics_eventtype',
};

// Persist analytics filter state
function persistAnalyticsFilters() {
  chrome.storage.local.set({
    [ANALYTICS_FILTER_KEYS.search]: searchQuery,
    [ANALYTICS_FILTER_KEYS.platform]: platformQuery,
    [ANALYTICS_FILTER_KEYS.eventType]: eventTypeQuery,
  }).catch(() => {});
}

// Restore analytics filter state and update UI/vars
async function restoreAnalyticsFilters() {
  try {
    const s = await chrome.storage.local.get([
      ANALYTICS_FILTER_KEYS.search,
      ANALYTICS_FILTER_KEYS.platform,
      ANALYTICS_FILTER_KEYS.eventType,
    ]);
    // Only use saved filter, do not use settings.analyticsFilter
    searchQuery = s[ANALYTICS_FILTER_KEYS.search] || '';
    platformQuery = s[ANALYTICS_FILTER_KEYS.platform] || '';
    eventTypeQuery = s[ANALYTICS_FILTER_KEYS.eventType] || '';
    searchParsed = parseSearchQuery(searchQuery);
    // Update UI controls if present
    const searchBox = document.getElementById('searchInput');
    if (searchBox) searchBox.value = searchQuery;
    const platformFilter = document.getElementById('ddlPlatformFilter');
    if (platformFilter) platformFilter.value = platformQuery;
    const eventTypeFilter = document.getElementById('ddlEventTypeFilter');
    if (eventTypeFilter) eventTypeFilter.value = eventTypeQuery;
  } catch (_) {}
}

// Register listeners after DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  const searchBox = document.getElementById('searchInput');
  if (searchBox) {
    searchBox.addEventListener('input', (e) => {
      searchQuery = e.target.value || '';
      searchParsed = parseSearchQuery(searchQuery);
      persistAnalyticsFilters();
      renderDDL();
    });
  }
  const platformFilter = document.getElementById('ddlPlatformFilter');
  if (platformFilter) {
    platformFilter.addEventListener('change', (e) => {
      platformQuery = e.target.value || '';
      persistAnalyticsFilters();
      renderDDL();
    });
  }
  const eventTypeFilter = document.getElementById('ddlEventTypeFilter');
  if (eventTypeFilter) {
    eventTypeFilter.addEventListener('change', (e) => {
      eventTypeQuery = e.target.value || '';
      persistAnalyticsFilters();
      renderDDL();
    });
  }
});

// ── Multi-criteria search parser (Fix 26) ─────────────────────────────────
// Parses raw search string into { include, exclude, mode }.
// Examples:
//   "wae, ddl"     → include: ['wae','ddl'],  mode: 'or'
//   "wae +ddl"     → include: ['wae','ddl'],  mode: 'and' (any +token forces AND)
//   "wae -test"    → include: ['wae'], exclude: ['test'], mode: 'or'
//   "+wae +ddl -test" → include: ['wae','ddl'], exclude: ['test'], mode: 'and'
// Default = OR. Single-term queries behave the same as before.
function parseSearchQuery(raw) {
  const out = { include: [], exclude: [], mode: 'or' };
  if (!raw) return out;
  // Split by commas or runs of whitespace; keep + and - prefixes attached
  const tokens = String(raw).toLowerCase().split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  let hasAndPrefix = false;
  tokens.forEach(t => {
    if (t.startsWith('-') && t.length > 1) {
      out.exclude.push(t.slice(1));
    } else if (t.startsWith('+') && t.length > 1) {
      out.include.push(t.slice(1));
      hasAndPrefix = true;
    } else {
      out.include.push(t);
    }
  });
  if (hasAndPrefix) out.mode = 'and';
  return out;
}

// Test if an event matches the parsed search criteria.
function matchesSearchCriteria(evt, parsed) {
  if (!parsed.include.length && !parsed.exclude.length) return true;
  const haystack = JSON.stringify(evt).toLowerCase();
  // Exclude wins: if any excluded term is found, reject
  for (const term of parsed.exclude) {
    if (haystack.includes(term)) return false;
  }
  if (!parsed.include.length) return true;
  if (parsed.mode === 'and') {
    return parsed.include.every(t => haystack.includes(t));
  }
  return parsed.include.some(t => haystack.includes(t));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

// Escape user-supplied strings before embedding in innerHTML.
// Fixes a hygiene issue where LS keys / cookie names / URLs from pages could
// inject markup into the privileged popup context.
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtData(data) {
  if (!data) return '';
  return Object.entries(data)
    // Keep 0, false, '' — only drop null/undefined
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return '<span class="k">' + escapeHtml(k) + ':</span><span class="v">' + escapeHtml(val) + '</span>';
    })
    .join('  ');
}

// Strip QAKit-internal bookkeeping keys and eliminate duplication between
// `_raw` (the deep-copy of the original push) and the lifted fields at top
// level.
//
// The interceptor stores each event as:
//   { _raw: <full original push>, page: ..., user: ..., eventDetails: ... }
// where the non-underscore fields are lifted copies of `_raw.<field>`.
//
// For display / export we want only the original push — so we return `_raw`
// when it exists (that IS the full payload). If `_raw` is missing, we return
// the object with internal keys removed.
function cleanEventData(data) {
  if (!data || typeof data !== 'object') return data;
  // If we have _raw, it already contains the original complete payload —
  // all the lifted fields are duplicates. Just return _raw.
  if (data._raw && typeof data._raw === 'object') {
    return data._raw;
  }
  // Otherwise strip known internal keys
  const INTERNAL_KEYS = new Set(['_raw', '_replayed', '_unserialisable', '__qkitOwn']);
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (INTERNAL_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// HTML-escaped JSON for <pre> display inside the UI.
function fmtFullJSON(data) {
  if (!data) return '{}';
  const cleaned = cleanEventData(data);
  return escapeHtml(JSON.stringify(cleaned, null, 2));
}

// Raw JSON for clipboard / export — NOT HTML-escaped.
function fmtRawJSON(data) {
  if (!data) return '{}';
  const cleaned = cleanEventData(data);
  return JSON.stringify(cleaned, null, 2);
}

// Simple debounce used to batch rapid-fire re-renders (e.g. analytics events
// firing 50/sec from a GTM-heavy page).
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// ── UI Updates ────────────────────────────────────────────────────────────────

// Category → provider key map — used by both updateStats and renderDDL.
// 'click' / DOM-captured events are always shown (not in this map).
const CATEGORY_TO_PROVIDER = {
  'GTM':        'gtm',
  'GTM/_dl':    'gtm',
  'DDL':        'ddl',
  'GA4':        'ga4',
  'Adobe':      'adobe',
  'Adobe DL':   'adobedl',
  'Tealium':    'tealium',
  'Meta Pixel': 'meta',
  'Floodlight': 'floodlight',
  'Segment':    'segment',
};

// Returns the Set of enabled provider keys from settings (or all if settings unavailable).
function enabledProviderSet() {
  const providers = (typeof getSettings === 'function' && getSettings().analyticsProviders)
    || ['gtm','ga4','ddl','adobe','adobedl','tealium','meta','floodlight','segment'];
  return new Set(providers);
}

function updateStats() {
  const providerSet = enabledProviderSet();
  const filtered = allEvents.filter(e => {
    if (!matchesSearchCriteria(e, searchParsed)) return false;
    if (platformQuery  && e.category !== platformQuery)  return false;
    if (eventTypeQuery && e.event    !== eventTypeQuery) return false;
    const provider = CATEGORY_TO_PROVIDER[e.category];
    if (provider && !providerSet.has(provider)) return false;
    return true;
  });
  const total      = filtered.length;
  const clickCount = filtered.filter(e => e.category === 'click').length;
  const errCount   = allEvents.filter(e => e.category === 'error' || e.category === 'console_error').length;
  const mockCount  = allEvents.filter(e => e.category === 'mock_intercept').length;

  // Total visible events — what renderDDL would show with current provider set + no extra filters
  const providerTotal = allEvents.filter(e => {
    const p = CATEGORY_TO_PROVIDER[e.category];
    return !p || providerSet.has(p);
  }).length;

  // ── Tab badges — show counts directly on the tab label ───────────────────
  function setTabBadge(tabId, count, color) {
    const tabEl = document.querySelector('.tab[data-tab="' + tabId + '"]');
    if (!tabEl) return;
    let badge = tabEl.querySelector('.tab-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-badge';
      tabEl.appendChild(badge);
    }
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.background = color;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  setTabBadge('ddl',     total,      'var(--accent)');
  setTabBadge('net',     mockCount,  '#b06bff');
  setTabBadge('console', errCount,   'var(--warn)');

  // Analytics event count
  const ddlCountEl = document.getElementById('ddlEventCount');
  if (ddlCountEl) {
    const hasFilters = (searchParsed.include.length || searchParsed.exclude.length) || platformQuery || eventTypeQuery;
    ddlCountEl.textContent = hasFilters
      ? total + ' / ' + providerTotal + ' events'
      : providerTotal + ' events' + (clickCount ? ' · ' + clickCount + ' clicks' : '');
  }
}

function updateStatus() {
  const dot      = document.getElementById('dot');
  const badge    = document.getElementById('statusBadge');      // legacy (removed from DOM)
  const pauseBtn = document.getElementById('pauseBtn');
  const toggle   = document.getElementById('recToggle');
  const recLabel = document.getElementById('recLabel');

  if (!isAllowedTab) {
    dot.className = 'dot inactive';
    if (badge) { badge.className = 'status-badge inactive'; badge.textContent = 'INACTIVE'; }
    if (toggle) { toggle.classList.add('paused'); toggle.title = 'Recording disabled — domain not allowed in settings'; }
    if (recLabel) recLabel.textContent = 'OFF';
    if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.style.opacity = '.4'; }
  } else if (paused) {
    dot.className = 'dot paused';
    if (badge) { badge.className = 'status-badge paused'; badge.textContent = 'PAUSED'; }
    if (toggle) { toggle.classList.add('paused'); toggle.title = 'Recording paused — click to resume'; }
    if (recLabel) recLabel.textContent = 'REC';
    if (pauseBtn) pauseBtn.textContent = '▶ Resume';
  } else {
    dot.className = 'dot';
    if (badge) { badge.className = 'status-badge'; badge.textContent = 'RECORDING'; }
    if (toggle) { toggle.classList.remove('paused'); toggle.title = 'Recording ON — click to pause'; }
    if (recLabel) recLabel.textContent = 'REC';
    if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
  }
  // Refresh Home panel to reflect current recording state
  updateHomePanel();
}

// Show/hide footer based on active tab
function updateFooterVisibility() {
  const footer = document.getElementById('analyticsFooter');
  footer.classList.toggle('hidden', activeTab !== 'ddl');
}

// ── Analytics (DDL) rendering ─────────────────────────────────────────────────

async function renderDDL() {
  await restoreAnalyticsFilters();
  const list = document.getElementById('ddlList');
  list.innerHTML = '';

  // Populate event type dropdown with unique event names from current events
  const typeSelect = document.getElementById('ddlEventTypeFilter');
  if (typeSelect) {
    const currentType = typeSelect.value;
    const types = [...new Set(allEvents.map(e => e.event).filter(Boolean))].sort();
    typeSelect.innerHTML = '<option value="">All types</option>' +
      types.map(t => '<option value="' + escapeHtml(t) + '"' + (t === currentType ? ' selected' : '') + '>' + escapeHtml(t) + '</option>').join('');
  }

  // Category → provider map for the provider filter (settings.analyticsProviders)
  // (CATEGORY_TO_PROVIDER and enabledProviderSet() are defined at module scope)
  const providerSet = enabledProviderSet();

  const filtered = allEvents.filter(e => {
    if (!matchesSearchCriteria(e, searchParsed)) return false;
    if (platformQuery && e.category !== platformQuery) return false;
    if (eventTypeQuery && e.event !== eventTypeQuery) return false;
    // Honour provider filter — 'click' events are DOM-captured, always shown.
    const provider = CATEGORY_TO_PROVIDER[e.category];
    if (provider && !providerSet.has(provider)) return false;
    return true;
  });

  // Update total count
  updateStats();

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">◎</div><div class="empty-text">No analytics events yet</div></div>';
    return;
  }

  filtered.slice(-300).reverse().forEach(evt => {
    const color   = CATEGORY_COLORS[evt.category] || '#888';
    const fullStr = fmtFullJSON(evt.data);

    // Build a useful 1-line preview prioritising the most signal-dense fields.
    // Avoid _raw (noisy duplicate), nested objects rendered as [object Object].
    let previewStr = '';
    const d = evt.data || {};
    if (d.wae) {
      // WAE click events — show event name + cta
      const parts = [];
      if (d.wae.bannerName)  parts.push(d.wae.bannerName);
      if (d.wae.bannerCta)   parts.push('→ ' + d.wae.bannerCta);
      if (!parts.length && d.wae.event) parts.push(d.wae.event);
      previewStr = parts.join('  ');
    } else if (d.ecommerce) {
      // GTM/DDL ecommerce events — show currency + action step
      const ec = d.ecommerce;
      const parts = [];
      if (ec.currencyCode)               parts.push(ec.currencyCode);
      const action = ec.checkout?.actionField?.action
                   || ec.purchase?.actionField?.action
                   || ec.click?.actionField?.list || null;
      if (action)                        parts.push(action);
      const products = (ec.checkout?.products || ec.purchase?.actionField?.products
                     || ec.click?.products || ec.impressions || []);
      if (Array.isArray(products) && products.length) {
        parts.push(products.length + (products.length === 1 ? ' product' : ' products'));
      }
      previewStr = parts.join('  ·  ');
    } else if (d.eventDetails) {
      const ed = d.eventDetails;
      const parts = [];
      if (ed.category) parts.push(ed.category);
      if (ed.action)   parts.push(ed.action);
      if (ed.label)    parts.push(ed.label);
      previewStr = parts.join('  ·  ');
    } else if (d.eventInfo) {
      previewStr = d.eventInfo.eventName || d.eventInfo.eventAction || '';
    } else if (d.params && typeof d.params === 'object') {
      // GA4 gtag params
      previewStr = Object.entries(d.params)
        .filter(([k]) => !['send_to','groups'].includes(k))
        .slice(0, 3)
        .map(([k, v]) => k + ': ' + String(v).slice(0, 30))
        .join('  ');
    } else {
      // Generic fallback — first 2 non-noise keys
      previewStr = Object.entries(d)
        .filter(([k]) => !['_raw','_replayed','wae','ecommerce','eventDetails','eventInfo','page','user','component'].includes(k))
        .filter(([, v]) => typeof v !== 'object')
        .slice(0, 2)
        .map(([k, v]) => k + ': ' + String(v).slice(0, 40))
        .join('  ');
    }

    const preview = previewStr
      ? '<span style="color:#a0a0c4">' + escapeHtml(previewStr.slice(0, 100)) + '</span>'
      : '<span style="color:#555570">—</span>';

    // Category label badge
    const catBadge = evt.category
      ? '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:' + color + '22;color:' + color + ';font-weight:700;margin-left:6px">' + escapeHtml(evt.category) + '</span>'
      : '';

    const div = document.createElement('div');
    div.className = 'ddl-entry';
    div.style.borderLeftColor = color + '99';
    div.innerHTML =
      '<div class="ddl-header">' +
        '<span class="ddl-event-name" style="color:' + color + '">' + escapeHtml(evt.event || '—') + '</span>' +
        catBadge +
        '<div style="display:flex;gap:4px;align-items:center">' +
          '<button class="ddl-copy-btn" title="Copy event JSON" style="font-size:9px;padding:1px 7px;border-radius:3px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;transition:all .12s">⎘ Copy</button>' +
          '<span class="ddl-toggle">▼ expand</span>' +
        '</div>' +
      '</div>' +
      '<div class="ddl-meta">#' + escapeHtml(evt.seq) + ' · ' + fmtTime(evt.timestamp) + ' · ' + escapeHtml((evt.url || '').split('/').slice(0, 4).join('/')) + '</div>' +
      '<div class="ddl-preview-row">' + (preview || '—') + '</div>' +
      '<pre class="ddl-full" style="display:none">' + fullStr + '</pre>';

    // Copy button
    const copyBtn = div.querySelector('.ddl-copy-btn');
    copyBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const text = fmtRawJSON(evt.data); // raw text, not HTML-escaped
      navigator.clipboard?.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      });
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied'; copyBtn.style.color = 'var(--accent)'; copyBtn.style.borderColor = 'var(--accent)';
      setTimeout(() => { copyBtn.textContent = orig; copyBtn.style.color = ''; copyBtn.style.borderColor = ''; }, 1400);
    });

    // Click anywhere on row to expand/collapse (item 6)
    function toggleExpand(e) {
      e.stopPropagation();
      const full    = div.querySelector('.ddl-full');
      const prevRow = div.querySelector('.ddl-preview-row');
      const toggle  = div.querySelector('.ddl-toggle');
      const isOpen  = full.style.display !== 'none';
      full.style.display    = isOpen ? 'none'  : 'block';
      prevRow.style.display = isOpen ? 'block' : 'none';
      toggle.textContent    = isOpen ? '▼ expand' : '▲ collapse';
    }

    div.addEventListener('click', toggleExpand);
    div.querySelector('.ddl-toggle').addEventListener('click', toggleExpand);

    list.appendChild(div);
  });
}

// ── Console Errors rendering ─────────────────────────────────────────────────
function renderConsoleErrors() {
  const list = document.getElementById('consoleList');
  if (!list) return;
  list.innerHTML = '';

  // Update header label with configured paths
  const labelEl = document.getElementById('consolePathsLabel');
  if (labelEl && typeof getSettings === 'function') {
    const paths = getSettings().consolePaths || '/scripts/,/blocks/';
    labelEl.textContent = paths;
  }

  const errors = allEvents.filter(e => e.category === 'console_error');

  if (errors.length === 0) {
    const paths = (typeof getSettings === 'function') ? (getSettings().consolePaths || '/scripts/,/blocks/') : '/scripts/,/blocks/';
    list.innerHTML = '<div class="empty"><div class="empty-icon">🖥</div><div class="empty-text">No console errors from configured paths yet<br><span style="font-size:9px;opacity:.6">' + paths + '</span></div></div>';
    return;
  }

  errors.slice(-60).reverse().forEach(evt => {
    const div = document.createElement('div');
    div.className = 'ddl-entry';
    div.style.borderLeftColor = '#ff6b6b99';

    const typeLabel = evt.type || 'console.error';
    const msg = evt.data?.message || '';
    const path = evt.data?.path || '';

    const copyId = 'copy-err-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    div.innerHTML =
      '<div class="ddl-header">' +
        '<span class="ddl-event-name" style="color:#ff6b6b">' + escapeHtml(typeLabel) + '</span>' +
        '<span class="ddl-toggle">▼ expand</span>' +
      '</div>' +
      '<div class="ddl-meta">' + fmtTime(evt.timestamp) + ' · ' + escapeHtml(path) + '</div>' +
      '<div class="ddl-preview-row" style="color:#ff9f9f;word-break:break-word">' + escapeHtml(msg.slice(0, 100)) + (msg.length > 100 ? '…' : '') + '</div>' +
      '<pre class="ddl-full" style="display:none;color:#ff9f9f">' + escapeHtml(evt.data?.message || '') + '</pre>' +
      '<div class="ddl-expanded-actions" style="display:none;padding:4px 10px 6px;border-top:1px solid var(--border);display:none;gap:8px;align-items:center;">' +
        '<button id="' + copyId + '" style="font-family:monospace;font-size:9px;padding:3px 8px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;">⎘ Copy</button>' +
        '<span style="font-size:9px;color:var(--muted);flex:1">💡 F12 → Console and search for this message</span>' +
      '</div>';

    function toggleExpand(e) {
      e.stopPropagation();
      const full    = div.querySelector('.ddl-full');
      const actions = div.querySelector('.ddl-expanded-actions');
      const prev    = div.querySelector('.ddl-preview-row');
      const toggle  = div.querySelector('.ddl-toggle');
      const isOpen  = full.style.display !== 'none';
      full.style.display    = isOpen ? 'none'  : 'block';
      actions.style.display = isOpen ? 'none'  : 'flex';
      prev.style.display    = isOpen ? 'block' : 'none';
      toggle.textContent    = isOpen ? '▼ expand' : '▲ collapse';
    }
    div.addEventListener('click', toggleExpand);
    div.querySelector('.ddl-toggle').addEventListener('click', toggleExpand);

    // Wire copy button after DOM insertion
    list.appendChild(div);

    const copyBtn = document.getElementById(copyId);
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fullMsg = [
          'Type: ' + typeLabel,
          'Time: ' + fmtTime(evt.timestamp),
          'Path: ' + path,
          'URL:  ' + (evt.url || ''),
          '',
          (evt.data?.message || ''),
        ].join('\n');
        navigator.clipboard?.writeText(fullMsg).catch(() => {
          const ta = document.createElement('textarea');
          ta.value = fullMsg; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
        });
        copyBtn.textContent = '✓ Copied';
        copyBtn.style.color = 'var(--accent)';
        setTimeout(() => { copyBtn.textContent = '⎘ Copy'; copyBtn.style.color = ''; }, 1500);
      });
    }
  });
}

function render() {
  updateStats();
  updateStatus();
  updateFooterVisibility();
  if      (activeTab === 'ddl')     renderDDL();
  else if (activeTab === 'ls')      fetchAndRenderLS();
  else if (activeTab === 'console') renderConsoleErrors();
  else if (activeTab === 'cookies') { if (typeof loadCookies === 'function') loadCookies(); }
  // audit / geo / epoch / settings initialise lazily on first tab click
}

// ── Local Storage ─────────────────────────────────────────────────────────────

const TS_FIELDS = ['dismissedat', 'dismissed_at', 'expiry', 'expireat', 'expire_at', 'timestamp', 'createdat', 'updatedat'];
function isTimestampField(key) {
  return TS_FIELDS.includes(key.toLowerCase().replace(/[^a-z]/g, ''));
}

function fmtUnixTs(val) {
  if (!val) return null;
  let ms = Number(val);
  if (isNaN(ms)) return null;
  if (ms < 1e12) ms *= 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  const pad = n => String(n).padStart(2, '0');
  return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear() +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

async function sendToContentScript(tabId, msg) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, msg, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    } catch(e) { resolve(null); }
  });
}

async function execLS(tabId, operation) {
  try {
    // Each store honours its own configured target keys (empty = scan all).
    const TARGET_KEYS = storeTargetKeys();
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (op, keys, storeType) => {
        const store = storeType === 'session' ? sessionStorage : localStorage;
        if (op.type === 'SCAN') {
          const found = {};
          if (keys.length === 0) {
            // No target keys configured — return ALL keys for this store
            for (let i = 0; i < store.length; i++) {
              const k = store.key(i);
              if (!k) continue;
              const raw = store.getItem(k);
              let parsed = null;
              try { parsed = raw !== null ? JSON.parse(raw) : null; } catch { parsed = raw; }
              found[k] = { raw, parsed, found: true };
            }
          } else {
            keys.forEach(k => {
              const raw = store.getItem(k);
              let parsed = null;
              try { parsed = raw !== null ? JSON.parse(raw) : null; } catch { parsed = raw; }
              found[k] = { raw, parsed, found: raw !== null };
            });
          }
          return { ls: found, currentUrl: location.href };
        }
        if (op.type === 'GET') {
          const result = {};
          (op.keys || keys).forEach(k => {
            const raw = store.getItem(k);
            let parsed = null;
            try { parsed = raw !== null ? JSON.parse(raw) : null; } catch { parsed = raw; }
            result[k] = { raw, found: raw !== null, parsed };
          });
          return { ls: result };
        }
        if (op.type === 'SET') {
          try {
            store.setItem(op.key, op.value);
            const raw = store.getItem(op.key);
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch { parsed = raw; }
            return { ok: true, raw, parsed };
          } catch(e) { return { ok: false, error: e.message }; }
        }
        if (op.type === 'DELETE') {
          try {
            store.removeItem(op.key);
            return { ok: true };
          } catch(e) { return { ok: false, error: e.message }; }
        }
      },
      args: [operation, TARGET_KEYS, _storeType],
    });
    return results?.[0]?.result ?? null;
  } catch(e) {
    console.warn('execLS failed:', e.message);
    return null;
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function fetchAndRenderLS() {
  const container = document.getElementById('lsContent');
  container.innerHTML = '<div class="empty"><div class="empty-icon">⟳</div><div class="empty-text">Scanning ' + storeApiName() + '…</div></div>';

  const tab = await getActiveTab();

  // Req 5: Don't gate on isAllowedTab — re-check domain directly so Refresh
  // always works even if the domain check ran before settings loaded.
  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🗄</div><div class="empty-text">Navigate to a web page first</div></div>';
    return;
  }

  // Try execLS first (direct script injection — most reliable, always fresh)
  let res = await execLS(tab.id, { type: 'SCAN' });
  if (!res || !res.ls) {
    // Fallback: send message to content script
    res = await sendToContentScript(tab.id, { action: 'SCAN_LS_URLS', targetKeys: storeTargetKeys(), storageType: _storeType });
  }

  if (!res || !res.ls) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Could not read ' + storeApiName() + '.<br>Please reload the page and try again.</div></div>';
    return;
  }

  renderLSCards(res.ls, tab.id, res.currentUrl);
}

function buildCardBody(key, info) {
  if (!info.found) return '';
  const parsed = info.parsed;

  // Extra timestamp field names beyond the generic TS_FIELDS list
  const PUBLISH_FIELDS = ['publishedtime', 'published_time', 'publishtime', 'publish_time'];

  // Render a single value cell — handles nested objects/arrays recursively
  function renderValue(k, v, depth) {
    const keyNorm = k.toLowerCase().replace(/[^a-z]/g, '');
    const isTs    = isTimestampField(k) || PUBLISH_FIELDS.includes(keyNorm);
    const tsLabel = isTs ? fmtUnixTs(v) : null;
    const tsHTML  = tsLabel ? ' <span class="ls-ts-badge">🕐 ' + escapeHtml(tsLabel) + '</span>' : '';

    if (v !== null && typeof v === 'object' && depth < 2) {
      // Render nested object/array as an indented sub-table
      const subRows = Array.isArray(v)
        ? v.map((sv, si) => [String(si), sv])
        : Object.entries(v);

      const subHTML = subRows.map(([sk, sv]) => renderValue(sk, sv, depth + 1)).join('');
      return '<tr class="depth-' + depth + '">' +
        '<td class="td-key td-depth-' + depth + '">' + escapeHtml(k) + '</td>' +
        '<td class="td-val"><table class="ls-nested-table">' + subHTML + '</table></td></tr>';
    }

    const valStr = v === null ? '<span class="ls-null">null</span>' :
                   v === undefined ? '<span class="ls-null">undefined</span>' :
                   escapeHtml(String(v));

    return '<tr class="depth-' + depth + '">' +
      '<td class="td-key td-depth-' + depth + '">' + escapeHtml(k) + '</td>' +
      '<td class="td-val">' + valStr + tsHTML + '</td></tr>';
  }

  let tableHTML = '';
  if (parsed !== null && typeof parsed === 'object') {
    const rows = Array.isArray(parsed)
      ? parsed.map((v, i) => [String(i), v])
      : Object.entries(parsed);

    const rowsHTML = rows.map(([k, v]) => renderValue(k, v, 0)).join('');
    tableHTML = '<table class="ls-parsed-table">' + rowsHTML + '</table>';
  } else {
    const tsLabel = isTimestampField(key) ? fmtUnixTs(info.raw) : null;
    const tsHTML  = tsLabel ? ' <span class="ls-ts-badge">🕐 ' + escapeHtml(tsLabel) + '</span>' : '';
    tableHTML = '<pre class="ls-value-raw">' + escapeHtml(info.raw || '') + '</pre>' + tsHTML;
  }

  return '<div class="ls-card-body">' + tableHTML +
    '<details class="ls-edit-details">' +
    '<summary class="ls-edit-summary">✏️ Edit Value</summary>' +
    '<div class="ls-edit-section">' +
    '<textarea class="ls-edit-area" rows="3">' + escapeHtml(info.raw || '') + '</textarea>' +
    '<div class="ls-edit-actions">' +
    '<button class="ls-btn ls-btn-save">💾 Save to ' + storeApiName() + '</button>' +
    '<span class="ls-edit-hint">Writes directly to ' + storeApiName() + '</span>' +
    '</div></div></details></div>';
}

function rebindCardEvents(card, key) {
  const saveBtn = card.querySelector('.ls-btn-save');
  if (!saveBtn) return;
  const newBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newBtn, saveBtn);
  newBtn.addEventListener('click', async () => {
    const textarea = card.querySelector('.ls-edit-area');
    const newVal   = textarea ? textarea.value.trim() : '';
    if (!newVal) return;
    const tab = await getActiveTab();
    let res = await sendToContentScript(tab.id, { action: 'SET_LS', key, value: newVal, storageType: _storeType });
    if (!res) res = await execLS(tab.id, { type: 'SET', key, value: newVal });
    if (res && res.ok) {
      const newInfo = { raw: res.raw, found: true, parsed: res.parsed };
      const body = card.querySelector('.ls-card-body');
      if (body) {
        const tmp = document.createElement('div');
        tmp.innerHTML = buildCardBody(key, newInfo);
        if (tmp.firstElementChild) body.replaceWith(tmp.firstElementChild);
      }
      rebindCardEvents(card, key);
      showLsToast('Saved ✓');
    } else {
      showLsToast('Error: ' + ((res && res.error) || 'unknown'), true);
    }
  });
}

function renderLSCards(ls, tabId, currentUrl) {
  const container = document.getElementById('lsContent');
  container.innerHTML = '';

  // Update origin label in header (Fix 17b)
  const originEl = document.getElementById('lsOrigin');
  if (originEl) {
    try {
      const u = new URL(currentUrl || '');
      originEl.textContent = u.origin;
    } catch { originEl.textContent = currentUrl || '—'; }
  }

  const allKeys = Object.keys(ls).filter(k => ls[k]?.found).sort();
  const countEl = document.getElementById('lsCount');
  if (countEl) countEl.textContent = allKeys.length + ' keys';

  if (allKeys.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="empty-icon">◎</div><div class="empty-text">' + storeLabel() + ' is empty for this origin</div>';
    container.appendChild(empty);
    return;
  }

  // Generate one collapsed row per key
  function previewFor(info) {
    if (info?.parsed && typeof info.parsed === 'object') {
      if (Array.isArray(info.parsed)) return '[ ' + info.parsed.length + ' items ]';
      return '{ ' + Object.keys(info.parsed).length + ' keys }';
    }
    const raw = String(info?.raw ?? '');
    if (raw.length === 0) return '(empty)';
    return raw.length + ' chars';
  }

  allKeys.forEach(key => {
    const info = ls[key];
    const row = document.createElement('div');
    row.className = 'ls-row';
    row.dataset.key = key;
    row.dataset.preview = String(info?.raw ?? '');

    row.innerHTML =
      '<div class="ls-row-header">' +
        '<span class="ls-row-toggle">▸</span>' +
        '<span class="ls-row-key">' + escapeHtml(key) + '</span>' +
        '<span class="ls-row-meta">' + previewFor(info) + '</span>' +
        '<button class="ls-row-action ls-btn-load" title="Reload">↻</button>' +
        '<button class="ls-row-action ls-btn-delete" title="Delete">🗑</button>' +
      '</div>' +
      '<div class="ls-row-body"></div>';

    // Lazy-render body on first expand
    let bodyRendered = false;
    const bodyEl = row.querySelector('.ls-row-body');
    const headerEl = row.querySelector('.ls-row-header');

    function renderBody() {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildCardBody(key, info);
      bodyEl.innerHTML = '';
      if (tmp.firstElementChild) bodyEl.appendChild(tmp.firstElementChild);
      rebindCardEvents(row, key);
      bodyRendered = true;
    }

    headerEl.addEventListener('click', (e) => {
      // Don't toggle when clicking action buttons
      if (e.target.closest('.ls-row-action')) return;
      if (!bodyRendered) renderBody();
      row.classList.toggle('expanded');
      const t = row.querySelector('.ls-row-toggle');
      if (t) t.textContent = row.classList.contains('expanded') ? '▾' : '▸';
    });

    // Reload single key
    row.querySelector('.ls-btn-load').addEventListener('click', async (e) => {
      e.stopPropagation();
      const tab = await getActiveTab();
      let res = await sendToContentScript(tab.id, { action: 'GET_LS', keys: [key], storageType: _storeType });
      if (!res?.ls) res = await execLS(tab.id, { type: 'GET', keys: [key] });
      if (res?.ls?.[key]) {
        const newInfo = res.ls[key];
        if (!newInfo.found) {
          row.remove();
          showLsToast(key + ' no longer in ' + storeApiName());
          return;
        }
        Object.assign(info, newInfo);
        row.querySelector('.ls-row-meta').textContent = previewFor(newInfo);
        row.dataset.preview = String(newInfo?.raw ?? '');
        if (bodyRendered) renderBody();
        showLsToast('Reloaded ✓');
      }
    });

    // Delete with two-step confirm
    const deleteBtn = row.querySelector('.ls-btn-delete');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (deleteBtn.dataset.confirming !== 'true') {
        deleteBtn.dataset.confirming = 'true';
        deleteBtn.textContent = '✓?';
        deleteBtn.style.background = 'var(--warn)';
        deleteBtn.style.color = '#fff';
        setTimeout(() => {
          if (deleteBtn.dataset.confirming === 'true') {
            deleteBtn.dataset.confirming = 'false';
            deleteBtn.textContent = '🗑';
            deleteBtn.style.background = '';
            deleteBtn.style.color = '';
          }
        }, 3000);
        return;
      }
      deleteBtn.dataset.confirming = 'false';
      const tab = await getActiveTab();
      let res = await sendToContentScript(tab.id, { action: 'DELETE_LS', key, storageType: _storeType });
      if (!res) res = await execLS(tab.id, { type: 'DELETE', key });
      if (res?.ok) {
        row.remove();
        showLsToast('Deleted ✓');
        // Update counts
        const remaining = document.querySelectorAll('#lsContent .ls-row').length;
        if (countEl) countEl.textContent = remaining + ' keys';
      }
    });

    container.appendChild(row);
  });
}

// showLsToast is also exposed as window.showLsToast for cross-module use
function showLsToast(msg, isError) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:40px;left:50%;transform:translateX(-50%);' +
    'background:' + (isError ? 'var(--warn)' : 'var(--accent)') + ';color:#000;' +
    'font-weight:700;font-size:10px;padding:5px 14px;border-radius:6px;' +
    'z-index:9999;white-space:nowrap;pointer-events:none;letter-spacing:.04em;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}
window.showLsToast = showLsToast;


// ── Tab switching ─────────────────────────────────────────────────────────────
// Panel labels for the ← Back nav bar
const PANEL_LABELS = {
  pagetools:  'Page Kit Tools',
  inspect:    'Element Inspector',
  responsive: 'Responsive Preview',
  meta:       'Page Metadata',
  audit:      'Page Audit',
  ddl:        'Analytics',
  net:        'Network Mock',
  rules:      'Unified Rules',
  headers:    'Headers Modifier',
  ls:         'Local Storage',
  time:       'Time & Epoch',
  utils:      'Encode & Decode',
  cookies:    'Cookie Manager',
  console:    'Console Errors',
  geo:        'Override Geolocation',
  envmarker:  'Environment Marker',
  tools:      'Developer Tools',
  settings:   'Settings',
};

function ensurePanelNav(panelEl, tabId) {
  if (tabId === 'home') return;
  const label = PANEL_LABELS[tabId] || tabId;
  let nav = panelEl.querySelector('.panel-nav');
  if (!nav) {
    nav = document.createElement('div');
    nav.className = 'panel-nav';
    nav.innerHTML =
      '<button class="panel-nav-back" id="panelBackBtn-'+tabId+'">← Home</button>' +
      '<span class="panel-nav-title" id="panelNavTitle-'+tabId+'">'+label+'</span>';
    panelEl.insertBefore(nav, panelEl.firstChild);
    nav.querySelector('.panel-nav-back').addEventListener('click', () => switchToTab('home'));
  }
  // For pagetools, update the title to reflect the active sub-tab
  if (tabId === 'pagetools') {
    const activeSubTab = panelEl.querySelector('.pt-subtab.active');
    const sub = activeSubTab?.dataset?.sub;
    const subLabels = { inspect: 'Element Inspector', screenshot: 'Screenshots', responsive: 'Responsive Preview', meta: 'Page Metadata' };
    const titleEl = nav.querySelector('.panel-nav-title');
    if (titleEl && sub && subLabels[sub]) titleEl.textContent = subLabels[sub];
  }
}

function switchToTab(tabId) {
  // Deactivate all panels (slide back off-screen)
  document.querySelectorAll('.panel').forEach(p => {
    if (p.id !== 'panel-home') p.classList.remove('active');
  });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  // Track previous tab so Settings close can return to it
  if (tabId === 'settings' && activeTab !== 'settings') {
    window._prevTab = activeTab;
  }

  activeTab = tabId;
  const panelEl = document.getElementById('panel-' + tabId);

  if (tabId === 'home') {
    // Home: no overlay — just ensure nothing else is active
    const homePanel = document.getElementById('panel-home');
    if (homePanel) homePanel.classList.add('active');
  } else {
    // Tool panel: ensure ← Back bar, then slide in
    if (panelEl) {
      ensurePanelNav(panelEl, tabId);
      // Force a reflow so the slide transition plays
      panelEl.offsetHeight; // eslint-disable-line
      panelEl.classList.add('active');
    }
    // Keep Home panel visible behind (it stays at z-index:1 / translateX(0))
    const homePanel = document.getElementById('panel-home');
    if (homePanel) homePanel.classList.add('active');
  }

  // Tab bar stays hidden always in Option 2 — but keep tab .active for badge/JS compat
  const tabEl = document.querySelector('.tab[data-tab="' + tabId + '"]');
  if (tabEl) tabEl.classList.add('active');

  persistActiveTab(tabId);
  render();

  // Auto-load Storage when user switches to it
  if (tabId === 'ls' && typeof fetchAndRenderLS === 'function') {
    fetchAndRenderLS();
  }
  if (tabId === 'rules' && typeof refreshUnifiedRulesPanel === 'function') {
    setTimeout(refreshUnifiedRulesPanel, 80);
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
});

// Clickable stats — conditional on count (updateStats toggles .stat-clickable)
document.getElementById('statErrorsCell')?.addEventListener('click', () => {
  if (document.getElementById('statErrorsCell').classList.contains('stat-clickable')) switchToTab('console');
});
document.getElementById('statMocksCell')?.addEventListener('click', () => {
  if (document.getElementById('statMocksCell').classList.contains('stat-clickable')) switchToTab('net');
});
document.getElementById('statTotalCell')?.addEventListener('click', () => {
  if (document.getElementById('statTotalCell').classList.contains('stat-clickable')) switchToTab('ddl');
});
document.getElementById('statClicksCell')?.addEventListener('click', () => {
  if (document.getElementById('statClicksCell').classList.contains('stat-clickable')) switchToTab('ddl');
});

const LAST_TAB_KEY = 'qakit_last_active_tab';

// ── Persist last active tab so popup reopens on the user's last tab ────────────
function persistActiveTab(tabId) {
  chrome.storage.local.set({ [LAST_TAB_KEY]: tabId }).catch(() => {});
}

async function restoreLastTab() {
  try {
    const s = await chrome.storage.local.get(LAST_TAB_KEY);
    const last = s[LAST_TAB_KEY];
    // 'screenshot' no longer exists as a top-level tab — redirect to home (Fix 45d)
    const obsolete = ['screenshot'];
    if (last && !obsolete.includes(last) && document.querySelector('.tab[data-tab="' + last + '"]')) {
      switchToTab(last);
    }
  } catch(_) {}
}
async function checkCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) { isAllowedTab = false; updateStatus(); updateFooterVisibility(); return; }

  // Always load latest settings before domain check — fixes race where
  // settings.js hasn't finished loading when popup first opens
  let matchFn = window.domainsMatchUrl;
  if (!matchFn) {
    // Settings not yet loaded — read directly from storage
    try {
      const stored = await chrome.storage.local.get('qa_tools_settings');
      const rawDomains = (stored.qa_tools_settings?.domains || '').trim();
      if (!rawDomains) {
        matchFn = (url) => url && url.startsWith('http');
      } else {
        const patterns = rawDomains.split(',').map(s => s.trim()).filter(Boolean);
        matchFn = (url) => {
          if (!url) return false;
          try {
            const hn = new URL(url).hostname;
            return patterns.some(pat => {
              const r = new RegExp(pat.replace(/\./g, '\\.').replace(/\*/g, '.*'));
              return r.test(hn);
            });
          } catch { return false; }
        };
      }
    } catch {
      matchFn = (url) => url && url.startsWith('http');
    }
  }

  isAllowedTab = matchFn(tab.url);
  updateStatus();
  updateFooterVisibility();
}

// ── Load events from background ───────────────────────────────────────────────

async function loadEvents() {
  chrome.runtime.sendMessage({ action: 'GET_EVENTS' }, async (res) => {
    if (res) {
      allEvents = res.events || [];
      paused    = res.paused || false;
      await restoreAnalyticsFilters();
      render();
    }
  });
}

// ── Listen for new events ─────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'NEW_EVENT') {
    allEvents.push(msg.event);
    if (activeTab === 'ddl') renderDDL();
    else updateStats();
  }
  if (msg.action === 'NEW_CONSOLE_ERROR') {
    // Req 7: deduplicate — skip if identical message+type already recorded
    const isDupe = allEvents.some(e =>
      e.category === 'console_error' &&
      e.type === msg.event.type &&
      e.data?.message === msg.event.data?.message &&
      e.url === msg.event.url
    );
    if (!isDupe) {
      allEvents.push(msg.event);
      if (activeTab === 'console') renderConsoleErrors();
      updateStats();
    }
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:52px;left:50%;transform:translateX(-50%);' +
    'background:var(--accent);color:#000;font-weight:700;font-size:10px;letter-spacing:.06em;' +
    'padding:6px 14px;border-radius:6px;animation:toastIn .2s ease-out;z-index:999;white-space:nowrap;';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME PANEL
// ═══════════════════════════════════════════════════════════════════════════

let _homeSessionStart = Date.now();

function formatSessionAge() {
  const ms = Date.now() - _homeSessionStart;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

function formatRecentTime(isoStr) {
  try {
    const then = new Date(isoStr).getTime();
    const ms = Date.now() - then;
    if (ms < 60000) return 'just now';
    const m = Math.floor(ms / 60000);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  } catch { return ''; }
}

// Populate Home panel with live session data. Called whenever state changes.
function updateHomePanel() {
  const panel = document.getElementById('panel-home');
  if (!panel) return;

  // Domain + scope badge
  try {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const domainEl = document.getElementById('homeDomain');
      const scopeEl  = document.getElementById('homeScopeBadge');
      if (!domainEl || !scopeEl) return;
      if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
        domainEl.textContent = 'no page';
        scopeEl.textContent = 'OUT OF SCOPE';
        scopeEl.classList.add('out');
      } else {
        try {
          domainEl.textContent = new URL(tab.url).hostname;
        } catch { domainEl.textContent = tab.url; }
        if (isAllowedTab) {
          scopeEl.textContent = 'IN SCOPE';
          scopeEl.classList.remove('out');
        } else {
          scopeEl.textContent = 'OUT OF SCOPE';
          scopeEl.classList.add('out');
        }
      }
    }).catch(() => {});
  } catch (_) {}

  // Session age
  const sessionEl = document.getElementById('homeSession');
  if (sessionEl) sessionEl.textContent = 'session · ' + formatSessionAge();

  // Metrics — read from existing allEvents state
  const evs = (typeof allEvents !== 'undefined' && Array.isArray(allEvents)) ? allEvents : [];
  const clicks = evs.filter(e => e.event === 'click' || e.category === 'click').length;
  const errors = evs.filter(e =>
    e.type === 'console.error' || e.type === 'window.error' ||
    e.type === 'unhandledrejection' || e.category === 'console' ||
    e.event === 'console.error'
  ).length;

  const evEl = document.getElementById('homeEvents');
  const erEl = document.getElementById('homeErrors');
  if (evEl) evEl.textContent = evs.length;
  if (erEl) erEl.textContent = errors;

  // Status strip — show errors only when count > 0
  const errStrip   = document.getElementById('homeStatErrors');
  const errSep     = document.getElementById('homeStatErrorsSep');
  if (errStrip) errStrip.style.display = errors > 0 ? '' : 'none';
  if (errSep)   errSep.style.display   = errors > 0 ? '' : 'none';

  // Tile hint for analytics events
  const hintEvents = document.getElementById('homeHintEvents');
  if (hintEvents) hintEvents.textContent = evs.length + (evs.length === 1 ? ' event' : ' events');

  // Mocks — show dot on Net Mock tile when active count > 0
  chrome.storage.local.get('qnet_rules').then(s => {
    const activeMocks = (s.qnet_rules || []).filter(r => r.active).length;
    const hintMocks = document.getElementById('homeHintMocks');
    if (hintMocks) hintMocks.textContent = activeMocks + (activeMocks === 1 ? ' rule active' : ' rules active');
    const mockDot = document.getElementById('homeMockDot');
    if (mockDot) mockDot.style.display = activeMocks > 0 ? '' : 'none';
  }).catch(() => {});

  chrome.runtime.sendMessage({ action: 'GET_UNIFIED_RULES' }, (res) => {
    const hintUnified = document.getElementById('homeHintUnifiedRules');
    if (!hintUnified) return;
    if (!res?.ok || !Array.isArray(res.rules)) {
      hintUnified.textContent = 'unavailable';
      return;
    }
    const count = res.rules.length;
    hintUnified.textContent = count + (count === 1 ? ' unified rule' : ' unified rules');
  });

  // Last audit grade — show pill in status strip + tile when present
  chrome.storage.local.get('qa_audit_last').then(s => {
    const last = s.qa_audit_last;
    const auditStrip = document.getElementById('homeStatAudit');
    const auditSep   = document.getElementById('homeStatAuditSep');
    const stripPill  = document.getElementById('homeAuditPill');
    const tilePill   = document.getElementById('homeAuditTilePill');
    const hintAudit  = document.getElementById('homeHintAudit');
    if (last && last.score != null && last.grade) {
      if (auditStrip) auditStrip.style.display = '';
      if (auditSep)   auditSep.style.display   = '';
      if (stripPill) {
        stripPill.textContent = last.grade + ' ' + last.score;
        stripPill.className = 'audit-pill grade-' + last.grade.toLowerCase();
      }
      if (tilePill) {
        tilePill.style.display = '';
        tilePill.textContent = last.grade;
        tilePill.className = 'audit-pill grade-' + last.grade.toLowerCase();
      }
      if (hintAudit) hintAudit.textContent = last.grade + ' · ' + last.score;
    } else {
      if (auditStrip) auditStrip.style.display = 'none';
      if (auditSep)   auditSep.style.display   = 'none';
      if (tilePill)   tilePill.style.display   = 'none';
      if (hintAudit)  hintAudit.textContent = 'a11y · perf · sec';
    }
  }).catch(() => {});

  // Cookies count — strip + list tile
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.url) return;
    try {
      const domain = new URL(tab.url).hostname;
      chrome.cookies.getAll({ domain }).then(cookies => {
        const hintCookies  = document.getElementById('homeHintCookies');
        const hintCookies2 = document.getElementById('homeHintCookies2');
        if (hintCookies)  hintCookies.textContent  = '🍪 ' + cookies.length;
        if (hintCookies2) hintCookies2.textContent = cookies.length + (cookies.length === 1 ? ' cookie' : ' cookies');
      }).catch(() => {});
    } catch (_) {}
  }).catch(() => {});

  // Geo override — show in strip only when active
  chrome.storage.local.get('qakit_geo_override').then(s => {
    const override = s.qakit_geo_override;
    const geoStrip   = document.getElementById('homeStatGeo');
    const geoSep     = document.getElementById('homeStatGeoSep');
    const hintGeo    = document.getElementById('homeHintGeo');
    const hintGeo2   = document.getElementById('homeHintGeo2');
    const isActive = override && override.active && override.label;
    if (geoStrip) geoStrip.style.display = isActive ? '' : 'none';
    if (geoSep)   geoSep.style.display   = isActive ? '' : 'none';
    if (isActive) {
      if (hintGeo)  hintGeo.textContent  = override.label;
      if (hintGeo2) {
        hintGeo2.textContent = override.label + ' override';
        hintGeo2.className = 'home-list-hint active';
      }
    } else {
      if (hintGeo)  hintGeo.textContent  = '—';
      if (hintGeo2) {
        hintGeo2.textContent = 'no override';
        hintGeo2.className = 'home-list-hint';
      }
    }
  }).catch(() => {});

  // Storage key count
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (!tab?.id) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => Object.keys(localStorage).length,
    }).then(([res]) => {
      const hintStorage = document.getElementById('homeHintStorage');
      if (hintStorage && res?.result != null) {
        hintStorage.textContent = res.result + (res.result === 1 ? ' key' : ' keys');
      }
    }).catch(() => {});
  }).catch(() => {});

  // Env Marker — show dot when any enabled env matches the current URL
  chrome.storage.local.get(['qakit_env_marker_envs']).then(s => {
    const envs = s.qakit_env_marker_envs || [];
    const enabledCount = envs.filter(e => e.enabled).length;
    const hintEnv = document.getElementById('homeHintEnv');
    const envDot  = document.getElementById('homeEnvDot');
    if (hintEnv) {
      hintEnv.textContent = enabledCount + (enabledCount === 1 ? ' env' : ' envs') + ' enabled';
    }
    if (envDot) envDot.style.display = enabledCount > 0 ? '' : 'none';
  }).catch(() => {});

  // Contextual alerts
  const alertsEl = document.getElementById('homeAlerts');
  if (alertsEl) {
    const parts = [];
    if (errors > 0) {
      parts.push(
        '<div class="home-alert err" data-goto="console">' +
        '<span class="home-alert-icon">⚠</span>' +
        '<div style="flex:1"><div class="home-alert-title">' + errors + ' console error' + (errors === 1 ? '' : 's') + '</div>' +
        '<div class="home-alert-detail">Review →</div></div></div>'
      );
    }
    const auditResult = window.__lastAuditResult;
    if (auditResult && auditResult.issueCount > 0) {
      parts.push(
        '<div class="home-alert audit" data-goto="audit">' +
        '<span class="home-alert-icon">📋</span>' +
        '<div style="flex:1"><div class="home-alert-title">Audit · ' + auditResult.when + '</div>' +
        '<div class="home-alert-detail">' + auditResult.issueCount + ' issues →</div></div></div>'
      );
    }
    if (parts.length) {
      alertsEl.innerHTML = parts.join('');
      alertsEl.style.display = 'flex';
    } else {
      alertsEl.style.display = 'none';
      alertsEl.innerHTML = '';
    }
  }

  // Recent activity — last 3 non-DOM events + screenshots
  const recentEl = document.getElementById('homeRecent');
  if (recentEl) {
    const recent = [];
    // Walk backwards through allEvents to pick interesting ones
    const interesting = evs.filter(e => {
      const t = e.type || e.event || '';
      return /^(console\.|window\.error|unhandledrejection|page\.|navigation)/.test(t) ||
             e.category === 'Screenshot' || e.category === 'Audit';
    }).slice(-3).reverse();

    if (interesting.length === 0) {
      recentEl.innerHTML = '<div class="home-empty">No recent activity yet. Use the tools above to get started.</div>';
    } else {
      recentEl.innerHTML = interesting.map(e => {
        const iconMap = { 'console.error': '⚠', 'window.error': '⚠', 'unhandledrejection': '⚠',
                          'Audit': '📋', 'Screenshot': '⬚', 'navigation': '↗', 'page.view': '↗' };
        const icon = iconMap[e.type] || iconMap[e.event] || iconMap[e.category] || '•';
        const name = e.event || e.type || '—';
        const meta = e.data?.label || e.data?.message || e.url?.split('?')[0] || '';
        const time = formatRecentTime(e.timestamp);
        return '<div class="home-recent-item">' +
          '<span class="home-recent-icon">' + icon + '</span>' +
          '<span class="home-recent-text">' + escapeHtml(String(name)) +
            ' <span class="home-recent-text-meta">' + escapeHtml(String(meta).slice(0, 40)) + '</span></span>' +
          '<span class="home-recent-time">' + time + '</span></div>';
      }).join('');
    }
  }
}

// Metric tile click handlers — route to the relevant tab.
// CLICKS tile additionally pre-filters the Analytics platform dropdown to
// 'click' so the user lands directly on click events.
document.querySelectorAll('#panel-home .home-metric.clickable').forEach(tile => {
  tile.addEventListener('click', () => {
    const targetTab = tile.dataset.tab;
    if (!targetTab) return;
    switchToTab(targetTab);
    // If user clicked the CLICKS tile, pre-filter Analytics to click category
    if (tile.id === 'homeClicks' || tile.querySelector('#homeClicks')) {
      setTimeout(() => {
        const platformFilter = document.getElementById('ddlPlatformFilter');
        if (platformFilter) {
          platformFilter.value = 'click';
          platformFilter.dispatchEvent(new Event('change'));
        }
      }, 80);
    }
  });
});

// ── Unified Rules API bridge (Phase 1 foundation) ─────────────────────────
// Exposed on window for upcoming Rules workspace UI and interim manual testing.
window.qakitUnifiedRulesApi = {
  list: async () => chrome.runtime.sendMessage({ action: 'GET_UNIFIED_RULES' }),
  upsert: async (rule) => chrome.runtime.sendMessage({ action: 'UPSERT_UNIFIED_RULE', rule }),
  remove: async (id) => chrome.runtime.sendMessage({ action: 'DELETE_UNIFIED_RULE', id }),
  toggle: async (id, enabled) => chrome.runtime.sendMessage({ action: 'TOGGLE_UNIFIED_RULE', id, enabled }),
  exportPack: async () => chrome.runtime.sendMessage({ action: 'EXPORT_UNIFIED_RULES' }),
  dryRunImport: async (pack, strategy) => chrome.runtime.sendMessage({ action: 'DRY_RUN_IMPORT_UNIFIED_RULES', pack, strategy }),
  importPack: async (pack, strategy) => chrome.runtime.sendMessage({ action: 'IMPORT_UNIFIED_RULES', pack, strategy }),
  setPaused: async (paused) => chrome.runtime.sendMessage({ action: 'SET_UNIFIED_RULES_PAUSED', paused }),
  setGroupState: async (groupId, enabled) => chrome.runtime.sendMessage({ action: 'SET_UNIFIED_GROUP_STATE', groupId, enabled }),
};

function refreshAllUnifiedRulesViews() {
  refreshUnifiedRulesPanel();
}

function unifiedRuleSearchText(rule) {
  const parts = [
    rule.name,
    rule.type,
    rule.groupId,
    rule.source?.urlPattern,
    rule.source?.matchType,
    rule.action?.header,
    rule.action?.redirectUrl,
  ]
    .filter(Boolean)
    .map(v => String(v).toLowerCase());
  return parts.join(' ');
}

const _unifiedRulesById = new Map();
let _editingUnifiedRuleId = null;
const RULES_PANEL_PREFS_KEY = 'qakit_rules_panel_prefs_v1';
const _rulesPanelState = {
  groupFilter: 'all',
  filteredIds: [],
  selectedIds: [],
};

function selectedRuleIdSet() {
  return new Set(_rulesPanelState.selectedIds || []);
}

function syncSelectedRulesWithCurrentRules(currentRules) {
  const valid = new Set((currentRules || []).map(r => String(r.id || '')).filter(Boolean));
  _rulesPanelState.selectedIds = (_rulesPanelState.selectedIds || []).filter(id => valid.has(id));
}

function setRuleSelected(ruleId, selected) {
  const id = String(ruleId || '');
  if (!id) return;
  const next = selectedRuleIdSet();
  if (selected) next.add(id);
  else next.delete(id);
  _rulesPanelState.selectedIds = Array.from(next);
  updateRulesSelectedCount();
}

function updateRulesSelectedCount() {
  const el = document.getElementById('rulesSelectedCount');
  const count = (_rulesPanelState.selectedIds || []).length;
  if (el) el.textContent = 'selected=' + count;
  const bulk = document.getElementById('rulesBulkBar');
  if (bulk) bulk.style.display = count > 0 ? 'flex' : 'none';
}

function setRulesComposerOpen(open) {
  const block = document.getElementById('rulesComposerBlock');
  const newBtn = document.getElementById('rulesNewBtn');
  if (block) block.style.display = open ? '' : 'none';
  if (newBtn) newBtn.textContent = open ? 'Close Composer' : '+ New Rule';
  if (open) {
    updateRulesQuickComposerUI();
    validateRulesQuickComposer(false);
  }
}

function setRulesQuickType(type) {
  const t = String(type || 'cancel-request');
  const select = document.getElementById('rulesQuickType');
  if (select) select.value = t;

  document.querySelectorAll('#rulesTypeTiles .rules-type-tile').forEach((btn) => {
    const active = btn.getAttribute('data-rules-type') === t;
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    btn.style.color = active ? 'var(--accent)' : 'var(--text)';
    btn.style.background = active ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))' : 'var(--surface)';
  });

  const headerPanel = document.getElementById('rulesBuilderHeaders');
  const redirectPanel = document.getElementById('rulesBuilderRedirect');
  const blockPanel = document.getElementById('rulesBuilderBlock');
  if (headerPanel) headerPanel.style.display = t === 'modify-header' ? '' : 'none';
  if (redirectPanel) redirectPanel.style.display = t === 'redirect-request' ? '' : 'none';
  if (blockPanel) blockPanel.style.display = t === 'cancel-request' ? '' : 'none';

  updateRulesQuickComposerUI();
}

function setRulesQuickMatchType(matchType) {
  const m = String(matchType || 'wildcard');
  const type = document.getElementById('rulesQuickType')?.value || 'cancel-request';
  const matchFieldId =
    type === 'modify-header' ? 'rulesHeaderMatchType' :
    type === 'redirect-request' ? 'rulesRedirectMatchType' :
    'rulesBlockMatchType';
  const select = document.getElementById(matchFieldId);
  if (select) select.value = m;
}

function updateRulesQuickComposerUI() {
  const type = document.getElementById('rulesQuickType')?.value || 'cancel-request';
  const op = document.getElementById('rulesQuickHeaderOp')?.value || 'set';

  const hintEl = document.getElementById('rulesComposerHint');
  const headerValueWrapEl = document.getElementById('rulesQuickHeaderValueWrap');
  const createBtn = document.getElementById('rulesQuickCreateBtn');

  if (hintEl) {
    if (type === 'redirect-request') hintEl.textContent = 'Redirect matching requests to another destination URL.';
    else if (type === 'modify-header') hintEl.textContent = 'Change request/response headers for matching traffic.';
    else hintEl.textContent = 'Block matching requests during testing.';
  }

  if (headerValueWrapEl) headerValueWrapEl.style.display = (type === 'modify-header' && op !== 'remove') ? '' : 'none';

  if (createBtn) {
    if (type === 'redirect-request') createBtn.textContent = 'Save Redirect Rule';
    else if (type === 'modify-header') createBtn.textContent = 'Save Header Rule';
    else createBtn.textContent = 'Save Block Rule';
  }

  validateRulesQuickComposer(false);
}

function setRulesComposerValidation(message, isError) {
  const el = document.getElementById('rulesComposerValidation');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--warn)' : 'var(--muted)';
}

function validateRulesQuickComposer(showToast) {
  const type = document.getElementById('rulesQuickType')?.value || 'cancel-request';
  const urlPattern = (
    type === 'modify-header'
      ? document.getElementById('rulesHeaderPattern')?.value
      : type === 'redirect-request'
        ? document.getElementById('rulesRedirectPattern')?.value
        : document.getElementById('rulesBlockPattern')?.value
  ) || '';
  const urlPatternTrimmed = urlPattern.trim();
  const redirectUrl = (document.getElementById('rulesQuickRedirectUrl')?.value || '').trim();
  const header = (document.getElementById('rulesQuickHeader')?.value || '').trim();
  const op = (document.getElementById('rulesQuickHeaderOp')?.value || 'set').trim();
  const value = (document.getElementById('rulesQuickHeaderValue')?.value || '').trim();

  if (!urlPatternTrimmed) {
    const msg = 'Add a URL pattern to match requests.';
    setRulesComposerValidation(msg, true);
    if (showToast) showLsToast('Enter a URL pattern', true);
    return { ok: false, message: msg };
  }

  if (type === 'redirect-request' && !redirectUrl) {
    const msg = 'Enter the destination URL for redirect.';
    setRulesComposerValidation(msg, true);
    if (showToast) showLsToast('Enter a redirect URL', true);
    return { ok: false, message: msg };
  }

  if (type === 'modify-header' && !header) {
    const msg = 'Enter a header name for this rule.';
    setRulesComposerValidation(msg, true);
    if (showToast) showLsToast('Enter a header name', true);
    return { ok: false, message: msg };
  }

  if (type === 'modify-header' && op !== 'remove' && !value) {
    const msg = 'Enter a header value or switch operation to remove.';
    setRulesComposerValidation(msg, true);
    if (showToast) showLsToast('Enter a header value', true);
    return { ok: false, message: msg };
  }

  const okMsg =
    type === 'redirect-request'
      ? 'Ready to create redirect rule.'
      : type === 'modify-header'
        ? 'Ready to create header rule.'
        : 'Ready to create block rule.';
  setRulesComposerValidation(okMsg, false);
  return { ok: true, message: okMsg };
}

function applyRulesQuickTemplate(templateId) {
  const id = String(templateId || '');
  const headerPatternEl = document.getElementById('rulesHeaderPattern');
  const redirectPatternEl = document.getElementById('rulesRedirectPattern');
  const blockPatternEl = document.getElementById('rulesBlockPattern');
  const redirectEl = document.getElementById('rulesQuickRedirectUrl');
  const headerEl = document.getElementById('rulesQuickHeader');
  const headerOpEl = document.getElementById('rulesQuickHeaderOp');
  const headerTargetEl = document.getElementById('rulesQuickTarget');
  const headerValueEl = document.getElementById('rulesQuickHeaderValue');
  const headerMatchEl = document.getElementById('rulesHeaderMatchType');
  const redirectMatchEl = document.getElementById('rulesRedirectMatchType');
  const blockMatchEl = document.getElementById('rulesBlockMatchType');

  if (id === 'block-tracking') {
    setRulesQuickType('cancel-request');
    if (blockPatternEl) blockPatternEl.value = '*://*.doubleclick.net/*';
    if (blockMatchEl) blockMatchEl.value = 'wildcard';
  } else if (id === 'block-thirdparty') {
    setRulesQuickType('cancel-request');
    if (blockPatternEl) blockPatternEl.value = '*://cdn.thirdparty.com/*';
    if (blockMatchEl) blockMatchEl.value = 'wildcard';
  } else if (id === 'redirect-local') {
    setRulesQuickType('redirect-request');
    if (redirectPatternEl) redirectPatternEl.value = '*://api.example.com/*';
    if (redirectMatchEl) redirectMatchEl.value = 'wildcard';
    if (redirectEl) redirectEl.value = 'http://localhost:3000';
  } else if (id === 'redirect-staging') {
    setRulesQuickType('redirect-request');
    if (redirectPatternEl) redirectPatternEl.value = '*://api.example.com/*';
    if (redirectMatchEl) redirectMatchEl.value = 'wildcard';
    if (redirectEl) redirectEl.value = 'https://staging-api.example.com';
  } else if (id === 'header-auth') {
    setRulesQuickType('modify-header');
    if (headerPatternEl) headerPatternEl.value = '*://api.example.com/*';
    if (headerMatchEl) headerMatchEl.value = 'wildcard';
    if (headerEl) headerEl.value = 'Authorization';
    if (headerOpEl) headerOpEl.value = 'set';
    if (headerTargetEl) headerTargetEl.value = 'request';
    if (headerValueEl) headerValueEl.value = 'Bearer test-token';
  } else if (id === 'header-remove-csp') {
    setRulesQuickType('modify-header');
    if (headerPatternEl) headerPatternEl.value = '*://*/*';
    if (headerMatchEl) headerMatchEl.value = 'wildcard';
    if (headerEl) headerEl.value = 'Content-Security-Policy';
    if (headerOpEl) headerOpEl.value = 'remove';
    if (headerTargetEl) headerTargetEl.value = 'response';
    if (headerValueEl) headerValueEl.value = '';
  }

  updateRulesQuickComposerUI();
}

function bindRulesPanelDelegatedActions() {
  if (window.__qakitRulesDelegatedBound) return;
  window.__qakitRulesDelegatedBound = true;

  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;

    const launchTile = target.closest('#panel-rules .rules-launch-tile');
    if (launchTile) {
      e.preventDefault();
      const id = launchTile.id;
      setRulesComposerOpen(true);
      if (id === 'rulesQuickLaunchHeaderBtn') setRulesQuickType('modify-header');
      else if (id === 'rulesQuickLaunchRedirectBtn') setRulesQuickType('redirect-request');
      else setRulesQuickType('cancel-request');
      return;
    }

    const typeTile = target.closest('#panel-rules .rules-type-tile');
    if (typeTile) {
      e.preventDefault();
      const type = typeTile.getAttribute('data-rules-type') || 'cancel-request';
      setRulesQuickType(type);
      return;
    }

    const matchChip = target.closest('#panel-rules .rules-match-chip');
    if (matchChip) {
      e.preventDefault();
      const matchType = matchChip.getAttribute('data-rules-match') || 'wildcard';
      setRulesQuickMatchType(matchType);
      return;
    }

    const templateBtn = target.closest('#panel-rules .rules-template-btn');
    if (templateBtn) {
      e.preventDefault();
      const templateId = templateBtn.getAttribute('data-rules-template') || '';
      applyRulesQuickTemplate(templateId);
    }
  });
}

function describeUnifiedRule(rule) {
  const r = rule || {};
  const src = r.source || {};
  const action = r.action || {};
  const pattern = String(src.urlPattern || '*');
  if (r.type === 'cancel-request') {
    return 'Block requests matching ' + pattern;
  }
  if (r.type === 'redirect-request') {
    const to = String(action.redirectUrl || action.to || '(missing target)');
    return 'Redirect ' + pattern + ' to ' + to;
  }
  if (r.type === 'modify-header') {
    const op = String(action.op || 'set');
    const header = String(action.header || 'header');
    const target = String(action.target || 'request');
    if (op === 'remove') return 'Remove ' + header + ' on ' + target + ' for ' + pattern;
    return (op === 'add' ? 'Add ' : 'Set ') + header + ' on ' + target + ' for ' + pattern;
  }
  return String(r.name || 'Custom rule');
}

async function loadRulesPanelPrefs() {
  try {
    const s = await chrome.storage.local.get(RULES_PANEL_PREFS_KEY);
    const prefs = s?.[RULES_PANEL_PREFS_KEY] || {};
    _rulesPanelState.groupFilter = String(prefs.groupFilter || 'all');

    const filterTextEl = document.getElementById('rulesFilterText');
    const filterTypeEl = document.getElementById('rulesFilterType');
    const sortEl = document.getElementById('rulesSortBy');
    if (filterTextEl && typeof prefs.filterText === 'string') filterTextEl.value = prefs.filterText;
    if (filterTypeEl && typeof prefs.filterType === 'string') filterTypeEl.value = prefs.filterType;
    if (sortEl && typeof prefs.sortBy === 'string') sortEl.value = prefs.sortBy;
  } catch {}
}

function persistRulesPanelPrefs() {
  const filterTextEl = document.getElementById('rulesFilterText');
  const filterTypeEl = document.getElementById('rulesFilterType');
  const sortEl = document.getElementById('rulesSortBy');
  const prefs = {
    groupFilter: _rulesPanelState.groupFilter || 'all',
    filterText: filterTextEl?.value || '',
    filterType: filterTypeEl?.value || 'all',
    sortBy: sortEl?.value || 'priority-asc',
  };
  chrome.storage.local.set({ [RULES_PANEL_PREFS_KEY]: prefs }).catch(() => {});
}

function renderRulesGroupChips(rules, groupStates) {
  const chipsEl = document.getElementById('rulesGroupChips');
  if (!chipsEl) return;

  const counts = new Map();
  (rules || []).forEach((r) => {
    const gid = String(r.groupId || 'default');
    counts.set(gid, (counts.get(gid) || 0) + 1);
  });
  const allCount = (rules || []).length;
  const groups = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b));

  const allActive = _rulesPanelState.groupFilter === 'all';
  let html =
    '<button class="btn-ghost rules-group-chip" data-group="all" style="padding:2px 7px;font-size:8px;' +
    (allActive ? 'border-color:var(--accent);color:var(--accent);' : '') +
    '">all (' + allCount + ')</button>';

  html += groups.map((gid) => {
    const active = _rulesPanelState.groupFilter === gid;
    const enabled = (groupStates || {})[gid] !== false;
    return (
      '<button class="btn-ghost rules-group-chip" data-group="' + escapeHtml(gid) + '" style="padding:2px 7px;font-size:8px;' +
      (active ? 'border-color:var(--accent);color:var(--accent);' : '') +
      '">' + escapeHtml(gid) + ' (' + counts.get(gid) + ') ' + (enabled ? 'on' : 'off') + '</button>'
    );
  }).join('');

  chipsEl.innerHTML = html;
  chipsEl.querySelectorAll('.rules-group-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      _rulesPanelState.groupFilter = btn.getAttribute('data-group') || 'all';
      persistRulesPanelPrefs();
      refreshUnifiedRulesPanel();
    });
  });
}

async function bulkToggleRuleIds(ids, enabled, label) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) {
    showLsToast('No rules to update', true);
    return;
  }

  let okCount = 0;
  for (const id of list) {
    const out = await window.qakitUnifiedRulesApi.toggle(id, !!enabled);
    if (out?.ok) okCount++;
  }
  showLsToast((label || 'Updated') + ' ' + okCount + ' / ' + list.length + ' rule(s)');
  refreshAllUnifiedRulesViews();
}

async function bulkDeleteRuleIds(ids, label) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) {
    showLsToast('No rules to delete', true);
    return;
  }
  if (!confirm('Delete ' + list.length + ' rule(s)?')) return;

  let okCount = 0;
  for (const id of list) {
    const out = await window.qakitUnifiedRulesApi.remove(id);
    if (out?.ok) okCount++;
  }
  showLsToast((label || 'Deleted') + ' ' + okCount + ' / ' + list.length + ' rule(s)');
  _rulesPanelState.selectedIds = (_rulesPanelState.selectedIds || []).filter(id => !list.includes(id));
  updateRulesSelectedCount();
  refreshAllUnifiedRulesViews();
}

function updateRulesEditTypeUI() {
  const type = document.getElementById('rulesEditType')?.value || 'cancel-request';
  const headerBlock = document.getElementById('rulesEditHeaderBlock');
  const redirectBlock = document.getElementById('rulesEditRedirectBlock');
  const valueRow = document.getElementById('rulesEditValueRow');
  const op = document.getElementById('rulesEditHeaderOp')?.value || 'set';
  if (headerBlock) headerBlock.style.display = type === 'modify-header' ? '' : 'none';
  if (redirectBlock) redirectBlock.style.display = type === 'redirect-request' ? '' : 'none';
  if (valueRow) valueRow.style.display = (type === 'modify-header' && op !== 'remove') ? '' : 'none';
}

function closeRulesEditModal() {
  const modal = document.getElementById('rulesEditModal');
  if (modal) modal.style.display = 'none';
  _editingUnifiedRuleId = null;
}

function openRulesEditModal(ruleId) {
  const rule = _unifiedRulesById.get(String(ruleId));
  if (!rule) {
    showLsToast('Rule not found in cache', true);
    return;
  }

  _editingUnifiedRuleId = String(rule.id || '');
  const modal = document.getElementById('rulesEditModal');
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value == null ? '' : String(value);
  };

  setVal('rulesEditName', rule.name || '');
  setVal('rulesEditType', rule.type || 'cancel-request');
  setVal('rulesEditPriority', Number.isFinite(rule.priority) ? rule.priority : 100);
  setVal('rulesEditGroup', rule.groupId || 'default');
  setVal('rulesEditPattern', rule.source?.urlPattern || '*');
  setVal('rulesEditMatchType', rule.source?.matchType || 'wildcard');
  setVal('rulesEditReqType', rule.source?.requestType || 'all');

  setVal('rulesEditHeader', rule.action?.header || '');
  setVal('rulesEditHeaderOp', rule.action?.op || 'set');
  setVal('rulesEditTarget', rule.action?.target || 'request');
  setVal('rulesEditValue', rule.action?.value || '');
  setVal('rulesEditRedirectUrl', rule.action?.redirectUrl || rule.action?.to || '');

  updateRulesEditTypeUI();
  if (modal) modal.style.display = 'flex';
}

async function saveRulesEditModal() {
  if (!_editingUnifiedRuleId) return;
  const existing = _unifiedRulesById.get(_editingUnifiedRuleId);
  if (!existing) {
    showLsToast('Rule no longer exists', true);
    return;
  }

  const type = (document.getElementById('rulesEditType')?.value || 'cancel-request').trim();
  const name = (document.getElementById('rulesEditName')?.value || '').trim();
  const groupId = (document.getElementById('rulesEditGroup')?.value || '').trim() || 'default';
  const urlPattern = (document.getElementById('rulesEditPattern')?.value || '').trim();
  const matchType = (document.getElementById('rulesEditMatchType')?.value || 'wildcard').trim();
  const requestType = (document.getElementById('rulesEditReqType')?.value || 'all').trim();
  const priorityRaw = Number.parseInt(document.getElementById('rulesEditPriority')?.value || '100', 10);
  const priority = Number.isFinite(priorityRaw) ? priorityRaw : 100;

  if (!name) {
    showLsToast('Rule name is required', true);
    return;
  }
  if (!urlPattern) {
    showLsToast('URL pattern is required', true);
    return;
  }

  let action = {};
  if (type === 'redirect-request') {
    const redirectUrl = (document.getElementById('rulesEditRedirectUrl')?.value || '').trim();
    if (!redirectUrl) {
      showLsToast('Redirect URL is required', true);
      return;
    }
    action = { redirectUrl };
  } else if (type === 'modify-header') {
    const header = (document.getElementById('rulesEditHeader')?.value || '').trim();
    const op = (document.getElementById('rulesEditHeaderOp')?.value || 'set').trim();
    const target = (document.getElementById('rulesEditTarget')?.value || 'request').trim();
    const value = (document.getElementById('rulesEditValue')?.value || '').trim();
    if (!header) {
      showLsToast('Header name is required', true);
      return;
    }
    if (op !== 'remove' && !value) {
      showLsToast('Header value is required for set/add', true);
      return;
    }
    action = {
      header,
      op,
      target,
      ...(op !== 'remove' ? { value } : {}),
    };
  }

  const rule = {
    id: existing.id,
    type,
    name,
    enabled: existing.enabled !== false,
    priority,
    groupId,
    source: {
      urlPattern,
      matchType,
      requestType,
    },
    action,
    metadata: {
      ...(existing.metadata || {}),
      updatedBy: 'rules-panel-edit',
    },
    createdAt: existing.createdAt,
  };

  const out = await window.qakitUnifiedRulesApi.upsert(rule);
  if (!out?.ok) {
    showLsToast('Save failed: ' + (out?.error || 'unknown'), true);
    return;
  }
  showLsToast('Rule saved ✓');
  closeRulesEditModal();
  refreshAllUnifiedRulesViews();
}

async function refreshUnifiedRulesPanel() {
  const statusEl = document.getElementById('rulesStatus');
  const listEl = document.getElementById('rulesList');
  const pauseBtn = document.getElementById('rulesPauseBtn');
  const textFilterEl = document.getElementById('rulesFilterText');
  const typeFilterEl = document.getElementById('rulesFilterType');
  const sortEl = document.getElementById('rulesSortBy');
  if (!statusEl || !listEl || !window.qakitUnifiedRulesApi) return;

  statusEl.textContent = 'Loading unified rules...';
  try {
    const res = await window.qakitUnifiedRulesApi.list();
    if (!res?.ok) {
      statusEl.textContent = 'Failed to load rules: ' + (res?.error || 'unknown');
      return;
    }

    const rules = Array.isArray(res.rules) ? res.rules : [];
    _unifiedRulesById.clear();
    rules.forEach(rule => {
      if (rule.id) _unifiedRulesById.set(String(rule.id), rule);
    });
    const info = res.info || {};
    const paused = !!info.paused;
    const groupStates = info.groupStates || {};
    if (pauseBtn) pauseBtn.textContent = paused ? '▶ Resume All' : '⏸ Pause All';

    const q = (textFilterEl?.value || '').trim().toLowerCase();
    const typeFilter = typeFilterEl?.value || 'all';
    const sortMode = sortEl?.value || 'priority-asc';
    const groupFilter = _rulesPanelState.groupFilter || 'all';

    renderRulesGroupChips(rules, groupStates);

    let filtered = rules.slice();
    if (typeFilter !== 'all') filtered = filtered.filter(r => r.type === typeFilter);
    if (groupFilter !== 'all') filtered = filtered.filter(r => String(r.groupId || 'default') === groupFilter);
    if (q) filtered = filtered.filter(r => unifiedRuleSearchText(r).includes(q));

    if (sortMode === 'priority-desc') {
      filtered.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    } else if (sortMode === 'name-asc') {
      filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    } else if (sortMode === 'name-desc') {
      filtered.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
    } else {
      filtered.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    }

    statusEl.textContent =
      rules.length + ' rules · ' + filtered.length + ' shown · group ' + groupFilter +
      (paused ? ' · rule set paused' : '');

    _rulesPanelState.filteredIds = filtered
      .map(r => String(r.id || ''))
      .filter(Boolean);

    const selectedIds = selectedRuleIdSet();

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="padding:8px 10px;font-size:9px;color:var(--muted)">No matching rules</div>';
      return;
    }

    listEl.innerHTML = filtered.map((r) => {
      const id = escapeHtml(String(r.id || ''));
      const name = escapeHtml(String(r.name || 'Untitled Rule'));
      const type = escapeHtml(String(r.type || 'custom'));
      const group = escapeHtml(String(r.groupId || 'default'));
      const pattern = escapeHtml(String(r.source?.urlPattern || '*'));
      const summary = escapeHtml(describeUnifiedRule(r));
      const enabled = r.enabled !== false;
      const groupEnabled = groupStates[String(r.groupId || 'default')] !== false;
      const effective = enabled && groupEnabled && !paused;
      const hitCount = Number(r.metadata?.diagnostics?.hitCount || 0);
      const selected = selectedIds.has(String(r.id || ''));
      return (
        '<div style="padding:8px 10px;border-bottom:1px solid var(--border)">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<input type="checkbox" class="rules-select" data-rule-id="' + id + '" ' + (selected ? 'checked' : '') + ' title="Select rule" />' +
            '<span style="font-size:9.5px;font-weight:700;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + summary + '</span>' +
            '<button class="btn-ghost rules-toggle" data-rule-id="' + id + '" data-enabled="' + (enabled ? '1' : '0') + '" style="padding:2px 7px;font-size:8.5px">' + (enabled ? 'Disable' : 'Enable') + '</button>' +
            '<button class="btn-ghost rules-edit" data-rule-id="' + id + '" style="padding:2px 7px;font-size:8.5px">Edit</button>' +
            '<button class="btn-ghost rules-clone" data-rule-id="' + id + '" style="padding:2px 7px;font-size:8.5px">Duplicate</button>' +
            '<button class="btn-ghost rules-delete" data-rule-id="' + id + '" style="padding:2px 7px;font-size:8.5px;color:var(--warn)">Delete</button>' +
          '</div>' +
          '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:4px;font-size:8px;color:var(--muted)">' +
            '<span>name=' + name + '</span>' +
            '<span>type=' + type + '</span>' +
            '<span>group=' + group + '</span>' +
            '<span>priority=' + (Number.isFinite(r.priority) ? r.priority : 100) + '</span>' +
            '<span>effective=' + (effective ? 'on' : 'off') + '</span>' +
            '<span>hits=' + hitCount + '</span>' +
          '</div>' +
          '<div style="margin-top:3px;font-size:8px;color:var(--muted);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + pattern + '</div>' +
        '</div>'
      );
    }).join('');

    listEl.querySelectorAll('.rules-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-rule-id');
        const enabled = btn.getAttribute('data-enabled') === '1';
        const out = await window.qakitUnifiedRulesApi.toggle(id, !enabled);
        if (!out?.ok) {
          showLsToast('Toggle failed: ' + (out?.error || 'unknown'), true);
          return;
        }
        showLsToast('Rule updated ✓');
        refreshAllUnifiedRulesViews();
      });
    });

    listEl.querySelectorAll('.rules-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-rule-id');
        if (!id) return;
        if (!confirm('Delete this unified rule?')) return;
        const out = await window.qakitUnifiedRulesApi.remove(id);
        if (!out?.ok) {
          showLsToast('Delete failed: ' + (out?.error || 'unknown'), true);
          return;
        }
        showLsToast('Rule deleted ✓');
        refreshAllUnifiedRulesViews();
      });
    });

    listEl.querySelectorAll('.rules-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-rule-id');
        if (!id) return;
        openRulesEditModal(id);
      });
    });

    listEl.querySelectorAll('.rules-select').forEach(chk => {
      chk.addEventListener('change', () => {
        const id = chk.getAttribute('data-rule-id');
        if (!id) return;
        setRuleSelected(id, !!chk.checked);
      });
    });

    listEl.querySelectorAll('.rules-clone').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-rule-id');
        if (!id) return;
        const out = await cloneUnifiedRule(id);
        if (!out?.ok) {
          showLsToast('Duplicate failed: ' + (out?.error || 'unknown'), true);
          return;
        }
        showLsToast('Rule duplicated ✓');
        refreshAllUnifiedRulesViews();
      });
    });
  } catch (e) {
    statusEl.textContent = 'Unified rules error: ' + e.message;
  }
}

async function importUnifiedRulesPackFromFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const pack = JSON.parse(text);
    const preview = await window.qakitUnifiedRulesApi.dryRunImport(pack, 'merge');
    if (!preview?.ok) {
      showLsToast('Import preview failed: ' + (preview?.error || 'invalid pack'), true);
      return;
    }

    const s = preview.summary || {};
    const ok = confirm(
      'Import rules pack?\n\n' +
      'Current: ' + (s.currentCount || 0) + '\n' +
      'Incoming: ' + (s.incomingCount || 0) + '\n' +
      'New: ' + (s.newCount || 0) + '\n' +
      'Update: ' + (s.updateCount || 0) + '\n' +
      'After merge: ' + (s.nextCount || 0)
    );
    if (!ok) return;

    const imported = await window.qakitUnifiedRulesApi.importPack(pack, 'merge');
    if (!imported?.ok) {
      showLsToast('Import failed: ' + (imported?.error || 'unknown'), true);
      return;
    }
    showLsToast('Rules pack imported ✓');
    refreshAllUnifiedRulesViews();
  } catch (e) {
    showLsToast('Import parse failed: ' + e.message, true);
  }
}

async function createUnifiedQuickRule(config) {
  const cfg = config || {};
  const type = String(cfg.type || 'cancel-request');
  const matchType = String(cfg.matchType || 'wildcard');
  const urlPattern = String(cfg.urlPattern || '*');
  const groupId = String(cfg.groupId || 'default');
  const redirectUrl = String(cfg.redirectUrl || '');
  const header = String(cfg.header || '');
  const op = String(cfg.op || 'set');
  const target = String(cfg.target || 'request');
  const value = String(cfg.value || '');

  let name = 'Rule ' + urlPattern;
  let action = {};

  if (type === 'cancel-request') {
    name = 'Block ' + urlPattern;
  } else if (type === 'redirect-request') {
    name = 'Redirect ' + urlPattern;
    action = { redirectUrl };
  } else if (type === 'modify-header') {
    name = 'Header ' + op + ' ' + header;
    action = {
      header,
      op,
      target,
      ...(op !== 'remove' ? { value } : {}),
    };
  }

  const rule = {
    type,
    name,
    enabled: true,
    priority: 200,
    groupId,
    source: {
      urlPattern,
      matchType,
      requestType: 'all',
    },
    action,
    metadata: {
      createdBy: 'unified-quick-create',
    },
  };
  return window.qakitUnifiedRulesApi.upsert(rule);
}

async function cloneUnifiedRule(ruleId) {
  const existing = _unifiedRulesById.get(String(ruleId));
  if (!existing) return { ok: false, error: 'rule not found' };

  const baseName = String(existing.name || 'Untitled Rule');
  const clone = {
    ...existing,
    id: undefined,
    name: baseName + ' (copy)',
    enabled: true,
    metadata: {
      ...(existing.metadata || {}),
      createdBy: 'rules-panel-clone',
      clonedFromId: existing.id,
    },
  };
  return window.qakitUnifiedRulesApi.upsert(clone);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindRulesPanelDelegatedActions();

  const settingOpenRulesBtn = document.getElementById('settingOpenRulesBtn');

  const rulesRefreshBtn = document.getElementById('rulesRefreshBtn');
  const rulesPauseBtn = document.getElementById('rulesPauseBtn');
  const rulesExportBtn = document.getElementById('rulesExportBtn');
  const rulesImportBtn = document.getElementById('rulesImportBtn');
  const rulesImportFile = document.getElementById('rulesImportFile');
  const rulesFilterText = document.getElementById('rulesFilterText');
  const rulesFilterType = document.getElementById('rulesFilterType');
  const rulesSortBy = document.getElementById('rulesSortBy');
  const rulesQuickType = document.getElementById('rulesQuickType');
  const rulesHeaderPattern = document.getElementById('rulesHeaderPattern');
  const rulesHeaderMatchType = document.getElementById('rulesHeaderMatchType');
  const rulesHeaderGroupId = document.getElementById('rulesHeaderGroupId');
  const rulesRedirectPattern = document.getElementById('rulesRedirectPattern');
  const rulesRedirectMatchType = document.getElementById('rulesRedirectMatchType');
  const rulesRedirectGroupId = document.getElementById('rulesRedirectGroupId');
  const rulesBlockPattern = document.getElementById('rulesBlockPattern');
  const rulesBlockMatchType = document.getElementById('rulesBlockMatchType');
  const rulesBlockGroupId = document.getElementById('rulesBlockGroupId');
  const rulesQuickRedirectUrl = document.getElementById('rulesQuickRedirectUrl');
  const rulesQuickHeader = document.getElementById('rulesQuickHeader');
  const rulesQuickHeaderOp = document.getElementById('rulesQuickHeaderOp');
  const rulesQuickHeaderValue = document.getElementById('rulesQuickHeaderValue');
  const rulesQuickTarget = document.getElementById('rulesQuickTarget');
  const rulesQuickCreateBtn = document.getElementById('rulesQuickCreateBtn');
  const rulesQuickLaunchBlockBtn = document.getElementById('rulesQuickLaunchBlockBtn');
  const rulesQuickLaunchRedirectBtn = document.getElementById('rulesQuickLaunchRedirectBtn');
  const rulesQuickLaunchHeaderBtn = document.getElementById('rulesQuickLaunchHeaderBtn');
  const rulesNewBtn = document.getElementById('rulesNewBtn');
  const rulesComposerCancelBtn = document.getElementById('rulesComposerCancelBtn');
  const rulesEnableSelectedBtn = document.getElementById('rulesEnableSelectedBtn');
  const rulesDisableSelectedBtn = document.getElementById('rulesDisableSelectedBtn');
  const rulesDeleteSelectedBtn = document.getElementById('rulesDeleteSelectedBtn');
  const rulesGroupEnableBtn = document.getElementById('rulesGroupEnableBtn');
  const rulesGroupDisableBtn = document.getElementById('rulesGroupDisableBtn');
  const rulesRedirectGroupEnableBtn = document.getElementById('rulesRedirectGroupEnableBtn');
  const rulesRedirectGroupDisableBtn = document.getElementById('rulesRedirectGroupDisableBtn');
  const rulesBlockGroupEnableBtn = document.getElementById('rulesBlockGroupEnableBtn');
  const rulesBlockGroupDisableBtn = document.getElementById('rulesBlockGroupDisableBtn');
  const rulesEditModal = document.getElementById('rulesEditModal');
  const rulesEditType = document.getElementById('rulesEditType');
  const rulesEditHeaderOp = document.getElementById('rulesEditHeaderOp');
  const rulesEditCancelBtn = document.getElementById('rulesEditCancelBtn');
  const rulesEditSaveBtn = document.getElementById('rulesEditSaveBtn');

  await loadRulesPanelPrefs();
  updateRulesSelectedCount();
  setRulesQuickType(rulesQuickType?.value || 'cancel-request');
  setRulesQuickMatchType('wildcard');
  setRulesComposerOpen(true);

  if (settingOpenRulesBtn) settingOpenRulesBtn.addEventListener('click', () => switchToTab('rules'));
  if (rulesRefreshBtn) rulesRefreshBtn.addEventListener('click', refreshUnifiedRulesPanel);

  if (rulesPauseBtn) {
    rulesPauseBtn.addEventListener('click', async () => {
      const current = await window.qakitUnifiedRulesApi.list();
      if (!current?.ok) {
        showLsToast('Failed to read current state', true);
        return;
      }
      const paused = !!current?.info?.paused;
      const out = await window.qakitUnifiedRulesApi.setPaused(!paused);
      if (!out?.ok) {
        showLsToast('Pause/resume failed: ' + (out?.error || 'unknown'), true);
        return;
      }
      showLsToast(!paused ? 'Unified rules paused' : 'Unified rules resumed');
      refreshAllUnifiedRulesViews();
    });
  }

  if (rulesExportBtn) {
    rulesExportBtn.addEventListener('click', async () => {
      const out = await window.qakitUnifiedRulesApi.exportPack();
      if (!out?.ok || !out.pack) {
        showLsToast('Export failed: ' + (out?.error || 'unknown'), true);
        return;
      }
      const blob = new Blob([JSON.stringify(out.pack, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qakit-unified-rules-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showLsToast('Rules pack exported ✓');
    });
  }

  if (rulesImportBtn && rulesImportFile) {
    rulesImportBtn.addEventListener('click', () => rulesImportFile.click());
    rulesImportFile.addEventListener('change', () => {
      const f = rulesImportFile.files && rulesImportFile.files[0];
      importUnifiedRulesPackFromFile(f);
      rulesImportFile.value = '';
    });
  }

  if (rulesFilterText) {
    rulesFilterText.addEventListener('input', () => {
      persistRulesPanelPrefs();
      refreshUnifiedRulesPanel();
    });
  }
  if (rulesFilterType) {
    rulesFilterType.addEventListener('change', () => {
      persistRulesPanelPrefs();
      refreshUnifiedRulesPanel();
    });
  }
  if (rulesSortBy) {
    rulesSortBy.addEventListener('change', () => {
      persistRulesPanelPrefs();
      refreshUnifiedRulesPanel();
    });
  }

  if (rulesQuickCreateBtn) {
    rulesQuickCreateBtn.addEventListener('click', async () => {
      const type = rulesQuickType?.value || 'cancel-request';
      const matchType =
        type === 'modify-header'
          ? (rulesHeaderMatchType?.value || 'wildcard')
          : type === 'redirect-request'
            ? (rulesRedirectMatchType?.value || 'wildcard')
            : (rulesBlockMatchType?.value || 'wildcard');
      const urlPattern =
        type === 'modify-header'
          ? (rulesHeaderPattern?.value || '').trim()
          : type === 'redirect-request'
            ? (rulesRedirectPattern?.value || '').trim()
            : (rulesBlockPattern?.value || '').trim();
      const groupId =
        type === 'modify-header'
          ? ((rulesHeaderGroupId?.value || '').trim() || 'default')
          : type === 'redirect-request'
            ? ((rulesRedirectGroupId?.value || '').trim() || 'default')
            : ((rulesBlockGroupId?.value || '').trim() || 'default');
      const redirectUrl = (rulesQuickRedirectUrl?.value || '').trim();
      const header = (rulesQuickHeader?.value || '').trim();
      const op = (rulesQuickHeaderOp?.value || 'set').trim();
      const target = (rulesQuickTarget?.value || 'request').trim();
      const value = (rulesQuickHeaderValue?.value || '').trim();

      const valid = validateRulesQuickComposer(true);
      if (!valid.ok) {
        return;
      }

      const out = await createUnifiedQuickRule({
        type,
        matchType,
        urlPattern,
        groupId,
        redirectUrl,
        header,
        op,
        target,
        value,
      });
      if (!out?.ok) {
        showLsToast('Create rule failed: ' + (out?.error || 'unknown'), true);
        return;
      }

      showLsToast('Rule created ✓');
      if (rulesHeaderPattern) rulesHeaderPattern.value = '';
      if (rulesRedirectPattern) rulesRedirectPattern.value = '';
      if (rulesBlockPattern) rulesBlockPattern.value = '';
      if (rulesQuickRedirectUrl) rulesQuickRedirectUrl.value = '';
      if (rulesQuickHeader) rulesQuickHeader.value = '';
      if (rulesQuickHeaderValue) rulesQuickHeaderValue.value = '';
      setRulesComposerOpen(true);
      refreshAllUnifiedRulesViews();
    });
  }

  document.querySelectorAll('#rulesTypeTiles .rules-type-tile').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-rules-type') || 'cancel-request';
      setRulesQuickType(type);
    });
  });

  if (rulesQuickHeaderOp) {
    rulesQuickHeaderOp.addEventListener('change', updateRulesQuickComposerUI);
  }

  [
    rulesQuickType,
    rulesHeaderPattern,
    rulesRedirectPattern,
    rulesBlockPattern,
    rulesHeaderMatchType,
    rulesRedirectMatchType,
    rulesBlockMatchType,
    rulesQuickRedirectUrl,
    rulesQuickHeader,
    rulesQuickHeaderValue,
    rulesQuickHeaderOp,
    rulesQuickTarget,
  ].forEach((el) => {
    if (!el) return;
    const eventName = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(eventName, () => validateRulesQuickComposer(false));
  });

  document.querySelectorAll('.rules-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const templateId = btn.getAttribute('data-rules-template') || '';
      applyRulesQuickTemplate(templateId);
    });
  });

  if (rulesQuickLaunchBlockBtn) {
    rulesQuickLaunchBlockBtn.addEventListener('click', () => {
      setRulesComposerOpen(true);
      setRulesQuickType('cancel-request');
    });
  }

  if (rulesQuickLaunchRedirectBtn) {
    rulesQuickLaunchRedirectBtn.addEventListener('click', () => {
      setRulesComposerOpen(true);
      setRulesQuickType('redirect-request');
    });
  }

  if (rulesQuickLaunchHeaderBtn) {
    rulesQuickLaunchHeaderBtn.addEventListener('click', () => {
      setRulesComposerOpen(true);
      setRulesQuickType('modify-header');
    });
  }

  if (rulesNewBtn) rulesNewBtn.addEventListener('click', () => {
    const block = document.getElementById('rulesComposerBlock');
    setRulesComposerOpen(block?.style.display === 'none');
  });
  if (rulesComposerCancelBtn) rulesComposerCancelBtn.addEventListener('click', () => setRulesComposerOpen(false));
  if (rulesEnableSelectedBtn) {
    rulesEnableSelectedBtn.addEventListener('click', () => {
      bulkToggleRuleIds((_rulesPanelState.selectedIds || []).slice(), true, 'Updated');
    });
  }
  if (rulesDisableSelectedBtn) {
    rulesDisableSelectedBtn.addEventListener('click', () => {
      bulkToggleRuleIds((_rulesPanelState.selectedIds || []).slice(), false, 'Updated');
    });
  }
  if (rulesDeleteSelectedBtn) {
    rulesDeleteSelectedBtn.addEventListener('click', () => {
      bulkDeleteRuleIds((_rulesPanelState.selectedIds || []).slice(), 'Deleted');
    });
  }

  const bindGroupToggleBtn = (btn, gidInput, enabled) => {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const gid = (gidInput?.value || '').trim() || 'default';
      const out = await window.qakitUnifiedRulesApi.setGroupState(gid, !!enabled);
      if (!out?.ok) {
        showLsToast((enabled ? 'Enable' : 'Disable') + ' group failed: ' + (out?.error || 'unknown'), true);
        return;
      }
      showLsToast('Group ' + (enabled ? 'enabled: ' : 'disabled: ') + gid);
      refreshAllUnifiedRulesViews();
    });
  };

  bindGroupToggleBtn(rulesGroupEnableBtn, rulesHeaderGroupId, true);
  bindGroupToggleBtn(rulesGroupDisableBtn, rulesHeaderGroupId, false);
  bindGroupToggleBtn(rulesRedirectGroupEnableBtn, rulesRedirectGroupId, true);
  bindGroupToggleBtn(rulesRedirectGroupDisableBtn, rulesRedirectGroupId, false);
  bindGroupToggleBtn(rulesBlockGroupEnableBtn, rulesBlockGroupId, true);
  bindGroupToggleBtn(rulesBlockGroupDisableBtn, rulesBlockGroupId, false);

  if (rulesEditType) rulesEditType.addEventListener('change', updateRulesEditTypeUI);
  if (rulesEditHeaderOp) rulesEditHeaderOp.addEventListener('change', updateRulesEditTypeUI);
  if (rulesEditCancelBtn) rulesEditCancelBtn.addEventListener('click', closeRulesEditModal);
  if (rulesEditSaveBtn) rulesEditSaveBtn.addEventListener('click', saveRulesEditModal);
  if (rulesEditModal) {
    rulesEditModal.addEventListener('click', (e) => {
      if (e.target === rulesEditModal) closeRulesEditModal();
    });
  }

  setTimeout(refreshAllUnifiedRulesViews, 180);
});

// Status strip delegated click — items with data-tab navigate
document.getElementById('homeStatusStrip')?.addEventListener('click', (e) => {
  const item = e.target.closest('.home-status-item');
  if (!item) return;
  const tab = item.dataset.tab;
  if (tab) switchToTab(tab);
});

// Tile click handlers — route to sub-tool or tab switch
document.querySelectorAll('#panel-home .home-tile, #panel-home .home-list-tile').forEach(tile => {
  tile.addEventListener('click', () => {
    const action = tile.dataset.action;
    const tab    = tile.dataset.tab;
    if (tab) {
      switchToTab(tab);
      return;
    }
    // Tool actions — route to Page Kit then click the matching tool
    switch (action) {
      case 'annotate':
        persistActiveTab('home');
        document.getElementById('ss-annotatePageBtn')?.click();
        window.close();
        break;
      case 'region':
        persistActiveTab('home');
        document.getElementById('ss-regionBtn')?.click();
        break;
      case 'fullpage':
        // Background does capture+stitch+toast; popup closes immediately (Fix 70)
        persistActiveTab('home');
        (async () => {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id && tab.url?.startsWith('http')) {
              chrome.runtime.sendMessage({ action: 'CAPTURE_FULL_PAGE_AND_TOAST', tabId: tab.id }).catch(() => {});
            }
          } catch(e) { console.error('[QAKit] fullpage tile error', e); }
          window.close();
        })();
        break;

      // Inspect tools — open Page Kit to the inspect sub-tab
      case 'inspect':
        switchToTab('pagetools');
        setTimeout(() => {
          document.querySelector('.pt-subtab[data-sub="inspect"]')?.click();
          setTimeout(() => document.getElementById('pt-inspectBtn')?.click(), 80);
        }, 60);
        break;
      case 'spacing':
        switchToTab('pagetools');
        setTimeout(() => {
          document.querySelector('.pt-subtab[data-sub="inspect"]')?.click();
          setTimeout(() => document.getElementById('pt-spacingBtn')?.click(), 80);
        }, 60);
        break;

      case 'viewports':
        switchToTab('pagetools');
        setTimeout(() => document.querySelector('.pt-subtab[data-sub="responsive"]')?.click(), 60);
        break;
      case 'metadata':
        switchToTab('meta');
        setTimeout(() => { document.getElementById('metaRefreshBtn2')?.click(); }, 200);
        break;
      case 'open-jsondiff':
        chrome.tabs.create({ url: chrome.runtime.getURL('json-diff-tool.html') });
        break;
      case 'open-textcompare':
        chrome.tabs.create({ url: chrome.runtime.getURL('text-compare.html') });
        break;
      case 'open-help':
        chrome.tabs.create({ url: chrome.runtime.getURL('help.html') });
        break;
    }
  });
});

// Alert click handlers (delegated to parent since alerts re-render)
document.getElementById('homeAlerts')?.addEventListener('click', (e) => {
  const alertEl = e.target.closest('.home-alert');
  if (!alertEl) return;
  const goto = alertEl.dataset.goto;
  if (goto) switchToTab(goto);
});

// Recent activity delegated click → switch to the right tab
document.getElementById('homeRecent')?.addEventListener('click', (e) => {
  const item = e.target.closest('.home-recent-item');
  if (!item) return;
  const icon = item.querySelector('.home-recent-icon')?.textContent;
  if (icon === '⚠') switchToTab('console');
  else if (icon === '📋') switchToTab('audit');
  else if (icon === '⬚') {
    switchToTab('pagetools');
    setTimeout(() => document.querySelector('.pt-subtab[data-sub="screenshot"]')?.click(), 60);
  } else {
    switchToTab('ddl');
  }
});

// Home Export — reuse the Analytics export flow (clean events, no internals)
document.getElementById('homeExportBtn')?.addEventListener('click', () => {
  const evs = (typeof allEvents !== 'undefined' && Array.isArray(allEvents)) ? allEvents : [];
  if (!evs.length) return;
  const cleanEvents = evs.map(e => {
    const out = {
      event:     e.event,
      timestamp: e.timestamp,
      category:  e.category,
    };
    if (e.url)  out.url  = e.url;
    if (e.data) out.data = cleanEventData(e.data);
    return out;
  });
  const blob = new Blob([JSON.stringify(cleanEvents, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'qakit-events-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Home Clear — defer to the existing clear pipeline
document.getElementById('homeClearBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('homeClearBtn');
  if (btn.dataset.confirming !== 'true') {
    btn.dataset.confirming = 'true';
    const orig = btn.textContent;
    btn.textContent = '⚠ Confirm?';
    setTimeout(() => {
      btn.dataset.confirming = 'false';
      btn.textContent = orig;
    }, 2200);
    return;
  }
  btn.dataset.confirming = 'false';
  btn.textContent = '🗑 Clear all';
  chrome.runtime.sendMessage({ action: 'CLEAR_EVENTS' }).catch(() => {});
  if (typeof allEvents !== 'undefined') allEvents.length = 0;
  updateHomePanel();
  if (typeof render === 'function') render();
});

// ═══════════════════════════════════════════════════════════════════════════
// TAB OVERFLOW MENU
// ═══════════════════════════════════════════════════════════════════════════
// The ⋯ button opens a dropdown of the overflow tabs (those with
// data-overflow="true"). We also propagate tab badges into the ⋯ badge so
// users see alerts even when the offending tab is hidden.

// Pull the label for a tab from ALL_TABS (fallback to the element's textContent
// stripped of badges). Avoids including badge numbers and icons in the menu.
function getTabLabel(tabEl) {
  if (!tabEl) return '';
  const id = tabEl.dataset.tab;
  if (typeof ALL_TABS !== 'undefined') {
    const found = ALL_TABS.find(t => t.id === id);
    if (found && found.label) return found.label;
  }
  // Fallback: clone, strip badge, use that text
  const clone = tabEl.cloneNode(true);
  clone.querySelectorAll('.tab-badge').forEach(b => b.remove());
  return clone.textContent.trim();
}

function updateOverflowMenu() {
  const menu  = document.getElementById('tabMoreMenu');
  const badge = document.getElementById('tabMoreBadge');
  const btn   = document.getElementById('tabMoreBtn');
  if (!menu) return;
  const overflowTabs = document.querySelectorAll('.tab[data-overflow="true"]');

  // ⋯ button always visible — signals to users that more tabs may be available
  if (btn) btn.style.display = '';

  const items = [];
  let totalBadge = 0;
  let badgeColor = '';
  overflowTabs.forEach(tab => {
    const label = getTabLabel(tab);
    const tabBadge = tab.querySelector('.tab-badge');
    let badgeHtml = '';
    if (tabBadge) {
      const count = parseInt(tabBadge.textContent, 10) || 0;
      if (count > 0) {
        badgeHtml = '<span class="tab-more-item-badge" style="background:' +
          (tabBadge.style.background || '#c0392b') + '">' +
          escapeHtml(tabBadge.textContent) + '</span>';
        totalBadge += count;
        if (tabBadge.style.background) badgeColor = tabBadge.style.background;
      }
    }
    items.push(
      '<div class="tab-more-item" data-tab="' + escapeHtml(tab.dataset.tab) + '">' +
        '<span class="tab-more-item-label">' + escapeHtml(label) + '</span>' +
        badgeHtml +
      '</div>'
    );
  });
  menu.innerHTML = items.join('');
  if (badge) {
    if (totalBadge > 0) {
      badge.textContent = totalBadge > 99 ? '99+' : String(totalBadge);
      badge.style.display = 'inline-block';
      if (badgeColor) badge.style.background = badgeColor;
    } else {
      badge.style.display = 'none';
    }
  }
  // Rebind click handlers — sliding window swap (Fix 23d):
  // When user picks an overflow tab, push the rightmost primary tab back to
  // overflow so total visible stays at PRIMARY_LIMIT. Home is never bumped.
  menu.querySelectorAll('.tab-more-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetId = item.dataset.tab;
      try {
        const settings = await loadSettings();
        const visible = (settings.visibleTabs || []).slice();
        // Find rightmost primary tab (last item in visible array within first 6, excluding home)
        const PRIMARY_LIMIT = 6;
        const primaryNonHome = [];
        let count = 0;
        // Walk ALL_TABS canonical order to find which tabs are primary
        const allTabIds = (window.ALL_TABS || []).map(t => t.id);
        allTabIds.forEach(id => {
          if (!visible.includes(id)) return;
          if (id === 'home') { count++; return; }
          if (count < PRIMARY_LIMIT) {
            primaryNonHome.push(id);
            count++;
          }
        });
        const bumpId = primaryNonHome[primaryNonHome.length - 1];
        if (bumpId && bumpId !== targetId) {
          // Swap: remove target, remove bump, then re-add target before bump
          // so target lands inside primary slot and bump goes to overflow
          let updated = visible.filter(id => id !== targetId && id !== bumpId);
          // Insert target at bump's old position (in primary)
          // Find bump position in canonical order to derive insert point
          const bumpCanonIdx = allTabIds.indexOf(bumpId);
          // Insert target right before the position where bump was, then put bump at end of overflow
          // Easiest: reconstruct visible as: [home, ...primary except bump, target, ...rest]
          updated = [];
          let primaryAdded = 0;
          allTabIds.forEach(id => {
            if (!visible.includes(id) && id !== targetId) return;
            if (id === bumpId) return; // skip bumped one
            if (id === targetId) return; // we'll insert it explicitly
            if (id === 'home' || primaryAdded < PRIMARY_LIMIT - 1) {
              updated.push(id);
              if (id !== 'home') primaryAdded++;
              if (primaryAdded === PRIMARY_LIMIT - 1) {
                // Insert target here as the new last primary
                updated.push(targetId);
                primaryAdded++;
              }
            } else {
              updated.push(id);
            }
          });
          // If target wasn't added yet (e.g. target was outside visible originally), append it
          if (!updated.includes(targetId)) updated.push(targetId);
          // Append bump at the end (overflow)
          if (!updated.includes(bumpId)) updated.push(bumpId);
          await saveSettings({ visibleTabs: updated });
          if (typeof applySettingsToUI === 'function') applySettingsToUI();
        }
      } catch (_) {}
      switchToTab(targetId);
      closeOverflowMenu();
    });
  });
}

// Toggle the overflow menu on click. Rebuild items every time so badges stay
// current. The menu is moved to document.body when opened — this escapes any
// parent stacking context (including .tabs overflow-x:auto and any panels
// below with their own z-index layers).
document.getElementById('tabMoreBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('tabMoreMenu');
  const btn  = document.getElementById('tabMoreBtn');
  if (!menu || !btn) return;
  const isOpen = menu.style.display === 'block';
  if (isOpen) {
    closeOverflowMenu();
  } else {
    updateOverflowMenu();
    if (menu.children.length === 0) {
      menu.innerHTML = '<div style="padding:10px 14px;font-size:11px;color:var(--muted);text-align:center">All tabs visible<br><span style="font-size:9px;opacity:.7">Manage in Settings → Tabs</span></div>';
    }
    // Move to body so it escapes stacking contexts created by .tabs or panels
    if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
    // Force layout before measuring width
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    const mw = menu.offsetWidth || 170;
    menu.style.visibility = '';
    // Position below-right of the ⋯ button
    const r = btn.getBoundingClientRect();
    let left = r.right - mw;
    if (left < 4) left = 4;
    const maxLeft = window.innerWidth - mw - 4;
    if (left > maxLeft) left = maxLeft;
    menu.style.top  = (r.bottom + 2) + 'px';
    menu.style.left = left + 'px';
  }
});

function closeOverflowMenu() {
  const menu = document.getElementById('tabMoreMenu');
  if (!menu) return;
  menu.style.display = 'none';
  // Put it back near the tab bar so CSS selectors that rely on it being a
  // sibling of .tabs keep working. Tab bar container:
  const tabsBar = document.getElementById('tabsBar');
  if (tabsBar && menu.parentElement !== tabsBar) {
    tabsBar.appendChild(menu);
  }
}

// Close the menu on any click outside. Since the button itself calls
// stopPropagation, a click on the button won't trigger this. A click inside
// the menu bubbles but clicking an item also calls stopPropagation after
// switching tabs.
document.addEventListener('click', (e) => {
  const menu = document.getElementById('tabMoreMenu');
  if (!menu) return;
  if (menu.style.display !== 'block') return;
  // If the click was inside the menu or on the button, do nothing
  if (e.target.closest('#tabMoreMenu') || e.target.closest('#tabMoreBtn')) return;
  closeOverflowMenu();
});

// Keep Home live — refresh whenever events arrive
if (typeof render === 'function') {
  const _origRender = render;
  render = function() {
    _origRender();
    if (activeTab === 'home') updateHomePanel();
    updateOverflowMenu();
  };
}

// ── Controls ──────────────────────────────────────────────────────────────────
document.getElementById('pauseBtn')?.addEventListener('click', async () => {
  if (!isAllowedTab) return;
  paused = !paused;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: paused ? 'PAUSE' : 'RESUME' });
  updateStatus();
});

// New header recording toggle (iOS-style switch) — same behaviour as pauseBtn
document.getElementById('recToggle')?.addEventListener('click', async () => {
  if (!isAllowedTab) return;
  paused = !paused;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: paused ? 'PAUSE' : 'RESUME' });
  updateStatus();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  const btn = document.getElementById('clearBtn');
  if (btn.dataset.confirming !== 'true') {
    btn.dataset.confirming = 'true';
    btn.textContent = '⚠ Confirm Clear?';
    btn.style.background = 'var(--warn)';
    btn.style.color = '#fff';
    setTimeout(() => {
      btn.dataset.confirming = 'false';
      btn.textContent = '🗑 Clear Log';
      btn.style.background = '';
      btn.style.color = '';
    }, 3000);
    return;
  }
  btn.dataset.confirming = 'false';
  btn.textContent = '🗑 Clear Log';
  btn.style.background = '';
  btn.style.color = '';
  allEvents = [];
  chrome.runtime.sendMessage({ action: 'CLEAR_ALL' });
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    const matchFnClear = window.domainsMatchUrl || ((u) => u && u.startsWith('http'));
    if (tab?.url && matchFnClear(tab.url)) chrome.tabs.sendMessage(tab.id, { action: 'CLEAR' });
  });
  render();
  showToast('Log cleared');
});

document.getElementById('exportBtn').addEventListener('click', () => {
  // Produce a clean export: one array of { event, timestamp, category, url, data }
  // with all QAKit-internal bookkeeping stripped out (no _raw, _replayed,
  // seq counters, tab IDs, etc.)
  const cleanEvents = allEvents.map(e => {
    const out = {
      event:     e.event,
      timestamp: e.timestamp,
      category:  e.category,
    };
    if (e.url)  out.url  = e.url;
    if (e.data) out.data = cleanEventData(e.data);
    return out;
  });
  const json = JSON.stringify(cleanEvents, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'qa-tools-analytics-' + Date.now() + '.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Exported ' + cleanEvents.length + ' events');
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  searchParsed = parseSearchQuery(searchQuery);
  // Persist last-used search
  try { chrome.storage.local.set({ qakit_ddl_search: searchQuery }); } catch(_) {}
  if (activeTab === 'ddl') renderDDL();
  updateStats();
});

// Restore previous search on popup open
try {
  chrome.storage.local.get('qakit_ddl_search').then(s => {
    const saved = s.qakit_ddl_search;
    if (saved != null) {
      const inp = document.getElementById('searchInput');
      if (inp) {
        inp.value = saved;
        searchQuery = saved.trim().toLowerCase();
        searchParsed = parseSearchQuery(searchQuery);
        if (activeTab === 'ddl') renderDDL();
        updateStats();
      }
    }
  }).catch(() => {});
} catch (_) {}

// Analytics event type filter
document.getElementById('ddlEventTypeFilter')?.addEventListener('change', (e) => {
  eventTypeQuery = e.target.value;
  if (activeTab === 'ddl') renderDDL();
});

// Analytics platform filter
document.getElementById('ddlPlatformFilter')?.addEventListener('change', (e) => {
  platformQuery = e.target.value;
  if (activeTab === 'ddl') renderDDL();
});

document.getElementById('lsRefreshBtn').addEventListener('click', fetchAndRenderLS);

// Add new storage key modal
function openLsAddModal() {
  const overlay = document.getElementById('lsAddOverlay');
  if (!overlay) return;
  const title = document.getElementById('lsAddModalTitle');
  if (title) title.textContent = 'Add ' + storeLabel() + ' Key';
  const keyInp = document.getElementById('lsAddKey');
  const valInp = document.getElementById('lsAddValue');
  if (keyInp) keyInp.value = '';
  if (valInp) valInp.value = '';
  overlay.style.display = 'flex';
  keyInp?.focus();
}

function closeLsAddModal() {
  const overlay = document.getElementById('lsAddOverlay');
  if (overlay) overlay.style.display = 'none';
}

document.getElementById('lsAddBtn')?.addEventListener('click', openLsAddModal);
document.getElementById('lsAddCancel')?.addEventListener('click', closeLsAddModal);
document.getElementById('lsAddOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'lsAddOverlay') closeLsAddModal();
});
document.getElementById('lsAddSave')?.addEventListener('click', async () => {
  const key = (document.getElementById('lsAddKey')?.value || '').trim();
  const val = document.getElementById('lsAddValue')?.value ?? '';
  if (!key) {
    showLsToast('Key is required', true);
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
    showLsToast('Navigate to a web page first', true);
    return;
  }
  let res = await sendToContentScript(tab.id, { action: 'SET_LS', key, value: val, storageType: _storeType });
  if (!res) res = await execLS(tab.id, { type: 'SET', key, value: val });
  if (res && res.ok) {
    closeLsAddModal();
    showLsToast('Saved to ' + storeApiName() + ' ✓');
    fetchAndRenderLS();
  } else {
    showLsToast('Error: ' + ((res && res.error) || 'Could not write to ' + storeApiName()), true);
  }
});

// Local / Session storage selector — switch the active store then reload.
function setStoreType(type) {
  _storeType = type === 'session' ? 'session' : 'local';
  document.querySelectorAll('#panel-ls .pt-subtab[data-store]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.store === _storeType);
  });
  const label = document.getElementById('lsTypeLabel');
  if (label) label.textContent = '🗄 ' + storeLabel();
  // Reset search + expand state so the two stores don't share stale UI.
  const search = document.getElementById('lsSearch');
  if (search && search.value) { search.value = ''; search.dispatchEvent(new Event('input')); }
  fetchAndRenderLS();
}
document.querySelectorAll('#panel-ls .pt-subtab[data-store]').forEach(btn => {
  btn.addEventListener('click', () => setStoreType(btn.dataset.store));
});

// Storage search — filter rows by key OR value substring
document.getElementById('lsSearch')?.addEventListener('input', (e) => {
  const q = (e.target.value || '').toLowerCase();
  const clearBtn = document.getElementById('lsSearchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  let shown = 0, total = 0;
  document.querySelectorAll('#lsContent .ls-row').forEach(row => {
    total++;
    const key = (row.dataset.key || '').toLowerCase();
    const val = (row.dataset.preview || '').toLowerCase();
    const matches = !q || key.includes(q) || val.includes(q);
    row.style.display = matches ? '' : 'none';
    if (matches) shown++;
  });
  const countEl = document.getElementById('lsCount');
  if (countEl) countEl.textContent = q ? (shown + ' of ' + total + ' keys') : (total + ' keys');
});
document.getElementById('lsSearchClear')?.addEventListener('click', () => {
  const inp = document.getElementById('lsSearch');
  if (inp) { inp.value = ''; inp.dispatchEvent(new Event('input')); }
});
let _lsAllExpanded = false;
document.getElementById('lsToggleAllBtn')?.addEventListener('click', () => {
  _lsAllExpanded = !_lsAllExpanded;
  document.querySelectorAll('#lsContent .ls-row').forEach(row => {
    const header = row.querySelector('.ls-row-header');
    const toggle = row.querySelector('.ls-row-toggle');
    const body   = row.querySelector('.ls-row-body');
    if (!header) return;
    // If expanding and body is empty, simulate a click to trigger lazy render
    if (_lsAllExpanded && body && !body.innerHTML.trim()) {
      header.click();
      return; // click handles expanded class + toggle arrow
    }
    row.classList.toggle('expanded', _lsAllExpanded);
    if (toggle) toggle.textContent = _lsAllExpanded ? '▾' : '▸';
  });
  const btn = document.getElementById('lsToggleAllBtn');
  if (btn) btn.textContent = _lsAllExpanded ? '⊟ Collapse all' : '⊞ Expand all';
});

// ── Console tab controls ───────────────────────────────────────────────────────
document.getElementById('consoleRefreshBtn').addEventListener('click', () => {
  renderConsoleErrors();
  showToast('Console refreshed');
});

document.getElementById('consoleClearBtn').addEventListener('click', async () => {
  // Remove console error events from allEvents
  allEvents = allEvents.filter(e => e.category !== 'console_error');
  // Req 6: reset the shim on the page so stale browser console errors
  // don't re-appear — clear the installed flag so next page action re-injects fresh
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world:  'MAIN',
        func: () => {
          // Reset shim so it can be re-injected with a clean slate
          window.__qConsoleShimInstalled = false;
          // Also clear any pending custom events in flight (Map matches shim)
          window.__qConsoleSeen = new Map();
        },
      }).catch(() => {});
    }
  } catch(_) {}
  renderConsoleErrors();
  updateStats();
  showToast('Console cleared');
});

// Expose activeTab to network-mock.js (loaded before popup.js)
Object.defineProperty(window, '_activeTab', { get: () => activeTab });

// ── Element Inspector & Spacing Inspector ─────────────────────────────────────
let inspectorMode   = null; // null | 'inspect' | 'spacing'

async function getInspectorTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const matchFn = window.domainsMatchUrl || ((url) => url && url.startsWith('http'));
  return (tab?.url && matchFn(tab.url)) ? tab : null;
}

async function activateInspector(mode) {
  const tab = await getInspectorTab();
  if (!tab) { showToast('Inspector: navigate to an allowed domain first'); return; }

  try {
    // Inject inspector.js into MAIN world — the __MODE__ placeholder
    // is replaced at runtime via a wrapper function
    // Pass custom test attr from settings into inspector
    const sCustomAttr = (typeof getSettings === 'function')
      ? (getSettings().testIdAttr || '')
      : '';
    const sLocatorOutput = (typeof getSettings === 'function')
      ? (getSettings().locatorOutput || 'css')
      : 'css';

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (m, customAttr, locatorOutput) => {
        window.__qInspectorMode     = m;
        window.__qInspectorActive   = true;
        window.__qCustomTestAttr    = customAttr || ''; // used by getTestAttrs() in inspector
        window.__qLocatorOutputStyle = locatorOutput || 'css';
        if (window.__qInspectorInstalled) {
          document.documentElement.style.cursor = 'crosshair';
          // Hide stale overlays from previous mode
          ['__q-inspector-overlay','__q-inspector-badge',
           '__q-spacing-margin','__q-spacing-padding','__q-spacing-content','__q-spacing-panel','__q-gap-all-layer',
           '__q-dim-w','__q-dim-h','__q-dim-pt','__q-dim-pb','__q-dim-pl','__q-dim-pr',
           '__q-dim-mt','__q-dim-mb','__q-dim-ml','__q-dim-mr'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
          });
        }
      },
      args: [mode, sCustomAttr, sLocatorOutput],
    });

    // First time: inject full script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => window.__qInspectorInstalled || false,
    });
    if (!results?.[0]?.result) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        files: ['inspector.js'],
      });
    }

    inspectorMode = mode;
    updateInspectorBtns();
    showToast((mode === 'spacing' ? '📐 Spacing' : '🔍 Inspector') + ' ON — Esc to exit');
    window.close();

  } catch(e) {
    showToast('Could not inject: ' + e.message);
  }
}

async function deactivateInspector() {
  const tab = await getInspectorTab();
  if (!tab) { inspectorMode = null; updateInspectorBtns(); return; }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        window.__qInspectorActive = false;
        window.__qInspectorPinned = false;
        // Cancel any pending rAF — prevents overlay from re-appearing after deactivation
        try {
          if (typeof window.__qInspectorRafId === 'number') {
            cancelAnimationFrame(window.__qInspectorRafId);
            window.__qInspectorRafId = null;
          }
        } catch(_) {}
        document.documentElement.style.cursor = '';
        ['__q-inspector-overlay','__q-inspector-badge',
         '__q-spacing-margin','__q-spacing-padding','__q-spacing-content','__q-spacing-panel','__q-gap-all-layer',
         '__q-dim-w','__q-dim-h','__q-dim-pt','__q-dim-pb','__q-dim-pl','__q-dim-pr',
         '__q-dim-mt','__q-dim-mb','__q-dim-ml','__q-dim-mr'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        });
      },
    });
  } catch(e) {}
  inspectorMode = null;
  updateInspectorBtns();
  showToast('Inspector OFF');
}

function updateInspectorBtns() {
  const iBtn = document.getElementById('inspectBtn');
  const sBtn = document.getElementById('spacingBtn');
  if (!iBtn || !sBtn) return;

  // Inspect button
  if (inspectorMode === 'inspect') {
    iBtn.classList.add('active'); iBtn.textContent = '🔍 Active';
  } else {
    iBtn.classList.remove('active'); iBtn.textContent = '🔍 Inspect';
  }

  // Spacing button
  if (inspectorMode === 'spacing') {
    sBtn.classList.add('active'); sBtn.textContent = '📐 Active';
  } else {
    sBtn.classList.remove('active'); sBtn.textContent = '📐 Spacing';
  }
}

async function checkInspectorState() {
  const tab = await getInspectorTab();
  if (!tab) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => window.__qInspectorActive ? (window.__qInspectorMode || 'inspect') : null,
    });
    inspectorMode = results?.[0]?.result || null;
    updateInspectorBtns();
  } catch { inspectorMode = null; }
}

document.getElementById('inspectBtn').addEventListener('click', async () => {
  if (inspectorMode === 'inspect') await deactivateInspector();
  else await activateInspector('inspect');
});

document.getElementById('spacingBtn').addEventListener('click', async () => {
  if (inspectorMode === 'spacing') await deactivateInspector();
  else await activateInspector('spacing');
});

// ── Init all modules ─────────────────────────────────────────────────────────
// Set version from manifest (single source of truth)
(function() {
  const vEl = document.querySelector('.logo-version');
  if (vEl) vEl.textContent = 'v' + chrome.runtime.getManifest().version;
})();
try {
  if (typeof initPageTools === 'function') initPageTools();
} catch(e) {
  console.error('[QAKit] initPageTools failed:', e);
  const pt = document.getElementById('panel-pagetools');
  if (pt) pt.innerHTML = '<div style="padding:20px;color:var(--warn);font-size:10px">⚠ Page Kit failed to load: ' + e.message + '</div>';
}
if (typeof initNetworkMock   === 'function') initNetworkMock();
if (typeof initPageAudit     === 'function') initPageAudit();
if (typeof initCookieManager === 'function') initCookieManager();
if (typeof initGeolocation   === 'function') initGeolocation();
if (typeof initTime          === 'function') initTime();
if (typeof initUtils         === 'function') initUtils();
if (typeof initHeaders       === 'function') initHeaders();
if (typeof initEnvMarker     === 'function') initEnvMarker();
if (typeof initSettings      === 'function') initSettings();

// ── Option 2 nav init ───────────────────────────────────────────────────────
(function() {
  // Floating home button removed (Fix 55) — ← Home in panel nav is sole back nav
})();

// ── Sub-tab switching (Time, Utils, Tools) ────────────────────────────────
function initSubTabs(tabClass, subClass) {
  const buttons = document.querySelectorAll('.' + tabClass);
  // Activate first button + pane on init (ensures correct highlight on first
  // visit and after any cross-panel active-class stripping).
  const firstBtn = buttons[0];
  if (firstBtn) {
    buttons.forEach(b => b.classList.remove('active'));
    firstBtn.classList.add('active');
    const firstSub = firstBtn.dataset.sub;
    document.querySelectorAll('.' + subClass).forEach(p => {
      const isFirst = p.id.endsWith('-' + firstSub);
      p.style.display = isFirst ? 'flex' : 'none';
      p.classList.toggle('active', isFirst);
    });
  }
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sub = btn.dataset.sub;
      document.querySelectorAll('.' + subClass).forEach(p => {
        p.style.display = p.id.endsWith('-' + sub) ? 'flex' : 'none';
        if (p.id.endsWith('-' + sub)) p.classList.add('active');
        else p.classList.remove('active');
      });
    });
  });
}
initSubTabs('util-subtab', 'util-sub');
initSubTabs('tools-subtab', 'tools-sub');

// ── Page Tools quick-action buttons ──────────────────────────────────────────
document.getElementById('pt-openAuditBtn')?.addEventListener('click',   () => switchToTab('audit'));
document.getElementById('pt-openConsoleBtn')?.addEventListener('click', () => switchToTab('console'));
document.getElementById('pt-openMetaBtn')?.addEventListener('click',    () => {
  switchToTab('pagetools');
  setTimeout(() => document.querySelector('.pt-subtab[data-sub="meta"]')?.click(), 50);
});

// ── Settings open/close helpers ──────────────────────────────────────────────
function openSettings() {
  switchToTab('settings');
  if (typeof renderSettingsPanel === 'function') renderSettingsPanel();
}

function closeSettings() {
  const returnTo = window._prevTab || 'home';
  window._prevTab = null;
  switchToTab(returnTo);
}

document.getElementById('settingsBtn')?.addEventListener('click', () => {
  if (activeTab === 'settings') closeSettings();
  else openSettings();
});

document.getElementById('settingsCloseBtn')?.addEventListener('click', closeSettings);

// ── Tab bar scroll indicators + mouse drag ────────────────────────────────────
(function() {
  const wrapper = document.getElementById('tabsWrapper');
  const bar     = document.getElementById('tabsBar');
  if (!wrapper || !bar) return;

  function updateFades() {
    wrapper.classList.toggle('can-scroll-left',  bar.scrollLeft > 2);
    wrapper.classList.toggle('can-scroll-right', bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
  }

  bar.addEventListener('scroll', updateFades, { passive: true });
  window.addEventListener('resize', updateFades);
  // Run after tabs render
  setTimeout(updateFades, 100);
  // Re-run when settings change tab visibility
  const _orig = window._rebuildOverflowMenu;
  window._rebuildOverflowMenu = function() { if (_orig) _orig(); setTimeout(updateFades, 50); };

  // Mouse drag-to-scroll
  let _isDragging = false, _startX = 0, _scrollStart = 0;
  bar.addEventListener('mousedown', e => {
    if (e.target.closest('.tab')) return; // let tab clicks work normally
    _isDragging = true;
    _startX = e.clientX;
    _scrollStart = bar.scrollLeft;
    bar.classList.add('is-dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!_isDragging) return;
    bar.scrollLeft = _scrollStart - (e.clientX - _startX);
  });
  document.addEventListener('mouseup', () => {
    _isDragging = false;
    bar.classList.remove('is-dragging');
  });
})();

// ── Init ──────────────────────────────────────────────────────────────────────
checkCurrentTab();
loadEvents();
checkInspectorState();
restoreLastTab(); // open on the tab the user was last on

// Initial Home panel populate + 30s tick so session age stays fresh
updateHomePanel();
setInterval(updateHomePanel, 30_000);

// ── Pending action handoff from context menu ──────────────────────────────
// Context-menu items can set qakit_pending_action in storage and open the
// popup. We read it here and execute once modules are wired up. Cleared
// immediately so it doesn't replay on next popup open. Flags > 10s old are
// treated as stale and ignored.
async function processPendingAction() {
  try {
    const s = await chrome.storage.local.get([
      'qakit_pending_action', 'qakit_pending_tab_id', 'qakit_pending_ts'
    ]);
    const action = s.qakit_pending_action;
    if (!action) return;

    const ageMs = Date.now() - (s.qakit_pending_ts || 0);
    // Always clear the flag so we never replay it
    await chrome.storage.local.remove([
      'qakit_pending_action', 'qakit_pending_tab_id', 'qakit_pending_ts'
    ]);
    if (ageMs > 10_000) return; // stale — ignore

    if (action === 'run-audit') {
      // Switch to Page Audit tab and kick off the scan.
      switchToTab('audit');
      // runPageAudit is exposed globally by page-audit.js (via window.initPageAudit
      // binding the click handler); we can also invoke it programmatically by
      // clicking the Run button once the tab DOM is settled.
      setTimeout(() => {
        document.getElementById('auditRunBtn')?.click();
      }, 80);
    }
  } catch (e) {
    console.warn('[QAKit] pending action failed:', e.message);
  }
}

// Defer slightly so module init (initPageAudit etc.) has wired up its handlers
setTimeout(processPendingAction, 120);

// ── Fix 55: floating home pill removed ─────────────────────────────────────
// ← Home in panel nav bar is the sole back navigation.

// ── Downloads permission banner ─────────────────────────────────────────────
// Shown each time the popup opens until the user grants the downloads
// permission (required for screenshot saving). Once granted, the banner
// never appears again. Dismissing hides it for the current session only.
document.addEventListener('DOMContentLoaded', () => {
  const banner      = document.getElementById('dlPermBanner');
  const enableBtn   = document.getElementById('dlPermEnableBtn');
  const dismissBtn  = document.getElementById('dlPermDismissBtn');
  if (!banner) return;

  chrome.permissions.contains({ permissions: ['downloads'] }, (has) => {
    if (has) return;
    banner.style.display = 'flex';

    enableBtn.addEventListener('click', () => {
      chrome.permissions.request({ permissions: ['downloads'] }, (granted) => {
        if (granted) {
          banner.style.display = 'none';
        } else {
          enableBtn.textContent = 'Try again';
        }
      });
    });

    dismissBtn.addEventListener('click', () => {
      banner.style.display = 'none';
    });
  });
});
