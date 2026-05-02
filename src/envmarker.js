// envmarker.js — QAKit v1.0.1
// Environment Marker panel: collapsed-row layout, drag reorder, position rules.

const ENV_STORAGE_KEY = 'qakit_env_marker_envs';

const DEFAULT_ENVS = [
  { id: 'staging', name: '🟠 STAGING',    pattern: 'regex:staging|stg',          color: '#ea580c', textColor: '#ffffff', fontSize: 'auto', position: 'top',    variant: 'bar', opacity: 85, enabled: true },
  { id: 'uat',     name: '🔵 UAT',        pattern: 'regex:uat|preprod|pre-prod', color: '#2563eb', textColor: '#ffffff', fontSize: 'auto', position: 'top',    variant: 'bar', opacity: 85, enabled: true },
  { id: 'dev',     name: '🔴 DEV',        pattern: 'regex:localhost|127\\.0\\.0\\.1|\\.dev\\.|dev\\.', color: '#dc2626', textColor: '#ffffff', fontSize: 'auto', position: 'bottom', variant: 'bar', opacity: 85, enabled: true },
  { id: 'prod',    name: '🟢 PRODUCTION', pattern: 'regex:^https?://(www|app)\\.', color: '#16a34a', textColor: '#ffffff', fontSize: 'auto', position: 'top',    variant: 'bar', opacity: 90, enabled: false },
];

async function loadEnvs() {
  const s = await chrome.storage.local.get(ENV_STORAGE_KEY);
  if (Array.isArray(s[ENV_STORAGE_KEY])) return s[ENV_STORAGE_KEY];
  await saveEnvs(DEFAULT_ENVS);
  return DEFAULT_ENVS.slice();
}

