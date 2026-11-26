// network-mock.js — QAKit Network Mock tab logic

// ── State ─────────────────────────────────────────────────────────────────────
let netRules      = [];   // [{id, name, pattern, matchType, responseStatus, responseBody, active}]
let netLog        = [];   // [{url, ruleName, status, timestamp}]
let editingRuleId = null; // null = new rule, string = editing existing
let fileBodyContent = null; // content from uploaded file

const RULES_KEY = 'qnet_rules';

function unifiedToLegacyMock(rule) {
  if (!rule || rule.type !== 'mock-response') return null;
  return {
    id: String(rule.metadata?.legacyId || rule.id || Date.now()),
    name: rule.name || 'Mock Rule',
    pattern: rule.source?.urlPattern || '*',
    matchType: rule.source?.matchType || 'contains',
    responseStatus: Number.isFinite(rule.action?.responseStatus) ? rule.action.responseStatus : 200,
    responseBody: rule.action?.responseBody ?? '{}',
    active: rule.enabled !== false,
  };
}

function isUnifiedRuleEffectivelyEnabled(rule, info) {
  if (!rule || rule.enabled === false) return false;
  if (info?.paused) return false;
  const gid = String(rule.groupId || 'default');
  return info?.groupStates?.[gid] !== false;
}

// ── Persistence ───────────────────────────────────────────────────────────────
async function loadRules() {
  // Prefer unified store when available; fall back to legacy key for compatibility.
  try {
    const res = await chrome.runtime.sendMessage({ action: 'GET_UNIFIED_RULES' });
    if (res?.ok && Array.isArray(res.rules)) {
      const mapped = res.rules
        .filter(r => r.type === 'mock-response')
        .map(r => {
          const legacy = unifiedToLegacyMock(r);
          if (legacy) legacy.active = isUnifiedRuleEffectivelyEnabled(r, res.info || {});
          return legacy;
        })
        .filter(Boolean);
      if (mapped.length > 0) {
        netRules = mapped;
        return;
      }
    }
  } catch (_) {}

  const stored = await chrome.storage.local.get(RULES_KEY);
  netRules = stored[RULES_KEY] || [];
}

async function saveRules() {
  await chrome.storage.local.set({ [RULES_KEY]: netRules });
  // Keep Phase 1 unified rules store in sync while legacy UI is still active.
  chrome.runtime.sendMessage({ action: 'SYNC_NETWORK_MOCK_RULES', rules: netRules }).catch(() => {});
}

// ── Interceptor injection ─────────────────────────────────────────────────────
async function injectInterceptor(tabId) {
  if (!tabId) return;
  const activeRules = netRules.filter(r => r.active);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: rules => { window.__qNetRules = rules; },
      args: [activeRules],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: ['network-interceptor.js'],
    });
    updateNetStatus(true);
  } catch(e) {
    console.warn('Interceptor inject failed:', e.message);
    updateNetStatus(false);
  }
}

async function updateInterceptorRules(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (rules) => { window.__qNetRules = rules; },
      args: [netRules.filter(r => r.active)],
    });
  } catch(e) { /* tab may not match allowed domains */ }
}

// ── Status indicator ──────────────────────────────────────────────────────────
function updateNetStatus(active) {
  const dot   = document.getElementById('netStatusDot');
  const label = document.getElementById('netStatusLabel');
  if (!dot) return;
  const count = netRules.filter(r => r.active).length;
  if (active && count > 0) {
    dot.className = 'net-status-dot active';
    label.textContent = count + ' rule' + (count > 1 ? 's' : '') + ' active';
    label.style.color = 'var(--accent)';
  } else {
    dot.className = 'net-status-dot';
    label.textContent = count > 0 ? count + ' rule' + (count > 1 ? 's' : '') + ' (inactive)' : 'No rules';
    label.style.color = '';
  }
}

