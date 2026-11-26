// settings.js — QAKit Settings
// Manages: allowed domains, analytics filter, test tag attr, LS keys, cookie keys, visible tabs

const SETTINGS_KEY = 'qa_tools_settings';

const DEFAULT_SETTINGS = {
  domains:            '*',
  testIdAttr:         'data-testid',
  lsKeys:             '',
  ssKeys:             '',
  cookieFilter:       '',
  consolePaths:       '/scripts/,/blocks/',
  theme:              'light',
  // Locator output style for context-menu copy: 'css' | 'xpath' | 'playwright' | 'cypress'.
  // Inspector badge has its own per-session toggle; this default seeds it.
  locatorOutput:      'css',
  // Default visible 6 = Home + Page Kit + Page Audit + Analytics + Net Mock + Tools.
  // Order in this array determines primary/overflow: first 6 visible items
  // (after Home) become the tab strip, rest go to ⋯ overflow.
  visibleTabs:        ['home','pagetools','audit','ddl','net','rules','tools','headers','utils','ls','time','cookies','console','geo','envmarker'],
  // Analytics providers — which third-party platforms to intercept.
  // NOTE: WAE attribute capture is DOM-based (click handler in content.js) and
  // always active. It's not a toggleable interceptor provider.
  analyticsProviders: ['gtm','ga4','ddl','adobe','adobedl','tealium','meta','floodlight','segment'],
};

// All tabs in canonical order
const ALL_TABS = [
  { id: 'home',      label: 'Home'          },
  { id: 'pagetools', label: 'Page Kit'      },
  { id: 'audit',     label: 'Page Audit'    },
  { id: 'ddl',       label: 'Analytics'     },
  { id: 'net',       label: 'Network Mock'  },
  { id: 'rules',     label: 'Rules'         },
  { id: 'tools',     label: 'Tools'         },
  { id: 'headers',   label: 'Headers'       },
  { id: 'ls',        label: 'Local Storage' },
  { id: 'time',      label: 'Time'          },
  { id: 'utils',     label: 'Encode'        },
  { id: 'cookies',   label: 'Cookies'       },
  { id: 'console',   label: 'Console'       },
  { id: 'geo',       label: 'Geolocation'   },
  { id: 'envmarker', label: 'Env Marker'    },
];

let _settings = { ...DEFAULT_SETTINGS };

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  _settings = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  // Ensure visibleTabs is always an array
  if (!Array.isArray(_settings.visibleTabs)) {
    _settings.visibleTabs = DEFAULT_SETTINGS.visibleTabs;
  }
  return _settings;
}

async function saveSettings(patch) {
  _settings = { ..._settings, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: _settings });
  return _settings;
}

function getSettings() { return _settings; }

// Convert domain glob pattern to regex for URL matching
// Empty domains = match ALL domains (generic tool mode)
// * matches all domains (default)
function domainsMatchUrl(url) {
  if (!url) return false;
  try {
    // Req 5: if no domains configured, work on ALL domains
    const raw = (_settings.domains || '').trim();
    if (!raw) return true;
    const patterns = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (!patterns.length) return true;
    const hostname = new URL(url).hostname;
    return patterns.some(pat => {
      const escaped = pat.replace(/\./g, '\\.').replace(/\*/g, '.*');
      return new RegExp(escaped).test(hostname);
    });
  } catch { return false; }
}

