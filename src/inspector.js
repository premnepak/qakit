// inspector.js — QAKit Element Inspector + Spacing Inspector
// Injected into MAIN world via chrome.scripting.executeScript

(function installInspector() {
  const mode = window.__qInspectorMode || 'inspect';

  // ── Re-activate / mode switch if already installed ────────────────────────
  // Only reactivate if the caller explicitly asked us to (by setting
  // __qInspectorActive = true BEFORE this script runs, or by calling us
  // after install). On the first-ever inject we don't activate automatically —
  // callers like ensureAllInjected() can pre-install the script without
  // turning the inspector on.
  if (window.__qInspectorInstalled) {
    if (window.__qInspectorActive) {
      document.documentElement.style.cursor = 'crosshair';
      if (typeof window.__qHideAll === 'function') window.__qHideAll();
    }
    return;
  }
  window.__qInspectorInstalled = true;
  // Only activate automatically if caller explicitly set it true before inject.
  // This lets context-menu handlers call ensureAllInjected() without side effects.
  if (window.__qInspectorActive !== true) {
    window.__qInspectorActive = false;
  }
  window.__qInspectorMode = mode; // 'inspect' | 'spacing'

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED: Overlay box
  // ══════════════════════════════════════════════════════════════════════════
  const overlay = document.createElement('div');
  overlay.id = '__q-inspector-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483645',
    boxSizing: 'border-box', border: '2px solid rgba(0,229,160,0.9)',
    borderRadius: '3px', background: 'rgba(0,229,160,0.06)', display: 'none',
  });
  document.documentElement.appendChild(overlay);

  // ══════════════════════════════════════════════════════════════════════════
  // MODE 1: INSPECT BADGE (data-testid + WAE)
  // ══════════════════════════════════════════════════════════════════════════
  const badge = document.createElement('div');
  badge.id = '__q-inspector-badge';
  Object.assign(badge.style, {
    position: 'fixed', zIndex: '2147483647', pointerEvents: 'none',
    fontFamily: 'ui-monospace,"SF Mono",Menlo,Consolas,"Courier New",monospace',
    fontSize: '13px', lineHeight: '1.6',
    borderRadius: '8px', background: 'rgba(15,15,20,0.97)',
    border: '1.5px solid rgba(0,229,160,0.6)', color: '#e8e8f0',
    maxWidth: '360px', minWidth: '220px',
    boxShadow: '0 8px 32px rgba(0,0,0,.7)', display: 'none', overflow: 'hidden',
    userSelect: 'none',
  });
  document.documentElement.appendChild(badge);

  // ══════════════════════════════════════════════════════════════════════════
  // MODE 2: SPACING OVERLAY (Figma-style box model)
  // ══════════════════════════════════════════════════════════════════════════

  // Margin overlay (outer, orange)
  const marginBox = document.createElement('div');
  marginBox.id = '__q-spacing-margin';
  Object.assign(marginBox.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483644',
    boxSizing: 'border-box', background: 'rgba(255,159,67,0.15)',
    border: '1px dashed rgba(255,159,67,0.7)', display: 'none',
  });
  document.documentElement.appendChild(marginBox);

  // Padding overlay (inner, purple/blue)
  const paddingBox = document.createElement('div');
  paddingBox.id = '__q-spacing-padding';
  Object.assign(paddingBox.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483645',
    boxSizing: 'border-box', background: 'rgba(130,100,255,0.12)',
    border: '1px dashed rgba(130,100,255,0.7)', display: 'none',
  });
  document.documentElement.appendChild(paddingBox);

  // Content box (teal)
  const contentBox = document.createElement('div');
  contentBox.id = '__q-spacing-content';
  Object.assign(contentBox.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
    boxSizing: 'border-box', background: 'rgba(0,229,160,0.10)',
    border: '2px solid rgba(0,229,160,0.9)', display: 'none',
  });
  document.documentElement.appendChild(contentBox);

  // Dimension labels (injected as needed)
  function makeDimLabel(id, text, bg, textColor) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      Object.assign(el.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
        fontFamily: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
        fontWeight: '700', fontSize: '11px', lineHeight: '1',
        padding: '2px 5px', borderRadius: '3px',
        background: bg, color: textColor,
        boxShadow: '0 1px 4px rgba(0,0,0,.5)',
        display: 'none', whiteSpace: 'nowrap',
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    return el;
  }

  // Spacing info panel
  const spacingPanel = document.createElement('div');
  spacingPanel.id = '__q-spacing-panel';
  Object.assign(spacingPanel.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    fontFamily: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace',
    fontSize: '12px', lineHeight: '1.6',
    borderRadius: '8px', background: 'rgba(10,10,20,0.97)',
    border: '1.5px solid rgba(130,100,255,0.7)', color: '#e8e8f0',
    maxWidth: '260px', minWidth: '180px',
    boxShadow: '0 8px 32px rgba(0,0,0,.7)', display: 'none', overflow: 'hidden',
  });
  document.documentElement.appendChild(spacingPanel);

  // ── Hide all ──────────────────────────────────────────────────────────────
  function hideAll() {
    [overlay, badge, marginBox, paddingBox, contentBox, spacingPanel].forEach(el => {
      el.style.display = 'none';
    });
    ['__q-dim-w','__q-dim-h','__q-dim-pt','__q-dim-pb','__q-dim-pl','__q-dim-pr',
     '__q-dim-mt','__q-dim-mb','__q-dim-ml','__q-dim-mr',
     '__q-gap-prev','__q-gap-next','__q-gap-prev-lbl','__q-gap-next-lbl'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
  window.__qHideAll = hideAll;

  // ══════════════════════════════════════════════════════════════════════════
  // INSPECT MODE HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  // Priority-ordered test locator attributes — user custom attr checked first
  const DEFAULT_TEST_ATTRS = [
    'data-testid', 'data-test', 'data-cy', 'data-qa', 'data-pw',
    'data-test-id', 'data-automation', 'data-e2e', 'data-id', 'qa-id',
  ];

  function getTestAttrs() {
    // window.__qCustomTestAttr optionally set from settings via popup.js
    const custom = (window.__qCustomTestAttr || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!custom.length) return DEFAULT_TEST_ATTRS;
    // Custom first, then any defaults not already included
    const merged = [...custom];
    DEFAULT_TEST_ATTRS.forEach(a => { if (!merged.includes(a)) merged.push(a); });
    return merged;
  }

  function findBestLocator(startEl, cursorX, cursorY) {
    // Strategy: use document.elementsFromPoint to get ALL elements stacked at
    // the cursor position, then search each one and its ancestors for test attrs.
    // This handles:
    //   1. Deep ancestor walk (data-testid on a distant parent)
    //   2. Overlapping/sibling elements (e.g. positioned overlay on top of testid element)
    //   3. z-index stacking where the hover target is not a descendant of testid element
    const testAttrs = getTestAttrs();

    // First try: walk up from the directly hovered element (fastest path)
    function walkUp(el, limit) {
      let node = el;
      for (let i = 0; i < limit && node && node.tagName && node !== document.documentElement; i++) {
        for (const attr of testAttrs) {
          if (node.hasAttribute(attr)) {
            return { attr, value: node.getAttribute(attr), el: node, isSuggested: false };
          }
        }
        node = node.parentElement;
      }
      return null;
    }

    // Try direct ancestor walk first (depth 30)
    const directResult = walkUp(startEl, 30);
    if (directResult) return directResult;

    // Second try: check ALL elements under the cursor via elementsFromPoint.
    // This catches overlapping elements where e.target is the wrong layer.
    try {
      const allEls = document.elementsFromPoint(
        cursorX !== undefined ? cursorX : startEl.getBoundingClientRect().left + startEl.getBoundingClientRect().width / 2,
        cursorY !== undefined ? cursorY : startEl.getBoundingClientRect().top  + startEl.getBoundingClientRect().height / 2
      );

      for (const candidate of allEls) {
        if (candidate === startEl) continue;              // already checked
        if (candidate === document.documentElement) break;// stop at root
        if (candidate.id && candidate.id.startsWith('__q-')) continue; // skip our own overlays
        const result = walkUp(candidate, 30);
        if (result) return result;
      }
    } catch (_) {}

    // Nothing found anywhere — suggest the best locator for the hovered element
    const el = startEl;
    if (el.id) return { attr: 'id', value: el.id, el, isSuggested: true };
    const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
    if (aria) return { attr: 'aria-label', value: aria, el, isSuggested: true };
    const name = el.getAttribute('name');
    if (name) return { attr: 'name', value: name, el, isSuggested: true };
    const role = el.getAttribute('role');
    if (role) return { attr: 'role', value: role, el, isSuggested: true };
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).slice(0, 2).join('.');
    return { attr: 'css', value: classes ? tag + '.' + classes : tag, el, isSuggested: true };
  }

  function findAttrs(startEl, cursorX, cursorY) {
    const result = {
      testLocator: null,   // { attr, value, el, isSuggested }
      waeEvent:    null,
      waeAttrs:    {},
      tag:         startEl.tagName?.toLowerCase() || '',
      id:          startEl.id || null,
      classes:     Array.from(startEl.classList).slice(0, 3),
      highlightEl: null,
      // True when the test locator lives on an ancestor (not the hovered element itself)
      locatorInherited:    false,
      locatorInheritedTag: null,
    };

    // Find best test locator — pass cursor coords for elementsFromPoint fallback
    result.testLocator = findBestLocator(startEl, cursorX, cursorY);

    // ALWAYS highlight the element directly under the cursor, never the
    // ancestor that carries the test attribute. Previously we highlighted
    // testLocator.el, which could be a parent wrapper spanning siblings,
    // producing a confusing "highlights both buttons" effect.
    result.highlightEl = startEl;

    if (result.testLocator && result.testLocator.el && result.testLocator.el !== startEl) {
      result.locatorInherited = true;
      const anc = result.testLocator.el;
      const ancTag = anc.tagName ? anc.tagName.toLowerCase() : '';
      const ancId  = anc.id ? '#' + anc.id : '';
      const ancCls = anc.classList && anc.classList.length ? '.' + anc.classList[0] : '';
      result.locatorInheritedTag = ancTag + ancId + ancCls;
    }

    // Walk up for WAE event (unchanged behavior — WAE events are commonly on
    // parent wrappers and aren't confusing there)
    let node = startEl;
    for (let i = 0; i < 10 && node && node.tagName; i++) {
      if (!result.waeEvent && node.hasAttribute('data-wae-event')) {
        result.waeEvent    = node.getAttribute('data-wae-event');
        for (const attr of node.attributes) {
          if (attr.name.startsWith('data-wae-') && attr.name !== 'data-wae-event') {
            const key = attr.name.replace('data-wae-','').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
            result.waeAttrs[key] = attr.value;
          }
        }
        break;
      }
      node = node.parentElement;
    }

    return result;
  }

  function px(n) { return Math.round(n) + 'px'; }

  // ── Generate shortest unique CSS selector ────────────────────────────────
  function generateCssSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return '#' + el.id;
    const testAttrs = getTestAttrs();
    for (const attr of testAttrs) {
      if (el.hasAttribute(attr)) {
        const v = el.getAttribute(attr);
        return el.tagName.toLowerCase() + '[' + attr + '="' + v.replace(/"/g, '\\"') + '"]';
      }
    }
    // Semantic attrs stable enough for test automation
    const tag = el.tagName.toLowerCase();
    const nameAttr = el.getAttribute('name');
    if (nameAttr) return tag + '[name="' + nameAttr.replace(/"/g, '\\"') + '"]';
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return tag + '[aria-label="' + ariaLabel.replace(/"/g, '\\"') + '"]';
    const phAttr = el.getAttribute('placeholder');
    if (phAttr) return tag + '[placeholder="' + phAttr.replace(/"/g, '\\"') + '"]';
    function seg(node) {
      const t = node.tagName.toLowerCase();
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) return '#' + node.id;
      const cls = Array.from(node.classList).find(c => /^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/.test(c) && !/^\d+$/.test(c));
      if (cls) {
        const p = node.parentElement;
        if (p && p.querySelectorAll(t + '.' + cls).length === 1) return t + '.' + cls;
      }
      const p = node.parentElement;
      if (p) {
        const sibs = Array.from(p.children).filter(c => c.tagName === node.tagName);
        if (sibs.length === 1) return t;
        return t + ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      return t;
    }
    const parts = []; let node = el;
    while (node && node !== document.documentElement && parts.length < 6) {
      parts.unshift(seg(node));
      const cand = parts.join(' > ');
      try { if (document.querySelectorAll(cand).length === 1) return cand; } catch(_) {}
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function generateXPath(el) {
    if (!el || el === document.body) return '//body';
    const TEST_ATTRS = ['data-testid','data-qa','data-test','data-cy','data-automation-id','data-test-id','data-pw'];
    function esc(v) { return v.replace(/"/g, '&quot;'); }

    // 1. id on element
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return '//*[@id="' + el.id + '"]';

    // 2. Test automation attribute on element
    for (const attr of TEST_ATTRS) {
      if (el.hasAttribute(attr)) return '//*[@' + attr + '="' + esc(el.getAttribute(attr)) + '"]';
    }

    const tag = el.tagName.toLowerCase();

    // 3. name attr (form elements)
    const nameAttr = el.getAttribute('name');
    if (nameAttr) return '//' + tag + '[@name="' + esc(nameAttr) + '"]';

    // 4. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return '//' + tag + '[@aria-label="' + esc(ariaLabel) + '"]';

    // 5. placeholder
    const phAttr = el.getAttribute('placeholder');
    if (phAttr) return '//' + tag + '[@placeholder="' + esc(phAttr) + '"]';

    // 6. Short visible text for interactive/structural elements
    if (['button','a','label','th','h1','h2','h3','h4','h5','h6'].includes(tag)) {
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (txt && txt.length <= 40 && !txt.includes('"')) {
        return '//' + tag + '[normalize-space()="' + txt + '"]';
      }
    }

    // 7. type+value for submit/button/reset inputs
    if (tag === 'input') {
      const type = el.getAttribute('type');
      const val  = el.getAttribute('value');
      if ((type === 'submit' || type === 'button' || type === 'reset') && val) {
        return '//input[@type="' + type + '" and @value="' + esc(val) + '"]';
      }
    }

    // 8. Walk up — anchor to nearest ancestor with id or test-attr, build short path down
    function seg(node) {
      const t = node.tagName.toLowerCase();
      const p = node.parentElement;
      if (!p) return t;
      const sibs = Array.from(p.children).filter(c => c.tagName === node.tagName);
      return sibs.length > 1 ? t + '[' + (sibs.indexOf(node) + 1) + ']' : t;
    }
    const parts = []; let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node !== el) {
        if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
          return '//*[@id="' + node.id + '"]/' + parts.join('/');
        }
        for (const attr of TEST_ATTRS) {
          if (node.hasAttribute(attr)) {
            return '//*[@' + attr + '="' + esc(node.getAttribute(attr)) + '"]/' + parts.join('/');
          }
        }
      }
      parts.unshift(seg(node));
      node = node.parentElement;
    }
    return '//' + parts.join('/');
  }

  function row(key, val, keyColor, valColor, bold) {
    return (
      '<div style="display:flex;align-items:flex-start;gap:5px;min-width:0;padding:1px 2px;">' +
        '<span style="color:' + keyColor + ';font-weight:' + (bold?'700':'500') + ';font-size:11px;flex-shrink:0;min-width:76px;">' + key + '</span>' +
        '<span style="color:rgba(255,255,255,.25);font-size:11px;flex-shrink:0;">=</span>' +
        '<span style="color:' + valColor + ';font-size:11px;word-break:break-word;flex:1;">' + val + '</span>' +
      '</div>'
    );
  }

  // Copyable row — uses data-copy attribute + event delegation (no inline onclick)
  // A small ⎘ copy button appears on the right, and hovering the row shows a tooltip
  function copyRow(key, val, keyColor, valColor) {
    // Escape val for display and for data attribute
    const displayVal = String(val).replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const dataVal    = String(val).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    return (
      '<div class="__q-copy-row" data-copy="' + dataVal + '" ' +
          'style="display:flex;align-items:flex-start;gap:5px;min-width:0;padding:2px 2px;' +
          'border-radius:3px;cursor:default;position:relative" ' +
          'title="Click ⎘ to copy">' +
        '<span style="color:' + keyColor + ';font-weight:500;font-size:11px;flex-shrink:0;min-width:76px;">' + key + '</span>' +
        '<span style="color:rgba(255,255,255,.25);font-size:11px;flex-shrink:0;">=</span>' +
        '<span style="color:' + valColor + ';font-size:11px;word-break:break-word;flex:1;">' + displayVal + '</span>' +
        '<button class="__q-copy-btn" data-copy="' + dataVal + '" ' +
          'style="flex-shrink:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);' +
          'border-radius:3px;color:rgba(255,255,255,.5);font-size:9px;padding:0 5px;cursor:pointer;' +
          'line-height:14px;height:16px;margin-left:2px;transition:all .12s" ' +
          'title="Copy ' + key + ' to clipboard">⎘</button>' +
      '</div>'
    );
  }

  // Wire copy buttons via event delegation on the badge (safe — no inline JS)
  function wireCopyButtons() {
    // Idempotent: attach the delegated listener once — badge is a persistent
    // node whose innerHTML is rewritten, but the listener on badge survives.
    if (badge.__qWired) return;
    badge.__qWired = true;
    badge.addEventListener('click', function(e) {
      // Pin label — replaces the old inline onclick= handler (which was dropped
      // on strict-CSP sites). Event delegation here always works.
      const pinBtn = e.target.closest('#__q-pin-label');
      if (pinBtn) {
        e.stopPropagation();
        window.__qInspectorPinned = !window.__qInspectorPinned;
        // Remember the current element so keyboard/arrow navigation can walk from it
        if (window.__qInspectorPinned) {
          window.__qPinnedEl = lastTarget || null;
        }
        pinBtn.textContent = window.__qInspectorPinned ? '📌 Pinned' : '📌 Pin';
        pinBtn.style.color = window.__qInspectorPinned ? '#f9c74f' : 'rgba(255,255,255,.5)';
        pinBtn.style.borderColor = window.__qInspectorPinned ? '#f9c74f' : 'rgba(255,255,255,.15)';
        return;
      }
      const btn = e.target.closest('.__q-copy-btn');
      if (!btn) return;
      e.stopPropagation(); // Don't trigger pin toggle
      const val = btn.dataset.copy || '';
      // Use a textarea fallback since clipboard API may be blocked in some contexts
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(val).then(() => flashCopied(btn)).catch(() => fallbackCopy(val, btn));
        } else {
          fallbackCopy(val, btn);
        }
      } catch(_) { fallbackCopy(val, btn); }
    }, { capture: false });
  }

  function fallbackCopy(val, btn) {
    const ta = document.createElement('textarea');
    ta.value = val;
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, 99999);
    try { document.execCommand('copy'); flashCopied(btn); } catch(_) {}
    document.body.removeChild(ta);
  }

  function flashCopied(btn) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = '✓';
    btn.style.background = 'rgba(0,229,160,.35)';
    btn.style.color = '#00e5a0';
    btn.style.borderColor = '#00e5a0';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = 'rgba(255,255,255,.08)';
      btn.style.color = 'rgba(255,255,255,.5)';
      btn.style.borderColor = 'rgba(255,255,255,.18)';
    }, 1200);
  }

  function renderInspectBadge(attrs) {
    // Always render — even if no test locator found (show element info + suggestions)
    const tl  = attrs.testLocator;
    const el  = attrs.highlightEl || attrs.testLocator?.el;
    const tag = attrs.tag;

    // Header: tag + id + first class — clean row, breadcrumb goes below
    const ctx = (attrs.id ? ' #' + attrs.id : '') + (attrs.classes.length ? ' .' + attrs.classes[0] : '');

    // Build breadcrumb trail from current element up to body
    let crumbsHtml = '';
    if (el) {
      const chain = [];
      let cur = el;
      let hops = 0;
      while (cur && cur !== document.documentElement && hops < 12) {
        const tagN = cur.tagName ? cur.tagName.toLowerCase() : '';
        if (!tagN) break;
        let label = tagN;
        if (cur.id) label += '#' + cur.id;
        else if (cur.className && typeof cur.className === 'string') {
          const firstCls = cur.className.trim().split(/\s+/)[0];
          if (firstCls) label += '.' + firstCls.slice(0, 18);
        }
        chain.unshift({ el: cur, label });
        cur = cur.parentElement;
        hops++;
      }
      crumbsHtml = '<div class="__q-crumbs" style="padding:5px 11px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.05);overflow-x:auto;white-space:nowrap;font-size:11.5px;line-height:1.3;scrollbar-width:thin">';
      chain.forEach((crumb, i) => {
        const isLast = i === chain.length - 1;
        if (i > 0) crumbsHtml += '<span style="color:rgba(255,255,255,.25);margin:0 3px">›</span>';
        if (isLast) {
          crumbsHtml += '<span style="color:rgba(0,229,160,.95);font-weight:500;background:rgba(0,229,160,.1);padding:1px 4px;border-radius:3px">' + crumb.label + '</span>';
        } else {
          crumbsHtml += '<span class="__q-crumb-link" data-crumb-idx="' + i + '" style="color:rgba(255,255,255,.55);cursor:pointer;text-decoration:none" title="Click to select this ancestor">' + crumb.label + '</span>';
        }
      });
      crumbsHtml += '</div>';
      // Stash chain on badge so click handlers can look it up
      badge.__qCrumbChain = chain;
    }

    let html =
      '<div style="background:rgba(0,229,160,.12);border-bottom:1px solid rgba(0,229,160,.2);padding:6px 11px;display:flex;align-items:center;justify-content:space-between;gap:6px">' +
        '<span style="font-size:12px;color:rgba(0,229,160,.95);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-weight:600">&lt;' + tag + ctx + '&gt;</span>' +
        '<span id="__q-pin-label" style="font-size:10.5px;color:rgba(255,255,255,.5);cursor:pointer;padding:2px 7px;border-radius:3px;border:1px solid rgba(255,255,255,.15);flex-shrink:0" ' +
          'title="Click to pin / unpin (P)">📌 Pin</span>' +
      '</div>' +
      crumbsHtml +
      '<div style="padding:8px 11px;display:flex;flex-direction:column;gap:4px;">';

    // ── Element identity rows (only non-empty) ────────────────────────────
    html += row('TAG', tag, 'rgba(255,255,255,.5)', '#c0c8d8', false);
    if (attrs.id) html += copyRow('ID', attrs.id, 'rgba(255,255,255,.5)', '#93c5fd');
    if (attrs.classes.length) html += copyRow('CLASS', attrs.classes.join(' '), 'rgba(255,255,255,.5)', '#c084fc');
    if (el) {
      const name = el.getAttribute?.('name');
      const type = el.getAttribute?.('type');
      const href = el.getAttribute?.('href');
      const src  = el.getAttribute?.('src');
      const alt  = el.getAttribute?.('alt');
      const role = el.getAttribute?.('role');
      const aria = el.getAttribute?.('aria-label');
      if (name) html += copyRow('NAME', name, 'rgba(255,255,255,.5)', '#86efac');
      if (type) html += copyRow('TYPE', type, 'rgba(255,255,255,.5)', '#86efac');
      if (href) html += copyRow('HREF', href.length > 60 ? href.slice(0,60)+'…' : href, 'rgba(255,255,255,.5)', '#7dd3fc');
      if (src)  html += copyRow('SRC', src.length > 60 ? src.slice(0,60)+'…' : src, 'rgba(255,255,255,.5)', '#7dd3fc');
      if (alt)  html += copyRow('ALT', alt, 'rgba(255,255,255,.5)', '#fde68a');
      if (role) html += copyRow('ROLE', role, 'rgba(255,255,255,.5)', '#fde68a');
      if (aria) html += copyRow('ARIA', aria, 'rgba(255,255,255,.5)', '#fde68a');
    }

    // ── Test locator ──────────────────────────────────────────────────────
    html += '<div style="border-top:1px solid rgba(255,255,255,.07);margin:4px 0 1px;padding-top:5px;">';
    if (tl && !tl.isSuggested) {
      // FIX 2b: use copyRow instead of row so testid values are copyable
      html += copyRow(tl.attr, '"' + tl.value + '"', '#00e5a0', '#fff');
      if (attrs.locatorInherited && attrs.locatorInheritedTag) {
        html += '<div style="font-size:10px;color:rgba(255,255,255,.5);margin:1px 0 0 2px">↑ inherited from &lt;' + attrs.locatorInheritedTag + '&gt;</div>';
      }
    } else if (tl && tl.isSuggested) {
      html += '<div style="font-size:10.5px;color:#ff9f43;margin-bottom:3px">⚠ No test attr — best available:</div>';
      html += copyRow(tl.attr, '"' + tl.value + '"', '#ff9f43', '#ffe0a0');
    } else {
      html += '<div style="font-size:10.5px;color:rgba(255,100,100,.85);margin-bottom:3px">⚠ No test locator found</div>';
    }
    html += '</div>';

    // ── CSS Selector + XPath (always shown) ───────────────────────────────
    if (el) {
      const css   = generateCssSelector(el);
      const xpath = generateXPath(el);
      html += '<div style="border-top:1px solid rgba(255,255,255,.07);margin:4px 0 1px;padding-top:5px;">';
      html += copyRow('CSS', css, 'rgba(255,255,255,.4)', '#a5f3c0');
      html += copyRow('XPath', xpath, 'rgba(255,255,255,.4)', '#fde68a');
      html += '</div>';
    }

    // ── WAE event ─────────────────────────────────────────────────────────
    if (attrs.waeEvent) {
      html += '<div style="border-top:1px solid rgba(255,255,255,.07);margin:4px 0 1px;padding-top:5px;">';
      html += copyRow('data-wae-event', attrs.waeEvent, '#ff6ec7', '#fff');
      const entries = Object.entries(attrs.waeAttrs);
      if (entries.length) {
        entries.forEach(([k,v]) => { html += copyRow('wae.' + k, v, '#9d8aff', '#d0d0e8'); });
      }
      html += '</div>';
    }

    html += '<div style="font-size:9.5px;color:rgba(255,255,255,.35);margin-top:4px;text-align:right;padding:0 2px">⎘ copy · 📌 pin · ⌥ click = drill in · click crumb above</div>';
    html += '</div>';
    badge.innerHTML = html;
    // Wire copy buttons via event delegation (must happen after innerHTML set)
    wireCopyButtons();
    // Wire breadcrumb clicks (Fix 7 — replaces arrow buttons)
    wireCrumbClicks();
    // Restore pin state if already pinned
    if (window.__qInspectorPinned) {
      const pl = badge.querySelector('#__q-pin-label');
      if (pl) { pl.textContent = '📌 Pinned'; pl.style.color = '#f9c74f'; pl.style.borderColor = '#f9c74f'; }
      applyPinStyles();
    }
    return true;
  }

  // Fix 7: DOM tree navigation via the breadcrumb trail. Click any crumb in
  // the header strip to jump to that ancestor. Alt+click on the page drills
  // down past the snap-to-interactive-ancestor logic (see onClick below).
  function navigateTo(newEl) {
    if (!newEl || !newEl.tagName) return;
    if (newEl.id && newEl.id.startsWith('__q-')) return; // don't walk into our overlays
    // Pin so the popup doesn't jump away when we move off the original hover
    window.__qInspectorPinned = true;
    window.__qPinnedEl = newEl;
    const cursorX = 0, cursorY = 0;
    const attrs   = findAttrs(newEl, cursorX, cursorY);
    positionOverlay(newEl);
    positionBadge(newEl);
    renderInspectBadge(attrs);
    applyPinStyles();
  }

  function getCurrentElement() {
    return window.__qPinnedEl || null;
  }

  function wireCrumbClicks() {
    if (!badge.__qCrumbChain) return;
    const chain = badge.__qCrumbChain;
    badge.querySelectorAll('.__q-crumb-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const idx = parseInt(link.dataset.crumbIdx, 10);
        if (isNaN(idx) || !chain[idx]) return;
        navigateTo(chain[idx].el);
      });
      // Hover preview — briefly highlight the ancestor in page
      link.addEventListener('mouseenter', () => {
        const idx = parseInt(link.dataset.crumbIdx, 10);
        if (isNaN(idx) || !chain[idx]) return;
        positionOverlay(chain[idx].el);
      });
      link.addEventListener('mouseleave', () => {
        // Restore overlay to currently-selected element
        const cur = getCurrentElement();
        if (cur) positionOverlay(cur);
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPACING MODE HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  function getSpacing(el) {
    const cs  = window.getComputedStyle(el);
    const r   = el.getBoundingClientRect();

    // ── Colour helpers ──────────────────────────────────────────────────────
    function toHex(rgb) {
      if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return rgb;
      return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('').toUpperCase();
    }

    // ── Font family — strip fallbacks, show primary ─────────────────────────
    const rawFont = cs.fontFamily || '';
    const primaryFont = rawFont.split(',')[0].trim().replace(/['"]/g, '');

    // ── Gap to next sibling ──────────────────────────────────────────────────
    let gapToNext = null;
    const next = el.nextElementSibling;
    if (next) {
      const nr = next.getBoundingClientRect();
      const vGap = Math.round(nr.top - r.bottom);
      const hGap = Math.round(nr.left - r.right);
      if (Math.abs(vGap) < 400 && r.bottom <= nr.top + 2)      gapToNext = { axis: 'V', px: vGap, sibRect: nr };
      else if (Math.abs(hGap) < 400 && r.right <= nr.left + 2) gapToNext = { axis: 'H', px: hGap, sibRect: nr };
    }
    // ── Gap to previous sibling ──────────────────────────────────────────────
    let gapToPrev = null;
    const prev = el.previousElementSibling;
    if (prev) {
      const pr = prev.getBoundingClientRect();
      const vGap2 = Math.round(r.top - pr.bottom);
      const hGap2 = Math.round(r.left - pr.right);
      if (Math.abs(vGap2) < 400 && pr.bottom <= r.top + 2)     gapToPrev = { axis: 'V', px: vGap2, sibRect: pr };
      else if (Math.abs(hGap2) < 400 && pr.right <= r.left + 2) gapToPrev = { axis: 'H', px: hGap2, sibRect: pr };
    }

    return {
      rect:       r,
      w:          Math.round(r.width),
      h:          Math.round(r.height),
      pt:         Math.round(parseFloat(cs.paddingTop)),
      pb:         Math.round(parseFloat(cs.paddingBottom)),
      pl:         Math.round(parseFloat(cs.paddingLeft)),
      pr:         Math.round(parseFloat(cs.paddingRight)),
      mt:         Math.round(parseFloat(cs.marginTop)),
      mb:         Math.round(parseFloat(cs.marginBottom)),
      ml:         Math.round(parseFloat(cs.marginLeft)),
      mr:         Math.round(parseFloat(cs.marginRight)),
      bt:         Math.round(parseFloat(cs.borderTopWidth)),
      br:         Math.round(parseFloat(cs.borderRightWidth)),
      bb:         Math.round(parseFloat(cs.borderBottomWidth)),
      bl:         Math.round(parseFloat(cs.borderLeftWidth)),
      display:    cs.display,
      tag:        el.tagName?.toLowerCase(),
      testId:     (() => {
        const attrs = getTestAttrs ? getTestAttrs() : ['data-testid'];
        for (const a of attrs) { const v = el.getAttribute(a); if (v) return a + '="' + v + '"'; }
        return null;
      })(),
      // New in v3.9.2
      color:       toHex(cs.color),
      bgColor:     toHex(cs.backgroundColor),
      borderColor: toHex(cs.borderColor),
      fontSize:    cs.fontSize,
      fontWeight:  cs.fontWeight,
      fontFamily:  primaryFont,
      lineHeight:  cs.lineHeight,
      gapToNext,
      gapToPrev,
    };
  }

  // ── Gap-box helpers (visual inter-element spacing lines) ─────────────────
  function makeGapBox(id) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      Object.assign(el.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '2147483643',
        boxSizing: 'border-box', display: 'none',
      });
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function positionGapBox(boxId, labelId, gap, elRect) {
    const box = makeGapBox(boxId);
    if (!gap || gap.px <= 0) {
      box.style.display = 'none';
      const lbl = document.getElementById(labelId);
      if (lbl) lbl.style.display = 'none';
      return;
    }
    const sr = gap.sibRect;
    const er = elRect;
    let top, left, width, height;
    if (gap.axis === 'V') {
      const upper = er.bottom <= sr.top ? er : sr;
      const lower = er.bottom <= sr.top ? sr : er;
      top = upper.bottom;
      height = lower.top - upper.bottom;
      const xL = Math.max(er.left, sr.left);
      const xR = Math.min(er.right, sr.right);
      if (xR > xL) { left = xL; width = xR - xL; }
      else { left = Math.min(er.left, sr.left); width = Math.max(er.right, sr.right) - left; }
    } else {
      const lft = er.right <= sr.left ? er : sr;
      const rgt = er.right <= sr.left ? sr : er;
      left  = lft.right;
      width = rgt.left - lft.right;
      const yT = Math.max(er.top, sr.top);
      const yB = Math.min(er.bottom, sr.bottom);
      if (yB > yT) { top = yT; height = yB - yT; }
      else { top = Math.min(er.top, sr.top); height = Math.max(er.bottom, sr.bottom) - top; }
    }
    if (width < 1 || height < 1) { box.style.display = 'none'; return; }
    const lc = 'rgba(230,60,60,0.85)';
    const bg = gap.axis === 'V'
      ? `linear-gradient(to bottom,${lc},${lc}) center/1px 100% no-repeat,` +
        `linear-gradient(to right,${lc},${lc}) 0 0/100% 1px no-repeat,` +
        `linear-gradient(to right,${lc},${lc}) 0 100%/100% 1px no-repeat`
      : `linear-gradient(to right,${lc},${lc}) 0 center/100% 1px no-repeat,` +
        `linear-gradient(to bottom,${lc},${lc}) 0 0/1px 100% no-repeat,` +
        `linear-gradient(to bottom,${lc},${lc}) 100% 0/1px 100% no-repeat`;
    Object.assign(box.style, {
      top: top + 'px', left: left + 'px',
      width: width + 'px', height: height + 'px',
      display: 'block', background: bg, border: 'none',
    });
    // Nudge gap labels off the dead-centre line so they don't land exactly on
    // pcy (for H gaps) or pcx (for V gaps) — the same axis where the padding
    // labels are also placed.  A small offset of ~12 px (capped at 25% of the
    // gap dimension) is enough to visually separate them.
    const gLabelCx = gap.axis === 'V'
      ? left + width / 2 + Math.min(12, width  * 0.25)   // shift right of pcx
      : left + width / 2;
    const gLabelCy = gap.axis === 'H'
      ? top  + height / 2 - Math.min(12, height * 0.25)  // shift above pcy
      : top  + height / 2;
    posLabel(labelId, gap.px + 'px', gLabelCx, gLabelCy, 'rgba(220,50,50,0.92)', '#fff', 'center');
    // Give gap labels a white border so they punch through the red indicator line.
    // If the gap is very thin, nudge the label just outside the gap box.
    const lbl = document.getElementById(labelId);
    if (lbl) {
      lbl.style.outline = '1.5px solid rgba(180,0,0,0.7)';
      const lblH = lbl.offsetHeight;
      const lblW = lbl.offsetWidth;
      if (gap.axis === 'V' && height < lblH + 4) {
        // Push label above the gap box
        lbl.style.top = Math.max(4, top - lblH - 3) + 'px';
      } else if (gap.axis === 'H' && width < lblW + 4) {
        // Push label to the right of the gap box
        const newLeft = Math.min(left + width + 3, window.innerWidth - lblW - 4);
        lbl.style.left = Math.max(4, newLeft) + 'px';
      }
    }
  }

  function positionSpacing(el) {
    const s = getSpacing(el);
    const r = s.rect;

    // Content box = element bounding rect
    Object.assign(contentBox.style, {
      top: r.top+'px', left: r.left+'px',
      width: r.width+'px', height: r.height+'px',
      display: 'block',
    });

    // Padding box = shrink by borders
    Object.assign(paddingBox.style, {
      top:    (r.top  + s.bt) + 'px',
      left:   (r.left + s.bl) + 'px',
      width:  (r.width  - s.bl - s.br) + 'px',
      height: (r.height - s.bt - s.bb) + 'px',
      display: (s.pt||s.pb||s.pl||s.pr) ? 'block' : 'none',
    });

    // Margin box = expand outwards
    Object.assign(marginBox.style, {
      top:    (r.top  - s.mt) + 'px',
      left:   (r.left - s.ml) + 'px',
      width:  (r.width  + s.ml + s.mr) + 'px',
      height: (r.height + s.mt + s.mb) + 'px',
      display: (s.mt||s.mb||s.ml||s.mr) ? 'block' : 'none',
    });

    // Dimension labels
    // Width label — above element; pushed further up when top padding label would overlap
    const wLabelY = s.pt ? r.top - 26 : r.top - 18;
    posLabel('__q-dim-w', s.w+'px',
      r.left + r.width/2, wLabelY,
      'rgba(0,229,160,0.95)', '#000', 'center');

    // Padding labels (only if non-zero)
    // Place each label at 1/3 or 1/4 from the respective edge (not at the centroid)
    // so top/bottom labels don't collide when the element is short, and
    // left/right labels don't collide with the W label or with each other.
    const pcx = r.left + r.width / 2;  // horizontal centre
    const pcy = r.top  + r.height / 2; // vertical centre
    // Top padding: 1/3 from top edge (inside content area), never overlapping W label
    if (s.pt) {
      const ptY = r.top + Math.min(Math.max(s.pt / 2, 8), r.height * 0.35);
      posLabel('__q-dim-pt', s.pt+'px', pcx, ptY, 'rgba(130,100,255,0.95)', '#fff', 'center');
    }
    // Bottom padding: 1/3 from bottom edge
    if (s.pb) {
      const pbY = r.bottom - Math.min(Math.max(s.pb / 2, 8), r.height * 0.35);
      posLabel('__q-dim-pb', s.pb+'px', pcx, pbY, 'rgba(130,100,255,0.95)', '#fff', 'center');
    }
    // Left padding: 1/3 from left, biased toward top quarter so it misses W+H labels
    if (s.pl) {
      const plX = r.left + Math.min(Math.max(s.pl / 2, 8), r.width * 0.3);
      posLabel('__q-dim-pl', s.pl+'px', plX, pcy, 'rgba(130,100,255,0.95)', '#fff', 'center');
    }
    // Right padding: 1/3 from right
    if (s.pr) {
      const prX = r.right - Math.min(Math.max(s.pr / 2, 8), r.width * 0.3);
      posLabel('__q-dim-pr', s.pr+'px', prX, pcy, 'rgba(130,100,255,0.95)', '#fff', 'center');
    }

    // Gap boxes — show spacing between this element and its adjacent siblings
    positionGapBox('__q-gap-prev', '__q-gap-prev-lbl', s.gapToPrev, r);
    positionGapBox('__q-gap-next', '__q-gap-next-lbl', s.gapToNext, r);

    // Build panel first so we know which side it lands on
    const panelLeft = renderSpacingPanel(s, r);

    // Height label — placed on the side opposite the panel to avoid overlap.
    // Prefer right; fall back to left when panel is on the right.
    const hLabelCy = r.top + r.height / 2;
    if (panelLeft > r.right) {
      // Panel is on the right — put H label on the left
      posLabel('__q-dim-h', s.h+'px',
        r.left - 6, hLabelCy,
        'rgba(0,229,160,0.95)', '#000', 'right');
    } else {
      // Panel is on the left (or centred fallback) — put H label on the right
      posLabel('__q-dim-h', s.h+'px',
        r.right + 6, hLabelCy,
        'rgba(0,229,160,0.95)', '#000', 'left');
    }
  }

  function posLabel(id, text, cx, cy, bg, fg, align) {
    const el = makeDimLabel(id, text, bg, fg);
    el.style.display = 'block';
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left;
    if (align === 'center') left = cx - w / 2;
    else if (align === 'right') left = cx - w - 2; // cx is the right edge
    else left = cx;
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
    el.style.left = left + 'px';
    el.style.top  = Math.max(4, cy - h/2) + 'px';
  }

  function renderSpacingPanel(s, r) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Colour swatch helper
    function swatch(hex) {
      if (!hex) return '';
      return '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;' +
        'background:' + hex + ';border:1px solid rgba(255,255,255,.3);margin-right:4px;' +
        'vertical-align:middle;flex-shrink:0"></span>';
    }

    function colorRow(label, hex, color) {
      if (!hex) return '';
      return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:11px;align-items:center;">' +
        '<span style="color:rgba(255,255,255,.45)">' + label + '</span>' +
        '<span style="color:' + color + ';font-weight:700;display:flex;align-items:center">' +
          swatch(hex) + hex +
        '</span>' +
      '</div>';
    }

    spacingPanel.innerHTML =
      // Header
      '<div style="background:rgba(130,100,255,.2);border-bottom:1px solid rgba(130,100,255,.3);padding:5px 10px;font-size:11px;color:rgba(130,100,255,1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
        '&lt;' + s.tag + (s.testId ? ' ' + s.testId : '') + '&gt;' +
      '</div>' +
      '<div style="padding:8px 10px;display:flex;flex-direction:column;gap:4px;">' +
        // Size
        sRow('W × H', s.w + ' × ' + s.h + ' px', '#00e5a0') +
        // Gaps between adjacent siblings
        (s.gapToPrev !== null || s.gapToNext !== null
          ? '<div style="border-top:1px solid rgba(255,255,255,.07);margin:3px 0 1px;padding-top:4px;">' +
            (s.gapToPrev !== null ? sRow((s.gapToPrev.axis === 'V' ? '↑' : '←') + ' Gap to prev', s.gapToPrev.px + ' px', '#ff6b6b') : '') +
            (s.gapToNext !== null ? sRow((s.gapToNext.axis === 'V' ? '↓' : '→') + ' Gap to next', s.gapToNext.px + ' px', '#ff6b6b') : '') +
            '</div>'
          : '') +
        // Padding
        (s.pt||s.pb||s.pl||s.pr
          ? '<div style="border-top:1px solid rgba(255,255,255,.07);margin:3px 0 1px;padding-top:4px;">' +
            sRow('Padding T/B', s.pt + ' / ' + s.pb + ' px', '#9d8aff') +
            sRow('Padding L/R', s.pl + ' / ' + s.pr + ' px', '#9d8aff') +
          '</div>' : '') +
        // Margin
        (s.mt||s.mb||s.ml||s.mr
          ? '<div style="border-top:1px solid rgba(255,255,255,.07);margin:3px 0 1px;padding-top:4px;">' +
            sRow('Margin T/B', s.mt + ' / ' + s.mb + ' px', '#ff9f43') +
            sRow('Margin L/R', s.ml + ' / ' + s.mr + ' px', '#ff9f43') +
          '</div>' : '') +
        // Border
        (s.bt||s.br||s.bb||s.bl
          ? '<div style="border-top:1px solid rgba(255,255,255,.07);margin:3px 0 1px;padding-top:4px;">' +
            sRow('Border T/B', s.bt + ' / ' + s.bb + ' px', '#7ec8e3') +
            sRow('Border L/R', s.bl + ' / ' + s.br + ' px', '#7ec8e3') +
          '</div>' : '') +
        // Colours
        (s.color || s.bgColor || s.borderColor
          ? '<div style="border-top:1px solid rgba(255,255,255,.07);margin:3px 0 1px;padding-top:4px;">' +
            colorRow('Text colour', s.color, '#e8e8f0') +
            colorRow('Background', s.bgColor, '#e8e8f0') +
            colorRow('Border colour', s.borderColor, '#e8e8f0') +
          '</div>' : '') +
        // Typography
        (s.fontFamily
          ? '<div style="border-top:1px solid rgba(255,255,255,.07);margin:3px 0 1px;padding-top:4px;">' +
            sRow('Font', s.fontFamily, '#f9c74f') +
            sRow('Size / Weight', s.fontSize + ' / ' + s.fontWeight, '#f9c74f') +
            (s.lineHeight && s.lineHeight !== 'normal' ? sRow('Line height', s.lineHeight, '#f9c74f') : '') +
          '</div>' : '') +
      '</div>';

    spacingPanel.style.display = 'block';
    spacingPanel.style.left = '0px'; spacingPanel.style.top = '0px';

    const pw = spacingPanel.offsetWidth;
    const ph = spacingPanel.offsetHeight;

    // Position panel: prefer right side, then left, with increased gap from element
    let left = r.right + 20;
    let top  = r.top;
    if (left + pw > vw - 8) left = r.left - pw - 20;
    if (left < 8) left = 8;
    if (top + ph > vh - 8) top = vh - ph - 8;
    if (top < 8) top = 8;

    spacingPanel.style.left = left + 'px';
    spacingPanel.style.top  = top + 'px';
    return left; // caller uses this to decide H label side
  }

  function sRow(key, val, color) {
    return (
      '<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;">' +
        '<span style="color:rgba(255,255,255,.45);">' + key + '</span>' +
        '<span style="color:' + color + ';font-weight:700;">' + val + '</span>' +
      '</div>'
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARED: overlay position
  // ══════════════════════════════════════════════════════════════════════════
  function positionOverlay(el) {
    const r = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      top: r.top+'px', left: r.left+'px',
      width: r.width+'px', height: r.height+'px',
      display: 'block',
    });
  }

  function positionBadge(el) {
    const r  = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    badge.style.display = 'block';
    badge.style.left = '0px'; badge.style.top = '0px';
    const bw = badge.offsetWidth;
    const bh = badge.offsetHeight;
    let left = r.left;
    if (left + bw > vw - 8) left = vw - bw - 8;
    if (left < 8) left = 8;
    let top = r.bottom + 10;
    if (top + bh > vh - 8) top = r.top - bh - 10;
    if (top < 8) top = 8;
    badge.style.left = left + 'px';
    badge.style.top  = top  + 'px';
  }

  // Badge anchored near the mouse cursor — used when highlightEl is a large
  // ancestor block so the badge stays close to where the user is pointing.
  function positionBadgeNearCursor(cx, cy, highlightEl) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    badge.style.display = 'block';
    badge.style.left = '0px'; badge.style.top = '0px';
    const bw = badge.offsetWidth;
    const bh = badge.offsetHeight;

    // Prefer to show badge just below and to the right of cursor
    let left = cx + 12;
    let top  = cy + 18;

    // Clamp so it doesn't fall off screen
    if (left + bw > vw - 8) left = cx - bw - 12;
    if (left < 8) left = 8;
    if (top + bh > vh - 8) top = cy - bh - 10;
    if (top < 8) top = 8;

    badge.style.left = left + 'px';
    badge.style.top  = top  + 'px';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN MOUSE HANDLER
  // ══════════════════════════════════════════════════════════════════════════
  let lastTarget = null;
  let rafId      = null;

  function onMouseMove(e) {
    if (!window.__qInspectorActive) return;
    // If pinned, badge is frozen — don't update on mouse move
    if (window.__qInspectorPinned) return;
    const el = e.target;
    if (el === overlay || el === badge || el === spacingPanel ||
        el === marginBox || el === paddingBox || el === contentBox ||
        (el.id && el.id.startsWith('__q-'))) return;
    if (el === lastTarget) return;
    lastTarget = el;

    // Capture coordinates at event time — RAF fires asynchronously so
    // e.clientX/Y may be stale by then
    const cx = e.clientX;
    const cy = e.clientY;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      window.__qInspectorRafId = null;
      // Re-check active flag — Esc may have fired between mousemove and rAF callback,
      // which would otherwise leave the green overlay visible after deactivation.
      if (!window.__qInspectorActive) { hideAll(); return; }
      hideAll();

      if (window.__qInspectorMode === 'spacing') {
        positionOverlay(el);
        positionSpacing(el);
      } else {
        try {
          const attrs = findAttrs(el, cx, cy);
          // Always render badge — even with no test locator (shows element info + CSS/XPath)
          renderInspectBadge(attrs);
          positionOverlay(attrs.highlightEl);
          positionBadgeNearCursor(cx, cy, attrs.highlightEl);
        } catch(err) {
          hideAll();
          lastTarget = null;
        }
      }
    });
    window.__qInspectorRafId = rafId;
  }

  function onScroll() {
    if (!window.__qInspectorActive || !lastTarget) return;
    hideAll();
    if (window.__qInspectorMode === 'spacing') {
      positionOverlay(lastTarget);
      positionSpacing(lastTarget);
    } else {
      try {
        const attrs = findAttrs(lastTarget);  // scroll: use element centre (no cursor coords)
        if ((attrs.testLocator || attrs.waeEvent) && attrs.highlightEl) {
          positionOverlay(attrs.highlightEl);
          positionBadge(attrs.highlightEl);
        }
      } catch(err) {
        hideAll();
        lastTarget = null;
      }
    }
  }

  // Helper to apply/remove pointer events based on pin state
  function applyPinStyles() {
    if (window.__qInspectorPinned) {
      badge.style.pointerEvents = 'auto';
      badge.style.userSelect    = 'text';
      badge.style.cursor        = 'default';
      badge.style.border        = '1.5px solid #f9c74f'; // gold border when pinned
    } else {
      badge.style.pointerEvents = 'none';
      badge.style.userSelect    = 'none';
      badge.style.cursor        = '';
      badge.style.border        = '1.5px solid rgba(0,229,160,0.6)';
    }
  }

  // Click on page pins/unpins the badge.
  // Fix 20: Alt+click also works in spacing mode for drill-down.
  document.addEventListener('click', (e) => {
    if (!window.__qInspectorActive) return;
    if (e.target === badge || badge.contains(e.target)) return; // handled inline

    // Alt (Option on Mac) + click → drill down. Works in BOTH inspect AND spacing modes.
    // Picks the literal element under the cursor, bypassing snap-to-ancestor.
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target;
      if (!target || (target.id && target.id.startsWith('__q-'))) return;
      navigateTo(target);
      return;
    }

    // Spacing mode normal click: pin/unpin to keep the spacing overlay locked
    if (window.__qInspectorMode === 'spacing') {
      window.__qInspectorPinned = !window.__qInspectorPinned;
      if (window.__qInspectorPinned && lastTarget) {
        window.__qPinnedEl = lastTarget;
      }
      applyPinStyles();
      if (!window.__qInspectorPinned) lastTarget = null;
      return;
    }

    // Inspect mode: pin/unpin (existing behaviour)
    window.__qInspectorPinned = !window.__qInspectorPinned;
    if (window.__qInspectorPinned && lastTarget) {
      window.__qPinnedEl = lastTarget;
    }
    applyPinStyles();
    const pl = badge.querySelector('#__q-pin-label');
    if (pl) {
      pl.textContent     = window.__qInspectorPinned ? '📌 Pinned' : '📌 Pin';
      pl.style.color     = window.__qInspectorPinned ? '#f9c74f' : 'rgba(255,255,255,.35)';
      pl.style.borderColor = window.__qInspectorPinned ? '#f9c74f' : 'rgba(255,255,255,.15)';
    }
    if (!window.__qInspectorPinned) {
      lastTarget = null;
    }
  }, { capture: true });

  document.addEventListener('mousemove',  (e) => onMouseMove(e), { capture: true, passive: true });
  document.addEventListener('mouseleave', () => { if (!window.__qInspectorPinned) { lastTarget = null; hideAll(); } }, { capture: true });
  window.addEventListener('scroll',       onScroll, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (!window.__qInspectorActive) return;
    if (e.key === 'Escape') {
      if (window.__qInspectorPinned) {
        // First Esc unpins
        window.__qInspectorPinned = false;
        applyPinStyles();
        lastTarget = null;
        const pl = badge.querySelector('#__q-pin-label');
        if (pl) { pl.textContent = '📌 Pin'; pl.style.color = 'rgba(255,255,255,.5)'; pl.style.borderColor = 'rgba(255,255,255,.15)'; }
        return;
      }
      window.__qInspectorActive = false;
      window.__qInspectorPinned = false;
      // Cancel any pending rAF to prevent overlay from re-appearing after Esc
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      document.documentElement.style.cursor = '';
      lastTarget = null; hideAll();
      window.dispatchEvent(new CustomEvent('__qInspectorOff'));
      return;
    }

    // FIX 2a: DOM navigation while pinned. Only activate when pinned (so it
    // doesn't fight with normal typing on unpinned hover).
    if (!window.__qInspectorPinned) return;
    const cur = window.__qPinnedEl;
    if (!cur) return;
    let next = null;
    if (e.key === 'ArrowUp')    next = cur.parentElement;
    else if (e.key === 'ArrowDown')  next = cur.firstElementChild;
    else if (e.key === 'ArrowLeft')  next = cur.previousElementSibling;
    else if (e.key === 'ArrowRight') next = cur.nextElementSibling;
    else if (e.key === 'p' || e.key === 'P') {
      window.__qInspectorPinned = !window.__qInspectorPinned;
      applyPinStyles();
      const pl = badge.querySelector('#__q-pin-label');
      if (pl) {
        if (window.__qInspectorPinned) {
          pl.textContent = '📌 Pinned'; pl.style.color = '#f9c74f'; pl.style.borderColor = '#f9c74f';
        } else {
          pl.textContent = '📌 Pin'; pl.style.color = 'rgba(255,255,255,.5)'; pl.style.borderColor = 'rgba(255,255,255,.15)';
        }
      }
      e.preventDefault();
      return;
    }
    if (next && next.tagName && !(next.id && next.id.startsWith('__q-'))) {
      e.preventDefault();
      navigateTo(next);
    }
  }, { capture: true });

  // Only commit the "inspector is on" UI if we're actually active.
  // Pre-install (via ensureAllInjected) should leave the page untouched.
  if (window.__qInspectorActive) {
    document.documentElement.style.cursor = 'crosshair';
    console.log('%c[QAKit] Inspector ON (' + mode + ' mode) — Esc to exit', 'color:#00e5a0;font-weight:bold');
  }

})();