// ── Render rule list ──────────────────────────────────────────────────────────
function renderNetRules() {
  const list  = document.getElementById('netRuleList');
  const empty = document.getElementById('netEmpty');
  list.querySelectorAll('.net-rule-card').forEach(el => el.remove());

  if (netRules.length === 0) {
    if (empty) empty.style.display = 'flex';
    updateNetStatus(false);
    return;
  }
  if (empty) empty.style.display = 'none';

  netRules.forEach(rule => {
    const card = document.createElement('div');
    card.className = 'net-rule-card';
    card.id = 'rule-' + rule.id;

    const bodyPreview = typeof rule.responseBody === 'string'
      ? rule.responseBody.slice(0, 120) + (rule.responseBody.length > 120 ? '…' : '')
      : JSON.stringify(rule.responseBody).slice(0, 120);

    card.innerHTML =
      '<div class="net-rule-header">' +
        '<button class="net-rule-toggle ' + (rule.active ? 'on' : '') + '" title="Enable/disable"></button>' +
        '<span class="net-rule-name">' + rule.name + '</span>' +
        '<span class="net-rule-match-type">' + rule.matchType + '</span>' +
        '<span class="net-rule-pattern">' + rule.pattern + '</span>' +
        '<div class="net-rule-actions">' +
          '<button class="net-rule-btn edit">✏</button>' +
          '<button class="net-rule-btn del">🗑</button>' +
        '</div>' +
      '</div>' +
      '<div class="net-rule-body">' + bodyPreview + '</div>';

    // Toggle active
    card.querySelector('.net-rule-toggle').addEventListener('click', async () => {
      rule.active = !rule.active;
      await saveRules();
      renderNetRules();
      const tab = await getActiveTabForNet();
      if (tab) await updateInterceptorRules(tab.id);
    });

    // Edit
    card.querySelector('.net-rule-btn.edit').addEventListener('click', () => openModal(rule.id));

    // Delete
    const delBtn = card.querySelector('.net-rule-btn.del');
    delBtn.addEventListener('click', async () => {
      if (delBtn.dataset.confirming !== 'true') {
        delBtn.dataset.confirming = 'true';
        delBtn.textContent = '⚠?';
        delBtn.style.color = 'var(--warn)';
        setTimeout(() => { delBtn.dataset.confirming = 'false'; delBtn.textContent = '🗑'; delBtn.style.color = ''; }, 3000);
        return;
      }
      netRules = netRules.filter(r => r.id !== rule.id);
      await saveRules();
      renderNetRules();
      const tab = await getActiveTabForNet();
      if (tab) await updateInterceptorRules(tab.id);
    });

    list.appendChild(card);
  });

  updateNetStatus(true);
}

// ── Intercept log ─────────────────────────────────────────────────────────────
// Track mock intercepts as recordable events for the stats counter
function recordMockIntercept(entry) {
  const evt = {
    seq:       Date.now(),
    event:     'mock_intercept',
    category:  'mock_intercept',
    timestamp: entry.timestamp,
    url:       entry.url,
    data: { ruleName: entry.ruleName, status: entry.status },
  };
  // Push into allEvents so stats counter picks it up
  if (typeof allEvents !== 'undefined') {
    allEvents.push(evt);
    updateStats();
  }
}

function renderNetLog() {
  const log = document.getElementById('netLog');
  log.innerHTML = '';
  if (netLog.length === 0) {
    log.innerHTML = '<div class="net-log-empty">No intercepted requests yet</div>';
    return;
  }
  netLog.slice(0, 20).forEach(entry => {
    const div = document.createElement('div');
    div.className = 'net-log-entry';
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
    const statusClass = entry.status >= 500 ? 'err' : entry.status >= 400 ? 'err' : 'mock';
    div.innerHTML =
      '<div class="net-log-time">' + time + '</div>' +
      '<div class="net-log-url" title="' + entry.url + '">' +
        '<span style="color:#555570">[' + entry.ruleName + ']</span> ' +
        entry.url.replace(/^https?:\/\/[^/]+/, '') +
      '</div>' +
      '<div class="net-log-status ' + statusClass + '">' + entry.status + '</div>';
    log.appendChild(div);
  });
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(ruleId = null) {
  editingRuleId   = ruleId;
  fileBodyContent = null;

  const overlay  = document.getElementById('netModalOverlay');
  const title    = document.getElementById('netModalTitle');
  const nameEl   = document.getElementById('netRuleName');
  const patternEl= document.getElementById('netPattern');
  const matchEl  = document.getElementById('netMatchType');
  const statusEl = document.getElementById('netStatus');
  const bodyPaste= document.getElementById('netBodyPaste');
  const fileNameEl = document.getElementById('netFileName');

  if (ruleId) {
    const rule = netRules.find(r => r.id === ruleId);
    if (!rule) return;
    title.textContent      = 'Edit Rule';
    nameEl.value           = rule.name;
    patternEl.value        = rule.pattern;
    matchEl.value          = rule.matchType;
    statusEl.value         = rule.responseStatus || 200;
    bodyPaste.value        = typeof rule.responseBody === 'string' ? rule.responseBody : JSON.stringify(rule.responseBody, null, 2);
    fileNameEl.style.display = 'none';
    switchBodyTab('text');
  } else {
    title.textContent = 'New Mock Rule';
    nameEl.value      = '';
    patternEl.value   = '';
    matchEl.value     = 'contains';
    statusEl.value    = '200';
    bodyPaste.value   = '{\n  \n}';
    fileNameEl.style.display = 'none';
    switchBodyTab('text');
  }

  overlay.style.display = 'flex';
  nameEl.focus();
}

function closeModal() {
  document.getElementById('netModalOverlay').style.display = 'none';
  editingRuleId   = null;
  fileBodyContent = null;
}

async function saveModal() {
  const name      = document.getElementById('netRuleName').value.trim();
  const pattern   = document.getElementById('netPattern').value.trim();
  const matchType = document.getElementById('netMatchType').value;
  const status    = parseInt(document.getElementById('netStatus').value) || 200;
  const activeBodyTab = document.querySelector('.net-body-tab.active')?.dataset?.bodytab || 'text';

  if (!name || !pattern) {
    document.getElementById('netRuleName').style.borderColor = name ? '' : 'var(--warn)';
    document.getElementById('netPattern').style.borderColor  = pattern ? '' : 'var(--warn)';
    return;
  }

  let responseBody;
  if (activeBodyTab === 'file' && fileBodyContent) {
    responseBody = fileBodyContent;
  } else {
    responseBody = document.getElementById('netBodyPaste').value.trim() || '{}';
  }

  // Validate JSON
  try { JSON.parse(responseBody); } catch {
    // Not valid JSON — store as plain string, that's OK
  }

  if (editingRuleId) {
    const rule = netRules.find(r => r.id === editingRuleId);
    if (rule) {
      rule.name = name; rule.pattern = pattern; rule.matchType = matchType;
      rule.responseStatus = status; rule.responseBody = responseBody;
    }
  } else {
    netRules.push({
      id:             Date.now().toString(),
      name, pattern, matchType,
      responseStatus: status,
      responseBody,
      active: true,
    });
  }

  await saveRules();
  renderNetRules();
  closeModal();

  const tab = await getActiveTabForNet();
  if (tab) await injectInterceptor(tab.id);
}

function switchBodyTab(tab) {
  document.querySelectorAll('.net-body-tab').forEach(b => b.classList.toggle('active', b.dataset.bodytab === tab));
  document.getElementById('netBodyText').style.display = tab === 'text' ? 'block' : 'none';
  document.getElementById('netBodyFile').style.display = tab === 'file' ? 'block' : 'none';
}

// ── Helper ────────────────────────────────────────────────────────────────────
async function getActiveTabForNet() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const matchFn = window.domainsMatchUrl || ((u) => u && u.startsWith('http'));
    return (tab?.url && matchFn(tab.url)) ? tab : null;
  } catch { return null; }
}