function getLsKeys() {
  const raw = _settings.lsKeys || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function getSsKeys() {
  const raw = _settings.ssKeys || '';
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function getVisibleTabs() {
  return _settings.visibleTabs || DEFAULT_SETTINGS.visibleTabs;
}

// ── Settings Panel UI ─────────────────────────────────────────────────────────
// ── Theme switch helper ───────────────────────────────────────────────────────
function _applyThemeSwitch(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark-theme', isDark);

  const lBtn = document.getElementById('themeLightBtn');
  const dBtn = document.getElementById('themeDarkBtn');

  if (lBtn) {
    lBtn.style.background  = isDark ? 'transparent'  : 'var(--card)';
    lBtn.style.borderColor = isDark ? 'transparent'  : 'var(--border)';
    lBtn.style.color       = isDark ? 'var(--muted)' : 'var(--text)';
    lBtn.style.fontWeight  = isDark ? '600'          : '700';
  }
  if (dBtn) {
    dBtn.style.background  = isDark ? 'var(--accent)' : 'transparent';
    dBtn.style.borderColor = isDark ? 'var(--accent)' : 'transparent';
    dBtn.style.color       = isDark ? '#0f141d'       : 'var(--muted)';
    dBtn.style.fontWeight  = isDark ? '700'           : '600';
  }
}

function renderSettingsPanel() {
  const s = _settings;

  document.getElementById('settingDomains').value         = s.domains || '';
  document.getElementById('settingTestIdAttr').value      = s.testIdAttr || '';
  document.getElementById('settingLsKeys').value          = s.lsKeys || '';
  document.getElementById('settingSsKeys').value          = s.ssKeys || '';
  document.getElementById('settingCookieFilter').value    = s.cookieFilter || '';
  document.getElementById('settingConsolePaths').value    = s.consolePaths || DEFAULT_SETTINGS.consolePaths;
  const lo = document.getElementById('settingLocatorOutput');
  if (lo) lo.value = s.locatorOutput || DEFAULT_SETTINGS.locatorOutput;

  // Analytics providers checkboxes
  const providers = s.analyticsProviders || DEFAULT_SETTINGS.analyticsProviders;
  document.querySelectorAll('#settingProviders input[type=checkbox]').forEach(cb => {
    cb.checked = providers.includes(cb.value);
  });

  // Theme pill selector — wire clicks here so they survive panel re-renders (Fix 69a)
  const theme = s.theme || 'light';
  _applyThemeSwitch(theme);

  document.getElementById('themeLightBtn')?.addEventListener('click', () => {
    _settings.theme = 'light';
    _applyThemeSwitch('light');
    saveSettings({ theme: 'light' }).catch(() => {});
  });
  document.getElementById('themeDarkBtn')?.addEventListener('click', () => {
    _settings.theme = 'dark';
    _applyThemeSwitch('dark');
    saveSettings({ theme: 'dark' }).catch(() => {});
  });

  // settingTabsContainer — removed (no tab bar in Option 2)
  const container = document.getElementById('settingTabsContainer');
  if (container) container.innerHTML = '';
}

async function handleSaveSettings() {
  const domains         = document.getElementById('settingDomains').value.trim();
  const testIdAttr      = document.getElementById('settingTestIdAttr').value.trim();
  const lsKeys          = document.getElementById('settingLsKeys').value.trim();
  const ssKeys          = document.getElementById('settingSsKeys').value.trim();
  const cookieFilter    = document.getElementById('settingCookieFilter').value.trim();

  // Visible tabs section removed (Option 2 pure launcher — no tab bar).
  // Preserve whatever is already stored so we don't wipe it.
  const visibleTabs = _settings.visibleTabs || DEFAULT_SETTINGS.visibleTabs;

  const consolePaths = document.getElementById('settingConsolePaths').value.trim();
  const theme = _settings.theme || 'light';
  const locatorOutput = (document.getElementById('settingLocatorOutput')?.value || 'css').trim();

  // Read selected analytics providers
  const analyticsProviders = [...document.querySelectorAll('#settingProviders input[type=checkbox]:checked')]
    .map(cb => cb.value);

  // S-6 Warn if all providers are unchecked — that disables analytics capture entirely
  if (analyticsProviders.length === 0) {
    if (!confirm('No analytics providers selected — this disables ALL analytics capture. Save anyway?')) {
      return;
    }
  }

  await saveSettings({ domains, testIdAttr, lsKeys, ssKeys, cookieFilter, consolePaths, theme, visibleTabs, analyticsProviders, locatorOutput });

  // Apply immediately
  applySettingsToUI();
  showLsToast('Settings saved ✓');

  // Re-inject analytics interceptor on current tab so the new providers list
  // takes effect for subsequent events (display-time filter catches the rest).
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.runtime.sendMessage({ action: 'REINJECT_ANALYTICS', tabId: tab.id }).catch(() => {});
    }
  } catch(_) {}

  // Also re-render Analytics panel if it exists so filter applies immediately
  if (typeof renderDDL === 'function') renderDDL();

  // S-4 Auto-return to previous tab after save — also update tab bar active state
  setTimeout(() => {
    if (typeof activeTab !== 'undefined') {
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      const prevPanel = document.getElementById('panel-' + activeTab);
      const prevTab   = document.querySelector('.tab[data-tab="' + activeTab + '"]');
      if (prevPanel) prevPanel.classList.add('active');
      if (prevTab)   prevTab.classList.add('active');
    }
  }, 800);
}

