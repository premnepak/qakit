// cookie-manager.js — Cookie Manager tab logic

let allCookies = [];
let cookieEditingName = null;

async function getCookieTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function loadCookies() {
  const tab = await getCookieTab();
  if (!tab?.url) { renderCookies([], 'No active tab'); return; }

  try {
    const url   = new URL(tab.url);
    const domain = url.hostname;
    const cookies = await chrome.cookies.getAll({ domain });
    allCookies = cookies.sort((a, b) => a.name.localeCompare(b.name));
    renderCookies(allCookies);
  } catch(e) {
    renderCookies([], 'Could not load cookies: ' + e.message);
  }
}

function renderCookies(cookies, errorMsg) {
  const container = document.getElementById('cookieList');
  if (!container) return;

  const searchVal = (document.getElementById('cookieSearch')?.value || '').toLowerCase().trim();
  const filtered  = searchVal
    ? cookies.filter(c => c.name.toLowerCase().includes(searchVal) || c.value.toLowerCase().includes(searchVal))
    : cookies;

  container.innerHTML = '';

  if (errorMsg) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🍪</div><div class="empty-text">' + errorMsg + '</div></div>';
    return;
  }
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🍪</div><div class="empty-text">' +
      (searchVal ? 'No cookies match "' + searchVal + '"' : 'No cookies found for this domain') +
      '</div></div>';
    return;
  }

  // Count label
  const countEl = document.getElementById('cookieCount');
  if (countEl) countEl.textContent = filtered.length + ' / ' + allCookies.length;

  filtered.forEach(cookie => {
    const card = document.createElement('div');
    card.className = 'ls-card';

    const isSession = !cookie.expirationDate;
    const expiry    = isSession ? 'Session' : new Date(cookie.expirationDate * 1000).toLocaleString();
    const flags     = [
      cookie.secure   ? '🔒 Secure'   : '',
      cookie.httpOnly ? '🚫 HttpOnly'  : '',
      cookie.sameSite !== 'no_restriction' ? '🛡 ' + cookie.sameSite : '',
    ].filter(Boolean).join('  ');

    const valPreview = cookie.value.length > 60 ? cookie.value.slice(0, 60) + '…' : cookie.value;

    card.innerHTML =
      '<div class="ls-card-header ck-toggle-header" style="cursor:pointer;display:flex;align-items:center;gap:6px">' +
        '<span class="ls-row-toggle" style="font-size:9px;color:var(--muted);flex-shrink:0">▸</span>' +
        '<span class="ls-key" style="color:#ff9f43;flex:1">' + cookie.name + '</span>' +
        '<span class="ck-preview" style="font-size:8.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px">' + valPreview + '</span>' +
        '<div class="ls-card-actions" style="flex-shrink:0">' +
          '<button class="ls-btn ls-btn-load ck-edit" data-name="' + encodeURIComponent(cookie.name) + '">✏</button>' +
          '<button class="ls-btn ls-btn-delete ck-delete" data-name="' + encodeURIComponent(cookie.name) + '">🗑</button>' +
        '</div>' +
      '</div>' +
      '<div class="ck-details" style="display:none;padding:6px 10px;">' +
        '<table class="ls-parsed-table">' +
          '<tr><td class="td-key">value</td><td class="td-val" style="word-break:break-all">' + cookie.value + '</td></tr>' +
          '<tr><td class="td-key">domain</td><td class="td-val">' + cookie.domain + '</td></tr>' +
          '<tr><td class="td-key">path</td><td class="td-val">' + cookie.path + '</td></tr>' +
          '<tr><td class="td-key">expires</td><td class="td-val">' + expiry + '</td></tr>' +
          (flags ? '<tr><td class="td-key">flags</td><td class="td-val" style="font-size:9px">' + flags + '</td></tr>' : '') +
        '</table>' +
      '</div>';

    // Toggle expand on header click
    card.querySelector('.ck-toggle-header').addEventListener('click', (e) => {
      if (e.target.closest('.ls-card-actions')) return;
      const details = card.querySelector('.ck-details');
      const tog     = card.querySelector('.ls-row-toggle');
      const expanded = details.style.display !== 'none';
      details.style.display = expanded ? 'none' : '';
      if (tog) tog.textContent = expanded ? '▸' : '▾';
      card.classList.toggle('expanded', !expanded);
    });

    // Edit
    card.querySelector('.ck-edit').addEventListener('click', () => openCookieEdit(cookie));

    // Delete
    const delBtn = card.querySelector('.ck-delete');
    delBtn.addEventListener('click', async () => {
      if (delBtn.dataset.confirm !== '1') {
        delBtn.dataset.confirm = '1';
        delBtn.textContent = '⚠ Sure?';
        delBtn.style.color = 'var(--warn)';
        setTimeout(() => { delBtn.dataset.confirm = '0'; delBtn.textContent = '🗑 Delete'; delBtn.style.color = ''; }, 3000);
        return;
      }
      const tab = await getCookieTab();
      const url = new URL(tab.url);
      await chrome.cookies.remove({ url: url.origin + cookie.path, name: cookie.name });
      showLsToast('Cookie deleted');
      loadCookies();
    });

    container.appendChild(card);
  });
}

