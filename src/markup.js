// QAKit Markup Editor
// Loads a screenshot from chrome.storage.session (one-shot id),
// renders it on a canvas, supports annotation tools, and saves via the
// background service worker (chrome.downloads.download with saveAs:true).
(() => {
  'use strict';

  // ── DOM refs ─────────────────────────────────────────────────────────
  const canvas      = document.getElementById('mkCanvas');
  const ctx         = canvas.getContext('2d');
  const wrap        = document.querySelector('.mk-canvas-wrap');
  const statusEl    = document.getElementById('mkStatus');
  const colorEl     = document.getElementById('mkColor');
  const sizeEl      = document.getElementById('mkSize');
  const sizeValEl   = document.getElementById('mkSizeVal');
  const textInput   = document.getElementById('mkTextInput');
  const undoBtn     = document.getElementById('mkUndo');
  const redoBtn     = document.getElementById('mkRedo');
  const copyBtn     = document.getElementById('mkCopy');
  const saveBtn     = document.getElementById('mkSave');
  const doneBtn     = document.getElementById('mkDone');
  const toolBtns    = document.querySelectorAll('.mk-tool');

  // ── State ────────────────────────────────────────────────────────────
  let baseImage = null;          // HTMLImageElement, the loaded screenshot
  let shapes    = [];            // committed shapes drawn on top of baseImage
  let history   = [];            // undo stack of operations: {kind:'shape'|'crop'|'move'|'delete', ...}
  let redoStack = [];
  let activeTool = 'pen';
  let drawing = false;
  let draftShape = null;
  let textCommit = null;         // pending text-input commit fn
  let prefix = 'qakit-screenshot';
  let storageKey = null;

  // Selection state
  let selectedIdx  = null;       // index into shapes[] or null
  let dragState    = null;       // { mode:'move'|'handle', handleIdx, startP, origShape }

  // Per-tool size defaults: size slider snaps to this when switching tools.
  // User can override by moving the slider; the overridden value is remembered
  // per-tool for the session.
  const toolSizeDefaults = { pen:3, rect:3, arrow:3, highlight:3, blur:1, number:3, text:3, crop:1, select:1 };
  let prevTool = null;

  const HIGHLIGHT_ALPHA = 0.35;
  const HANDLE_R = 5;            // resize handle radius (canvas px)

  // ── Status helper ────────────────────────────────────────────────────
  let statusTimer = null;
  function showStatus(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove('show'), 1600);
  }

  // ── Tool selection ───────────────────────────────────────────────────
  function setTool(tool) {
    // Save current slider value back to the tool we're leaving.
    if (prevTool) toolSizeDefaults[prevTool] = parseInt(sizeEl.value, 10);
    prevTool = tool;

    // Deselect when switching away from select tool.
    if (tool !== 'select' && selectedIdx !== null) {
      selectedIdx = null;
      render();
    }

    activeTool = tool;
    toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    wrap.classList.remove('tool-select','tool-pen','tool-rect','tool-arrow','tool-highlight','tool-blur','tool-number','tool-text','tool-crop');
    wrap.classList.add('tool-' + tool);

    // Load the per-tool default size.
    const def = toolSizeDefaults[tool] ?? 3;
    sizeEl.value = def;
    sizeValEl.textContent = def;
  }
  toolBtns.forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));

  // ── Size input live label ────────────────────────────────────────────
  sizeEl.addEventListener('input', () => { sizeValEl.textContent = sizeEl.value; });

  // ── Load screenshot from background service worker ──────────────────
  async function loadFromStorage() {
    const params = new URLSearchParams(location.search);
    storageKey = params.get('id');
    if (!storageKey) {
      showStatus('No screenshot id provided');
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({ action: 'FETCH_MARKUP_IMAGE', id: storageKey });
      if (!res || !res.ok || !res.entry || !res.entry.dataUrl) {
        showStatus('Screenshot not found (may have expired)');
        return;
      }
      const entry = res.entry;
      prefix = entry.prefix || prefix;

      const img = new Image();
      img.onload = () => {
        baseImage = img;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        render();
        document.title = `QAKit Markup — ${img.naturalWidth}×${img.naturalHeight}`;
        showStatus('Loaded');
      };
      img.onerror = () => showStatus('Failed to load image');
      img.src = entry.dataUrl;
    } catch (e) {
      console.error('[QAKit Markup] load failed:', e);
      showStatus('Load error: ' + e.message);
    }
  }

  // ── Render: base image + all committed shapes + draft + selection ─────
  function render() {
    if (!baseImage) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseImage, 0, 0);
    for (let i = 0; i < shapes.length; i++) {
      drawShape(shapes[i]);
      if (i === selectedIdx) drawSelection(shapes[i]);
    }
    if (draftShape) drawShape(draftShape);
  }

  function drawShape(s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;

    if (s.type === 'pen' || s.type === 'highlight') {
      if (s.type === 'highlight') {
        ctx.globalAlpha = HIGHLIGHT_ALPHA;
        ctx.lineWidth = Math.max(s.size * 4, 8);
      }
      const pts = s.points;
      if (pts.length < 2) {
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (s.type === 'rect') {
      const { x, y, w, h } = s;
      ctx.strokeRect(x, y, w, h);
    } else if (s.type === 'arrow') {
      drawArrow(s.x1, s.y1, s.x2, s.y2, s.size);
    } else if (s.type === 'text') {
      const fontSize = Math.max(14, s.size * 5);
      ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(s.text, s.x, s.y);
    } else if (s.type === 'blur') {
      drawBlurRegion(s.x, s.y, s.w, s.h, s.size);
    } else if (s.type === 'number') {
      drawNumberMarker(s.x, s.y, s.n, s.color, s.size);
    }
    ctx.restore();
  }

  function drawArrow(x1, y1, x2, y2, size) {
    const headLen = Math.max(12, size * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }

  // Blur region — pixelate by downscaling and re-upscaling a slice of the
  // canvas. Done by reading from the *base image* (not the live ctx, which
  // would also include other annotations and create feedback artifacts).
  function drawBlurRegion(x, y, w, h, size) {
    if (!baseImage || w < 1 || h < 1) return;
    // Hybrid redaction:
    //   size 1–10  → gaussian blur, +0.5px per step (1 → 1px, 10 → 5.5px)
    //   size 11–20 → mosaic pixelation, +0.5px per step (11 → 1px, 20 → 5.5px)
    if (size <= 10) {
      const radius = 1 + (size - 1) * 0.5;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const offCtx = off.getContext('2d');
      offCtx.filter = `blur(${radius}px)`;
      offCtx.drawImage(baseImage, x, y, w, h, 0, 0, w, h);

      const prevFilter = ctx.filter;
      ctx.filter = 'none';
      ctx.drawImage(off, x, y);
      ctx.filter = prevFilter;
    } else {
      const block = Math.max(1, 1 + (size - 11) * 0.5);
      const downW = Math.max(1, Math.round(w / block));
      const downH = Math.max(1, Math.round(h / block));

      const off = document.createElement('canvas');
      off.width = downW; off.height = downH;
      const offCtx = off.getContext('2d');
      offCtx.imageSmoothingEnabled = true;
      offCtx.drawImage(baseImage, x, y, w, h, 0, 0, downW, downH);

      const prevSmooth = ctx.imageSmoothingEnabled;
      const prevFilter = ctx.filter;
      ctx.filter = 'none';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, downW, downH, x, y, w, h);
      ctx.imageSmoothingEnabled = prevSmooth;
      ctx.filter = prevFilter;
    }
  }

  // Numbered step marker — filled circle with white digit, useful for
  // step-by-step bug repros.
  function drawNumberMarker(x, y, n, color, size) {
    const r = Math.max(14, size * 5);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${Math.round(r * 1.1)}px -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 1);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // Compute the next step number based on existing number shapes.
  function nextNumber() {
    let max = 0;
    for (const s of shapes) if (s.type === 'number' && s.n > max) max = s.n;
    return max + 1;
  }

  // ── Mouse / coordinate helpers ───────────────────────────────────────
  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (ev.clientX - rect.left) * sx,
      y: (ev.clientY - rect.top) * sy,
    };
  }

  // ── Move / resize helpers ────────────────────────────────────────────
  function applyMove(s, orig, dx, dy) {
    if (s.type === 'rect' || s.type === 'blur') {
      s.x = orig.x + dx; s.y = orig.y + dy;
    } else if (s.type === 'text') {
      s.x = orig.x + dx; s.y = orig.y + dy;
    } else if (s.type === 'arrow') {
      s.x1 = orig.x1 + dx; s.y1 = orig.y1 + dy;
      s.x2 = orig.x2 + dx; s.y2 = orig.y2 + dy;
    } else if (s.type === 'number') {
      s.x = orig.x + dx; s.y = orig.y + dy;
    } else if (s.type === 'pen' || s.type === 'highlight') {
      s.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    }
  }

  function applyResize(s, orig, handleIdx, dx, dy) {
    if (s.type === 'rect' || s.type === 'blur') {
      resizeBox(s, orig, handleIdx, dx, dy);
    } else if (s.type === 'text') {
      resizeBox(s, orig, handleIdx, dx, dy);
    } else if (s.type === 'arrow') {
      if (handleIdx === 'p1') { s.x1 = orig.x1 + dx; s.y1 = orig.y1 + dy; }
      else                    { s.x2 = orig.x2 + dx; s.y2 = orig.y2 + dy; }
    }
  }

  // Resize a bounding-box shape using one of 8 handles (0=NW, 1=N, 2=NE, 3=E, 4=SE, 5=S, 6=SW, 7=W).
  function resizeBox(s, orig, hi, dx, dy) {
    let { x, y, w, h } = orig;
    const r = x + w, b = y + h;
    // Which edges move?
    const movesL = (hi === 0 || hi === 6 || hi === 7);
    const movesR = (hi === 2 || hi === 3 || hi === 4);
    const movesT = (hi === 0 || hi === 1 || hi === 2);
    const movesB = (hi === 4 || hi === 5 || hi === 6);

    const newL = movesL ? x + dx : x;
    const newT = movesT ? y + dy : y;
    const newR = movesR ? r + dx : r;
    const newB = movesB ? b + dy : b;

    s.x = Math.min(newL, newR);
    s.y = Math.min(newT, newB);
    s.w = Math.abs(newR - newL);
    s.h = Math.abs(newB - newT);
  }

  // ── Selection rendering ──────────────────────────────────────────────
  // Called from render() after all shapes are drawn.
  function drawSelection(s) {
    if (!s) return;
    const canvasScale = canvas.width / canvas.getBoundingClientRect().width;
    const hr = HANDLE_R; // handle radius in canvas px

    ctx.save();
    ctx.strokeStyle = '#00e5a0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    if (s.type === 'rect' || s.type === 'blur' || s.type === 'highlight') {
      const { x, y, w, h } = shapeBounds(s);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      drawHandles(x, y, w, h, hr);
    } else if (s.type === 'text') {
      const { x, y, w, h } = shapeBounds(s);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
      drawHandles(x, y, w, h, hr);
    } else if (s.type === 'arrow') {
      // Highlight line + endpoint handles
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      ctx.setLineDash([]);
      drawCircleHandle(s.x1, s.y1, hr);
      drawCircleHandle(s.x2, s.y2, hr);
    } else if (s.type === 'number') {
      const r = Math.max(14, s.size * 5) + 6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'pen') {
      // Bounding box for pen
      const { x, y, w, h } = shapeBounds(s);
      ctx.strokeRect(x - 4, y - 4, w + 8, h + 8);
    }

    ctx.restore();
  }

  function drawHandles(x, y, w, h, r) {
    // 8 handles: corners + edge midpoints
    const pts = [
      { x, y }, { x: x + w/2, y }, { x: x + w, y },
      { x: x + w, y: y + h/2 },
      { x: x + w, y: y + h }, { x: x + w/2, y: y + h }, { x, y: y + h },
      { x, y: y + h/2 },
    ];
    ctx.setLineDash([]);
    for (const p of pts) drawCircleHandle(p.x, p.y, r);
  }

  function drawCircleHandle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#00e5a0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Hit testing ──────────────────────────────────────────────────────
  const HIT_SLOP = 8; // px in canvas-space for line/point hit

  function shapeBounds(s) {
    if (s.type === 'rect' || s.type === 'blur') {
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    } else if (s.type === 'highlight') {
      const pts = s.points;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const lw = Math.max(s.size * 4, 8);
      return { x: minX - lw/2, y: minY - lw/2, w: maxX - minX + lw, h: maxY - minY + lw };
    } else if (s.type === 'text') {
      const fontSize = Math.max(14, s.size * 5);
      ctx.save();
      ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
      const metrics = ctx.measureText(s.text);
      ctx.restore();
      return { x: s.x, y: s.y, w: metrics.width, h: fontSize };
    } else if (s.type === 'pen') {
      const pts = s.points;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      return { x: minX - s.size/2, y: minY - s.size/2, w: maxX - minX + s.size, h: maxY - minY + s.size };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function ptInRect(px, py, x, y, w, h, slop = 0) {
    return px >= x - slop && px <= x + w + slop && py >= y - slop && py <= y + h + slop;
  }

  function ptNearSegment(px, py, x1, y1, x2, y2, slop) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1) <= slop;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= slop;
  }

  function hitShape(s, px, py) {
    const slop = HIT_SLOP;
    if (s.type === 'rect' || s.type === 'blur') {
      return ptInRect(px, py, s.x, s.y, s.w, s.h, slop);
    } else if (s.type === 'highlight') {
      const b = shapeBounds(s);
      return ptInRect(px, py, b.x, b.y, b.w, b.h, slop);
    } else if (s.type === 'text') {
      const b = shapeBounds(s);
      return ptInRect(px, py, b.x, b.y, b.w, b.h, slop);
    } else if (s.type === 'pen') {
      const pts = s.points;
      for (let i = 0; i < pts.length - 1; i++) {
        if (ptNearSegment(px, py, pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y, slop)) return true;
      }
      return false;
    } else if (s.type === 'arrow') {
      return ptNearSegment(px, py, s.x1, s.y1, s.x2, s.y2, slop);
    } else if (s.type === 'number') {
      const r = Math.max(14, s.size * 5) + slop;
      return Math.hypot(px - s.x, py - s.y) <= r;
    }
    return false;
  }

  // Returns { handleIdx: 0-7 } for 8-handle shapes, { handleIdx: 'p1'|'p2' } for arrows,
  // or null if no handle hit.
  function hitHandle(s, px, py) {
    const r = HANDLE_R + 3; // slightly larger hit area
    if (s.type === 'rect' || s.type === 'blur' || s.type === 'text') {
      const { x, y, w, h } = shapeBounds(s);
      const pts = [
        { x, y }, { x: x + w/2, y }, { x: x + w, y },
        { x: x + w, y: y + h/2 },
        { x: x + w, y: y + h }, { x: x + w/2, y: y + h }, { x, y: y + h },
        { x, y: y + h/2 },
      ];
      for (let i = 0; i < pts.length; i++) {
        if (Math.hypot(px - pts[i].x, py - pts[i].y) <= r) return { handleIdx: i };
      }
    } else if (s.type === 'arrow') {
      if (Math.hypot(px - s.x1, py - s.y1) <= r) return { handleIdx: 'p1' };
      if (Math.hypot(px - s.x2, py - s.y2) <= r) return { handleIdx: 'p2' };
    }
    return null;
  }

  // Cursor name for a given handle index on an 8-handle shape.
  const HANDLE_CURSORS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  // ── Drawing handlers ─────────────────────────────────────────────────
  canvas.addEventListener('mousedown', (ev) => {
    if (!baseImage) return;
    if (ev.button !== 0) return;

    // If a text-input is open, commit it first
    if (textCommit) { textCommit(); }

    const p = canvasPoint(ev);
    const color = colorEl.value;
    const size  = parseInt(sizeEl.value, 10);

    // ── Select tool ──
    if (activeTool === 'select') {
      // Check if clicking a handle of the currently selected shape first
      if (selectedIdx !== null) {
        const sel = shapes[selectedIdx];
        const hh = hitHandle(sel, p.x, p.y);
        if (hh !== null) {
          dragState = { mode: 'handle', handleIdx: hh.handleIdx, startP: p, origShape: JSON.parse(JSON.stringify(sel)) };
          return;
        }
      }
      // Hit-test shapes top-to-bottom (last drawn = topmost)
      let found = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitShape(shapes[i], p.x, p.y)) { found = i; break; }
      }
      if (found !== null) {
        selectedIdx = found;
        dragState = { mode: 'move', startP: p, origShape: JSON.parse(JSON.stringify(shapes[found])) };
      } else {
        selectedIdx = null;
        dragState = null;
      }
      render();
      return;
    }

    if (activeTool === 'pen' || activeTool === 'highlight') {
      drawing = true;
      draftShape = { type: activeTool, color, size, points: [p] };
    } else if (activeTool === 'rect') {
      drawing = true;
      draftShape = { type: 'rect', color, size, x: p.x, y: p.y, w: 0, h: 0, _start: p };
    } else if (activeTool === 'arrow') {
      drawing = true;
      draftShape = { type: 'arrow', color, size, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    } else if (activeTool === 'blur') {
      drawing = true;
      draftShape = { type: 'blur', color, size, x: p.x, y: p.y, w: 0, h: 0, _start: p };
    } else if (activeTool === 'number') {
      // Single-click placement — no drag.
      const n = nextNumber();
      commitShape({ type: 'number', color, size, x: p.x, y: p.y, n });
      render();
    } else if (activeTool === 'crop') {
      drawing = true;
      draftShape = { type: '_crop', color: '#00e5a0', size: 1, x: p.x, y: p.y, w: 0, h: 0, _start: p };
    } else if (activeTool === 'text') {
      openTextInput(ev.clientX, ev.clientY, p, color, size);
    }
  });

  canvas.addEventListener('mousemove', (ev) => {
    const p = canvasPoint(ev);

    // ── Select tool: drag move or resize ──
    if (activeTool === 'select') {
      if (dragState) {
        const dx = p.x - dragState.startP.x;
        const dy = p.y - dragState.startP.y;
        const s  = shapes[selectedIdx];
        const o  = dragState.origShape;
        if (dragState.mode === 'move') {
          applyMove(s, o, dx, dy);
        } else {
          applyResize(s, o, dragState.handleIdx, dx, dy);
        }
        render();
      } else {
        // Update cursor based on what's under the mouse
        let cursorClass = '';
        if (selectedIdx !== null) {
          const hh = hitHandle(shapes[selectedIdx], p.x, p.y);
          if (hh !== null) {
            if (typeof hh.handleIdx === 'number') {
              cursorClass = 'cursor-resize-' + HANDLE_CURSORS[hh.handleIdx];
            } else {
              cursorClass = 'cursor-move';
            }
          } else if (hitShape(shapes[selectedIdx], p.x, p.y)) {
            cursorClass = 'cursor-move';
          }
        }
        // Remove all cursor classes then add the new one
        wrap.classList.remove('cursor-move','cursor-resize-nw','cursor-resize-n','cursor-resize-ne',
          'cursor-resize-e','cursor-resize-se','cursor-resize-s','cursor-resize-sw','cursor-resize-w');
        if (cursorClass) wrap.classList.add(cursorClass);
      }
      return;
    }

    if (!drawing || !draftShape) return;
    if (draftShape.type === 'pen' || draftShape.type === 'highlight') {
      draftShape.points.push(p);
    } else if (draftShape.type === 'rect' || draftShape.type === '_crop' || draftShape.type === 'blur') {
      const s = draftShape._start;
      draftShape.x = Math.min(s.x, p.x);
      draftShape.y = Math.min(s.y, p.y);
      draftShape.w = Math.abs(p.x - s.x);
      draftShape.h = Math.abs(p.y - s.y);
    } else if (draftShape.type === 'arrow') {
      draftShape.x2 = p.x;
      draftShape.y2 = p.y;
    }
    render();
    if (draftShape.type === '_crop') drawCropOverlay(draftShape);
  });

  canvas.addEventListener('mouseup', () => {
    // ── Select tool: commit move/resize ──
    if (activeTool === 'select' && dragState) {
      const s = shapes[selectedIdx];
      const origShape = dragState.origShape;
      // Only record history if something actually moved
      const changed = JSON.stringify(s) !== JSON.stringify(origShape);
      if (changed) {
        history.push({ kind: 'move', idx: selectedIdx, oldShape: origShape, newShape: JSON.parse(JSON.stringify(s)) });
        redoStack = [];
        updateUndoRedo();
      }
      dragState = null;
      render();
      return;
    }

    if (!drawing || !draftShape) return;
    drawing = false;

    if (draftShape.type === '_crop') {
      const { x, y, w, h } = draftShape;
      draftShape = null;
      if (w > 4 && h > 4) applyCrop(x, y, w, h);
      render();
      return;
    }

    // Discard zero-size rects/arrows
    if (draftShape.type === 'rect' && (draftShape.w < 2 || draftShape.h < 2)) {
      draftShape = null; render(); return;
    }
    if (draftShape.type === 'blur' && (draftShape.w < 4 || draftShape.h < 4)) {
      draftShape = null; render(); return;
    }
    if (draftShape.type === 'arrow') {
      const dx = draftShape.x2 - draftShape.x1;
      const dy = draftShape.y2 - draftShape.y1;
      if (Math.hypot(dx, dy) < 4) { draftShape = null; render(); return; }
    }

    commitShape(draftShape);
    draftShape = null;
    render();
  });

  function commitShape(s) {
    // Strip private fields
    const clean = { ...s };
    delete clean._start;
    shapes.push(clean);
    history.push({ kind: 'shape', shape: clean });
    redoStack = [];
    updateUndoRedo();
  }

  // ── Crop overlay (visual only during drag) ───────────────────────────
  function drawCropOverlay(c) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    // Dim outside the crop region
    ctx.fillRect(0, 0, canvas.width, c.y);
    ctx.fillRect(0, c.y + c.h, canvas.width, canvas.height - (c.y + c.h));
    ctx.fillRect(0, c.y, c.x, c.h);
    ctx.fillRect(c.x + c.w, c.y, canvas.width - (c.x + c.w), c.h);
    // Border
    ctx.strokeStyle = '#00e5a0';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.restore();
  }

  function applyCrop(x, y, w, h) {
    // Render the current full image+annotations, then crop into a fresh base
    render();
    const cropped = ctx.getImageData(x, y, w, h);
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    off.getContext('2d').putImageData(cropped, 0, 0);

    // Snapshot pre-crop state so the operation can be undone.
    const snapshot = {
      kind: 'crop',
      prevBase: baseImage,
      prevW: canvas.width,
      prevH: canvas.height,
      prevShapes: shapes.slice(),
    };

    const newImg = new Image();
    newImg.onload = () => {
      baseImage = newImg;
      canvas.width = w;
      canvas.height = h;
      shapes = [];           // cropping bakes annotations into the base
      history.push(snapshot);
      redoStack = [];
      updateUndoRedo();
      render();
      showStatus(`Cropped to ${w}×${h}`);
    };
    newImg.src = off.toDataURL('image/png');
  }

  // ── Text input overlay ───────────────────────────────────────────────
  function openTextInput(clientX, clientY, canvasPos, color, size) {
    // Position relative to .mk-canvas-wrap (its `position:relative` is the
    // absolute-positioning context). Add the wrap's scroll offsets so the
    // input lands on the actual click point even when the canvas is scrolled.
    const wrapRect = wrap.getBoundingClientRect();
    textInput.style.display = 'block';
    textInput.style.left = (clientX - wrapRect.left + wrap.scrollLeft) + 'px';
    textInput.style.top  = (clientY - wrapRect.top  + wrap.scrollTop)  + 'px';
    textInput.style.color = color;
    textInput.style.fontSize = Math.max(14, size * 5) + 'px';
    textInput.value = '';
    // Focus on next tick — focusing synchronously inside the canvas mousedown
    // can race with the browser's own focus management on some platforms.
    setTimeout(() => textInput.focus(), 0);

    const commit = () => {
      const text = textInput.value;
      textInput.style.display = 'none';
      textInput.removeEventListener('keydown', onKey);
      textInput.removeEventListener('blur', commit);
      textCommit = null;
      if (text && text.trim()) {
        commitShape({ type: 'text', color, size, x: canvasPos.x, y: canvasPos.y, text });
        render();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') {
        textInput.value = ''; commit();
      }
    };
    textInput.addEventListener('keydown', onKey);
    textInput.addEventListener('blur', commit);
    textCommit = commit;
  }

  // ── Undo / Redo ──────────────────────────────────────────────────────
  function undo() {
    if (!history.length) return;
    const op = history.pop();
    if (op.kind === 'shape') {
      const idx = shapes.lastIndexOf(op.shape);
      if (idx !== -1) shapes.splice(idx, 1);
      if (selectedIdx !== null && selectedIdx >= shapes.length) selectedIdx = null;
    } else if (op.kind === 'move') {
      Object.assign(shapes[op.idx], op.oldShape);
    } else if (op.kind === 'delete') {
      shapes.splice(op.idx, 0, op.shape);
    } else if (op.kind === 'crop') {
      const current = {
        kind: 'crop',
        prevBase: baseImage, prevW: canvas.width, prevH: canvas.height, prevShapes: shapes.slice(),
      };
      baseImage = op.prevBase; canvas.width = op.prevW; canvas.height = op.prevH;
      shapes = op.prevShapes.slice(); selectedIdx = null;
      redoStack.push(current);
      updateUndoRedo(); render(); return;
    }
    redoStack.push(op);
    updateUndoRedo(); render();
  }

  function redo() {
    if (!redoStack.length) return;
    const op = redoStack.pop();
    if (op.kind === 'shape') {
      shapes.push(op.shape);
      history.push(op);
    } else if (op.kind === 'move') {
      Object.assign(shapes[op.idx], op.newShape);
      history.push(op);
    } else if (op.kind === 'delete') {
      shapes.splice(op.idx, 1);
      if (selectedIdx !== null && selectedIdx >= shapes.length) selectedIdx = null;
      history.push(op);
    } else if (op.kind === 'crop') {
      const undoEntry = {
        kind: 'crop',
        prevBase: baseImage, prevW: canvas.width, prevH: canvas.height, prevShapes: shapes.slice(),
      };
      baseImage = op.prevBase; canvas.width = op.prevW; canvas.height = op.prevH;
      shapes = op.prevShapes.slice(); selectedIdx = null;
      history.push(undoEntry);
    }
    updateUndoRedo(); render();
  }
  function updateUndoRedo() {
    undoBtn.disabled = history.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // ── Save / Copy / Done ───────────────────────────────────────────────
  function exportDataUrl() {
    // Temporarily clear draft and selection so they don't appear in the export.
    const stashDraft = draftShape; draftShape = null;
    const stashSel   = selectedIdx; selectedIdx = null;
    render();
    const url = canvas.toDataURL('image/png');
    draftShape   = stashDraft;
    selectedIdx  = stashSel;
    if (draftShape || selectedIdx !== null) render();
    return url;
  }

  saveBtn.addEventListener('click', () => {
    const dataUrl = exportDataUrl();
    showStatus('Save dialog opening…');
    chrome.runtime.sendMessage(
      { action: 'SAVE_SCREENSHOT', dataUrl, prefix: prefix + '-markup' },
      (resp) => {
        // Close the markup tab once the background has acknowledged the
        // download initiation. Brief delay so the OS Save dialog has time
        // to attach to the parent window before this tab disappears.
        if (resp && resp.ok) {
          setTimeout(() => window.close(), 250);
        }
      }
    );
  });

  copyBtn.addEventListener('click', async () => {
    try {
      // Render without draft, grab blob from canvas
      const stash = draftShape; draftShape = null; render();
      canvas.toBlob(async (blob) => {
        if (draftShape !== stash) { draftShape = stash; render(); }
        if (!blob) { showStatus('Copy failed'); return; }
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showStatus('Copied to clipboard');
        } catch (e) {
          showStatus('Clipboard blocked');
        }
      }, 'image/png');
    } catch (e) {
      showStatus('Copy error');
    }
  });

  doneBtn.addEventListener('click', () => {
    window.close();
  });

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Skip when typing in the text-input overlay
    if (document.activeElement === textInput) return;

    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); undo(); return;
    }
    if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault(); redo(); return;
    }
    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault(); saveBtn.click(); return;
    }

    // Tool shortcuts (single keys, only when no modifier)
    if (meta || e.altKey) return;

    // Delete / Backspace — remove selected shape
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIdx !== null) {
      const idx = selectedIdx;
      const shape = shapes[idx];
      shapes.splice(idx, 1);
      history.push({ kind: 'delete', idx, shape });
      redoStack = [];
      selectedIdx = null;
      updateUndoRedo(); render(); return;
    }

    // Escape — deselect
    if (e.key === 'Escape' && selectedIdx !== null) {
      selectedIdx = null; render(); return;
    }

    const map = { v:'select', p:'pen', r:'rect', a:'arrow', h:'highlight', b:'blur', n:'number', t:'text', c:'crop' };
    const k = e.key.toLowerCase();
    if (map[k]) { setTool(map[k]); }
  });

  // ── Init ─────────────────────────────────────────────────────────────
  setTool('pen');
  updateUndoRedo();
  loadFromStorage();
})();
