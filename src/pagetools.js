// pagetools.js — QAKit v1.0.1
// Page Kit tab logic: Inspector, Ruler, Responsive, Screenshot.

const VP_STORAGE_KEY = 'qakit_viewport_presets';
const VP_MAX_SELECTED = 6;

const DEFAULT_VIEWPORTS = [
  { id: 'vs', name: 'Mobile S',  w: 375,  h: 667,  selected: true  },
  { id: 'vl', name: 'Mobile L',  w: 414,  h: 896,  selected: true  },
  { id: 'vt', name: 'Tablet',    w: 768,  h: 1024, selected: true  },
  { id: 'vd', name: 'Desktop',   w: 1280, h: 800,  selected: true  },
  { id: 'vw', name: 'Wide',      w: 1440, h: 900,  selected: true  },
  { id: 'vx', name: 'Full HD',   w: 1920, h: 1080, selected: false },
];

window.initPageTools = function () {
  // Ensure showLsToast is always available (defined in popup.js but loaded after pagetools.js)
  function toast(msg, isErr) {
    if (typeof showLsToast === 'function') showLsToast(msg, isErr);
    else if (typeof window.showLsToast === 'function') window.showLsToast(msg, isErr);
  }

  // ── Sub-tab switching ─────────────────────────────────────────────────────
  document.querySelectorAll('.pt-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pt-subtab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.pt-sub').forEach(p => {
        p.style.display = 'none'; p.classList.remove('active');
      });
      btn.classList.add('active');
      const panel = document.getElementById('ptsub-' + btn.dataset.sub);
      if (panel) { panel.style.display = 'flex'; panel.classList.add('active'); }
      // Update panel nav title to reflect active sub-tab (Fix 40)
      const subLabels = { inspect: 'Element Inspector', screenshot: 'Screenshots', responsive: 'Responsive Preview', meta: 'Page Metadata' };
      const titleEl = document.getElementById('panelNavTitle-pagetools');
      if (titleEl && subLabels[btn.dataset.sub]) titleEl.textContent = subLabels[btn.dataset.sub];
    });
  });

  // ── Shared helpers ────────────────────────────────────────────────────────
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async function injectAndRun(tabId, func, args) {
    await chrome.runtime.sendMessage({ action: 'INJECT_PAGE_SCRIPTS', tabId });
    return chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func, args: args || []
    });
  }

  // ── Quick Actions ─────────────────────────────────────────────────────────
  const _qa = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
  _qa('pt-openAuditBtn',   () => { if (typeof switchToTab === 'function') switchToTab('audit'); });
  _qa('pt-openConsoleBtn', () => { if (typeof switchToTab === 'function') switchToTab('console'); });
  _qa('pt-openMetaBtn',    () => document.querySelector('.pt-subtab[data-sub="meta"]')?.click());
  _qa('pt-openDdlBtn',     () => { if (typeof switchToTab === 'function') switchToTab('ddl'); });
  _qa('pt-openNetBtn',     () => { if (typeof switchToTab === 'function') switchToTab('net'); });
  _qa('pt-openLsBtn',      () => { if (typeof switchToTab === 'function') switchToTab('ls'); });
  _qa('pt-openCookiesBtn', () => { if (typeof switchToTab === 'function') switchToTab('cookies'); });
  _qa('pt-openGeoBtn',     () => { if (typeof switchToTab === 'function') switchToTab('geo'); });

  // ═══════════════════════════════════════════════════════════════════════════
  // INSPECTOR + SPACING — uniform pt-tool-btn with active toggle
  // ═══════════════════════════════════════════════════════════════════════════
  const inspectBtn = document.getElementById('pt-inspectBtn');
  const spacingBtn = document.getElementById('pt-spacingBtn');

  // Keep in sync with hidden header buttons (which popup.js manages)
  function syncToolBtns() {
    const iOn = document.getElementById('inspectBtn')?.classList.contains('active');
    const sOn = document.getElementById('spacingBtn')?.classList.contains('active');
    inspectBtn?.classList.toggle('active', !!iOn);
    spacingBtn?.classList.toggle('active', !!sOn);
  }

  const _origUpdate = window.updateInspectorBtns;
  window.updateInspectorBtns = function () {
    if (typeof _origUpdate === 'function') _origUpdate();
    syncToolBtns();
  };
  setTimeout(syncToolBtns, 80);

  inspectBtn?.addEventListener('click', () => {
    document.getElementById('inspectBtn')?.click();
    setTimeout(syncToolBtns, 50);
  });

  spacingBtn?.addEventListener('click', () => {
    document.getElementById('spacingBtn')?.click();
    setTimeout(syncToolBtns, 50);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RULER
  // ═══════════════════════════════════════════════════════════════════════════
  let rulerActive = false;
  const rulerBtn = document.getElementById('pt-rulerBtn');

  async function toggleRuler() {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    if (rulerActive) {
      await injectAndRun(tab.id, () => window.__qkitStopRuler?.());
      rulerActive = false;
    } else {
      await injectAndRun(tab.id, () => window.__qkitStartRuler?.());
      rulerActive = true;
      toast('📏 Ruler ON — click to set point · Esc to close');
      window.close();
    }
    rulerBtn?.classList.toggle('active', rulerActive);
  }

  rulerBtn?.addEventListener('click', toggleRuler);

  // ── In-page Annotation ────────────────────────────────────────────────────
  const annotateBtn = document.getElementById('pt-annotateBtn');
  let annotateActive = false;

  async function toggleAnnotate() {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith('http')) {
      toast('Navigate to a webpage first', true); return;
    }
    if (annotateActive) {
      await injectAndRun(tab.id, () => window.__qkitCloseAnnotation?.());
      annotateActive = false;
      annotateBtn?.classList.remove('active');
    } else {
      await injectAndRun(tab.id, () => window.__qkitStartAnnotation?.());
      annotateActive = true;
      annotateBtn?.classList.add('active');
      toast('✏ Draw on the page · 📸 in toolbar to capture · Esc to exit');
      window.close();
    }
  }

  annotateBtn?.addEventListener('click', toggleAnnotate);

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSIVE VIEWPORTS — custom list with checkboxes, max 5 selected
  // ═══════════════════════════════════════════════════════════════════════════
  let viewports = [...DEFAULT_VIEWPORTS];

  async function loadViewports() {
    try {
      const s = await chrome.storage.local.get(VP_STORAGE_KEY);
      if (s[VP_STORAGE_KEY] && Array.isArray(s[VP_STORAGE_KEY]) && s[VP_STORAGE_KEY].length) {
        viewports = s[VP_STORAGE_KEY];
      }
    } catch (_) {}
  }

  async function saveViewports() {
    try {
      await chrome.storage.local.set({ [VP_STORAGE_KEY]: viewports });
    } catch (_) {}
  }

  function sortViewports() {
    viewports.sort((a, b) => a.w !== b.w ? a.w - b.w : a.h - b.h);
  }

  function renderViewportList() {
    const list = document.getElementById('vpPresetList');
    if (!list) return;
    sortViewports();
    const selectedCount = viewports.filter(v => v.selected).length;
    list.innerHTML = '';

    viewports.forEach((vp, idx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'vp-item' + (vp.selected ? ' vp-item-checked' : '');

      // Checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = vp.selected; cb.id = 'vpcb-' + idx;
      cb.addEventListener('change', async () => {
        const nowSel = viewports.filter(v => v.selected).length;
        if (cb.checked && nowSel >= VP_MAX_SELECTED) {
          cb.checked = false;
          toast('Maximum ' + VP_MAX_SELECTED + ' viewports can be selected', true); return;
        }
        viewports[idx].selected = cb.checked;
        await saveViewports(); renderViewportList();
      });

      // Editable name
      const nameIn = document.createElement('input');
      nameIn.value = vp.name;
      nameIn.style.cssText = 'flex:1;background:transparent;border:none;color:var(--text);font-family:monospace;font-size:9.5px;font-weight:700;outline:none;min-width:0;padding:0';
      nameIn.title = 'Click to edit name';
      nameIn.addEventListener('change', async () => {
        const v = nameIn.value.trim();
        if (v) { viewports[idx].name = v; await saveViewports(); renderViewportList(); }
      });

      // Editable W
      const wIn = document.createElement('input');
      wIn.type = 'number'; wIn.value = vp.w; wIn.min = 100; wIn.max = 3840;
      wIn.style.cssText = 'width:44px;background:transparent;border:none;border-bottom:1px dotted var(--muted);color:var(--muted);font-family:monospace;font-size:9px;text-align:right;outline:none;padding:0';
      wIn.title = 'Click to edit width';
      wIn.addEventListener('change', async () => {
        const v = parseInt(wIn.value);
        if (v >= 100) { viewports[idx].w = v; await saveViewports(); renderViewportList(); }
      });

      const xSpan = document.createElement('span');
      xSpan.textContent = '×'; xSpan.style.cssText = 'font-size:9px;color:var(--muted)';

      // Editable H
      const hIn = document.createElement('input');
      hIn.type = 'number'; hIn.value = vp.h; hIn.min = 100; hIn.max = 2160;
      hIn.style.cssText = 'width:44px;background:transparent;border:none;border-bottom:1px dotted var(--muted);color:var(--muted);font-family:monospace;font-size:9px;outline:none;padding:0';
      hIn.title = 'Click to edit height';
      hIn.addEventListener('change', async () => {
        const v = parseInt(hIn.value);
        if (v >= 100) { viewports[idx].h = v; await saveViewports(); renderViewportList(); }
      });

      // Delete button
      const del = document.createElement('span');
      del.className = 'vp-item-del'; del.textContent = '✕'; del.title = 'Remove';
      del.addEventListener('click', async () => {
        viewports.splice(idx, 1);
        await saveViewports(); renderViewportList();
      });

      rowEl.appendChild(cb);
      rowEl.appendChild(nameIn);
      rowEl.appendChild(wIn);
      rowEl.appendChild(xSpan);
      rowEl.appendChild(hIn);
      rowEl.appendChild(del);
      list.appendChild(rowEl);
    });

    // Count label
    const info = document.createElement('div');
    info.style.cssText = 'font-size:8.5px;color:var(--muted);padding:2px 4px;text-align:right';
    info.textContent = selectedCount + ' of ' + VP_MAX_SELECTED + ' selected  ·  sorted by width';
    list.appendChild(info);
  }

  // Add custom viewport
  document.getElementById('vpAddBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('vpNewName')?.value.trim();
    const w    = parseInt(document.getElementById('vpNewW')?.value);
    const h    = parseInt(document.getElementById('vpNewH')?.value);
    if (!name || !w || !h || w < 100 || h < 100) {
      toast('Enter a name and valid W×H (min 100px)', true); return;
    }
    const sel  = viewports.filter(v => v.selected).length < VP_MAX_SELECTED;
    viewports.push({ id: 'vc-' + Date.now(), name, w, h, selected: sel });
    sortViewports();
    await saveViewports();
    renderViewportList();
    // Clear inputs
    ['vpNewName','vpNewW','vpNewH'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    toast('"' + name + '" added' + (sel ? ' and selected' : ' (deselected — max reached)'));
  });

  // Launch responsive preview with selected viewports
  document.getElementById('vpLaunchBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith('http')) {
      toast('Navigate to a webpage first', true); return;
    }
    const selected = viewports.filter(v => v.selected);
    if (!selected.length) { showLsToast('Select at least one viewport', true); return; }
    await injectAndRun(tab.id, (vps) => window.__qkitStartResponsive?.(vps), [selected]);
    toast('📐 Responsive Preview launched');
    window.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCREENSHOT — Full Page + Region, annotate before/after, save + clipboard
  // ═══════════════════════════════════════════════════════════════════════════
  let ctx          = null;
  let lastX = 0, lastY = 0;
  let shapeStart   = null;
  let _snapshots   = [];
  let _hasCaptured = false;

  const ssCanvas      = document.getElementById('ssCanvas');
  const ssSaveBtn     = document.getElementById('ssSaveBtn');
  const ssClearBtn    = document.getElementById('ssClearBtn');
  const ssCopyBtn     = document.getElementById('ssCopyBtn');
  const ssUndoBtn     = document.getElementById('ssUndoBtn');
  const ssColorPicker = document.getElementById('ssColorPicker');
  const ssSizeSelect  = document.getElementById('ssSizeSelect');
  const ssStatus      = document.getElementById('ssStatus');
  const ssProgress    = document.getElementById('ssProgress');
  const ssClearAnnotBtn = document.getElementById('ssClearAnnotBtn');

  function setStatus(msg, isErr) {
    if (!ssStatus) return;
    ssStatus.textContent = msg;
    ssStatus.style.color = isErr ? 'var(--warn)' : 'var(--muted)';
  }

  function showProgress(v) {
    if (ssProgress) ssProgress.style.display = v ? 'block' : 'none';
  }

  function ensureCanvas(w, h) {
    if (!ssCanvas) return null;
    if (ssCanvas.width !== w || ssCanvas.height !== h) {
      ssCanvas.width  = w;
      ssCanvas.height = h;
    }
    ctx = ssCanvas.getContext('2d');
    ssCanvas.style.display = 'block';
    // Enable drawing immediately
    ssCanvas.style.cursor = 'crosshair';
    return ctx;
  }

  function saveSnap() {
    if (!ctx) return;
    _snapshots.push(ctx.getImageData(0, 0, ssCanvas.width, ssCanvas.height));
    if (_snapshots.length > 40) _snapshots.shift();
  }

  function loadImageToCanvas(dataUrl, label) {
    const img = new Image();
    img.onload = () => {
      const c = ensureCanvas(img.width, img.height);
      if (!c) return;
      c.drawImage(img, 0, 0);
      _hasCaptured = true;
      _snapshots = [];
      setStatus('✓ ' + label + ' — ' + img.width + '×' + img.height + 'px · Draw then Save/Copy');
      // Auto-copy to clipboard so it's immediately available
      autoCopyToClipboard(ssCanvas);
    };
    img.onerror = () => setStatus('Failed to load image', true);
    img.src = dataUrl;
  }

  // ── Full Page ────────────────────────────────────────────────────────────
  document.getElementById('ss-fullBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith('http')) {
      setStatus('Navigate to a webpage first', true); return;
    }
    showProgress(true); setStatus('Capturing full page… (please wait)');
    try {
      const result = await chrome.runtime.sendMessage({ action: 'CAPTURE_FULL_PAGE', tabId: tab.id });
      showProgress(false);
      if (!result?.strips) { setStatus('Capture failed: ' + (result?.error || 'unknown'), true); return; }

      const { strips, totalHeight, viewportWidth, viewportHeight, dpr } = result;
      const W = Math.round(viewportWidth * dpr);
      const H = Math.round(totalHeight   * dpr);
      const c = ensureCanvas(W, H);
      if (!c) return;
      setStatus('Stitching ' + strips.length + ' strips…');

      let i = 0;
      function next() {
        if (i >= strips.length) {
          _hasCaptured = true; _snapshots = [];
          setStatus('✓ Full page ' + W + '×' + H + 'px');
          // Export canvas → copy to clipboard + show toast matching region/element (Fix 54a)
          try {
            const canvas = document.getElementById('ssCanvas');
            if (canvas) {
              canvas.toBlob(async blob => {
                try {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                } catch(_) { /* clipboard write failed — continue to toast */ }
                const dataUrl = canvas.toDataURL('image/png');
                showScreenshotToast(dataUrl, 'Full page ' + W + '×' + H + 'px captured');
              }, 'image/png');
            }
          } catch(exportErr) {
            setStatus('✓ Done — open Page Kit to save', false);
          }
          return;
        }
        const strip = strips[i++];
        const img   = new Image();
        img.onload  = () => {
          const destY = Math.round(strip.scrollY * dpr);
          const rem   = H - destY;
          const srcH  = Math.min(img.height, rem);
          c.drawImage(img, 0, 0, img.width, srcH, 0, destY, img.width, srcH);
          setStatus('Stitching ' + i + '/' + strips.length + '…');
          next();
        };
        img.onerror = next;
        img.src     = strip.dataUrl;
      }
      next();
    } catch(e) { showProgress(false); setStatus('Capture failed: ' + e.message, true); }
  });

  // ── Region Capture ───────────────────────────────────────────────────────
  document.getElementById('ss-regionBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith('http')) {
      setStatus('Navigate to a webpage first', true); return;
    }
    setStatus('Preparing region capture…');

    // STEP 1: Capture the screenshot NOW while popup is open and has focus.
    // This is the only reliable way in Chrome — captureVisibleTab works when
    // the extension popup is the active context. After popup.close(), it fails.
    let captureDataUrl = null;
    try {
      captureDataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(dataUrl);
        });
      });
    } catch (e) {
      setStatus('Capture failed: ' + e.message, true);
      return;
    }

    if (!captureDataUrl) {
      setStatus('Could not capture page — try again', true);
      return;
    }

    // STEP 2: Store the screenshot in background state and tell background which tab
    await chrome.runtime.sendMessage({
      action: 'STORE_REGION_SCREENSHOT',
      tabId: tab.id,
      dataUrl: captureDataUrl,
    });

    // STEP 3: Inject the region selection overlay — user draws their selection
    await injectAndRun(tab.id, () => {
      window.__qkitStartRegionCapture();
    });

    // STEP 4: Close popup — user now drags on the page
    setTimeout(() => window.close(), 80);
  });

  // Receive cropped/annotated screenshot delivered from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'DELIVER_CROPPED_SCREENSHOT' && msg.dataUrl) {
      // Don't navigate to screenshot tab — show a toast with download button instead
      showScreenshotToast(msg.dataUrl, msg.label || 'Screenshot captured');
    }
  });

  // Show toast with download button for screenshot results (Fix 45)
  function showScreenshotToast(dataUrl, label) {
    // Remove any existing screenshot toast
    document.getElementById('ssToast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'ssToast';
    toast.style.cssText = 'position:fixed;bottom:44px;left:8px;right:8px;z-index:99999;' +
      'background:#1a1f2c;color:#fff;border-radius:8px;padding:10px 12px;' +
      'display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:11px;';
    toast.innerHTML =
      '<span style="font-size:16px;flex-shrink:0">📸</span>' +
      '<span style="flex:1;font-weight:600;color:#00e5a0">' + label + '</span>' +
      '<button id="ssDownloadBtn" style="background:#00e5a0;border:none;border-radius:5px;padding:5px 12px;color:#0f141d;font-size:10px;font-weight:700;cursor:pointer">⬇ Download</button>' +
      '<button id="ssDismissBtn" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:16px;cursor:pointer;padding:0 2px">×</button>';
    document.body.appendChild(toast);

    document.getElementById('ssDownloadBtn').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'qakit-screenshot-' + Date.now() + '.png';
      a.click();
    });
    document.getElementById('ssDismissBtn').addEventListener('click', () => toast.remove());

    // Also load into canvas if screenshot panel is somehow visible
    try { loadImageToCanvas(dataUrl, label); } catch (_) {}

    // Auto-dismiss after 10 seconds
    setTimeout(() => toast?.remove(), 10000);
  }

  // ── Screenshot annotation — uses the in-page SVG annotation engine ─────────
  // "Annotate Page" button launches __qkitStartAnnotation on the live page.
  // When user presses 📸 in the page toolbar, it delivers back to the popup.
  document.getElementById('ss-annotatePageBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.startsWith('http')) {
      setStatus('Navigate to a webpage first', true); return;
    }
    await injectAndRun(tab.id, () => window.__qkitStartAnnotation?.());
    toast('✏ Draw on the page · 📸 to capture with annotations · Esc to exit');
    window.close();
  });

  // Undo in page annotation context
  document.getElementById('ssUndoBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    // If annotation is active on the page, undo there
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: () => { if (typeof window._annotUndo === 'function') window._annotUndo(); },
      });
    } catch(_) {}
    // Also undo on popup canvas if that has content
    if (ctx && _snapshots.length) ctx.putImageData(_snapshots.pop(), 0, 0);
  });

  document.getElementById('ssClearAnnotBtn')?.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab?.id) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: 'MAIN',
        func: () => {
          if (window.__qkitAnnotationActive?.()) window.__qkitCloseAnnotation?.();
        },
      });
    } catch(_) {}
    setStatus('Annotations cleared');
  });

  // ── Save + Copy + Clear for full-page canvas captures ────────────────────
  // (Region captures now go through the in-page toast, not the canvas)

  // ── Auto-copy helper — called after every successful capture/save ─────────
  function autoCopyToClipboard(canvas) {
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
    }, 'image/png');
  }

  // ── Save — download as PNG + auto-copy to clipboard ──────────────────────
  ssSaveBtn?.addEventListener('click', async () => {
    if (!ssCanvas || !ctx) { setStatus('Nothing to save', true); return; }
    const blob = await new Promise(r => ssCanvas.toBlob(r, 'image/png'));
    if (!blob) { setStatus('Failed to create image', true); return; }

    // 1. Auto-copy to clipboard immediately
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch (_) { /* clipboard write may fail on some browsers — non-fatal */ }

    // 2. Save-as dialog (native file picker if available, else <a download>)
    if (window.showSaveFilePicker) {
      try {
        const fh = await window.showSaveFilePicker({
          suggestedName: 'qakit-screenshot-' + Date.now() + '.png',
          types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
        });
        const ws = await fh.createWritable();
        await ws.write(blob); await ws.close();
        toast('Saved + copied to clipboard ✓');
        return;
      } catch(e) {
        if (e.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = 'qakit-screenshot-' + Date.now() + '.png';
    a.click(); URL.revokeObjectURL(url);
    toast('Saved + copied to clipboard ✓');
  });

  // ── Copy — copy PNG to clipboard ─────────────────────────────────────────
  ssCopyBtn?.addEventListener('click', () => {
    if (!ssCanvas || !ctx) { setStatus('Nothing to copy', true); return; }
    ssCanvas.toBlob(blob => {
      if (!blob) return;
      try {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Copied to clipboard ✓');
      } catch(e) { setStatus('Copy failed: ' + e.message, true); }
    }, 'image/png');
  });

  // ── Clear all ─────────────────────────────────────────────────────────────
  ssClearBtn?.addEventListener('click', () => {
    if (ssCanvas) { ssCanvas.style.display = 'none'; ssCanvas.width = 1; ssCanvas.height = 1; }
    ctx = null; _snapshots = []; _hasCaptured = false;
    setStatus('Choose Full Page or Region capture. Use ✏ Annotate Page to draw on the live page first.');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // METADATA
  // ═══════════════════════════════════════════════════════════════════════════
  document.getElementById('metaRefreshBtn')?.addEventListener('click', loadMetadata);
  document.getElementById('metaRefreshBtn2')?.addEventListener('click', loadMetadata);

  // Last-loaded metadata payload — used by Copy + Export buttons
  let _lastMetadata = null;

  async function loadMetadata() {
    // Write to both metaContent (Page Kit sub-tab) and metaContent2 (standalone panel)
    const mc  = document.getElementById('metaContent');
    const mc2 = document.getElementById('metaContent2');
    const loading = '<div style="padding:12px;color:var(--muted);font-size:10px">Loading…</div>';
    if (mc)  mc.innerHTML  = loading;
    if (mc2) mc2.innerHTML = loading;
    const tab = await getActiveTab();
    if (!tab?.id) return;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const g = sel => { const e = document.querySelector(sel); return e ? (e.getAttribute('content') || e.getAttribute('href') || e.textContent) : null; };
          // Collect all OG and Twitter tags
          const og = {}, twitter = {};
          document.querySelectorAll('meta[property^="og:"]').forEach(m => {
            og[m.getAttribute('property').replace('og:', '')] = m.getAttribute('content') || '';
          });
          document.querySelectorAll('meta[name^="twitter:"]').forEach(m => {
            twitter[m.getAttribute('name').replace('twitter:', '')] = m.getAttribute('content') || '';
          });
          // JSON-LD blocks
          const jsonLd = [];
          document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
            try { jsonLd.push(JSON.parse(s.textContent)); } catch(_) {}
          });
          return {
            title: document.title, url: location.href,
            desc:  g('meta[name="description"]') || g('meta[property="og:description"]'),
            keywords: g('meta[name="keywords"]'),
            author:   g('meta[name="author"]'),
            ogTitle: g('meta[property="og:title"]'), ogImage: g('meta[property="og:image"]'), ogType: g('meta[property="og:type"]'),
            canonical: g('link[rel="canonical"]'), robots: g('meta[name="robots"]'),
            viewport: g('meta[name="viewport"]'), charset: document.characterSet, lang: document.documentElement.lang,
            h1s: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()).slice(0,5),
            links: document.querySelectorAll('a').length, images: document.querySelectorAll('img').length,
            scripts: document.querySelectorAll('script[src]').length,
            og, twitter, jsonLd,
            allMeta: [...document.querySelectorAll('meta')].map(m => ({
              name: m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv') || '',
              content: m.getAttribute('content') || ''
            })).filter(m => m.name).slice(0, 60),
          };
        },
      });
      const d = res?.[0]?.result;
      if (!d) {
        const err = '<div style="padding:12px;color:var(--warn);font-size:10px">Could not read metadata</div>';
        if (mc)  mc.innerHTML  = err;
        if (mc2) mc2.innerHTML = err;
        return;
      }
      _lastMetadata = d;
      // Enable copy/export buttons in both panels
      document.getElementById('metaCopyBtn')?.removeAttribute('disabled');
      document.getElementById('metaExportBtn')?.removeAttribute('disabled');
      document.getElementById('metaCopyBtn2')?.removeAttribute('disabled');
      document.getElementById('metaExportBtn2')?.removeAttribute('disabled');

      function mr(lbl, val, warn) {
        if (!val) return '';
        const len = String(val).length;
        const lt  = warn ? ' <span style="color:' + (len > warn ? 'var(--warn)' : 'var(--accent)') + '">(' + len + ')</span>' : '';
        return '<div class="meta-row"><span class="meta-label">' + lbl + '</span><span class="meta-val">' + String(val).slice(0,200) + lt + '</span></div>';
      }
      let h = '<div class="meta-section-title">📄 Core SEO</div>' +
        mr('Title', d.title, 60) + mr('Description', d.desc, 160) +
        mr('Keywords', d.keywords) + mr('Author', d.author) +
        mr('Canonical', d.canonical) + mr('Robots', d.robots) + mr('Charset', d.charset) +
        mr('Lang', d.lang) + mr('Viewport', d.viewport);
      // Open Graph — show full set
      const ogKeys = Object.keys(d.og || {});
      if (ogKeys.length) {
        h += '<div class="meta-section-title">🔗 Open Graph (' + ogKeys.length + ')</div>';
        ogKeys.forEach(k => { h += mr('og:' + k, d.og[k]); });
      }
      // Twitter
      const twKeys = Object.keys(d.twitter || {});
      if (twKeys.length) {
        h += '<div class="meta-section-title">🐦 Twitter (' + twKeys.length + ')</div>';
        twKeys.forEach(k => { h += mr('twitter:' + k, d.twitter[k]); });
      }
      if (d.h1s?.length) { h += '<div class="meta-section-title">📝 H1</div>'; d.h1s.forEach(v => { h += mr('H1', v); }); }
      if (d.jsonLd && d.jsonLd.length) {
        h += '<div class="meta-section-title">🔷 JSON-LD (' + d.jsonLd.length + ')</div>';
        d.jsonLd.forEach((item, i) => {
          const type = (item['@type'] || 'unknown');
          h += mr('#' + (i+1) + ' ' + type, JSON.stringify(item).slice(0, 80) + '…');
        });
      }
      h += '<div class="meta-section-title">📊 Stats</div>' + mr('Links', d.links) + mr('Images', d.images) + mr('Scripts', d.scripts);
      if (d.allMeta?.length) { h += '<div class="meta-section-title">🏷 All Meta</div>'; d.allMeta.forEach(m => { h += mr(m.name, m.content); }); }
      const finalHtml = h || '<div style="padding:12px;color:var(--muted);font-size:10px">No metadata found</div>';
      if (mc)  mc.innerHTML  = finalHtml;
      if (mc2) mc2.innerHTML = finalHtml;
    } catch(e) {
      const errHtml = '<div style="padding:12px;color:var(--warn);font-size:10px">Error: ' + e.message + '</div>';
      if (mc)  mc.innerHTML  = errHtml;
      if (mc2) mc2.innerHTML = errHtml;
    }
  }

  // ── Metadata Copy + Export (Fix 4) ─────────────────────────────────────
  function formatMetadataAsText(d) {
    if (!d) return '';
    const lines = [];
    const line = '═'.repeat(54);
    lines.push(line);
    lines.push('  Page Metadata');
    lines.push(line);
    lines.push('URL:         ' + (d.url || ''));
    lines.push('Title:       ' + (d.title || ''));
    lines.push('Description: ' + (d.desc || ''));
    lines.push('Canonical:   ' + (d.canonical || ''));
    lines.push('Keywords:    ' + (d.keywords || ''));
    lines.push('Author:      ' + (d.author || ''));
    lines.push('Robots:      ' + (d.robots || ''));
    lines.push('Lang:        ' + (d.lang || ''));
    lines.push('Charset:     ' + (d.charset || ''));
    lines.push('Viewport:    ' + (d.viewport || ''));
    const og = d.og || {};
    if (Object.keys(og).length) {
      lines.push('');
      lines.push('── Open Graph ──');
      Object.keys(og).forEach(k => lines.push('og:' + k.padEnd(12) + ' ' + og[k]));
    }
    const tw = d.twitter || {};
    if (Object.keys(tw).length) {
      lines.push('');
      lines.push('── Twitter ──');
      Object.keys(tw).forEach(k => lines.push('twitter:' + k.padEnd(10) + ' ' + tw[k]));
    }
    if (d.h1s && d.h1s.length) {
      lines.push('');
      lines.push('── H1 Tags ──');
      d.h1s.forEach(h => lines.push('  ' + h));
    }
    if (d.jsonLd && d.jsonLd.length) {
      lines.push('');
      lines.push('── JSON-LD (' + d.jsonLd.length + ') ──');
      d.jsonLd.forEach((item, i) => {
        lines.push('#' + (i + 1) + ' ' + (item['@type'] || 'unknown'));
        lines.push(JSON.stringify(item, null, 2));
      });
    }
    lines.push('');
    lines.push('── Stats ──');
    lines.push('Links:   ' + (d.links || 0));
    lines.push('Images:  ' + (d.images || 0));
    lines.push('Scripts: ' + (d.scripts || 0));
    return lines.join('\n');
  }

  // Copy/Export handlers for both Page Kit sub-tab and standalone panel-meta
  function wireCopyBtn(id) {
    document.getElementById(id)?.addEventListener('click', () => {
      if (!_lastMetadata) return;
      const text = formatMetadataAsText(_lastMetadata);
      navigator.clipboard?.writeText(text).then(() => {
        if (typeof showLsToast === 'function') showLsToast('Metadata copied ✓');
      }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      });
    });
  }
  wireCopyBtn('metaCopyBtn');
  wireCopyBtn('metaCopyBtn2');

  function wireExportBtn(btnId, menuId, formatAttr) {
    const exportBtn  = document.getElementById(btnId);
    const exportMenu = document.getElementById(menuId);
    exportBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (exportMenu) exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
    });
    exportMenu?.querySelectorAll('[' + formatAttr + ']').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!_lastMetadata) return;
        const fmt = item.getAttribute(formatAttr);
        let blob, filename;
        let domain = 'page';
        try { domain = new URL(_lastMetadata.url).hostname; } catch(_) {}
        if (fmt === 'json') {
          blob = new Blob([JSON.stringify(_lastMetadata, null, 2)], { type: 'application/json' });
          filename = 'metadata-' + domain + '-' + Date.now() + '.json';
        } else {
          blob = new Blob([formatMetadataAsText(_lastMetadata)], { type: 'text/plain' });
          filename = 'metadata-' + domain + '-' + Date.now() + '.txt';
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        if (exportMenu) exportMenu.style.display = 'none';
        if (typeof showLsToast === 'function') showLsToast('Metadata exported ✓');
      });
    });
  }
  wireExportBtn('metaExportBtn',  'metaExportMenu',  'data-meta-format');
  wireExportBtn('metaExportBtn2', 'metaExportMenu2', 'data-meta-format2');
  // Close menu on outside click
  document.addEventListener('click', () => {
    if (metaExportMenu) metaExportMenu.style.display = 'none';
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  loadViewports().then(renderViewportList);
};