async function saveEnvs(envs) {
  await chrome.storage.local.set({ [ENV_STORAGE_KEY]: envs });
  try { chrome.runtime.sendMessage({ action: 'REFRESH_ENV_MARKERS' }).catch(() => {}); } catch(_) {}
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Position options per variant. Bar → only top/bottom. Pill/ribbon → only corners.
function positionOptionsFor(variant) {
  if (variant === 'bar') {
    return [['top', 'Top'], ['bottom', 'Bottom']];
  }
  return [
    ['top-left',     'Top-Left'],
    ['top-right',    'Top-Right'],
    ['bottom-left',  'Bottom-Left'],
    ['bottom-right', 'Bottom-Right'],
  ];
}

// Coerce position to be valid for the chosen variant
function coercePosition(variant, position) {
  const valid = positionOptionsFor(variant).map(p => p[0]);
  if (valid.includes(position)) return position;
  if (variant === 'bar') return position && position.includes('bottom') ? 'bottom' : 'top';
  return 'top-right';
}

async function renderEnvMarkerPanel() {
  const list = document.getElementById('envmarkerList');
  if (!list) return;
  const envs = await loadEnvs();
  list.innerHTML = '';
  if (envs.length === 0) {
    list.innerHTML = '<div class="empty" style="padding:20px 12px"><div class="empty-icon">🏷</div><div class="empty-text">No environments configured. Click "+ Add" above.</div></div>';
    return;
  }

  envs.forEach((env, idx) => {
    const opacityVal = env.opacity != null ? env.opacity : 90;
    const wrapper = document.createElement('div');
    wrapper.className = 'env-row' + (env._expanded ? ' expanded' : '');
    wrapper.draggable = true;
    wrapper.dataset.idx = idx;
    wrapper.style.cssText = 'border:1px solid var(--border);border-radius:5px;margin-bottom:5px;background:var(--card);overflow:hidden';

    const positionLabel = (positionOptionsFor(env.variant).find(p => p[0] === env.position) || [env.position, env.position])[1];

    wrapper.innerHTML =
      // ── Collapsed row ─────────────────────────────────────────────────
      '<div class="env-row-header" style="display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;user-select:none">' +
        '<span class="env-drag" style="color:var(--muted);cursor:grab;font-size:12px;flex-shrink:0;padding:0 2px" title="Drag to reorder">⠿</span>' +
        '<input type="checkbox" class="env-enabled" ' + (env.enabled ? 'checked' : '') + ' style="accent-color:var(--accent);cursor:pointer;flex-shrink:0" />' +
        '<span style="flex-shrink:0;font-size:11px;font-weight:700;color:var(--text);min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(env.name) + '</span>' +
        '<span style="flex:1;font-size:9.5px;color:var(--muted);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0" title="' + escHtml(env.pattern) + '">' + escHtml(env.pattern) + '</span>' +
        '<span style="display:inline-block;width:16px;height:16px;border-radius:3px;border:1px solid var(--border);background:' + env.color + ';opacity:' + (opacityVal/100) + ';flex-shrink:0" title="Color"></span>' +
        '<span class="env-row-toggle" style="color:var(--muted);font-size:11px;flex-shrink:0;width:12px;text-align:center">' + (env._expanded ? '▾' : '▸') + '</span>' +
        '<button class="btn-ghost env-delete" style="padding:2px 5px;font-size:9px;color:var(--warn);border-color:var(--warn);flex-shrink:0" title="Delete">🗑</button>' +
      '</div>' +
      // ── Expanded editor ───────────────────────────────────────────────
      '<div class="env-row-body" style="display:' + (env._expanded ? 'block' : 'none') + ';padding:8px 10px;background:var(--surface);border-top:1px solid var(--border)">' +
        '<div style="display:grid;grid-template-columns:1fr 1.4fr;gap:5px;margin-bottom:5px">' +
          '<label style="font-size:8.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">Name' +
            '<input type="text" class="env-name net-input" value="' + escHtml(env.name) + '" style="font-size:10px;padding:4px 6px">' +
          '</label>' +
          '<label style="font-size:8.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">URL pattern (host or <code>regex:</code>)' +
            '<input type="text" class="env-pattern net-input" value="' + escHtml(env.pattern) + '" placeholder="*.staging.example.com or regex:uat" style="font-size:10px;padding:4px 6px;font-family:monospace">' +
          '</label>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1.2fr 1fr 1fr;gap:5px;margin-bottom:6px">' +
          '<label style="font-size:8.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">Variant' +
            '<select class="env-variant net-select" style="font-size:10px;padding:3px 4px">' +
              ['bar','pill','ribbon'].map(v => '<option value="' + v + '"' + (env.variant === v ? ' selected' : '') + '>' + v + '</option>').join('') +
            '</select>' +
          '</label>' +
          '<label style="font-size:8.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">Position' +
            '<select class="env-position net-select" style="font-size:10px;padding:3px 4px">' +
              positionOptionsFor(env.variant).map(([v, label]) => '<option value="' + v + '"' + (env.position === v ? ' selected' : '') + '>' + label + '</option>').join('') +
            '</select>' +
          '</label>' +
          '<label style="font-size:8.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">Size' +
            '<select class="env-fontsize net-select" style="font-size:10px;padding:3px 4px">' +
              ['auto','small','large'].map(s => '<option value="' + s + '"' + (env.fontSize === s ? ' selected' : '') + '>' + s + '</option>').join('') +
            '</select>' +
          '</label>' +
          '<label style="font-size:8.5px;color:var(--muted);display:flex;flex-direction:column;gap:2px">Color' +
            '<input type="color" class="env-color" value="' + env.color + '" style="width:100%;height:24px;padding:0;border:1px solid var(--border);border-radius:3px;cursor:pointer">' +
          '</label>' +
        '</div>' +
        '<label style="font-size:8.5px;color:var(--muted);display:flex;align-items:center;gap:8px">' +
          '<span style="flex-shrink:0">Opacity</span>' +
          '<input type="range" min="20" max="100" step="5" class="env-opacity" value="' + opacityVal + '" style="flex:1;accent-color:var(--accent);cursor:pointer">' +
          '<span class="env-opacity-val" style="font-family:monospace;width:32px;text-align:right;color:var(--text);font-weight:700">' + opacityVal + '%</span>' +
        '</label>' +
      '</div>';

    // ── Wire interactions ───────────────────────────────────────────────
    const headerEl = wrapper.querySelector('.env-row-header');
    const bodyEl = wrapper.querySelector('.env-row-body');
    const toggleEl = wrapper.querySelector('.env-row-toggle');

    headerEl.addEventListener('click', (e) => {
      // Don't toggle when clicking inside controls
      if (e.target.closest('input, button, .env-drag')) return;
      env._expanded = !env._expanded;
      bodyEl.style.display = env._expanded ? 'block' : 'none';
      toggleEl.textContent = env._expanded ? '▾' : '▸';
      wrapper.classList.toggle('expanded', env._expanded);
    });

    const refresh = async () => {
      const current = await loadEnvs();
      const target = current[idx];
      if (!target) return;
      target.enabled  = wrapper.querySelector('.env-enabled').checked;
      target.name     = wrapper.querySelector('.env-name').value;
      target.pattern  = wrapper.querySelector('.env-pattern').value;
      const newVariant = wrapper.querySelector('.env-variant').value;
      const oldVariant = target.variant;
      target.variant  = newVariant;
      target.fontSize = wrapper.querySelector('.env-fontsize').value;
      target.color    = wrapper.querySelector('.env-color').value;
      target.opacity  = parseInt(wrapper.querySelector('.env-opacity').value, 10);
      // Position depends on variant — coerce if variant changed
      target.position = coercePosition(newVariant, wrapper.querySelector('.env-position').value);
      current[idx] = target;
      await saveEnvs(current);
      // Re-render only if variant changed (positions need to update dropdown)
      if (oldVariant !== newVariant) {
        target._expanded = true;
        renderEnvMarkerPanel();
      }
    };

    wrapper.querySelector('.env-enabled').addEventListener('change', refresh);
    ['.env-name', '.env-pattern', '.env-variant', '.env-position', '.env-fontsize', '.env-color'].forEach(sel => {
      wrapper.querySelector(sel)?.addEventListener('change', refresh);
    });
    const opSlider = wrapper.querySelector('.env-opacity');
    const opLabel  = wrapper.querySelector('.env-opacity-val');
    opSlider?.addEventListener('input', () => { opLabel.textContent = opSlider.value + '%'; });
    opSlider?.addEventListener('change', refresh);

    wrapper.querySelector('.env-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete "' + env.name + '"?')) return;
      const current = await loadEnvs();
      current.splice(idx, 1);
      await saveEnvs(current);
      renderEnvMarkerPanel();
    });

    // ── Drag & drop reorder ─────────────────────────────────────────────
    // Guard: don't initiate drag when user interacts with form controls (Fix 66)
    wrapper.addEventListener('mousedown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
        wrapper.draggable = false;
      } else {
        wrapper.draggable = true;
      }
    });
    wrapper.addEventListener('dragstart', (e) => {
      if (!wrapper.draggable) { e.preventDefault(); return; }
      wrapper.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    });
    wrapper.addEventListener('dragend', () => { wrapper.style.opacity = '1'; });
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      wrapper.style.borderTop = '2px solid var(--accent)';
    });
    wrapper.addEventListener('dragleave', () => { wrapper.style.borderTop = ''; });
    wrapper.addEventListener('drop', async (e) => {
      e.preventDefault();
      wrapper.style.borderTop = '';
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const toIdx = parseInt(wrapper.dataset.idx, 10);
      if (fromIdx === toIdx) return;
      const current = await loadEnvs();
      const [moved] = current.splice(fromIdx, 1);
      current.splice(toIdx, 0, moved);
      await saveEnvs(current);
      renderEnvMarkerPanel();
    });

    list.appendChild(wrapper);
  });
}

window.initEnvMarker = function() {
  renderEnvMarkerPanel();

  // Add new at the top + auto-expand
  document.getElementById('envmarkerAddBtn')?.addEventListener('click', async () => {
    const envs = await loadEnvs();
    const newEnv = {
      id: 'env-' + Date.now(),
      name: '🏷 NEW ENV',
      pattern: '',
      color: '#6b7280',
      textColor: '#ffffff',
      fontSize: 'auto',
      position: 'top',
      variant: 'bar',
      opacity: 85,
      enabled: true,
      _expanded: true,
    };
    envs.unshift(newEnv); // ← new at top, not at bottom
    await saveEnvs(envs);
    renderEnvMarkerPanel();
  });

  document.getElementById('envmarkerResetBtn')?.addEventListener('click', async () => {
    if (!confirm('Reset to default environments? This will delete your customisations.')) return;
    await saveEnvs(DEFAULT_ENVS.slice());
    renderEnvMarkerPanel();
  });
};
