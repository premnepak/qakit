// headers.js — QAKit: Header Modifier
// Uses chrome.declarativeNetRequest for add/modify/remove headers on matching requests.
// Rules are stored in chrome.storage.local and applied via background.js.

const HDR_STORAGE_KEY = 'qa_header_rules';

let headerRules = [];

async function loadHeaderRules() {
  const s = await chrome.storage.local.get(HDR_STORAGE_KEY);
  headerRules = s[HDR_STORAGE_KEY] || [];
}

async function saveHeaderRules() {
  await chrome.storage.local.set({ [HDR_STORAGE_KEY]: headerRules });
  // Notify background to re-apply rules
  chrome.runtime.sendMessage({ action: 'APPLY_HEADER_RULES', rules: headerRules }).catch(() => {});
}

function renderHeaderRules() {
  const container = document.getElementById('hdrRuleList');
  if (!container) return;

  if (headerRules.length === 0) {
    container.innerHTML =
      '<div class="empty" style="padding:20px">' +
        '<div class="empty-icon">🔧</div>' +
        '<div class="empty-text">No header rules yet.<br>Add a rule below to intercept requests.</div>' +
      '</div>';
    return;
  }

  container.innerHTML = '';
  headerRules.forEach((rule, idx) => {
    const card = document.createElement('div');
    card.className = 'net-rule-card';
    card.style.marginBottom = '6px';

    const opColor = { add: 'var(--accent)', set: '#0ea5e9', remove: 'var(--warn)' }[rule.op] || '#888';
    const opLabel = { add: '+ Add', set: '✎ Set', remove: '✕ Remove' }[rule.op] || rule.op;

    card.innerHTML =
      '<div class="net-rule-header" style="display:flex;align-items:center;gap:8px;padding:7px 10px">' +
        '<button class="net-rule-toggle ' + (rule.enabled ? 'on' : '') + '" data-idx="' + idx + '"></button>' +
        '<span style="font-size:10px;font-weight:700;color:' + opColor + ';min-width:54px">' + opLabel + '</span>' +
        '<span style="font-weight:700;font-size:10px;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
          rule.header +
        '</span>' +
        '<div class="net-rule-actions">' +
          '<button class="net-rule-btn edit" data-idx="' + idx + '">✎ Edit</button>' +
          '<button class="net-rule-btn del"  data-idx="' + idx + '">✕</button>' +
        '</div>' +
      '</div>' +
      '<div style="padding:5px 10px 7px;background:var(--card);font-size:9px;color:var(--muted)">' +
        '<span style="font-family:monospace;color:var(--text)">' + (rule.value || '(removed)') + '</span>' +
        '&nbsp;&nbsp;·&nbsp;&nbsp;URL: <span style="font-family:monospace">' + rule.urlFilter + '</span>' +
        (rule.requestType !== 'all' ? '&nbsp;·&nbsp;' + rule.requestType : '') +
      '</div>';

    // Toggle enable/disable
    card.querySelector('.net-rule-toggle').addEventListener('click', async () => {
      headerRules[idx].enabled = !headerRules[idx].enabled;
      await saveHeaderRules();
      renderHeaderRules();
    });

    // Edit
    card.querySelector('.edit').addEventListener('click', () => openHdrModal(idx));

    // Delete
    card.querySelector('.del').addEventListener('click', async () => {
      headerRules.splice(idx, 1);
      await saveHeaderRules();
      renderHeaderRules();
    });

    container.appendChild(card);
  });
}

let editingIdx = -1;

function openHdrModal(idx) {
  editingIdx = idx;
  const rule = idx >= 0 ? headerRules[idx] : null;
  const modal = document.getElementById('hdrModal');
  if (!modal) return;

  document.getElementById('hdrModalTitle').textContent = rule ? 'Edit Header Rule' : 'Add Header Rule';
  document.getElementById('hdrUrlFilter').value  = rule?.urlFilter  || '*';
  document.getElementById('hdrHeaderName').value = rule?.header     || '';
  document.getElementById('hdrHeaderValue').value= rule?.value      || '';
  document.getElementById('hdrOp').value         = rule?.op         || 'set';
  document.getElementById('hdrReqType').value    = rule?.requestType || 'all';

  // Show/hide value field based on op
  toggleValueField();

  modal.style.display = 'flex';
}

function toggleValueField() {
  const op   = document.getElementById('hdrOp')?.value;
  const row  = document.getElementById('hdrValueRow');
  if (row) row.style.display = op === 'remove' ? 'none' : '';
}

document.getElementById('hdrOp')?.addEventListener('change', toggleValueField);

document.getElementById('hdrAddBtn')?.addEventListener('click', () => openHdrModal(-1));

document.getElementById('hdrModalCancel')?.addEventListener('click', () => {
  document.getElementById('hdrModal').style.display = 'none';
});

document.getElementById('hdrModalSave')?.addEventListener('click', async () => {
  const urlFilter   = document.getElementById('hdrUrlFilter')?.value.trim();
  const header      = document.getElementById('hdrHeaderName')?.value.trim();
  const value       = document.getElementById('hdrHeaderValue')?.value.trim();
  const op          = document.getElementById('hdrOp')?.value;
  const requestType = document.getElementById('hdrReqType')?.value;

  if (!urlFilter || !header) {
    showLsToast('URL filter and header name are required', true); return;
  }

  const rule = { urlFilter, header, value: op === 'remove' ? '' : value, op, requestType, enabled: true };

  if (editingIdx >= 0) headerRules[editingIdx] = rule;
  else headerRules.push(rule);

  await saveHeaderRules();
  renderHeaderRules();
  document.getElementById('hdrModal').style.display = 'none';
  showLsToast('Header rule saved ✓');
});

document.getElementById('hdrClearAllBtn')?.addEventListener('click', async () => {
  if (!confirm('Clear all header rules?')) return;
  headerRules = [];
  await saveHeaderRules();
  renderHeaderRules();
  showLsToast('All header rules cleared');
});

window.initHeaders = async function () {
  await loadHeaderRules();
  renderHeaderRules();

  // Show info about rule limits
  const info = document.getElementById('hdrInfo');
  if (info) {
    chrome.declarativeNetRequest?.getSessionRules?.((rules) => {
      info.textContent = 'Active dynamic rules: ' + (rules?.length || 0);
    });
  }
};