function applySettingsToUI() {
  const s = _settings;
  // Home is always first, always visible — not user-configurable
  const visible = ['home', ...(s.visibleTabs || []).filter(id => id !== 'home')];

  // Apply theme to body + sync toggle button
  const theme = s.theme || 'light';
  _applyThemeSwitch(theme);

  // Reorder tab bar DOM + show/hide tabs
  const tabsBar = document.getElementById('tabsBar');
  if (tabsBar) {
    // Build the desired display order: visible tabs first (in saved order), then hidden
    const allTabEls = ALL_TABS.map(t => document.querySelector('.tab[data-tab="' + t.id + '"]')).filter(Boolean);

    // Sort: visible tabs in their saved order first, hidden tabs after
    allTabEls.sort((a, b) => {
      const ai = visible.indexOf(a.dataset.tab);
      const bi = visible.indexOf(b.dataset.tab);
      const aVis = ai >= 0, bVis = bi >= 0;
      if (aVis && bVis) return ai - bi;
      if (aVis) return -1;
      if (bVis) return 1;
      return 0;
    });

    // Re-append in sorted order
    allTabEls.forEach(el => tabsBar.appendChild(el));

    // Keep the ⋯ button + its menu AFTER all tabs (so overflow UI stays rightmost)
    const moreBtn  = document.getElementById('tabMoreBtn');
    const moreMenu = document.getElementById('tabMoreMenu');
    if (moreBtn)  tabsBar.appendChild(moreBtn);
    if (moreMenu) tabsBar.appendChild(moreMenu);

    // Partition: Home + first 6 other visible tabs stay primary (7 total).
    // The rest become overflow and live inside the scrollable ⋯ dropdown.
    const PRIMARY_LIMIT = 6;
    let primaryCount = 0;
    ALL_TABS.forEach(tab => {
      const el = document.querySelector('.tab[data-tab="' + tab.id + '"]');
      if (!el) return;
      // Home is force-pinned: always visible, always primary, always leftmost
      if (tab.id === 'home') {
        el.style.display = '';
        el.removeAttribute('data-overflow');
        primaryCount++;
        return;
      }
      const isVisible = visible.includes(tab.id);
      if (!isVisible) {
        el.style.display = 'none';
        el.removeAttribute('data-overflow');
        return;
      }
      if (primaryCount < PRIMARY_LIMIT) {
        el.style.display = '';
        el.removeAttribute('data-overflow');
        primaryCount++;
      } else {
        el.setAttribute('data-overflow', 'true');
        el.style.display = 'none';
      }
    });

    // Force ⋯ button always visible — invariant of the tab bar
    const moreBtnForce = document.getElementById('tabMoreBtn');
    if (moreBtnForce) moreBtnForce.style.display = '';

    // Refresh the overflow menu to reflect new partition
    if (typeof updateOverflowMenu === 'function') updateOverflowMenu();
  }

  // Apply analytics filter from settings — empty string means show all events
  const searchEl = document.getElementById('searchInput');
  if (searchEl) {
  }

  // Update LS_TARGET_KEYS from settings
  const newKeys = getLsKeys();
  LS_TARGET_KEYS.length = 0;
  newKeys.forEach(k => LS_TARGET_KEYS.push(k));

  // Update SS_TARGET_KEYS (session storage) from settings
  if (typeof SS_TARGET_KEYS !== 'undefined') {
    const newSsKeys = getSsKeys();
    SS_TARGET_KEYS.length = 0;
    newSsKeys.forEach(k => SS_TARGET_KEYS.push(k));
  }

  window._domainsMatchUrl = domainsMatchUrl;
}

