// json-diff-tool.js — QAKit standalone tool: Tree, Text, Diff modes
'use strict';

const STORAGE_KEY = 'qakit_json_diff_workspace';

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════
async function loadWorkspace() {
  try {
    const s = await chrome.storage.local.get(STORAGE_KEY);
    return s[STORAGE_KEY] || {};
  } catch { return {}; }
}
async function saveWorkspace(patch) {
  try {
    const cur = await loadWorkspace();
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...cur, ...patch } });
  } catch {}
}
const debounce = (fn, ms) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// ═══════════════════════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════════════════════
function switchMode(mode) {
  document.querySelectorAll('.qd-mode').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
  document.querySelectorAll('.qd-mode-pane').forEach(el => {
    const isActive = el.dataset.modePane === mode;
    el.style.display = isActive ? 'flex' : 'none';
  });
  saveWorkspace({ mode });
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function copy(text) {
  navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  });
}
function download(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename || 'data.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).sort().forEach(k => { out[k] = sortKeysDeep(v[k]); });
    return out;
  }
  return v;
}
function tryParse(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) {
    // Extract line:col from error message
    const m = String(e.message).match(/position\s+(\d+)/);
    let line = '?', col = '?';
    if (m) {
      const pos = parseInt(m[1], 10);
      const before = text.slice(0, pos);
      const lines = before.split('\n');
      line = lines.length;
      col = lines[lines.length - 1].length + 1;
    }
    return { ok: false, error: e.message, line, col };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TREE MODE
// ═══════════════════════════════════════════════════════════════════════════
let treeData     = null;     // parsed JSON
let treeRawText  = '';       // raw text input
let treeSelected = '$';      // path of selected node
const treeExpanded = new Set(['$']); // expanded paths
let treeMatches  = [];       // array of paths matching current search
let treeSearchIdx = 0;       // current match index for Next/Prev

function childPath(path, key) {
  return path + '/' + JSON.stringify(String(key)).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pathSegments(path) {
  return path === '$' ? [] : path.slice(2).split('/').map(s => JSON.parse(s.replace(/~1/g, '/').replace(/~0/g, '~')));
}

function expandPath(path) {
  let current = '$';
  treeExpanded.add(current);
  pathSegments(path).forEach(segment => {
    current = childPath(current, segment);
    treeExpanded.add(current);
  });
}

// Walk tree once to collect every path that matches the search query.
// Auto-adds ancestor paths to treeExpanded so matches render visible.
function collectMatches(query) {
  treeMatches = [];
  if (!query || treeData == null) return;
  const q = query.toLowerCase();
  function walk(v, path, key) {
    const keyStr = String(key || '').toLowerCase();
    let isMatch = keyStr.includes(q);
    if (!isMatch) {
      if (v == null) {}
      else if (typeof v === 'string' && v.toLowerCase().includes(q)) isMatch = true;
      else if (typeof v === 'number' && String(v).includes(q)) isMatch = true;
      else if (typeof v === 'boolean' && String(v) === q) isMatch = true;
    }
    if (isMatch) {
      treeMatches.push(path);
      // Auto-expand ancestors so this match is visible in the tree
      expandPath(path);
    }
    if (Array.isArray(v)) {
      v.forEach((c, i) => walk(c, childPath(path, i), i));
    } else if (v && typeof v === 'object') {
      Object.entries(v).forEach(([k, c]) => walk(c, childPath(path, k), k));
    }
  }
  walk(treeData, '$', 'JSON');
}

function gotoNextMatch() {
  if (!treeMatches.length) return;
  treeSearchIdx = (treeSearchIdx + 1) % treeMatches.length;
  treeSelected = treeMatches[treeSearchIdx];
  renderTree();
  scrollToActiveMatch();
}
function gotoPrevMatch() {
  if (!treeMatches.length) return;
  treeSearchIdx = (treeSearchIdx - 1 + treeMatches.length) % treeMatches.length;
  treeSelected = treeMatches[treeSearchIdx];
  renderTree();
  scrollToActiveMatch();
}
function scrollToActiveMatch() {
  if (!treeMatches.length) return;
  const path = treeMatches[treeSearchIdx];
  const row = [...document.querySelectorAll('.qd-tree-row')].find(el => el.dataset.path === path);
  if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderTree() {
  const content = document.getElementById('qdTreeContent');
  const status  = document.getElementById('qdTreeStatus');
  const filter  = (document.getElementById('qdTreeFilter')?.value || '').toLowerCase();

  if (treeData == null) {
    content.innerHTML = '<div class="qd-empty"><div class="qd-empty-icon">{ }</div>Paste JSON in the <strong>Data</strong> tab to view it here</div>';
    status.className = 'qd-status idle';
    status.textContent = 'Empty';
    document.getElementById('qdTreeCrumb').textContent = '—';
    document.getElementById('qdDetailContent').innerHTML = '<div class="qd-empty">Select a node to see its fields</div>';
    treeMatches = [];
    return;
  }

  // Count nodes
  let nodeCount = 0;
  (function count(v) {
    nodeCount++;
    if (Array.isArray(v)) v.forEach(count);
    else if (v && typeof v === 'object') Object.values(v).forEach(count);
  })(treeData);

  // Collect search matches up-front so we can show count + highlight
  collectMatches(filter);

  status.className = 'qd-status ok';
  if (filter && treeMatches.length) {
    status.textContent = (treeSearchIdx + 1) + '/' + treeMatches.length + ' matches';
  } else if (filter) {
    status.textContent = 'No matches';
    status.className = 'qd-status error';
  } else {
    status.textContent = '✓ ' + nodeCount + ' nodes';
  }

  // Build tree HTML
  const lines = [];
  walkTree(treeData, '$', '', 0, 'JSON', lines, filter);
  content.innerHTML = lines.join('');

  // Wire interactions
  content.querySelectorAll('.qd-toggle-box').forEach(t => {
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      const path = t.closest('[data-path]').dataset.path;
      if (treeExpanded.has(path)) treeExpanded.delete(path);
      else treeExpanded.add(path);
      renderTree();
    });
  });
  content.querySelectorAll('.qd-tree-row').forEach(r => {
    r.addEventListener('click', () => {
      treeSelected = r.dataset.path;
      renderTree();
      renderDetail();
    });
  });
  renderDetail();
}

function getValueAtPath(data, path) {
  if (path === '$') return data;
  const segs = pathSegments(path);
  let cur = data;
  for (const seg of segs) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

function walkTree(value, path, key, depth, label, out, filter, isIndex) {
  const isObj   = value && typeof value === 'object' && !Array.isArray(value);
  const isArr   = Array.isArray(value);
  const isLeaf  = !isObj && !isArr;
  const expanded = treeExpanded.has(path);
  const indent  = depth * 16;
  const isSelected = path === treeSelected;
  const isMatch    = treeMatches.includes(path);
  const isActiveMatch = isMatch && treeMatches[treeSearchIdx] === path;

  // Filter: if filter set, only render rows whose key OR descendants match
  if (filter) {
    const subtree = JSON.stringify(value).toLowerCase();
    const keyStr  = String(key || '').toLowerCase();
    if (!keyStr.includes(filter) && !subtree.includes(filter)) return;
  }

  const typeMarker = isObj ? '{ }' : isArr ? '[ ]' : '';
  const meta = isObj ? Object.keys(value).length + ' keys'
             : isArr ? value.length + ' items' : '';

  const cls = ['qd-tree-row'];
  if (isSelected)    cls.push('selected');
  if (isMatch)       cls.push('match');
  if (isActiveMatch) cls.push('active-match');

  let line = '<div class="' + cls.join(' ') + '" data-path="' + escapeHtml(path) + '" style="padding-left:' + indent + 'px">';

  // Toggle box: [+]/[−] for containers, empty slot for leaves
  if (isLeaf) {
    line += '<span class="qd-toggle-empty"></span>';
  } else {
    line += '<span class="qd-toggle-box" title="' + (expanded ? 'Collapse' : 'Expand') + '">' + (expanded ? '−' : '+') + '</span>';
  }

  // Type marker
  if (typeMarker) {
    line += '<span class="qd-type-marker">' + typeMarker + '</span>';
  }

  // Key / index label
  if (depth === 0) {
    line += '<span class="' + (isSelected ? 'qd-key-selected' : 'qd-key') + '">' + label + '</span>';
  } else {
    if (isIndex) {
      line += '<span class="qd-meta">[' + key + ']</span>';
    } else {
      line += '<span class="' + (isSelected ? 'qd-key-selected' : 'qd-key') + '">' + escapeHtml(key) + '</span>';
    }
  }

  // Inline value for leaves
  if (isLeaf) {
    line += '<span class="qd-meta">:</span> ';
    line += renderLeafValue(value);
  } else if (meta) {
    line += '<span class="qd-meta">&nbsp;' + meta + '</span>';
  }

  line += '</div>';
  out.push(line);

  // Children (only if expanded)
  if (!isLeaf && expanded) {
    if (isArr) {
      value.forEach((item, i) => {
        walkTree(item, childPath(path, i), String(i), depth + 1, '', out, filter, true);
      });
    } else {
      Object.entries(value).forEach(([k, v]) => {
        walkTree(v, childPath(path, k), k, depth + 1, '', out, filter, false);
      });
    }
  }
}

function renderLeafValue(v) {
  if (v === null) return '<span class="qd-null">null</span>';
  if (typeof v === 'string') return '<span class="qd-string">"' + escapeHtml(v.length > 80 ? v.slice(0, 80) + '…' : v) + '"</span>';
  if (typeof v === 'number') return '<span class="qd-number">' + v + '</span>';
  if (typeof v === 'boolean') return '<span class="qd-bool">' + v + '</span>';
  return '<span>' + escapeHtml(String(v)) + '</span>';
}

function renderDetail() {
  const detail = document.getElementById('qdDetailContent');
  const crumb  = document.getElementById('qdTreeCrumb');
  if (treeData == null) return;

  // Build crumb
  const crumbParts = ['$', ...pathSegments(treeSelected)];
  let crumbHtml = '';
  for (let i = 0; i < crumbParts.length; i++) {
    if (i > 0) crumbHtml += ' › ';
    if (i === crumbParts.length - 1) {
      crumbHtml += '<span class="qd-crumb-active">' + escapeHtml(crumbParts[i]) + '</span>';
    } else {
      crumbHtml += escapeHtml(crumbParts[i]);
    }
  }
  crumb.innerHTML = crumbHtml || '<span class="qd-crumb-active">JSON</span>';

  // Render value at selected path
  const node = getValueAtPath(treeData, treeSelected);
  if (node === undefined || node === null) {
    detail.innerHTML = '<div class="qd-empty">' + (node === null ? 'Value is <code>null</code>' : 'No node at this path') + '</div>';
    return;
  }
  if (typeof node !== 'object') {
    detail.innerHTML =
      '<div class="qd-detail-row">' +
        '<div><span class="qd-key">value</span></div>' +
        '<div>' + renderLeafValue(node) + '</div>' +
      '</div>';
    return;
  }

  const isArr = Array.isArray(node);
  const entries = isArr ? node.map((v, i) => [String(i), v]) : Object.entries(node).sort((a, b) => a[0].localeCompare(b[0]));

  let h = '';
  entries.forEach(([k, v]) => {
    let valHtml;
    let drillPath = null;
    if (v === null) valHtml = '<span class="qd-null">null</span>';
    else if (Array.isArray(v)) {
      valHtml = '<span class="qd-drill" data-drill="1">[ ] ' + v.length + ' items ›</span>';
      drillPath = childPath(treeSelected, k);
    }
    else if (typeof v === 'object') {
      valHtml = '<span class="qd-drill" data-drill="1">{ } ' + Object.keys(v).length + ' keys ›</span>';
      drillPath = childPath(treeSelected, k);
    }
    else valHtml = renderLeafValue(v);

    h += '<div class="qd-detail-row" ' + (drillPath ? 'data-drill-path="' + escapeHtml(drillPath) + '"' : '') + '>' +
      '<div><span class="qd-key">' + (isArr ? '[' + k + ']' : escapeHtml(k)) + '</span></div>' +
      '<div>' + valHtml + '</div>' +
    '</div>';
  });
  if (!entries.length) h = '<div class="qd-empty">Empty ' + (isArr ? 'array' : 'object') + '</div>';

  detail.innerHTML = h;
  // Drill clicks
  detail.querySelectorAll('[data-drill-path]').forEach(row => {
    row.addEventListener('click', () => {
      treeSelected = row.dataset.drillPath;
      // Auto-expand path
      expandPath(treeSelected);
      renderTree();
    });
  });
}

function loadTreeFrom(text) {
  treeRawText = text;
  saveWorkspace({ treeText: text });
  if (!text.trim()) {
    treeData = null;
    renderTree();
    return;
  }
  const r = tryParse(text);
  const status = document.getElementById('qdTreeStatus');
  if (!r.ok) {
    treeData = null;
    status.className = 'qd-status error';
    status.textContent = '✗ ' + r.error.split(' at')[0] + (r.line !== '?' ? ' at line ' + r.line + ':' + r.col : '');
    document.getElementById('qdTreeContent').innerHTML = '<div class="qd-empty"><div class="qd-empty-icon" style="color:#c0392b">!</div>Invalid JSON · ' + escapeHtml(r.error) + '</div>';
    return;
  }
  treeData = r.value;
  treeSelected = '$';
  treeExpanded.clear();
  treeExpanded.add('$');
  // Auto-expand top level
  if (treeData && typeof treeData === 'object') {
    if (Array.isArray(treeData)) {
      treeData.forEach((_, i) => treeExpanded.add(childPath('$', i)));
    } else {
      Object.keys(treeData).forEach(k => treeExpanded.add(childPath('$', k)));
    }
  }
  renderTree();
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT MODE
// ═══════════════════════════════════════════════════════════════════════════
function updateTextLineNos(errorLine) {
  const ta = document.getElementById('qdTextArea');
  const ln = document.getElementById('qdTextLineNos');
  if (!ta || !ln) return;
  const lines = ta.value.split('\n');
  let h = '';
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1;
    if (errorLine && n === errorLine) {
      h += '<span class="qd-error-line">' + n + '</span>\n';
    } else {
      h += n + '\n';
    }
  }
  ln.innerHTML = h;
}

function validateText() {
  const ta = document.getElementById('qdTextArea');
  const status = document.getElementById('qdTextStatus');
  const text = ta.value;
  saveWorkspace({ textValue: text });
  // Editing → drop colour overlay (it'll be stale until next Format)
  clearTextOverlay();
  if (!text.trim()) {
    status.className = 'qd-status idle';
    status.textContent = 'Empty';
    updateTextLineNos();
    return null;
  }
  const r = tryParse(text);
  if (r.ok) {
    status.className = 'qd-status ok';
    status.textContent = '✓ Valid';
    updateTextLineNos();
    return r.value;
  } else {
    status.className = 'qd-status error';
    status.textContent = '✗ ' + r.error + (r.line !== '?' ? ' at line ' + r.line + ':' + r.col : '');
    updateTextLineNos(r.line === '?' ? null : r.line);
    return null;
  }
}

// ── Syntax-colour the textarea contents (rendered into overlay) ───────────
function highlightJsonHtml(text) {
  // Tokenise: strings (key vs value), numbers, bool/null, punctuation
  const tokens = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (ch === '"') {
      // Scan to closing quote (respect escapes)
      const start = i;
      i++;
      while (i < len) {
        if (text[i] === '\\' && i + 1 < len) { i += 2; continue; }
        if (text[i] === '"') { i++; break; }
        i++;
      }
      const str = text.slice(start, i);
      // Look ahead past whitespace for ":" → it's a key
      let j = i;
      while (j < len && /\s/.test(text[j])) j++;
      const isKey = text[j] === ':';
      tokens.push([isKey ? 'key' : 'string', str]);
    } else if (/[-\d]/.test(ch) && (i === 0 || /[\s,:\[\{]/.test(text[i-1]))) {
      const start = i;
      if (ch === '-') i++;
      while (i < len && /[\d.eE+\-]/.test(text[i])) i++;
      tokens.push(['number', text.slice(start, i)]);
    } else if (text.slice(i, i + 4) === 'true' || text.slice(i, i + 5) === 'false') {
      const len2 = text[i] === 't' ? 4 : 5;
      tokens.push(['bool', text.slice(i, i + len2)]);
      i += len2;
    } else if (text.slice(i, i + 4) === 'null') {
      tokens.push(['null', 'null']);
      i += 4;
    } else if (/[\{\}\[\],:]/.test(ch)) {
      tokens.push(['punct', ch]);
      i++;
    } else {
      tokens.push(['plain', ch]);
      i++;
    }
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  return tokens.map(([type, txt]) => {
    if (type === 'key')    return '<span class="qd-tx-key">'    + esc(txt) + '</span>';
    if (type === 'string') return '<span class="qd-tx-string">' + esc(txt) + '</span>';
    if (type === 'number') return '<span class="qd-tx-number">' + esc(txt) + '</span>';
    if (type === 'bool')   return '<span class="qd-tx-bool">'   + esc(txt) + '</span>';
    if (type === 'null')   return '<span class="qd-tx-null">'   + esc(txt) + '</span>';
    if (type === 'punct')  return '<span class="qd-tx-punct">'  + esc(txt) + '</span>';
    return esc(txt);
  }).join('');
}

function applyTextOverlay() {
  const ta = document.getElementById('qdTextArea');
  const overlay = document.getElementById('qdTextOverlay');
  if (!ta || !overlay) return;
  overlay.innerHTML = highlightJsonHtml(ta.value);
  ta.classList.add('colorised');
  syncTextScroll();
}
function clearTextOverlay() {
  const ta = document.getElementById('qdTextArea');
  const overlay = document.getElementById('qdTextOverlay');
  if (overlay) overlay.innerHTML = '';
  if (ta) ta.classList.remove('colorised');
}
function syncTextScroll() {
  const ta = document.getElementById('qdTextArea');
  const overlay = document.getElementById('qdTextOverlay');
  const ln = document.getElementById('qdTextLineNos');
  if (!ta) return;
  if (overlay) {
    overlay.scrollTop = ta.scrollTop;
    overlay.scrollLeft = ta.scrollLeft;
  }
  if (ln) ln.scrollTop = ta.scrollTop;
}

// ═══════════════════════════════════════════════════════════════════════════
// WIRE UP
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  // Version from manifest
  const vEl = document.querySelector('.qd-version');
  if (vEl) vEl.textContent = 'v' + chrome.runtime.getManifest().version;

  // Mode switch
  document.querySelectorAll('.qd-mode').forEach(btn => {
    btn.addEventListener('click', () => switchMode(btn.dataset.mode));
  });

  // ── Tree mode toolbar (Fix 28: search Next/Prev, Expand all, Collapse all) ──
  document.getElementById('qdTreeSortKeys')?.addEventListener('click', () => {
    if (treeData != null) {
      treeData = sortKeysDeep(treeData);
      treeRawText = JSON.stringify(treeData, null, 2);
      saveWorkspace({ treeText: treeRawText });
      // Push back to Data tab textarea so Data view stays in sync
      const ta = document.getElementById('qdTextArea');
      if (ta) { ta.value = treeRawText; validateText(); applyTextOverlay(); }
      renderTree();
    }
  });
  document.getElementById('qdTreeCopy')?.addEventListener('click', () => {
    if (treeData != null) copy(JSON.stringify(treeData, null, 2));
  });
  document.getElementById('qdTreeDownload')?.addEventListener('click', () => {
    if (treeData != null) download(JSON.stringify(treeData, null, 2), 'data.json');
  });

  // Expand all — recursively expand every container; warn on huge JSON
  document.getElementById('qdTreeExpandAll')?.addEventListener('click', () => {
    if (treeData == null) return;
    let count = 0;
    (function walk(value, path) {
      treeExpanded.add(path);
      count++;
      if (count > 5000) return;
      if (Array.isArray(value)) {
        value.forEach((v, i) => walk(v, childPath(path, i)));
      } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([k, v]) => walk(v, childPath(path, k)));
      }
    })(treeData, '$');
    if (count > 5000 && !confirm('JSON has ' + count + '+ nodes. Expand-all may be slow. Continue?')) {
      return;
    }
    renderTree();
  });
  document.getElementById('qdTreeCollapseAll')?.addEventListener('click', () => {
    treeExpanded.clear();
    treeExpanded.add('$');
    renderTree();
  });

  // Search — debounced, with Next/Prev navigation through matches
  const searchInp = document.getElementById('qdTreeFilter');
  const searchPrev = document.getElementById('qdTreeSearchPrev');
  const searchNext = document.getElementById('qdTreeSearchNext');
  if (searchInp) {
    searchInp.addEventListener('input', debounce(() => {
      treeSearchIdx = 0;
      renderTree();
      // Auto-scroll to first match
      setTimeout(scrollToActiveMatch, 50);
    }, 200));
    searchInp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) gotoPrevMatch(); else gotoNextMatch();
        e.preventDefault();
      }
    });
  }
  searchPrev?.addEventListener('click', gotoPrevMatch);
  searchNext?.addEventListener('click', gotoNextMatch);

  // ── Data tab (Fix 30: restore full toolbar + colour after Format) ──
  const ta = document.getElementById('qdTextArea');
  ta.addEventListener('input', () => {
    validateText();
    if (ta.value.trim() && tryParse(ta.value).ok) {
      loadTreeFrom(ta.value);
    } else if (!ta.value.trim()) {
      treeData = null; treeRawText = '';
      saveWorkspace({ treeText: '' });
      renderTree();
    }
  });
  ta.addEventListener('scroll', () => {
    document.getElementById('qdTextLineNos').scrollTop = ta.scrollTop;
    syncTextScroll();
  });
  document.getElementById('qdTextPaste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      ta.value = text; validateText();
      if (text.trim() && tryParse(text).ok) {
        const v = JSON.parse(text);
        ta.value = JSON.stringify(v, null, 2);
        validateText(); applyTextOverlay(); loadTreeFrom(ta.value);
      }
    } catch {}
  });
  document.getElementById('qdTextFormat').addEventListener('click', () => {
    const v = validateText();
    if (v != null) { ta.value = JSON.stringify(v, null, 2); validateText(); applyTextOverlay(); loadTreeFrom(ta.value); }
  });
  document.getElementById('qdTextMinify').addEventListener('click', () => {
    const v = validateText();
    if (v != null) { ta.value = JSON.stringify(v); validateText(); applyTextOverlay(); loadTreeFrom(ta.value); }
  });
  document.getElementById('qdTextSortKeys').addEventListener('click', () => {
    const v = validateText();
    if (v != null) { ta.value = JSON.stringify(sortKeysDeep(v), null, 2); validateText(); applyTextOverlay(); loadTreeFrom(ta.value); }
  });
  document.getElementById('qdTextEscape').addEventListener('click', () => {
    ta.value = JSON.stringify(ta.value); validateText(); clearTextOverlay();
  });
  document.getElementById('qdTextUnescape').addEventListener('click', () => {
    try { const v = JSON.parse(ta.value); ta.value = typeof v === 'string' ? v : JSON.stringify(v); } catch {}
    validateText(); clearTextOverlay();
  });
  document.getElementById('qdTextCopy').addEventListener('click', () => { if (ta.value) copy(ta.value); });
  document.getElementById('qdTextDownload').addEventListener('click', () => { if (ta.value) download(ta.value, 'data.json'); });
  document.getElementById('qdTextClear').addEventListener('click', () => {
    ta.value = ''; clearTextOverlay(); validateText();
    treeData = null; treeRawText = ''; saveWorkspace({ treeText: '' }); renderTree();
  });

  // ── Resizable splitter for Tree mode (Fix 16) ──
  const splitter   = document.getElementById('qdSplitter');
  const treePane   = document.getElementById('qdTreePane');
  const detailPane = document.getElementById('qdDetailPane');
  if (splitter && treePane && detailPane) {
    let dragging = false;
    splitter.addEventListener('mousedown', (e) => {
      dragging = true;
      splitter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const body = splitter.parentElement;
      const rect = body.getBoundingClientRect();
      const totalWidth = rect.width - 6;
      const leftWidth = e.clientX - rect.left;
      const ratio = Math.max(15, Math.min(85, (leftWidth / totalWidth) * 100));
      treePane.style.flex   = ratio + ' 1 0';
      detailPane.style.flex = (100 - ratio) + ' 1 0';
      saveWorkspace({ splitRatio: ratio });
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        splitter.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // ── Restore workspace ──
  const ws = await loadWorkspace();
  if (ws.treeText) loadTreeFrom(ws.treeText);
  if (ws.textValue != null) {
    ta.value = ws.textValue;
    validateText();
    // Auto-colour if it's already valid formatted JSON
    if (ta.value.includes('\n') && tryParse(ta.value).ok) applyTextOverlay();
  }
  if (ws.splitRatio && treePane && detailPane) {
    treePane.style.flex   = ws.splitRatio + ' 1 0';
    detailPane.style.flex = (100 - ws.splitRatio) + ' 1 0';
  }
  if (ws.mode && ws.mode !== 'diff') switchMode(ws.mode);
});