// ── Listen for intercept events pushed from content.js bridge ─────────────
// Replaces 2s polling. Called from initNetworkMock below.
function onNetIntercepted(entry) {
  if (!entry) return;
  recordMockIntercept(entry);
  netLog = [entry, ...netLog].slice(0, 100);
  // Only re-render if the net tab is actually visible
  if (window._activeTab === 'net') renderNetLog();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function initNetworkMock() {
  await loadRules();
  renderNetRules();

  // Add rule button
  document.getElementById('netAddBtn').addEventListener('click', () => openModal(null));

  // Modal buttons
  document.getElementById('netModalCancel').addEventListener('click', closeModal);
  document.getElementById('netModalSave').addEventListener('click', saveModal);

  // Close modal on overlay click
  document.getElementById('netModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'netModalOverlay') closeModal();
  });

  // Body tab switching
  document.querySelectorAll('.net-body-tab').forEach(btn => {
    btn.addEventListener('click', () => switchBodyTab(btn.dataset.bodytab));
  });

  // File drop
  const dropZone  = document.getElementById('netFileDrop');
  const fileInput = document.getElementById('netFileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileLoad(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileLoad(fileInput.files[0]);
  });

  // Clear log
  document.getElementById('netLogClearBtn').addEventListener('click', () => {
    netLog = [];
    renderNetLog();
  });

  // Auto-inject interceptor when switching to net tab
  document.querySelector('[data-tab="net"]').addEventListener('click', async () => {
    const tab = await getActiveTabForNet();
    if (tab && netRules.some(r => r.active)) await injectInterceptor(tab.id);
    renderNetLog();
  });

  // Receive intercept events pushed from background (bridged from page's MAIN world)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'NET_INTERCEPTED' && msg.entry) {
      onNetIntercepted(msg.entry);
    }
  });
}

function handleFileLoad(file) {
  const nameEl = document.getElementById('netFileName');
  const reader = new FileReader();
  reader.onload = (e) => {
    fileBodyContent = e.target.result;
    nameEl.textContent = '📄 ' + file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
    nameEl.style.display = 'block';
  };
  reader.readAsText(file);
}

// Export for use in popup.js
window.initNetworkMock = initNetworkMock;
window.injectInterceptorOnTabChange = async function(tab) {
  const _matchFn = window.domainsMatchUrl || ((u) => u && u.startsWith('http'));
  if (tab?.url && _matchFn(tab.url) && netRules.some(r => r.active)) {
    await injectInterceptor(tab.id);
  }
};