window.initSettings = async function() {
  await loadSettings();
  renderSettingsPanel();
  applySettingsToUI();

  document.getElementById('settingSaveBtn')?.addEventListener('click', handleSaveSettings);

  // S-3 Reset confirm: two-click pattern to prevent accidental data loss
  const resetBtn = document.getElementById('settingResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (resetBtn.dataset.confirming !== 'true') {
        resetBtn.dataset.confirming = 'true';
        const orig = resetBtn.textContent;
        resetBtn.textContent = '⚠ Confirm reset?';
        resetBtn.style.background = 'var(--warn)';
        resetBtn.style.color = '#fff';
        setTimeout(() => {
          if (resetBtn.dataset.confirming === 'true') {
            resetBtn.dataset.confirming = 'false';
            resetBtn.textContent = orig;
            resetBtn.style.background = '';
            resetBtn.style.color = '';
          }
        }, 2500);
        return;
      }
      resetBtn.dataset.confirming = 'false';
      resetBtn.textContent = '↺ Reset';
      resetBtn.style.background = '';
      resetBtn.style.color = '';
      await saveSettings({ ...DEFAULT_SETTINGS });
      renderSettingsPanel();
      applySettingsToUI();
      showLsToast('Reset to defaults');
    });
  }

  // S-7 Export / Import settings as JSON
  document.getElementById('settingExportBtn')?.addEventListener('click', () => {
    const payload = JSON.stringify(_settings, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'qakit-settings-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showLsToast('Settings exported ✓');
  });
  document.getElementById('settingImportBtn')?.addEventListener('click', () => {
    document.getElementById('settingImportFile')?.click();
  });
  document.getElementById('settingImportFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('Not a valid settings object');
      // Merge with defaults to ensure all required keys exist
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // Home always pinned first in visible tabs
      if (Array.isArray(merged.visibleTabs)) {
        merged.visibleTabs = ['home', ...merged.visibleTabs.filter(id => id !== 'home')];
      }
      await saveSettings(merged);
      renderSettingsPanel();
      applySettingsToUI();
      showLsToast('Settings imported ✓');
    } catch (err) {
      showLsToast('Import failed: ' + err.message, true);
    }
    // Reset input so same file can be picked again
    e.target.value = '';
  });

  // S-8 Live preview while typing — domains, LS keys, cookies
  const domainsInput = document.getElementById('settingDomains');
  if (domainsInput) {
    domainsInput.addEventListener('input', () => {
      const preview = document.getElementById('settingDomainsPreview');
      if (!preview) return;
      const raw = domainsInput.value.trim();
      if (!raw || raw === '*') {
        preview.textContent = '✓ Matches all domains';
        preview.style.color = 'var(--accent)';
        return;
      }
      const patterns = raw.split(',').map(s => s.trim()).filter(Boolean);
      preview.textContent = patterns.length + ' pattern' + (patterns.length === 1 ? '' : 's') + ' — will match: ' + patterns.join(', ');
      preview.style.color = 'var(--muted)';
    });
  }
  const lsKeysInput = document.getElementById('settingLsKeys');
  if (lsKeysInput) {
    lsKeysInput.addEventListener('input', () => {
      const preview = document.getElementById('settingLsKeysPreview');
      if (!preview) return;
      const keys = lsKeysInput.value.split(',').map(s => s.trim()).filter(Boolean);
      preview.textContent = keys.length === 0 ? '✓ Showing all LS keys' : keys.length + ' specific key' + (keys.length === 1 ? '' : 's');
    });
  }
  const ssKeysInput = document.getElementById('settingSsKeys');
  if (ssKeysInput) {
    ssKeysInput.addEventListener('input', () => {
      const preview = document.getElementById('settingSsKeysPreview');
      if (!preview) return;
      const keys = ssKeysInput.value.split(',').map(s => s.trim()).filter(Boolean);
      preview.textContent = keys.length === 0 ? '✓ Showing all SS keys' : keys.length + ' specific key' + (keys.length === 1 ? '' : 's');
    });
  }
  const cookieInput = document.getElementById('settingCookieFilter');
  if (cookieInput) {
    cookieInput.addEventListener('input', () => {
      const preview = document.getElementById('settingCookieFilterPreview');
      if (!preview) return;
      const keys = cookieInput.value.split(',').map(s => s.trim()).filter(Boolean);
      preview.textContent = keys.length === 0 ? '✓ Showing all cookies' : keys.length + ' specific filter' + (keys.length === 1 ? '' : 's');
    });
  }

  document.querySelector('[data-tab="settings"]')?.addEventListener('click', renderSettingsPanel);
};

// Exports for use in popup.js
window.getSettings     = getSettings;
window.loadSettings    = loadSettings;
window.domainsMatchUrl = domainsMatchUrl;
window.getLsKeys       = getLsKeys;
window.getSsKeys       = getSsKeys;
window.getVisibleTabs  = getVisibleTabs;
window.ALL_TABS        = ALL_TABS;
