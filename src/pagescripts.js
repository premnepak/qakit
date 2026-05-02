// pagescripts.js — QAKit
// Injected into page MAIN world on demand.
// Provides: region capture overlay, element capture overlay,
//           ruler measurement, responsive preview overlay, CSS selector inspector.

(function installPageScripts() {
  if (window.__qkitPageScriptsInstalled) return;
  window.__qkitPageScriptsInstalled = true;

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT-MENU TARGET TRACKER
  // ═══════════════════════════════════════════════════════════════════════════
  // chrome.contextMenus.OnClickData does NOT expose pageX/pageY for regular
  // element right-clicks, so our handlers previously used elementFromPoint(0,0)
  // by accident and copied the wrong element. We listen for `contextmenu` here
  // (MAIN world) and stash the target + coordinates. Background handlers then
  // read window.__qkitLastContextTarget via executeScript.
  document.addEventListener('contextmenu', e => {
    window.__qkitLastContextTarget = e.target;
    window.__qkitLastContextCoords = { x: e.clientX, y: e.clientY };
    window.__qkitLastContextTs     = Date.now();
  }, true);

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  // Remove any existing QAKit overlay by id
  function removeEl(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  // Clean close of whichever tool is active
  function closeAll() {
    closeRegionCapture();
    closeElementCapture();
    closeRuler();
    closeResponsive();
    closeSelectorInspector();
  }

  // Global Esc handler — close any active tool
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAll();
  }, true);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. REGION CAPTURE — drag crosshair to select area
  // ═══════════════════════════════════════════════════════════════════════════
  let _regionCb = null;

  function closeRegionCapture() {
    removeEl('__qkit-region-overlay');
    _regionCb = null;
  }

  window.__qkitStartRegionCapture = function(cb) {
    // closeAll() MUST run before setting _regionCb because closeAll()
    // calls closeRegionCapture() which nulls _regionCb.
    closeAll();
    // Set callback AFTER closeAll so it doesn't get wiped.
    _regionCb = cb;
    const dpr = window.devicePixelRatio || 1;

    // Dark overlay
    const host = document.createElement('div');
    host.id = '__qkit-region-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none';
    document.body.appendChild(host);

    // Dark tint (whole screen)
    const tint = document.createElement('div');
    tint.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);pointer-events:none';
    host.appendChild(tint);

    // Selection highlight box
    const sel = document.createElement('div');
    sel.style.cssText = 'position:absolute;border:2px solid #0a6e51;background:rgba(10,110,80,0.08);pointer-events:none;display:none;box-sizing:border-box';
    host.appendChild(sel);

    // Instruction tip
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:rgba(12,12,18,0.92);color:#fff;font:600 12px/1.4 -apple-system,monospace;padding:8px 18px;border-radius:8px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    tip.textContent = 'Drag to select a region  ·  Esc to cancel';
    host.appendChild(tip);

    let startX = 0, startY = 0, dragging = false;

    host.addEventListener('mousedown', e => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      sel.style.display = 'block';
      sel.style.left = startX + 'px'; sel.style.top = startY + 'px';
      sel.style.width = '0'; sel.style.height = '0';
    });

    host.addEventListener('mousemove', e => {
      if (!dragging) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      sel.style.left = x + 'px'; sel.style.top = y + 'px';
      sel.style.width = w + 'px'; sel.style.height = h + 'px';
      tip.textContent = w + ' × ' + h + ' px  ·  Esc to cancel';
    });

    host.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      const x1 = Math.min(e.clientX, startX);
      const y1 = Math.min(e.clientY, startY);
      const pw = Math.abs(e.clientX - startX);
      const ph = Math.abs(e.clientY - startY);

      if (pw <= 4 || ph <= 4) {
        closeRegionCapture();
        return;
      }

      const rect = { x: x1 * dpr, y: y1 * dpr, w: pw * dpr, h: ph * dpr, dpr };

      // 1. Make overlay invisible but keep it in DOM so no layout shift before capture
      host.style.opacity = '0';
      host.style.pointerEvents = 'none';
      sel.style.display = 'none';
      tip.style.display = 'none';

      // 2. Store callback ref before any nulling
      const cb = _regionCb;

      // 3. Fire callback after two paint frames so overlay is fully invisible
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // Dispatch via CustomEvent bridge (content.js bridges to background)
          // This is more reliable than chrome.runtime.sendMessage from MAIN world
          window.dispatchEvent(new CustomEvent('__qkitRegionSelected', { detail: rect }));
          // Remove overlay after background has had time to capture
          setTimeout(() => closeRegionCapture(), 600);
        });
      });
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ELEMENT CAPTURE — hover highlights element, click captures it
  // ═══════════════════════════════════════════════════════════════════════════
  let _elementCb = null;
  let _elemOverlay = null;

  function closeElementCapture() {
    removeEl('__qkit-element-overlay');
    if (_elemOverlay) { _elemOverlay.remove(); _elemOverlay = null; }
    document.removeEventListener('mousemove', _elemMouseMove, true);
    document.removeEventListener('click',     _elemClick,     true);
    _elementCb = null;
  }

  function _elemMouseMove(e) {
    if (!_elemOverlay) return;
    const el = e.target;
    if (!el || el === _elemOverlay || el.id === '__qkit-element-overlay') return;
    const r = el.getBoundingClientRect();
    Object.assign(_elemOverlay.style, {
      top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px', display: 'block'
    });
    _elemOverlay._target = el;
  }

  function _elemClick(e) {
    e.preventDefault(); e.stopPropagation();
    const el = _elemOverlay?._target;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const r = el.getBoundingClientRect();
    const rect = { x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr, dpr };
    closeElementCapture();
    if (_elementCb) {
      // Popup path — direct callback
      _elementCb(rect);
    } else {
      // Context-menu / standalone path — dispatch for content.js to bridge
      // to the background service worker (which has the pre-captured
      // screenshot and can crop + inject the save toast).
      try {
        window.dispatchEvent(new CustomEvent('__qkitElementSelected', { detail: rect }));
      } catch (_) {}
    }
  }

  window.__qkitStartElementCapture = function(cb) {
    closeAll();
    _elementCb = cb;

    const host = document.createElement('div');
    host.id = '__qkit-element-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:pointer;pointer-events:none';
    document.body.appendChild(host);

    _elemOverlay = document.createElement('div');
    _elemOverlay.style.cssText = 'position:fixed;border:2px solid #0a6e51;background:rgba(10,110,80,0.1);pointer-events:none;display:none;box-sizing:border-box;transition:top .05s,left .05s,width .05s,height .05s';
    host.appendChild(_elemOverlay);

    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:rgba(12,12,18,0.92);color:#fff;font:600 12px/1.4 -apple-system,monospace;padding:8px 18px;border-radius:8px;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    tip.textContent = 'Click an element to capture it  ·  Esc to cancel';
    host.appendChild(tip);

    document.addEventListener('mousemove', _elemMouseMove, true);
    document.addEventListener('click',     _elemClick,     true);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. RULER — SVG crosshair + two-click distance measurement
  // ═══════════════════════════════════════════════════════════════════════════
  let _rulerSvg = null, _rulerActive = false;
  let _pt1 = null, _measureLine = null, _labelEl = null;
  let _crossH = null, _crossV = null;

  function closeRuler() {
    removeEl('__qkit-ruler-host');
    _rulerSvg = null; _rulerActive = false;
    _pt1 = null; _measureLine = null; _labelEl = null;
    _crossH = null; _crossV = null;
    document.removeEventListener('mousemove', _rulerMouseMove, true);
    document.removeEventListener('click',     _rulerClick,     true);
  }

  function _svgLine(parent, color, dash, width) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('stroke', color);
    l.setAttribute('stroke-width', width || '1');
    if (dash) l.setAttribute('stroke-dasharray', dash);
    parent.appendChild(l);
    return l;
  }

  function _svgText(parent) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('fill', '#fff');
    t.setAttribute('font-size', '11');
    t.setAttribute('font-family', "-apple-system,'Segoe UI',sans-serif");
    t.setAttribute('font-weight', '700');
    parent.appendChild(t);
    return t;
  }

  function _svgRect(parent, fill, rx) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('fill', fill);
    if (rx) r.setAttribute('rx', rx);
    parent.appendChild(r);
    return r;
  }

  window.__qkitStartRuler = function() {
    closeAll();
    _rulerActive = true;
    _pt1 = null;

    const host = document.createElement('div');
    host.id = '__qkit-ruler-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden';
    document.body.appendChild(host);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    host.appendChild(svg);
    _rulerSvg = svg;

    // Crosshair lines
    _crossH = _svgLine(svg, 'rgba(10,110,80,0.5)', '4 4');
    _crossV = _svgLine(svg, 'rgba(10,110,80,0.5)', '4 4');

    // Measurement line (hidden until pt1 set)
    _measureLine = _svgLine(svg, '#f9c74f', null, '2');
    _measureLine.style.display = 'none';

    // Dot at pt1
    const dot1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot1.id = '__qkit-ruler-dot1';
    dot1.setAttribute('r', '4');
    dot1.setAttribute('fill', '#f9c74f');
    dot1.setAttribute('stroke', '#fff');
    dot1.setAttribute('stroke-width', '1.5');
    dot1.style.display = 'none';
    svg.appendChild(dot1);

    // Label group: bg rect + text
    const labelG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    labelG.style.display = 'none';
    const labelBg  = _svgRect(labelG, 'rgba(10,10,20,0.85)', '4');
    const labelTxt = _svgText(labelG);
    svg.appendChild(labelG);
    _labelEl = { g: labelG, bg: labelBg, txt: labelTxt, dot1 };

    const tip = document.createElement('div');
    tip.id = '__qkit-ruler-tip';
    tip.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);background:rgba(12,12,18,.92);color:#fff;font:600 12px/1.4 -apple-system,monospace;padding:8px 18px;border-radius:8px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4)';
    tip.textContent = 'Click to set start point  ·  Esc to close';
    host.appendChild(tip);

    document.addEventListener('mousemove', _rulerMouseMove, true);
    document.addEventListener('click',     _rulerClick,     true);
  };

  function _rulerMouseMove(e) {
    if (!_rulerActive || !_rulerSvg) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const x = e.clientX, y = e.clientY;

    // Update crosshair
    _crossH.setAttribute('x1', '0'); _crossH.setAttribute('y1', y);
    _crossH.setAttribute('x2', vw);  _crossH.setAttribute('y2', y);
    _crossV.setAttribute('x1', x);   _crossV.setAttribute('y1', '0');
    _crossV.setAttribute('x2', x);   _crossV.setAttribute('y2', vh);

    if (_pt1) {
      // Update measurement line
      _measureLine.setAttribute('x1', _pt1.x); _measureLine.setAttribute('y1', _pt1.y);
      _measureLine.setAttribute('x2', x);       _measureLine.setAttribute('y2', y);
      _measureLine.style.display = '';

      // Compute distance, delta, angle
      const dx = x - _pt1.x, dy = y - _pt1.y;
      const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
      const adx  = Math.abs(Math.round(dx));
      const ady  = Math.abs(Math.round(dy));
      const labelStr = dist + 'px  ·  Δx:' + adx + '  Δy:' + ady;

      // Position label near midpoint
      const mx = (_pt1.x + x) / 2, my = (_pt1.y + y) / 2;
      const { g, bg, txt } = _labelEl;
      txt.textContent = labelStr;
      g.style.display = '';
      // Measure text width (approximate: 6px per char)
      const tw = labelStr.length * 6.5 + 12;
      const th = 18;
      const lx = Math.max(4, Math.min(mx - tw / 2, vw - tw - 4));
      const ly = Math.max(4, my - 24);
      bg.setAttribute('x', lx - 4); bg.setAttribute('y', ly - 2);
      bg.setAttribute('width', tw + 8); bg.setAttribute('height', th + 4);
      txt.setAttribute('x', lx + tw / 2);
      txt.setAttribute('y', ly + 13);
      txt.setAttribute('text-anchor', 'middle');

      const tip = document.getElementById('__qkit-ruler-tip');
      if (tip) tip.textContent = dist + 'px (Δx:' + adx + ' Δy:' + ady + ')  ·  Click to reset  ·  Esc to close';
    }
  }

  function _rulerClick(e) {
    if (!_rulerActive) return;
    if (_pt1) {
      // Reset — start new measurement from here
      _pt1 = { x: e.clientX, y: e.clientY };
      const { dot1 } = _labelEl;
      dot1.setAttribute('cx', _pt1.x); dot1.setAttribute('cy', _pt1.y);
    } else {
      _pt1 = { x: e.clientX, y: e.clientY };
      const { dot1 } = _labelEl;
      dot1.style.display = '';
      dot1.setAttribute('cx', _pt1.x); dot1.setAttribute('cy', _pt1.y);
      const tip = document.getElementById('__qkit-ruler-tip');
      if (tip) tip.textContent = 'Move to measure  ·  Click to reset  ·  Esc to close';
    }
  }

  window.__qkitStopRuler = closeRuler;

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. RESPONSIVE PREVIEW OVERLAY — full-screen in-page iframe grid
  // ═══════════════════════════════════════════════════════════════════════════
  const RESPONSIVE_VIEWPORTS = [
    { label: 'Mobile S',  w: 375,  h: 667,  icon: '📱' },
    { label: 'Mobile L',  w: 414,  h: 896,  icon: '📱' },
    { label: 'Tablet',    w: 768,  h: 1024, icon: '📟' },
    { label: 'Desktop',   w: 1280, h: 800,  icon: '🖥' },
    { label: 'Desktop L', w: 1440, h: 900,  icon: '🖥' },
    { label: 'Wide',      w: 1920, h: 1080, icon: '🖥' },
  ];

  function closeResponsive() { removeEl('__qkit-responsive-overlay'); }

  window.__qkitStartResponsive = function(customViewports) {
    closeAll();
    const url = location.href;
    // Use custom viewports passed from popup, or fall back to defaults
    const viewportList = (customViewports && customViewports.length)
      ? customViewports
      : RESPONSIVE_VIEWPORTS.map(v => ({ name: v.label, w: v.w, h: v.h }));
    const dark = window.matchMedia('(prefers-color-scheme:dark)').matches;
    const BG   = dark ? '#0d1117' : '#1a1d25';
    const CARD = dark ? '#161b22' : '#2a2d3a';
    const BORD = dark ? '#30363d' : '#3d4460';
    const TEXT = '#e0e0f0';
    const MUT  = '#a0a0b0';

    const host = document.createElement('div');
    host.id = '__qkit-responsive-overlay';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:' + BG + ';display:flex;flex-direction:column;font-family:-apple-system,"Segoe UI",sans-serif';
    document.body.appendChild(host);

    // Header bar
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 14px;background:' + CARD + ';border-bottom:1px solid ' + BORD + ';flex-shrink:0';
    bar.innerHTML = '<span style="font-size:13px;font-weight:700;color:#fff">📐 Responsive Viewports</span>' +
      '<span style="font-size:10px;color:' + MUT + ';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + url + '">' + url.replace(/^https?:\/\//, '') + '</span>';
    host.appendChild(bar);

    const btnClose = document.createElement('button');
    btnClose.textContent = '✕ Close';
    btnClose.style.cssText = 'padding:4px 10px;font-size:11px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff';
    btnClose.addEventListener('click', closeResponsive);
    bar.appendChild(btnClose);

    // Info banner for X-Frame-Options sites
    const info = document.createElement('div');
    info.style.cssText = 'background:#1e3a5f;border-bottom:1px solid #2a5298;padding:5px 14px;font-size:10px;color:#93c5fd;flex-shrink:0';
    info.textContent = 'ℹ If a site blocks iframes, click the "Open window" button on that card to preview it at the exact viewport size.';
    host.appendChild(info);

    // Viewport cards — horizontal scrolling strip
    const strip = document.createElement('div');
    strip.style.cssText = 'flex:1;overflow-x:auto;overflow-y:hidden;display:flex;align-items:stretch;gap:1px;background:#111;padding:0';
    host.appendChild(strip);

    const iframes = [];

    viewportList.forEach(vp => {
      const card = document.createElement('div');
      card.style.cssText = 'display:flex;flex-direction:column;min-width:' + (vp.w + 2) + 'px;flex-shrink:0;background:' + CARD + ';overflow:hidden';

      // Card header
      const cardHdr = document.createElement('div');
      cardHdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:' + BORD + ';flex-shrink:0';
      const vpLabel = vp.name || vp.label || (vp.w + '×' + vp.h);
      cardHdr.innerHTML = '<span style="font-size:10px;color:' + TEXT + ';font-weight:600">' + vpLabel + '</span>';

      // Editable W/H display
      const dimSpan = document.createElement('span');
      dimSpan.style.cssText = 'font-size:9px;color:' + MUT + ';margin-left:auto';
      dimSpan.textContent = vp.w + ' × ' + vp.h;
      cardHdr.appendChild(dimSpan);

    // Per-card: open in window button — uses RELAY message since MAIN world can't call chrome.windows
      const btnWin = document.createElement('button');
      btnWin.textContent = '↗';
      btnWin.title = 'Open in browser window at ' + vp.w + '×' + vp.h;
      btnWin.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:3px;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff';
      btnWin.addEventListener('click', e => {
        e.stopPropagation();
        // Dispatch via CustomEvent bridge (content.js bridges to background)
        // chrome.runtime.sendMessage from MAIN world is unreliable for this
        window.dispatchEvent(new CustomEvent('__qkitOpenViewport', {
          detail: { url, w: vp.w, h: vp.h }
        }));
      });
      cardHdr.appendChild(btnWin);
      card.appendChild(cardHdr);

      // iframe
      const iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:' + vp.w + 'px;height:100%;border:none;flex:1;display:block;background:#fff';
      iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups');
      iframes.push(iframe);
      card.appendChild(iframe);

      strip.appendChild(card);
    });

    // "Refresh all" button (renamed from "Reload all")
    const btnReload = document.createElement('button');
    btnReload.textContent = '↺ Refresh';
    btnReload.style.cssText = 'padding:4px 10px;font-size:11px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:transparent;color:#fff';
    btnReload.addEventListener('click', () => { iframes.forEach(f => { f.src = f.src; }); });
    bar.insertBefore(btnReload, btnClose);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CSS SELECTOR INSPECTOR — hover shows unique CSS selector + XPath
  // ═══════════════════════════════════════════════════════════════════════════
  let _selectorActive = false;
  let _selectorBadge  = null;
  let _selectorBox    = null;

  function closeSelectorInspector() {
    _selectorActive = false;
    removeEl('__qkit-selector-host');
    _selectorBadge = null; _selectorBox = null;
    document.removeEventListener('mousemove', _selectorMove, true);
    document.removeEventListener('click',     _selectorClick, true);
  }

  // Generate the shortest unique CSS selector for an element
  function generateSelector(el) {
    if (!el || el === document.body) return 'body';

    // 1. ID — always unique
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) {
      return '#' + el.id;
    }

    // 2. data-testid / data-test / data-cy (test attrs are unique by intent)
    for (const attr of ['data-testid','data-test','data-cy','data-qa','data-pw']) {
      if (el.hasAttribute(attr)) {
        const v = el.getAttribute(attr);
        return el.tagName.toLowerCase() + '[' + attr + '="' + v + '"]';
      }
    }

    // 3. Walk up and build a path
    function segmentFor(node) {
      const tag = node.tagName.toLowerCase();
      if (node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) return '#' + node.id;
      // Use first stable class (non-dynamic: no numbers-only, no long hash-like strings)
      const stableClass = Array.from(node.classList).find(c =>
        /^[a-zA-Z][a-zA-Z0-9_-]{1,30}$/.test(c) && !/^\d+$/.test(c)
      );
      if (stableClass) {
        // Check if this tag.class combo is unique among siblings
        const parent = node.parentElement;
        if (parent) {
          const matches = parent.querySelectorAll(tag + '.' + stableClass);
          if (matches.length === 1) return tag + '.' + stableClass;
        }
      }
      // Fallback: nth-child
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length === 1) return tag;
        const idx = siblings.indexOf(node) + 1;
        return tag + ':nth-of-type(' + idx + ')';
      }
      return tag;
    }

    // Build path from element to document root, stop when selector is already unique
    const parts = [];
    let node = el;
    while (node && node !== document.documentElement && parts.length < 6) {
      parts.unshift(segmentFor(node));
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch (_) {}
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  // Generate XPath for an element
  function generateXPath(el) {
    if (!el || el === document.body) return '//body';
    if (el.id) return '//*[@id="' + el.id + '"]';

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) {
          parts.unshift(tag + '[' + (siblings.indexOf(node) + 1) + ']');
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      node = node.parentElement;
    }
    return '//' + parts.join('/');
  }

  function _selectorMove(e) {
    if (!_selectorActive) return;
    const el = e.target;
    if (!el || el.id?.startsWith('__qkit-')) return;

    // Update highlight box
    const r = el.getBoundingClientRect();
    Object.assign(_selectorBox.style, {
      top: r.top + 'px', left: r.left + 'px',
      width: r.width + 'px', height: r.height + 'px', display: 'block'
    });

    // Compute selector and XPath
    const css   = generateSelector(el);
    const xpath = generateXPath(el);
    const tag   = el.tagName.toLowerCase();

    // Position badge near cursor (below + right, clamped to viewport)
    const vw = window.innerWidth, vh = window.innerHeight;
    _selectorBadge.innerHTML =
      '<div style="background:rgba(10,110,80,.18);border-bottom:1px solid rgba(10,110,80,.3);padding:4px 9px;font-size:9px;color:rgba(10,200,120,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
        '&lt;' + tag + (el.id ? ' id="' + el.id + '"' : '') + '&gt;' +
      '</div>' +
      '<div style="padding:6px 9px;display:flex;flex-direction:column;gap:4px">' +
        '<div style="display:flex;gap:5px;align-items:center">' +
          '<span style="color:rgba(255,255,255,.4);font-size:9px;width:36px;flex-shrink:0">CSS</span>' +
          '<code style="color:#a5f3c0;font-size:9.5px;word-break:break-all;flex:1;cursor:pointer" id="__qkit-css-val">' + css + '</code>' +
        '</div>' +
        '<div style="display:flex;gap:5px;align-items:center">' +
          '<span style="color:rgba(255,255,255,.4);font-size:9px;width:36px;flex-shrink:0">XPath</span>' +
          '<code style="color:#fde68a;font-size:9.5px;word-break:break-all;flex:1;cursor:pointer" id="__qkit-xpath-val">' + xpath + '</code>' +
        '</div>' +
        '<div style="font-size:8px;color:rgba(255,255,255,.3);text-align:right;margin-top:1px">Click to copy CSS · Right-click to copy XPath</div>' +
      '</div>';

    _selectorBadge.style.display = 'block';
    _selectorBadge.style.left = '0'; _selectorBadge.style.top = '0';
    const bw = _selectorBadge.offsetWidth;
    const bh = _selectorBadge.offsetHeight;
    let bx = e.clientX + 14, by = e.clientY + 14;
    if (bx + bw > vw - 8) bx = e.clientX - bw - 14;
    if (by + bh > vh - 8) by = e.clientY - bh - 14;
    _selectorBadge.style.left = Math.max(4, bx) + 'px';
    _selectorBadge.style.top  = Math.max(4, by) + 'px';
    _selectorBadge._css   = css;
    _selectorBadge._xpath = xpath;
  }

  function _selectorClick(e) {
    if (!_selectorActive) return;
    if (e.button === 2) return; // right click handled below
    e.preventDefault(); e.stopPropagation();
    const css = _selectorBadge?._css;
    if (css) {
      navigator.clipboard?.writeText(css).catch(() => {});
      // Flash confirmation
      const el = document.getElementById('__qkit-css-val');
      if (el) { const orig = el.style.color; el.style.color = '#fff'; setTimeout(() => { el.style.color = orig; }, 600); }
      window.dispatchEvent(new CustomEvent('__qkitSelectorCopied', { detail: { css, type: 'css' } }));
    }
  }

  function _selectorRightClick(e) {
    if (!_selectorActive) return;
    e.preventDefault(); e.stopPropagation();
    const xpath = _selectorBadge?._xpath;
    if (xpath) {
      navigator.clipboard?.writeText(xpath).catch(() => {});
      const el = document.getElementById('__qkit-xpath-val');
      if (el) { const orig = el.style.color; el.style.color = '#fff'; setTimeout(() => { el.style.color = orig; }, 600); }
      window.dispatchEvent(new CustomEvent('__qkitSelectorCopied', { detail: { xpath, type: 'xpath' } }));
    }
  }

  window.__qkitStartSelectorInspector = function() {
    closeAll();
    _selectorActive = true;

    const host = document.createElement('div');
    host.id = '__qkit-selector-host';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none';
    document.body.appendChild(host);

    _selectorBox = document.createElement('div');
    _selectorBox.style.cssText = 'position:fixed;border:2px solid rgba(10,200,120,0.8);background:rgba(10,110,80,0.07);pointer-events:none;display:none;box-sizing:border-box';
    host.appendChild(_selectorBox);

    _selectorBadge = document.createElement('div');
    _selectorBadge.style.cssText = [
      'position:fixed;z-index:2147483647;pointer-events:none;display:none',
      'font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace',
      'font-size:10px;line-height:1.5;border-radius:8px',
      'background:rgba(12,12,20,0.97);border:1.5px solid rgba(10,200,120,0.5)',
      'max-width:320px;min-width:180px;overflow:hidden',
      'box-shadow:0 8px 28px rgba(0,0,0,.7)'
    ].join(';');
    document.body.appendChild(_selectorBadge);

    document.addEventListener('mousemove',    _selectorMove,       true);
    document.addEventListener('click',        _selectorClick,      true);
    document.addEventListener('contextmenu',  _selectorRightClick, true);
  };

  window.__qkitStopSelectorInspector = function() { closeSelectorInspector(); };
  window.__qkitSelectorActive = function() { return _selectorActive; };

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. FULL-PAGE SCREENSHOT — scroll-and-stitch stitcher
  // Called by background.js orchestration; provides helper to get page dims
  // ═══════════════════════════════════════════════════════════════════════════
  window.__qkitGetFullPageDimensions = function() {
    return {
      scrollWidth:    Math.max(document.body.scrollWidth,   document.documentElement.scrollWidth),
      scrollHeight:   Math.max(document.body.scrollHeight,  document.documentElement.scrollHeight),
      viewportWidth:  window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr:            window.devicePixelRatio || 1,
      originalScrollY: window.scrollY,
    };
  };

  window.__qkitScrollTo = function(y) {
    window.scrollTo(0, y);
    return { done: true, currentY: window.scrollY };
  };

  window.__qkitRestoreScroll = function(y) {
    window.scrollTo(0, y);
  };

  console.log('%c[QAKit] Page scripts installed ✓', 'color:#0a6e51;font-weight:bold');

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. IN-PAGE ANNOTATION — SVG overlay on full page + floating toolbar
  //    Annotate on the live page before taking a screenshot
  // ═══════════════════════════════════════════════════════════════════════════
  let _annotSvg      = null;
  let _annotToolbar  = null;
  let _annotActive   = false;
  let _annotTool     = 'pen';   // pen | rect | arrow | text
  let _annotColor    = '#e63946';
  let _annotSize     = 3;
  let _annotDrawing  = false;
  let _annotStart    = null;
  let _annotCurrent  = null;    // live preview element
  let _annotHistory  = [];      // undo stack of SVG element arrays
  let _annotPath     = null;    // current pen path element

  function _pageSize() {
    return {
      w: Math.max(document.body.scrollWidth,  document.documentElement.scrollWidth),
      h: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    };
  }

  function _svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function _annotSaveHistory() {
    _annotHistory.push(Array.from(_annotSvg.querySelectorAll('.qk-annot')).map(e => e.cloneNode(true)));
    if (_annotHistory.length > 50) _annotHistory.shift();
  }

  function _annotUndo() {
    if (!_annotSvg) return;
    _annotSvg.querySelectorAll('.qk-annot').forEach(e => e.remove());
    const prev = _annotHistory.pop();
    if (prev) prev.forEach(e => _annotSvg.appendChild(e));
  }

  function _annotClear() {
    if (!_annotSvg) return;
    _annotSaveHistory();
    _annotSvg.querySelectorAll('.qk-annot').forEach(e => e.remove());
  }

  function _annotSetActiveTool(tool) {
    _annotTool = tool;
    if (_annotToolbar) {
      _annotToolbar.querySelectorAll('.__qk-toolbtn').forEach(b => {
        b.style.background = b.dataset.tool === tool ? 'rgba(0,229,160,.25)' : 'transparent';
        b.style.color      = b.dataset.tool === tool ? '#00e5a0' : '#ccc';
      });
    }
    if (_annotSvg) _annotSvg.style.cursor = tool === 'text' ? 'text' : 'crosshair';
  }

  function _mkBtn(icon, title, onclick, tool) {
    const b = document.createElement('button');
    b.textContent = icon; b.title = title;
    b.className = '__qk-toolbtn';
    if (tool) b.dataset.tool = tool;
    b.style.cssText = 'background:transparent;border:none;color:#ccc;font-size:14px;padding:4px 7px;cursor:pointer;border-radius:4px;transition:all .12s;line-height:1';
    b.addEventListener('mouseover', () => { if (b.dataset.tool !== _annotTool) b.style.background = 'rgba(255,255,255,.07)'; });
    b.addEventListener('mouseout',  () => { if (b.dataset.tool !== _annotTool) b.style.background = 'transparent'; });
    b.addEventListener('click', e => { e.stopPropagation(); onclick(); });
    return b;
  }

  function _buildAnnotToolbar() {
    const bar = document.createElement('div');
    bar.id = '__qkit-annot-toolbar';
    bar.style.cssText = [
      'position:fixed;bottom:22px;left:50%;transform:translateX(-50%)',
      'z-index:2147483647;display:flex;align-items:center;gap:2px',
      'background:#1a1a2e;border:1px solid rgba(255,255,255,.15)',
      'border-radius:10px;padding:4px 8px',
      'box-shadow:0 8px 32px rgba(0,0,0,.6)',
      'font-family:-apple-system,"Segoe UI",sans-serif',
    ].join(';');

    // Tool buttons
    bar.appendChild(_mkBtn('✏', 'Pen (freehand)',    () => _annotSetActiveTool('pen'),   'pen'));
    bar.appendChild(_mkBtn('▭', 'Rectangle',         () => _annotSetActiveTool('rect'),  'rect'));
    bar.appendChild(_mkBtn('↗', 'Arrow',              () => _annotSetActiveTool('arrow'), 'arrow'));
    bar.appendChild(_mkBtn('T', 'Text label',         () => _annotSetActiveTool('text'),  'text'));

    // Divider
    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:18px;background:rgba(255,255,255,.15);margin:0 4px';
    bar.appendChild(sep);

    // Colour picker
    const cp = document.createElement('input');
    cp.type = 'color'; cp.value = _annotColor; cp.title = 'Pen colour';
    cp.style.cssText = 'width:22px;height:22px;border:none;background:none;cursor:pointer;padding:0';
    cp.addEventListener('input', () => { _annotColor = cp.value; });
    bar.appendChild(cp);

    // Size
    const sz = document.createElement('select');
    sz.style.cssText = 'background:#222;border:1px solid rgba(255,255,255,.2);color:#ccc;font-size:9px;padding:2px 4px;border-radius:4px;cursor:pointer';
    [['2','Fine'],['3','Medium'],['5','Thick'],['10','Marker']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l;
      if (v === '3') o.selected = true; sz.appendChild(o);
    });
    sz.addEventListener('change', () => { _annotSize = parseInt(sz.value); });
    bar.appendChild(sz);

    const sep2 = sep.cloneNode();
    bar.appendChild(sep2);

    // Undo
    bar.appendChild(_mkBtn('↩', 'Undo (Ctrl+Z)', _annotUndo));
    // Clear
    bar.appendChild(_mkBtn('🗑', 'Clear all', () => {
      if (window.confirm('Clear all annotations?')) _annotClear();
    }));

    const sep3 = sep.cloneNode();
    bar.appendChild(sep3);

    // Screenshot now — dispatches a CustomEvent that content.js bridges to background
    const ssBtn = _mkBtn('📸', 'Take screenshot now', () => {
      // Use CustomEvent bridge: content.js listens for __qkitCaptureAnnotated
      // and forwards to background as CAPTURE_VISIBLE_FOR_CROP.
      // This avoids the unreliable chrome.runtime.sendMessage callback pattern
      // from MAIN world scripts.
      window.dispatchEvent(new CustomEvent('__qkitCaptureAnnotated'));
    });
    ssBtn.style.color = '#00e5a0';
    bar.appendChild(ssBtn);

    // Close
    bar.appendChild(_mkBtn('✕', 'Exit annotation mode (Esc)', closeAnnotation));

    _annotToolbar = bar;
    document.body.appendChild(bar);

    // Keyboard shortcuts
    const _kbHandler = e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeAnnotation(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); _annotUndo(); }
    };
    document.addEventListener('keydown', _kbHandler, true);
    bar._kbHandler = _kbHandler;

    _annotSetActiveTool('pen');
    return bar;
  }

  function closeAnnotation() {
    if (_annotSvg)    { _annotSvg._ro?.disconnect(); _annotSvg.remove(); _annotSvg = null; }
    if (_annotToolbar) {
      if (_annotToolbar._kbHandler) document.removeEventListener('keydown', _annotToolbar._kbHandler, true);
      _annotToolbar.remove(); _annotToolbar = null;
    }
    // Remove indicator bar and keyframe style — these were missing from close, causing the green bar to persist
    const ind = document.getElementById('__qkit-annot-indicator');
    if (ind) ind.remove();
    const sty = document.getElementById('__qkit-annot-style');
    if (sty) sty.remove();
    _annotActive  = false;
    _annotHistory = [];
    _annotPath    = null;
    _annotCurrent = null;
  }

  window.__qkitStartAnnotation = function() {
    if (_annotActive) { closeAnnotation(); return; }
    closeAll();
    _annotActive = true;
    const { w, h } = _pageSize();

    // SVG layer covering full page scroll area
    const svg = _svgEl('svg', {
      id:       '__qkit-annot-svg',
      width:    w, height: h,
      viewBox:  '0 0 ' + w + ' ' + h,
      style:    'position:absolute;top:0;left:0;z-index:2147483640;pointer-events:all;overflow:visible;cursor:crosshair',
    });
    document.body.appendChild(svg);
    _annotSvg = svg;

    // Resize guard
    const _ro = new ResizeObserver(() => {
      const { w: nw, h: nh } = _pageSize();
      svg.setAttribute('width', nw); svg.setAttribute('height', nh);
      svg.setAttribute('viewBox', '0 0 ' + nw + ' ' + nh);
    });
    _ro.observe(document.body);
    svg._ro = _ro;

    // ── Drawing event handlers ──────────────────────────────────────────────
    svg.addEventListener('mousedown', e => {
      if (!_annotActive) return;
      e.stopPropagation();
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;
      _annotStart = { x, y };
      _annotDrawing = true;

      if (_annotTool === 'pen') {
        _annotSaveHistory();
        _annotPath = _svgEl('path', {
          class: 'qk-annot', fill: 'none',
          stroke: _annotColor, 'stroke-width': _annotSize,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          d: 'M ' + x + ' ' + y,
        });
        svg.appendChild(_annotPath);
      } else if (_annotTool === 'text') {
        _annotDrawing = false;
        _annotSaveHistory();
        const label = window.prompt('Enter annotation text:');
        if (label) {
          const t = _svgEl('text', {
            class: 'qk-annot', x, y,
            fill: _annotColor, 'font-size': Math.max(14, _annotSize * 4),
            'font-family': '-apple-system,sans-serif', 'font-weight': '700',
          });
          t.textContent = label;
          svg.appendChild(t);
        }
      } else {
        // rect / arrow: show live preview
        _annotCurrent = null;
      }
    });

    svg.addEventListener('mousemove', e => {
      if (!_annotDrawing || !_annotActive) return;
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;

      if (_annotTool === 'pen' && _annotPath) {
        const d = _annotPath.getAttribute('d') + ' L ' + x + ' ' + y;
        _annotPath.setAttribute('d', d);
      } else if (_annotTool === 'rect') {
        if (_annotCurrent) _annotCurrent.remove();
        const rx = Math.min(x, _annotStart.x), ry = Math.min(y, _annotStart.y);
        _annotCurrent = _svgEl('rect', {
          class: 'qk-annot-preview', x: rx, y: ry,
          width: Math.abs(x - _annotStart.x), height: Math.abs(y - _annotStart.y),
          fill: 'none', stroke: _annotColor, 'stroke-width': _annotSize,
          'stroke-dasharray': '4 2',
        });
        svg.appendChild(_annotCurrent);
      } else if (_annotTool === 'arrow') {
        if (_annotCurrent) _annotCurrent.remove();
        _annotCurrent = _svgEl('g', { class: 'qk-annot-preview' });
        const line = _svgEl('line', {
          x1: _annotStart.x, y1: _annotStart.y, x2: x, y2: y,
          stroke: _annotColor, 'stroke-width': _annotSize,
        });
        const ang = Math.atan2(y - _annotStart.y, x - _annotStart.x);
        const len = Math.max(12, _annotSize * 4);
        const poly = _svgEl('polygon', {
          points: [
            x + ',' + y,
            (x - len * Math.cos(ang - Math.PI/6)) + ',' + (y - len * Math.sin(ang - Math.PI/6)),
            (x - len * Math.cos(ang + Math.PI/6)) + ',' + (y - len * Math.sin(ang + Math.PI/6)),
          ].join(' '),
          fill: _annotColor,
        });
        _annotCurrent.appendChild(line);
        _annotCurrent.appendChild(poly);
        svg.appendChild(_annotCurrent);
      }
    });

    svg.addEventListener('mouseup', e => {
      if (!_annotDrawing) return;
      _annotDrawing = false;
      const x = e.clientX + window.scrollX;
      const y = e.clientY + window.scrollY;

      if (_annotTool === 'rect' || _annotTool === 'arrow') {
        if (_annotCurrent) {
          _annotSaveHistory();
          // Promote preview to permanent annotation
          _annotCurrent.querySelectorAll
            ? _annotCurrent.querySelectorAll('*').forEach(c => c.removeAttribute('class'))
            : _annotCurrent.removeAttribute('class');
          _annotCurrent.setAttribute('class', 'qk-annot');
          _annotCurrent = null;
        }
      }
      _annotPath = null;
    });

    _buildAnnotToolbar();

    // Indicator bar at top of page
    const ind = document.createElement('div');
    ind.id = '__qkit-annot-indicator';
    ind.style.cssText = 'position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483646;background:linear-gradient(90deg,#0a6e51,#00e5a0,#0a6e51);background-size:200% 100%;animation:__qkAnnotSlide 2s linear infinite;pointer-events:none';
    const style = document.createElement('style');
    style.id = '__qkit-annot-style';
    style.textContent = '@keyframes __qkAnnotSlide{0%{background-position:0% 0}100%{background-position:200% 0}}';
    document.head.appendChild(style);
    document.body.appendChild(ind);
  };

  window.__qkitAnnotationActive = function() { return _annotActive; };
  window.__qkitCloseAnnotation  = closeAnnotation;
})();
