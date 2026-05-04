// utils.js — QAKit: JWT Decoder/Encoder, URL Encoder/Decoder, Base64

window.initUtils = function () {

  // ── JSON Viewer + Text Compare launchers ─────────────────────────────────
  document.getElementById('openJsonDiffBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('json-diff-tool.html') });
  });
  document.getElementById('openTextCompareBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('text-compare.html') });
  });

  // ── Shared copy helper ────────────────────────────────────────────────────
  function copyText(text, btn) {
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    });
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied'; btn.style.color = 'var(--accent)';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1400);
    }
  }

  function showErr(el, msg) {
    el.innerHTML = '<span style="color:var(--warn);font-size:9px">' + msg + '</span>';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // JWT Decoder / Encoder
  // ══════════════════════════════════════════════════════════════════════════
  function b64urlDecode(str) {
    try {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      return atob(str);
    } catch { return null; }
  }

  function b64urlEncode(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function decodeJWT(token) {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    const header  = b64urlDecode(parts[0]);
    const payload = b64urlDecode(parts[1]);
    if (!header || !payload) return null;
    try {
      return {
        header:    JSON.parse(header),
        payload:   JSON.parse(payload),
        signature: parts[2],
        raw:       { header: parts[0], payload: parts[1], sig: parts[2] },
      };
    } catch { return null; }
  }

  function encodeJWT(headerStr, payloadStr) {
    try {
      JSON.parse(headerStr);
      JSON.parse(payloadStr);
    } catch { return null; }
    const h = b64urlEncode(headerStr);
    const p = b64urlEncode(payloadStr);
    return h + '.' + p + '.UNSIGNED';
  }

  function jwtSectionHtml(label, obj, color) {
    return '<div style="margin-bottom:8px">' +
      '<div style="font-size:9px;font-weight:700;color:' + color + ';margin-bottom:3px;letter-spacing:.04em">' + label + '</div>' +
      '<pre style="background:var(--card);border:1px solid var(--border);border-radius:5px;padding:8px;font-size:9.5px;overflow-x:auto;color:var(--text);white-space:pre-wrap;word-break:break-all">' +
        JSON.stringify(obj, null, 2) +
      '</pre></div>';
  }

  function renderJWTExpiry(payload) {
    if (!payload.exp) return '';
    const exp = new Date(payload.exp * 1000);
    const now = new Date();
    const expired = exp < now;
    const diff    = Math.abs(exp - now);
    const mins    = Math.floor(diff / 60000);
    const hrs     = Math.floor(mins / 60);
    const days    = Math.floor(hrs / 24);
    const label   = expired ? 'Expired ' : 'Expires in ';
    const when    = days  ? days  + 'd '  + (hrs % 24)  + 'h' :
                    hrs   ? hrs   + 'h '  + (mins % 60) + 'm' :
                            mins  + 'm';
    return '<div style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:4px;' +
      'background:' + (expired ? 'var(--warn-light)' : 'var(--accent-light)') + ';' +
      'border:1px solid ' + (expired ? 'var(--warn)' : 'var(--accent)') + ';' +
      'color:' + (expired ? 'var(--warn)' : 'var(--accent)') + ';font-size:9px;margin-bottom:8px">' +
      (expired ? '⚠' : '✓') + ' ' + label + when + ' · ' + exp.toLocaleString() +
      '</div>';
  }

  const jwtInput     = document.getElementById('jwtInput');
  const jwtDecodeOut = document.getElementById('jwtDecodeOut');
  const jwtDecodeBtn = document.getElementById('jwtDecodeBtn');
  const jwtCopyBtn   = document.getElementById('jwtCopyBtn');
  const jwtHdrInput  = document.getElementById('jwtHdrInput');
  const jwtPayInput  = document.getElementById('jwtPayInput');
  const jwtEncodeBtn = document.getElementById('jwtEncodeBtn');
  const jwtEncodeOut = document.getElementById('jwtEncodeOut');
  const jwtEnCopyBtn = document.getElementById('jwtEnCopyBtn');

  jwtDecodeBtn?.addEventListener('click', () => {
    const token = jwtInput.value.trim();
    if (!token) { showErr(jwtDecodeOut, 'Paste a JWT token above'); return; }
    const r = decodeJWT(token);
    if (!r) { showErr(jwtDecodeOut, 'Invalid JWT — must have 3 dot-separated base64url parts'); return; }
    jwtDecodeOut.innerHTML =
      renderJWTExpiry(r.payload) +
      jwtSectionHtml('HEADER', r.header, '#0ea5e9') +
      jwtSectionHtml('PAYLOAD', r.payload, 'var(--accent)') +
      '<div style="font-size:9px;font-weight:700;color:var(--muted);margin-bottom:3px">SIGNATURE</div>' +
      '<pre style="background:var(--card);border:1px solid var(--border);border-radius:5px;padding:8px;font-size:9px;color:var(--muted);word-break:break-all;white-space:pre-wrap">' + r.signature + '</pre>';
  });

  jwtCopyBtn?.addEventListener('click', () => {
    const token = jwtInput.value.trim();
    const r = decodeJWT(token);
    if (r) copyText(JSON.stringify({ header: r.header, payload: r.payload }, null, 2), jwtCopyBtn);
  });

  jwtEncodeBtn?.addEventListener('click', () => {
    const h = jwtHdrInput.value.trim() || '{"alg":"HS256","typ":"JWT"}';
    const p = jwtPayInput.value.trim();
    if (!p) { showErr(jwtEncodeOut, 'Enter payload JSON'); return; }
    const token = encodeJWT(h, p);
    if (!token) { showErr(jwtEncodeOut, 'Invalid JSON in header or payload'); return; }
    jwtEncodeOut.innerHTML =
      '<div style="font-size:9px;color:var(--muted);margin-bottom:4px">⚠ Signature is UNSIGNED — for testing only</div>' +
      '<pre style="background:var(--card);border:1px solid var(--border);border-radius:5px;padding:8px;font-size:9px;color:var(--text);word-break:break-all;white-space:pre-wrap">' + token + '</pre>';
  });

  jwtEnCopyBtn?.addEventListener('click', () => {
    const h = jwtHdrInput.value.trim() || '{"alg":"HS256","typ":"JWT"}';
    const p = jwtPayInput.value.trim();
    const t = encodeJWT(h, p);
    if (t) copyText(t, jwtEnCopyBtn);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // URL Encoder / Decoder
  // ══════════════════════════════════════════════════════════════════════════
  const urlInput      = document.getElementById('urlInput');
  const urlEncodeBtn  = document.getElementById('urlEncodeBtn');
  const urlDecodeBtn  = document.getElementById('urlDecodeBtn');
  const urlFullEncBtn = document.getElementById('urlFullEncBtn');
  const urlOutput     = document.getElementById('urlOutput');
  const urlCopyBtn    = document.getElementById('urlCopyBtn');

  urlEncodeBtn?.addEventListener('click', () => {
    try { urlOutput.value = encodeURIComponent(urlInput.value); }
    catch (e) { urlOutput.value = 'Error: ' + e.message; }
  });

  urlDecodeBtn?.addEventListener('click', () => {
    try { urlOutput.value = decodeURIComponent(urlInput.value); }
    catch (e) {
      try { urlOutput.value = decodeURIComponent(urlInput.value.replace(/\+/g, ' ')); }
      catch { urlOutput.value = 'Error: invalid URL encoding'; }
    }
  });

  urlFullEncBtn?.addEventListener('click', () => {
    try { urlOutput.value = encodeURI(urlInput.value); }
    catch (e) { urlOutput.value = 'Error: ' + e.message; }
  });

  urlCopyBtn?.addEventListener('click', () => copyText(urlOutput.value, urlCopyBtn));

  // ══════════════════════════════════════════════════════════════════════════
  // Base64 Encoder / Decoder
  // ══════════════════════════════════════════════════════════════════════════
  const b64Input     = document.getElementById('b64Input');
  const b64EncodeBtn = document.getElementById('b64EncodeBtn');
  const b64DecodeBtn = document.getElementById('b64DecodeBtn');
  const b64UrlEncBtn = document.getElementById('b64UrlEncBtn');
  const b64Output    = document.getElementById('b64Output');
  const b64CopyBtn   = document.getElementById('b64CopyBtn');

  b64EncodeBtn?.addEventListener('click', () => {
    try { b64Output.value = btoa(unescape(encodeURIComponent(b64Input.value))); }
    catch (e) { b64Output.value = 'Error: ' + e.message; }
  });

  b64DecodeBtn?.addEventListener('click', () => {
    try {
      const decoded = atob(b64Input.value.replace(/\s/g, ''));
      b64Output.value = decodeURIComponent(escape(decoded));
    } catch (e) { b64Output.value = 'Error: invalid Base64 input'; }
  });

  b64UrlEncBtn?.addEventListener('click', () => {
    try {
      b64Output.value = btoa(unescape(encodeURIComponent(b64Input.value)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    } catch (e) { b64Output.value = 'Error: ' + e.message; }
  });

  b64CopyBtn?.addEventListener('click', () => copyText(b64Output.value, b64CopyBtn));
};