function openCookieEdit(cookie) {
  const overlay = document.getElementById('cookieEditOverlay');
  if (!overlay) return;
  cookieEditingName = cookie.name;
  document.getElementById('ckEditName').value  = cookie.name;
  document.getElementById('ckEditValue').value = cookie.value;
  document.getElementById('ckEditDomain').value = cookie.domain;
  document.getElementById('ckEditPath').value  = cookie.path;
  overlay.style.display = 'flex';
}

function closeCookieEdit() {
  const overlay = document.getElementById('cookieEditOverlay');
  if (overlay) overlay.style.display = 'none';
  cookieEditingName = null;
}

async function saveCookieEdit() {
  const tab = await getCookieTab();
  if (!tab) return;
  const url    = new URL(tab.url);
  const name   = document.getElementById('ckEditName').value.trim();
  const value  = document.getElementById('ckEditValue').value;
  const domain = document.getElementById('ckEditDomain').value.trim();
  const path   = document.getElementById('ckEditPath').value.trim() || '/';

  if (!name) return;
  try {
    await chrome.cookies.set({
      url:    url.origin + path,
      name,
      value,
      domain,
      path,
    });
    showLsToast('Cookie saved ✓');
    closeCookieEdit();
    loadCookies();
  } catch(e) {
    showLsToast('Error: ' + e.message, true);
  }
}

window.initCookieManager = function() {
  const refreshBtn = document.getElementById('cookieRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadCookies);

  const search = document.getElementById('cookieSearch');
  if (search) search.addEventListener('input', () => renderCookies(allCookies));

  // Expand/Collapse toggle (Fix 72a)
  let _ckAllExpanded = false;
  document.getElementById('cookieToggleAllBtn')?.addEventListener('click', () => {
    _ckAllExpanded = !_ckAllExpanded;
    document.querySelectorAll('#cookieList .ls-card').forEach(card => {
      const details = card.querySelector('.ck-details');
      const tog     = card.querySelector('.ls-row-toggle');
      if (details) details.style.display = _ckAllExpanded ? '' : 'none';
      if (tog)     tog.textContent = _ckAllExpanded ? '▾' : '▸';
      card.classList.toggle('expanded', _ckAllExpanded);
    });
    const btn = document.getElementById('cookieToggleAllBtn');
    if (btn) btn.textContent = _ckAllExpanded ? '⊟ Collapse' : '⊞ Expand';
  });

  const saveBtn   = document.getElementById('ckEditSave');
  const cancelBtn = document.getElementById('ckEditCancel');
  const overlay   = document.getElementById('cookieEditOverlay');

  if (saveBtn)   saveBtn.addEventListener('click', saveCookieEdit);
  if (cancelBtn) cancelBtn.addEventListener('click', closeCookieEdit);
  if (overlay)   overlay.addEventListener('click', e => { if (e.target === overlay) closeCookieEdit(); });

  // Load when tab becomes active
  document.querySelector('[data-tab="cookies"]')?.addEventListener('click', loadCookies);
};
