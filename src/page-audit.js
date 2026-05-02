// page-audit.js — QAKit v1.0.1 Page Auditor

// ── Custom spell dictionary ───────────────────────────────────────────────────
// Words the user has chosen to accept — persisted in chrome.storage.local
const SPELL_DICT_KEY = 'qa_custom_spell_dict';

async function getCustomDict() {
  const s = await chrome.storage.local.get(SPELL_DICT_KEY);
  return new Set(s[SPELL_DICT_KEY] || []);
}

async function addWordToDict(word) {
  const dict = await getCustomDict();
  dict.add(word.toLowerCase());
  await chrome.storage.local.set({ [SPELL_DICT_KEY]: [...dict] });
}

window.auditAddToDict = async function(word, btnEl) {
  await addWordToDict(word);
  // Remove the spelling item from the UI
  const item = btnEl?.closest('.audit-item');
  if (item) {
    item.style.opacity = '0';
    item.style.transition = 'opacity .3s';
    setTimeout(() => item.remove(), 300);
  }
  showLsToast('"' + word + '" added to dictionary ✓');
  // Update auditResults so export doesn't include it
  if (auditResults?.spelling) {
    auditResults.spelling = auditResults.spelling.filter(s => s.wrong.toLowerCase() !== word.toLowerCase());
    const chip = document.querySelector('.audit-chip[data-type="spelling"]');
    if (chip) {
      const cnt = auditResults.spelling.length;
      chip.querySelector('.chip-val').textContent = cnt === 0 ? '✓' : cnt;
    }
  }
};

let auditResults  = null;
let auditRunning  = false;
let auditPageInfo = null; // { url, title, ts }
let auditProgress = null; // { phase, current, total } for progress indicator
let auditPreviousResults = null; // previous run for diff comparison (A-18)

// A-14 Per-URL persistence: keyed by URL (normalized). Falls back to last.
const AUDIT_STORAGE_KEY = 'qa_audit_last';        // legacy single key
const AUDIT_HISTORY_KEY = 'qa_audit_history';     // A-22 last N runs per URL
const AUDIT_SKIP_WORDS  = 'qa_audit_skip_words';  // A-6 user-configurable skip list
const AUDIT_HISTORY_LIMIT = 10; // keep last 10 audits per URL

// Normalize a URL to a stable key (strip hash, trailing slash).
function auditKeyForUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    let p = u.origin + u.pathname.replace(/\/$/, '');
    return p;
  } catch { return url; }
}

async function getAuditTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// A-6 User skip-words (merged with hardcoded set)
async function getUserSkipWords() {
  const s = await chrome.storage.local.get(AUDIT_SKIP_WORDS);
  return Array.isArray(s[AUDIT_SKIP_WORDS]) ? s[AUDIT_SKIP_WORDS] : [];
}

// Audit runner. Pass a scope to limit what gets scanned:
//   'all'       — everything (default, full legacy behaviour)
//   'overview'  — just links + images + spelling (fast)
//   'perf'      — just performance metrics
//   'security'  — just security checks
//   'a11y'      — just accessibility checks
async function runPageAudit(scope) {
  // Fix 27 — Run always does the full audit. Targeted scopes ('perf' / 'security'
  // / 'a11y') used to do partial scans; now they all just do the full thing.
  scope = 'all';
  const tab = await getAuditTab();
  if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
    showAuditError('Navigate to a web page first'); return;
  }

  // A-18 Save previous results for diff comparison before clearing (overview only)
  if (scope === 'all' || scope === 'overview') {
    auditPreviousResults = auditResults ? { ...auditResults, pageInfo: auditPageInfo } : null;
  }

  // ── Clear previous results immediately before scanning ──────────────────
  // For scope='all' or 'overview' we clear the Overview panel. For the other
  // scopes we keep the Overview visible and just refresh the target sub-panel.
  if (scope === 'all' || scope === 'overview') {
    auditResults  = null;
    auditPageInfo = null;
    const hdr = document.getElementById('auditPageHeader');
    if (hdr) hdr.style.display = 'none';
    const auditEl = document.getElementById('auditContent');
    if (auditEl) auditEl.innerHTML =
      '<div class="empty"><div class="empty-icon">⟳</div><div class="empty-text" id="auditScanStatus">Scanning page…</div></div>';
  } else {
    // Targeted re-scan: show spinner inside the relevant sub-panel
    const panelId = scope === 'perf'     ? 'auditPerfContent'
                  : scope === 'security' ? 'auditSecContent'
                  : scope === 'a11y'     ? 'auditA11yContent' : null;
    if (panelId) {
      const el = document.getElementById(panelId);
      if (el) el.innerHTML =
        '<div class="empty"><div class="empty-icon">⟳</div><div class="empty-text" id="auditScanStatus">Scanning ' + scope + '…</div></div>';
    }
  }

  setAuditLoading(true);
  setAuditProgress('Gathering page data', 0, 0);

  try {
    // Inject and warm up spell-bundle.js before scan so QASpell is ready
    // (only needed for overview spell check)
    if (scope === 'all' || scope === 'overview') {
      try {
        await chrome.runtime.sendMessage({ action: 'INJECT_SPELL', tabId: tab.id });
      } catch(_) {}
    }

    // A-6 Pass user skip words into the MAIN-world scan
    const userSkipWords = await getUserSkipWords();

    const scanResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world:  'MAIN',
      args:   [userSkipWords, scope],
      func: (USER_SKIP, SCOPE) => {
        SCOPE = SCOPE || 'all';
        const wantOverview = SCOPE === 'all' || SCOPE === 'overview';
        const wantPerf     = SCOPE === 'all' || SCOPE === 'perf';
        const wantSec      = SCOPE === 'all' || SCOPE === 'security';
        const wantA11y     = SCOPE === 'all' || SCOPE === 'a11y';
        const out = {
          scope:    SCOPE,
          links:    [],
          images:   [],
          spelling: [],
          spellingTruncated: false,
          perf:     {},
          security: {},
          a11y:     [],
          url:      location.href,
          title:    document.title || location.hostname,
          ts:       Date.now(),
        };

        // Helper: eTLD+1 normalize so example.com and www.example.com count as same (A-7)
        function registrableDomain(hostname) {
          // Strip leading www., m., mobile.
          return (hostname || '').replace(/^(www|m|mobile)\./i, '');
        }

        // ── All first-level links (no 30-link cap) ───────────────────────────
        const locReg = registrableDomain(location.hostname);
        if (wantOverview) {
        document.querySelectorAll('a[href]').forEach(a => {
          const href = a.href;
          const text = (a.textContent || a.getAttribute('aria-label') || '').trim().slice(0, 80);
          if (!href || href === '#' || href.startsWith('javascript:') || href === 'about:blank') return;
          if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
          // A-7 First-level: same registrable domain (handles www and cross-subdomain)
          try {
            const u = new URL(href);
            const hostReg = registrableDomain(u.hostname);
            if (hostReg !== locReg) return;
          } catch { return; }
          out.links.push({ href, text: text || '(no text)', id: a.id || null });
        });

        // Deduplicate links by href
        const seen = new Set();
        out.links = out.links.filter(l => { if (seen.has(l.href)) return false; seen.add(l.href); return true; });
        } // end wantOverview (links)

        // ── Missing/broken images + oversized images ────────────────────────
        if (wantOverview) {
        // A-8 Also check CSS background images (banners/heroes often use these).
        // A-23 Flag images over 500KB as oversized.
        // Performance resource entries give us transferSize — match by URL to find heavy images.
        const imgSizeByUrl = new Map();
        try {
          performance.getEntriesByType('resource').forEach(r => {
            if (r.initiatorType === 'img' || r.initiatorType === 'css' || r.initiatorType === 'picture') {
              if (r.transferSize > 0) imgSizeByUrl.set(r.name, r.transferSize);
            }
          });
        } catch(_) {}

        const OVERSIZED_BYTES = 500 * 1024; // 500KB threshold

        document.querySelectorAll('img').forEach(img => {
          const rawSrc = img.getAttribute('src');
          const resolvedSrc = img.src; // browser-resolved absolute URL

          // Case 1: No src attribute or empty src
          if (!rawSrc || rawSrc.trim() === '') {
            out.images.push({ src: '(missing src)', issue: 'No src attribute' });
            return;
          }
          // Case 2: data: URI placeholder or blob — skip these
          if (resolvedSrc.startsWith('data:') || resolvedSrc.startsWith('blob:')) return;
          // Case 3: Image failed to load — complete=true but naturalWidth=0
          if (img.complete && img.naturalWidth === 0) {
            out.images.push({ src: resolvedSrc || rawSrc, issue: 'Failed to load' });
            return;
          }
          // A-23 Oversized image check
          const size = imgSizeByUrl.get(resolvedSrc);
          if (size && size > OVERSIZED_BYTES) {
            out.images.push({
              src: resolvedSrc,
              issue: 'Oversized — ' + Math.round(size / 1024) + ' KB',
              kind: 'oversized',
              bytes: size,
            });
          }
        });

        // A-8 CSS background images — check computed styles of visible elements
        try {
          const seenBgs = new Set();
          // Only check elements that are likely banners/heroes — limit work
          const bgCandidates = document.querySelectorAll(
            'header,section,div,figure,article,aside,main,[class*="hero" i],[class*="banner" i]'
          );
          const MAX_BG_CHECK = 200;
          let checked = 0;
          for (const el of bgCandidates) {
            if (checked >= MAX_BG_CHECK) break;
            const rect = el.getBoundingClientRect();
            // Only care about reasonably sized elements
            if (rect.width < 100 || rect.height < 100) continue;
            const cs = window.getComputedStyle(el);
            const bg = cs.backgroundImage;
            if (!bg || bg === 'none') continue;
            // Parse url("...") out — may have multiple
            const urls = [...bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m => m[1]);
            checked++;
            for (const u of urls) {
              if (!u || u.startsWith('data:') || u.startsWith('blob:')) continue;
              if (seenBgs.has(u)) continue;
              seenBgs.add(u);
              // Check if this bg resource loaded — by looking at perf entries
              const loaded = performance.getEntriesByName(
                new URL(u, location.href).href
              ).length > 0;
              if (!loaded) {
                out.images.push({
                  src: u,
                  issue: 'CSS background — not loaded',
                  kind: 'css-bg',
                });
              } else {
                const sz = imgSizeByUrl.get(new URL(u, location.href).href);
                if (sz && sz > OVERSIZED_BYTES) {
                  out.images.push({
                    src: u,
                    issue: 'CSS background — oversized ' + Math.round(sz / 1024) + ' KB',
                    kind: 'css-bg-oversized',
                    bytes: sz,
                  });
                }
              }
            }
          }
        } catch(_) {}
        } // end wantOverview (images)

        // ── Spelling — uses QASpell (nspell bundle) loaded in page context ──────
        if (wantOverview) {
        const spellSeen  = new Set();
        const rootEl     = document.body;
        if (!rootEl) return out;

        const useNspell = typeof window.QASpell !== 'undefined' && window.QASpell.loaded();

        // Fallback dictionary (kept for resilience when bundle unavailable)
        const FALLBACK = {
          'recieve':'receive','occured':'occurred','seperate':'separate',
          'definately':'definitely','accomodate':'accommodate','acheive':'achieve',
          'beleive':'believe','calender':'calendar','concious':'conscious',
          'existance':'existence','goverment':'government','grammer':'grammar',
          'harrass':'harass','independant':'independent','millenium':'millennium',
          'neccessary':'necessary','occassion':'occasion','persue':'pursue',
          'reccomend':'recommend','relevent':'relevant','sucessful':'successful',
          'tommorrow':'tomorrow','unforseen':'unforeseen','wierd':'weird',
          'recieved':'received','accessable':'accessible','accomodation':'accommodation',
          'beggining':'beginning','dissapear':'disappear','embarass':'embarrass',
          'enviroment':'environment','experianced':'experienced','freind':'friend',
          'gauruntee':'guarantee','imediately':'immediately','knowlege':'knowledge',
          'occurence':'occurrence','occuring':'occurring','refering':'referring',
          'untill':'until','dependant':'dependent','privelege':'privilege',
        };
        const FALLBACK_RE = {};
        for (const w of Object.keys(FALLBACK)) {
          FALLBACK_RE[w] = new RegExp('\\b' + w + '\\b', 'i');
        }

        // Technical/product words to skip (common false positives).
        // Merged with user-configurable list (A-6) passed in as USER_SKIP.
        const SKIP_WORDS = new Set([
          'qakit','qff','href','html','json','api','url','css','js',
          'src','alt','nav','img','btn','div','xhr','cdn','sdk','id',
          'localhost','www','http','https','com','au','ie','eg','etc',
          ...(Array.isArray(USER_SKIP) ? USER_SKIP.map(w => String(w).toLowerCase()) : []),
        ]);

        const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
          acceptNode: n => {
            const p = n.parentElement?.tagName?.toLowerCase();
            if (['script','style','noscript','code','pre','input','textarea',
                 'meta','link','head','svg','path'].includes(p)) return NodeFilter.FILTER_REJECT;
            const el = n.parentElement;
            if (el) {
              const cs = window.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_SKIP;
            }
            const t = n.textContent.trim();
            return t.length > 2 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
          }
        });

        // A-4 Report whether we hit the 50-issue cap so UI can say "50+ more"
        const SPELL_CAP = 50;
        let spellTotalFound = 0;
        let node;
        // A-5 Note: spellSeen dedups by lowercased form, so "Recieve" and
        // "recieve" are reported once (typically what users want for page QA).
        while ((node = walker.nextNode())) {
          const text = node.textContent;

          if (useNspell) {
            // nspell path: extract individual words and check each
            const words = text.match(/\b[a-zA-Z]{4,}\b/g) || [];
            for (const w of words) {
              const lower = w.toLowerCase();
              if (spellSeen.has(lower)) continue;
              if (SKIP_WORDS.has(lower)) continue;
              if (/^[A-Z]+$/.test(w)) continue;           // all-caps acronyms
              if (/[0-9]/.test(w)) continue;              // contains digits
              if (w.length > 30) continue;                 // probably not a word
              if (!window.QASpell.correct(w) && !window.QASpell.correct(lower)) {
                spellTotalFound++;
                if (out.spelling.length >= SPELL_CAP) {
                  out.spellingTruncated = true;
                  continue;
                }
                spellSeen.add(lower);
                const suggestions = window.QASpell.suggest(w);
                out.spelling.push({
                  wrong:    w,
                  right:    suggestions[0] || '?',
                  snippet:  text.trim().slice(0, 120),
                  fromNspell: true,
                });
              }
            }
          } else {
            // Fallback dictionary path
            for (const [wrong, right] of Object.entries(FALLBACK)) {
              if (spellSeen.has(wrong)) continue;
              if (FALLBACK_RE[wrong].test(text)) {
                spellTotalFound++;
                if (out.spelling.length >= SPELL_CAP) {
                  out.spellingTruncated = true;
                  continue;
                }
                spellSeen.add(wrong);
                out.spelling.push({ wrong, right, snippet: text.trim().slice(0, 120) });
              }
            }
          }
        }
        out.spellTotalFound = spellTotalFound;
        out.spellEngine = useNspell ? 'nspell' : 'fallback';
        } // end wantOverview (spelling)

        // ── Performance checks ───────────────────────────────────────────────
        if (wantPerf) {
        try {
          const nav = performance.getEntriesByType('navigation')[0] || {};
          const paint = Object.fromEntries(
            performance.getEntriesByType('paint').map(e => [e.name, Math.round(e.startTime)])
          );
          const resources = performance.getEntriesByType('resource');
          const slowRes = resources.filter(r => r.duration > 1000).map(r => ({
            url: r.name.split('?')[0].slice(-80),
            ms: Math.round(r.duration),
          }));
          const totalBytes = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
          const domNodes = document.querySelectorAll('*').length;

          // A-9 LCP: getEntriesByType may be empty on pages where the buffer
          // was never opened. Try multiple fallbacks:
          //   1. window.__qakitLCP — set by an observer we inject below
          //   2. performance.getEntriesByType('largest-contentful-paint')
          //   3. null if neither available
          let lcp = null, lcpElement = null;
          if (window.__qakitLCP && window.__qakitLCP.value) {
            lcp = Math.round(window.__qakitLCP.value);
            lcpElement = window.__qakitLCP.element || null;
          } else {
            const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
            if (lcpEntries.length) {
              const last = lcpEntries[lcpEntries.length - 1];
              lcp = Math.round(last.startTime);
              lcpElement = last.element || null;
            }
          }
          // A-21 Derive a CSS-like path for the LCP element so user can find it
          let lcpElementPath = null;
          if (lcpElement) {
            try {
              const tag = lcpElement.tagName ? lcpElement.tagName.toLowerCase() : '';
              const id  = lcpElement.id ? '#' + lcpElement.id : '';
              const cls = lcpElement.className && typeof lcpElement.className === 'string'
                ? '.' + lcpElement.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
              lcpElementPath = (tag + id + cls).slice(0, 100) || null;
            } catch(_) {}
          }

          // A-10 CLS: this is a ROUGH running total, not the proper "session
          // window" CWV metric. Good enough for a heuristic but noted in UI.
          let cls = null;
          const layoutShiftEntries = performance.getEntriesByType('layout-shift');
          if (layoutShiftEntries.length)
            cls = layoutShiftEntries.reduce((s, e) => s + (e.hadRecentInput ? 0 : e.value), 0).toFixed(3);

          out.perf = {
            ttfb:           Math.round((nav.responseStart || 0) - (nav.requestStart || 0)),
            fcp:            paint['first-contentful-paint'] || null,
            lcp:            lcp,
            lcpElementPath: lcpElementPath,  // A-21
            cls:            cls,
            clsNote:        'Running total; may differ from proper CWV session-window calculation', // A-10
            domNodes:       domNodes,
            resourceCount:  resources.length,
            slowResources:  slowRes.slice(0, 10),
            totalKB:        Math.round(totalBytes / 1024),
            domInteractive: Math.round(nav.domInteractive || 0),
            loadTime:       Math.round((nav.loadEventEnd || 0) - (nav.startTime || 0)),
          };
        } catch(_) {}
        } // end wantPerf

        // ── Security checks ──────────────────────────────────────────────────
        if (wantSec) {
        try {
          const isHTTPS = location.protocol === 'https:';
          // Mixed content: http resources on https page
          const mixedContent = [];
          if (isHTTPS) {
            document.querySelectorAll('img[src],script[src],link[href],iframe[src],audio[src],video[src]').forEach(el => {
              const src = el.src || el.href || '';
              if (src.startsWith('http:')) {
                mixedContent.push(src.replace(/^http:\/\//, '').split('/')[0] + '…');
              }
            });
          }
          // CSP meta tag
          const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
          // X-Frame-Options meta (rare but possible)
          const xfoMeta = document.querySelector('meta[http-equiv="X-Frame-Options"]');
          // Referrer-Policy meta
          const refMeta = document.querySelector('meta[name="referrer"],meta[http-equiv="Referrer-Policy"]');
          // Cookie flags — we can only check if document.cookie is accessible; flag presence requires server headers
          const hasCookies = document.cookie.length > 0;
          // Links with target=_blank but no rel=noopener
          const unsafeBlank = [];
          document.querySelectorAll('a[target="_blank"]').forEach(a => {
            const rel = (a.rel || '').toLowerCase();
            if (!rel.includes('noopener') && !rel.includes('noreferrer')) {
              const href = a.href || '';
              try {
                const host = new URL(href).hostname;
                if (host && host !== location.hostname) unsafeBlank.push(host);
              } catch {}
            }
          });
          const uniqUnsafeBlank = [...new Set(unsafeBlank)].slice(0, 5);

          // ── EXPANDED SECURITY CHECKS (3d) ────────────────────────────────

          // CSP content evaluation
          let cspIssues = [];
          if (cspMeta) {
            const cspContent = cspMeta.getAttribute('content') || '';
            if (cspContent.includes("'unsafe-inline'")) cspIssues.push("'unsafe-inline' present");
            if (cspContent.includes("'unsafe-eval'"))   cspIssues.push("'unsafe-eval' present");
            if (/\b\*\s/.test(cspContent) || cspContent.includes(' * '))
              cspIssues.push('wildcard (*) source used');
          }

          // Subresource integrity — external scripts and stylesheets without integrity
          const sriMissingScripts = [];
          document.querySelectorAll('script[src]').forEach(s => {
            try {
              const u = new URL(s.src, location.href);
              if (u.origin !== location.origin && !s.hasAttribute('integrity')) {
                sriMissingScripts.push(u.hostname + u.pathname.slice(0, 30));
              }
            } catch(_) {}
          });
          const sriMissingStyles = [];
          document.querySelectorAll('link[rel="stylesheet"][href]').forEach(l => {
            try {
              const u = new URL(l.href, location.href);
              if (u.origin !== location.origin && !l.hasAttribute('integrity')) {
                sriMissingStyles.push(u.hostname + u.pathname.slice(0, 30));
              }
            } catch(_) {}
          });

          // Mixed content in form actions
          const insecureForms = [];
          document.querySelectorAll('form[action]').forEach(f => {
            try {
              const action = new URL(f.action, location.href);
              if (isHTTPS && action.protocol === 'http:') {
                insecureForms.push(action.href);
              }
            } catch(_) {}
          });

          // Password inputs on HTTP pages
          let httpPasswordInputs = 0;
          if (!isHTTPS) {
            httpPasswordInputs = document.querySelectorAll('input[type="password"]').length;
          }

          // Third-party script count — distinct origins
          const thirdPartyOrigins = new Set();
          document.querySelectorAll('script[src]').forEach(s => {
            try {
              const u = new URL(s.src, location.href);
              if (u.origin !== location.origin) thirdPartyOrigins.add(u.origin);
            } catch(_) {}
          });

          // Sensitive patterns in localStorage keys
          const sensitiveLsKeys = [];
          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i) || '';
              if (/jwt|token|password|secret|credit|ssn|auth/i.test(k)) {
                sensitiveLsKeys.push(k);
              }
            }
          } catch(_) {}

          out.security = {
            isHTTPS,
            mixedContent:    [...new Set(mixedContent)].slice(0, 10),
            hasCSP:          !!cspMeta,
            hasXFO:          !!xfoMeta,
            hasReferrer:     !!refMeta,
            unsafeBlankLinks: uniqUnsafeBlank,
            hasCookies,
            // New expanded fields
            cspIssues,
            sriMissingScripts: sriMissingScripts.slice(0, 5),
            sriMissingStyles:  sriMissingStyles.slice(0, 5),
            insecureForms:     insecureForms.slice(0, 5),
            httpPasswordInputs,
            thirdPartyCount:   thirdPartyOrigins.size,
            thirdPartyOrigins: [...thirdPartyOrigins].slice(0, 10),
            sensitiveLsKeys:   sensitiveLsKeys.slice(0, 5),
          };
        } catch(_) {}
        } // end wantSec

        // ── Accessibility checks ──────────────────────────────────────────────
        if (wantA11y) {
        try {
          const a11y = [];

          // Images missing alt attribute
          const imgsNoAlt = document.querySelectorAll('img:not([alt])');
          if (imgsNoAlt.length) a11y.push({ type: 'error', msg: imgsNoAlt.length + ' image(s) missing alt attribute', detail: [...imgsNoAlt].slice(0,3).map(i=>(i.src||'').split('/').pop().slice(0,40)).join(', ') });

          // Inputs missing label
          let unlabelledCount = 0;
          document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])').forEach(inp => {
            const id = inp.id;
            const hasLabel = id ? !!document.querySelector('label[for="' + id + '"]') : false;
            const hasAria  = inp.getAttribute('aria-label') || inp.getAttribute('aria-labelledby') || inp.getAttribute('title') || inp.getAttribute('placeholder');
            if (!hasLabel && !hasAria) unlabelledCount++;
          });
          if (unlabelledCount) a11y.push({ type: 'error', msg: unlabelledCount + ' input(s) missing label or aria-label', detail: '' });

          // Buttons with no accessible text — capture class/id context
          const emptyBtnDetails = [];
          document.querySelectorAll('button, [role="button"]').forEach(btn => {
            const txt = (btn.textContent || '').trim();
            const ariaLabel = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
            if (!txt && !ariaLabel) {
              const ctx = btn.id ? '#' + btn.id : btn.className ? '.' + btn.className.trim().split(' ')[0] : btn.outerHTML.slice(0, 60).replace(/</g,'&lt;');
              emptyBtnDetails.push(ctx);
            }
          });
          if (emptyBtnDetails.length) a11y.push({ type: 'warn', msg: emptyBtnDetails.length + ' button(s) have no accessible text', detail: emptyBtnDetails.slice(0,5).join(', ') });

          // Heading hierarchy — A-13 report ALL gaps, not just the first
          const headingEls = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
          const headings   = headingEls.map(h => parseInt(h.tagName[1]));
          const gaps = [];
          let prevLevel = 0;
          for (let i = 0; i < headings.length; i++) {
            const lvl = headings[i];
            if (prevLevel && lvl > prevLevel + 1) {
              gaps.push('h' + prevLevel + ' → h' + lvl);
            }
            prevLevel = lvl;
          }
          if (gaps.length) {
            a11y.push({
              type: 'warn',
              msg: gaps.length + ' heading hierarchy gap' + (gaps.length === 1 ? '' : 's'),
              detail: gaps.slice(0, 5).join(', ') + (gaps.length > 5 ? ' …' : ''),
            });
          }

          // Missing lang attribute
          if (!document.documentElement.getAttribute('lang')) {
            a11y.push({ type: 'warn', msg: '<html> is missing lang attribute', detail: '' });
          }

          // A-12 Duplicate IDs — skip empty IDs ('' counts as a 'duplicate' with
          // multiple elements having id="").
          const idMap = {};
          document.querySelectorAll('[id]').forEach(el => {
            const id = el.id;
            if (!id || !id.trim()) return; // skip empty ids
            idMap[id] = (idMap[id] || 0) + 1;
          });
          const dupIds = Object.entries(idMap).filter(([,c]) => c > 1).map(([id]) => id).slice(0, 5);
          if (dupIds.length) a11y.push({ type: 'warn', msg: dupIds.length + ' duplicate ID(s) found', detail: dupIds.join(', ') });

          // Multiple H1s
          const h1s = document.querySelectorAll('h1');
          if (h1s.length > 1) a11y.push({ type: 'info', msg: h1s.length + ' <h1> elements found (should be 1)', detail: '' });
          if (h1s.length === 0) a11y.push({ type: 'warn', msg: 'No <h1> element found on page', detail: '' });

          // A-19 Landmark regions
          const landmarks = {
            main:   document.querySelectorAll('main, [role="main"]').length,
            nav:    document.querySelectorAll('nav, [role="navigation"]').length,
            header: document.querySelectorAll('header, [role="banner"]').length,
            footer: document.querySelectorAll('footer, [role="contentinfo"]').length,
          };
          if (landmarks.main === 0) {
            a11y.push({ type: 'warn', msg: 'No <main> landmark found', detail: 'Screen readers use <main> to skip to primary content' });
          }
          if (landmarks.main > 1) {
            a11y.push({ type: 'warn', msg: landmarks.main + ' <main> landmarks (should be 1)', detail: '' });
          }

          // A-19 ARIA role validation — known valid roles
          const VALID_ROLES = new Set([
            'alert','alertdialog','application','article','banner','button','cell','checkbox',
            'columnheader','combobox','complementary','contentinfo','definition','dialog','directory',
            'document','feed','figure','form','grid','gridcell','group','heading','img','link','list',
            'listbox','listitem','log','main','marquee','math','menu','menubar','menuitem','menuitemcheckbox',
            'menuitemradio','navigation','none','note','option','presentation','progressbar','radio',
            'radiogroup','region','row','rowgroup','rowheader','scrollbar','search','searchbox','separator',
            'slider','spinbutton','status','switch','tab','table','tablist','tabpanel','term','textbox',
            'timer','toolbar','tooltip','tree','treegrid','treeitem',
          ]);
          const invalidRoles = new Set();
          document.querySelectorAll('[role]').forEach(el => {
            const r = el.getAttribute('role').trim().toLowerCase().split(/\s+/)[0];
            if (r && !VALID_ROLES.has(r)) invalidRoles.add(r);
          });
          if (invalidRoles.size) {
            a11y.push({ type: 'warn', msg: invalidRoles.size + ' invalid ARIA role(s) used', detail: [...invalidRoles].slice(0, 5).join(', ') });
          }

          // A-19 aria-labelledby / aria-describedby referencing non-existent IDs
          let danglingRefs = 0;
          document.querySelectorAll('[aria-labelledby],[aria-describedby]').forEach(el => {
            const ids = ((el.getAttribute('aria-labelledby') || '') + ' ' + (el.getAttribute('aria-describedby') || ''))
              .split(/\s+/).filter(Boolean);
            for (const id of ids) {
              if (!document.getElementById(id)) { danglingRefs++; break; }
            }
          });
          if (danglingRefs) {
            a11y.push({ type: 'warn', msg: danglingRefs + ' aria-labelledby/describedby reference(s) point to missing IDs', detail: '' });
          }

          // A-20 Keyboard navigation checks:
          //  - positive tabindex (>0) disrupts natural tab order — anti-pattern
          //  - elements with tabindex="-1" that look interactive (buttons, links)
          let positiveTabindex = 0;
          const positiveSamples = [];
          document.querySelectorAll('[tabindex]').forEach(el => {
            const ti = parseInt(el.getAttribute('tabindex'), 10);
            if (ti > 0) {
              positiveTabindex++;
              if (positiveSamples.length < 3) {
                const tag = el.tagName.toLowerCase();
                positiveSamples.push(tag + (el.id ? '#' + el.id : '') + '[' + ti + ']');
              }
            }
          });
          if (positiveTabindex) {
            a11y.push({
              type: 'warn',
              msg: positiveTabindex + ' element(s) with positive tabindex',
              detail: 'Positive tabindex disrupts natural tab order: ' + positiveSamples.join(', '),
            });
          }

          // A-19 Color contrast — sample a subset of visible text for AA compliance
          //  - Samples up to 100 text-containing elements
          //  - Checks contrast ratio of text vs. element's computed background
          //  - WCAG AA: 4.5:1 normal, 3:1 large text (>=18pt or >=14pt bold)
          try {
            function parseRGB(str) {
              const m = str.match(/rgba?\(([^)]+)\)/);
              if (!m) return null;
              const parts = m[1].split(',').map(s => parseFloat(s.trim()));
              return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
            }
            function relLum(rgb) {
              const c = [rgb.r, rgb.g, rgb.b].map(v => {
                const s = v / 255;
                return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
              });
              return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            }
            function ratio(a, b) {
              const la = relLum(a), lb = relLum(b);
              return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
            }
            // Walk up for background colour
            function bgOf(el) {
              let cur = el;
              while (cur && cur !== document.documentElement) {
                const cs = window.getComputedStyle(cur);
                const bg = parseRGB(cs.backgroundColor);
                if (bg && bg.a > 0) return bg;
                cur = cur.parentElement;
              }
              return { r: 255, g: 255, b: 255, a: 1 }; // assume white
            }
            const contrastFails = [];
            const candidates = document.querySelectorAll('p, span, a, button, h1, h2, h3, h4, h5, h6, li, td, th, label');
            let sampled = 0;
            for (const el of candidates) {
              if (sampled >= 100) break;
              const txt = (el.textContent || '').trim();
              if (!txt || txt.length < 3) continue;
              const cs = window.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.5) continue;
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              sampled++;
              const fg = parseRGB(cs.color);
              const bg = bgOf(el);
              if (!fg || !bg) continue;
              const r = ratio(fg, bg);
              const fontSize = parseFloat(cs.fontSize);
              const isBold = parseInt(cs.fontWeight, 10) >= 700;
              const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
              const threshold = isLarge ? 3 : 4.5;
              if (r < threshold) {
                contrastFails.push({
                  tag: el.tagName.toLowerCase(),
                  ratio: r.toFixed(2),
                  threshold,
                  sample: txt.slice(0, 40),
                });
              }
            }
            if (contrastFails.length) {
              const sampleStr = contrastFails.slice(0, 3)
                .map(f => f.tag + ' "' + f.sample + '" (' + f.ratio + ':1)')
                .join('; ');
              a11y.push({
                type: 'warn',
                msg: contrastFails.length + ' of ' + sampled + ' text element(s) fail WCAG AA contrast',
                detail: sampleStr,
              });
            }
          } catch(_) {}

          // Links with no accessible text — capture href context
          const emptyLinkDetails = [];
          document.querySelectorAll('a[href]').forEach(a => {
            const txt = (a.textContent || '').trim();
            const ariaLabel = a.getAttribute('aria-label') || a.getAttribute('title') || '';
            if (!txt && !ariaLabel) {
              let ctx = '';
              try { ctx = new URL(a.href).pathname.slice(-40) || a.href.slice(-40); } catch { ctx = a.href.slice(-40); }
              emptyLinkDetails.push(ctx || a.outerHTML.slice(0, 50).replace(/</g,'&lt;'));
            }
          });
          if (emptyLinkDetails.length) a11y.push({ type: 'warn', msg: emptyLinkDetails.length + ' link(s) have no accessible text', detail: emptyLinkDetails.slice(0,5).join(', ') });

          // ── EXPANDED A11y CHECKS (3c) ────────────────────────────────

          // Alt text quality — generic filler like "image", "photo", "picture"
          const genericAlt = [];
          document.querySelectorAll('img[alt]').forEach(img => {
            const alt = (img.alt || '').trim().toLowerCase();
            if (!alt) return; // empty alt is valid for decorative
            if (/^(image|photo|picture|img|icon|graphic|logo|banner|thumbnail)$/i.test(alt) || alt.length < 3) {
              genericAlt.push((img.src || '').split('/').pop().slice(0, 40) + ': "' + alt + '"');
            }
          });
          if (genericAlt.length) a11y.push({
            type: 'warn',
            msg: genericAlt.length + ' image(s) with generic / low-quality alt text',
            detail: genericAlt.slice(0, 3).join(' · '),
          });

          // Link text quality — "click here", "read more", "learn more"
          const vagueLinks = [];
          document.querySelectorAll('a[href]').forEach(a => {
            const t = (a.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (!t) return;
            if (/^(click here|here|read more|learn more|more|details|link|continue|this)(\s*[→▸»>]*)*$/i.test(t)) {
              vagueLinks.push('"' + t.slice(0, 30) + '"');
            }
          });
          if (vagueLinks.length) a11y.push({
            type: 'warn',
            msg: vagueLinks.length + ' link(s) with non-descriptive text',
            detail: 'Use meaningful link text: ' + [...new Set(vagueLinks)].slice(0, 4).join(', '),
          });

          // Buttons without accessible name (no text, no aria-label, no title)
          let unnamedBtns = 0;
          document.querySelectorAll('button, [role="button"]').forEach(btn => {
            const text = (btn.textContent || '').trim();
            const label = btn.getAttribute('aria-label') || btn.getAttribute('aria-labelledby') || btn.getAttribute('title');
            if (!text && !label && !btn.querySelector('img[alt]:not([alt=""])')) unnamedBtns++;
          });
          if (unnamedBtns) a11y.push({
            type: 'error',
            msg: unnamedBtns + ' button(s) with no accessible name',
            detail: 'Buttons need text, aria-label, or an img with alt',
          });

          // Form labels quality — selects/textareas without proper labels
          let unlabelledControls = 0;
          document.querySelectorAll('select, textarea').forEach(el => {
            if (el.id && document.querySelector('label[for="' + el.id + '"]')) return;
            if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return;
            if (el.closest('label')) return;
            unlabelledControls++;
          });
          if (unlabelledControls) a11y.push({
            type: 'warn',
            msg: unlabelledControls + ' form control(s) without a label',
            detail: 'select/textarea need <label for=""> or aria-label',
          });

          // Skip link presence
          const firstFocusable = document.querySelector('a[href], button');
          let hasSkipLink = false;
          document.querySelectorAll('a[href^="#"]').forEach(a => {
            const t = (a.textContent || '').toLowerCase();
            if (/skip.*(content|main|navigation)/i.test(t)) hasSkipLink = true;
          });
          if (!hasSkipLink && document.querySelectorAll('nav a, header a').length > 5) {
            a11y.push({ type: 'info', msg: 'No "skip to main content" link found', detail: 'Helpful for keyboard users on pages with lots of nav links' });
          }

          // Touch target size — interactive elements < 24x24px on mobile
          let smallTargets = 0;
          const smallTargetSamples = [];
          document.querySelectorAll('a[href], button, [role="button"], input[type="checkbox"], input[type="radio"]').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return; // hidden
            if (r.width < 24 || r.height < 24) {
              smallTargets++;
              if (smallTargetSamples.length < 3) {
                smallTargetSamples.push(el.tagName.toLowerCase() + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
              }
            }
          });
          if (smallTargets > 3) a11y.push({
            type: 'warn',
            msg: smallTargets + ' tap target(s) smaller than 24×24px',
            detail: 'WCAG 2.2 minimum: ' + smallTargetSamples.join(', '),
          });

          // Table accessibility
          document.querySelectorAll('table').forEach(table => {
            // Skip layout tables (role=presentation or no data cells)
            if (table.getAttribute('role') === 'presentation') return;
            if (!table.querySelector('td')) return;
            const headers = table.querySelectorAll('th');
            const hasCaption = !!table.querySelector('caption');
            const hasScope = [...headers].some(th => th.hasAttribute('scope'));
            if (!headers.length) {
              a11y.push({ type: 'warn', msg: 'Data table missing <th> headers', detail: 'Use <th> for row/column headers' });
            } else if (!hasScope && headers.length > 2) {
              a11y.push({ type: 'info', msg: 'Table headers missing scope attribute', detail: 'Add scope="col" or scope="row" for clarity' });
            }
            if (!hasCaption && (table.rows?.length || 0) > 3) {
              a11y.push({ type: 'info', msg: 'Data table missing <caption>', detail: 'Add <caption> to describe the table' });
            }
          });

          // Video / audio accessibility
          const videosNoTrack = document.querySelectorAll('video:not(:has(track[kind="captions"])):not(:has(track[kind="subtitles"]))');
          if (videosNoTrack.length) a11y.push({
            type: 'warn',
            msg: videosNoTrack.length + ' <video> element(s) without captions/subtitles track',
            detail: 'Add <track kind="captions"> for deaf/hard-of-hearing users',
          });

          // Autoplay media
          const autoplay = document.querySelectorAll('video[autoplay], audio[autoplay]');
          if (autoplay.length) {
            const withoutMute = [...autoplay].filter(m => !m.muted).length;
            if (withoutMute) a11y.push({
              type: 'error',
              msg: withoutMute + ' media element(s) autoplay with sound',
              detail: 'Autoplaying sound violates WCAG 1.4.2',
            });
          }

          // Focus visibility — heuristic check for outline:none without :focus-visible replacement.
          // Sample 30 focusable elements, check if they have visible focus style.
          try {
            const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].slice(0, 30);
            let missingFocus = 0;
            for (const el of focusables) {
              const s = window.getComputedStyle(el);
              if (s.outlineStyle === 'none' && s.boxShadow === 'none' && !el.matches(':focus-visible')) {
                // Crude — can't fully test without actually focusing. This flags strong negatives.
                if (s.outlineWidth === '0px') missingFocus++;
              }
            }
            if (missingFocus > focusables.length / 2) {
              a11y.push({
                type: 'warn',
                msg: 'Focus indicators may be removed site-wide',
                detail: 'Many interactive elements have outline:none — verify :focus-visible replacement',
              });
            }
          } catch(_) {}

          out.a11y = a11y;
        } catch(_) {}
        } // end wantA11y

        return out;
      },
    });

    const data = scanResult?.[0]?.result;
    if (!data) { showAuditError('Could not scan page — try reloading the page'); setAuditLoading(false); return; }

    // Fix 27e — Targeted rescan branch removed. Run always does the full audit.
    // The scope parameter is preserved for backward compat but `'all'`/'overview'
    // are now the only supported values; both run everything.

    auditPageInfo = { url: data.url, title: data.title, ts: data.ts };

    // Filter out user-accepted words before storing
    const customDict = await getCustomDict();
    if (data.spelling) {
      data.spelling = data.spelling.filter(s => !customDict.has(s.wrong.toLowerCase()));
    }

    // Check ALL first-level links — only when overview or all scope
    const links    = data.links || [];
    const results  = new Array(links.length);
    const BATCH    = 5;
    setAuditProgress('Checking links', 0, links.length);
    for (let i = 0; i < links.length; i += BATCH) {
      const batch = links.slice(i, i + BATCH);
      const checked = await Promise.all(batch.map(async (link) => {
        // Skip in-page anchor links (same-page fragments) — those are always "live"
        try {
          const u = new URL(link.href);
          if (u.origin === location.origin && u.pathname === location.pathname && (u.hash || '').length) {
            return { ...link, status: 200, ok: true, redirected: false, method: 'SKIP', skipReason: 'in-page-anchor' };
          }
        } catch(_) {}

        // Helper: do a single fetch with all the options we care about
        async function tryFetch(method, redirect) {
          try {
            return await fetch(link.href, {
              method, redirect,
              credentials: 'include',        // send cookies so auth-gated pages don't 401/404
              signal: AbortSignal.timeout(10000),
            });
          } catch(e) {
            return null;
          }
        }

        try {
          // Step 1: try HEAD first (cheap). Fall through to GET on ANY non-2xx
          // result — many CMSes (AEM/Adobe/enterprise) return 404/405/501 on
          // HEAD but serve GET fine.
          let res = await tryFetch('HEAD', 'manual');
          let method = 'HEAD';

          const needsGet = !res ||
                           res.status === 0 ||
                           res.status === 404 || res.status === 405 ||
                           res.status === 501 || res.status === 400 ||
                           (res.status >= 500 && res.status !== 503); // fall through on server errors except rate-limit

          if (needsGet) {
            const getRes = await tryFetch('GET', 'manual');
            if (getRes) { res = getRes; method = 'GET'; }
          }

          if (!res) {
            return { ...link, status: 0, ok: false, error: 'Network error', method };
          }

          // Opaque-redirect (cross-origin with redirect:manual) — treat as redirect
          const isOpaqueRedirect = res.type === 'opaqueredirect';
          const isRedirect = (res.status >= 300 && res.status < 400) || isOpaqueRedirect;

          let finalUrl = null;
          let finalStatus = res.status;
          if (isRedirect) {
            // Step 2: follow to find the final URL + status
            const followed = await tryFetch('GET', 'follow');
            if (followed) {
              finalUrl = followed.url && followed.url !== link.href ? followed.url : link.href;
              finalStatus = followed.status;
            } else {
              finalStatus = 0;
            }
          }

          // Rate-limit / blocked detection — mark as "inconclusive" not broken
          const isRateLimited = finalStatus === 429 || finalStatus === 503 || finalStatus === 420;
          const isAuthGated   = finalStatus === 401 || finalStatus === 403;
          const ok            = finalStatus >= 200 && finalStatus < 400;

          return {
            ...link,
            status:         finalStatus,
            originalStatus: res.status === 0 ? (isOpaqueRedirect ? 'redirect' : finalStatus) : res.status,
            ok,
            redirected:     isRedirect,
            finalUrl,
            method,
            inconclusive:   isRateLimited || isAuthGated,
            reason:         isRateLimited ? 'Rate-limited — try again' :
                            isAuthGated ? 'Auth required' : undefined,
          };
        } catch (e) {
          return { ...link, status: 0, ok: false, error: e.message };
        }
      }));
      checked.forEach((r, bi) => results[i + bi] = r);
      setAuditProgress('Checking links', Math.min(i + BATCH, links.length), links.length);
    }

    data.linkResults = results;
    data.totalLinks  = links.length;

    // A-11 Cookie security flag checks — needs chrome.cookies API (extension context)
    try {
      setAuditProgress('Checking cookies', 0, 0);
      const pageUrl = data.url;
      const cookies = await chrome.cookies.getAll({ url: pageUrl });
      const insecure = cookies.filter(c => !c.secure && data.url.startsWith('https:'));
      const nonHttpOnlySensitive = cookies.filter(c => {
        const name = (c.name || '').toLowerCase();
        return !c.httpOnly && /session|auth|token|jwt|csrf|sid/.test(name);
      });
      const weakSameSite = cookies.filter(c => !c.sameSite || c.sameSite === 'unspecified' || c.sameSite === 'no_restriction');

      data.security = data.security || {};
      data.security.cookies = {
        total:     cookies.length,
        insecure:  insecure.map(c => c.name),
        nonHttpOnlySensitive: nonHttpOnlySensitive.map(c => c.name),
        weakSameSite: weakSameSite.map(c => c.name),
      };
    } catch (_) {
      // chrome.cookies may be unavailable on some URLs (e.g. extension pages)
    }

    // Response headers check (3d) — fetch page URL and inspect headers.
    // Only meaningful on the exact URL being audited, so we fetch the current page.
    if (scope === 'all' || scope === 'security') {
      try {
        setAuditProgress('Checking response headers', 0, 0);
        const resp = await fetch(data.url, {
          method: 'GET',
          credentials: 'include',
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
        });
        data.security = data.security || {};
        const h = resp.headers;
        data.security.responseHeaders = {
          hsts:               h.get('strict-transport-security'),
          cspHeader:          h.get('content-security-policy'),
          xFrameOpts:         h.get('x-frame-options'),
          xContentTypeOpts:   h.get('x-content-type-options'),
          permissionsPolicy:  h.get('permissions-policy') || h.get('feature-policy'),
          referrerPolicy:     h.get('referrer-policy'),
          server:             h.get('server'),
        };
      } catch(_) {
        // CORS or network block — silently skip
      }
    }

    auditResults = data;

    // Basic persist — scores added by renderAuditResults after computing them
    await chrome.storage.local.set({
      [AUDIT_STORAGE_KEY]: { data, pageInfo: auditPageInfo },
    });

    // A-22 Audit history — last N runs per URL
    try {
      const urlKey = auditKeyForUrl(data.url);
      const h = await chrome.storage.local.get(AUDIT_HISTORY_KEY);
      const history = h[AUDIT_HISTORY_KEY] || {};
      const runs = history[urlKey] || [];
      runs.push({
        ts:         data.ts,
        url:        data.url,
        title:      data.title,
        // Lightweight summary for quick diff/list — not the full payload
        broken:     results.filter(l => !l.ok).length,
        redirected: results.filter(l => l.redirected).length,
        images:     (data.images || []).length,
        spelling:   (data.spelling || []).length,
        a11y:       (data.a11y || []).length,
        lcp:        data.perf?.lcp,
        cls:        data.perf?.cls,
      });
      // Trim
      if (runs.length > AUDIT_HISTORY_LIMIT) runs.splice(0, runs.length - AUDIT_HISTORY_LIMIT);
      history[urlKey] = runs;
      await chrome.storage.local.set({ [AUDIT_HISTORY_KEY]: history });
    } catch(e) { console.warn('[QAKit] audit history save failed:', e.message); }

    setAuditProgress(null, 0, 0);
    renderAuditResults(data);
  } catch(e) {
    showAuditError('Audit failed: ' + e.message);
  }
  setAuditLoading(false);
}

// A-2/A-17 Progress indicator helper. Shows current/total in the scan message.
function setAuditProgress(phase, current, total) {
  const el = document.getElementById('auditScanStatus');
  if (!el) return;
  if (!phase) { auditProgress = null; return; }
  auditProgress = { phase, current, total };
  if (total > 0) {
    el.textContent = phase + '… ' + current + '/' + total;
  } else {
    el.textContent = phase + '…';
  }
}

// Restore last audit results on tab open.
// A-14: Only show automatically if the last audit was for the current URL.
// Otherwise show a subtle banner so the user isn't confused.
async function restoreAuditResults() {
  const stored = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
  if (!stored[AUDIT_STORAGE_KEY]) return;
  const { data, pageInfo } = stored[AUDIT_STORAGE_KEY];
  const tab = await getAuditTab();
  const currentUrl = tab?.url || '';

  if (currentUrl && pageInfo?.url && auditKeyForUrl(currentUrl) !== auditKeyForUrl(pageInfo.url)) {
    // Different URL — show rich banner with last-run summary
    const el = document.getElementById('auditContent');
    if (!el) return;
    const lastUrl = pageInfo.url || '';
    const truncUrl = lastUrl.length > 55 ? lastUrl.slice(0, 52) + '…' : lastUrl;
    const tsAgo = pageInfo.ts ? Math.max(1, Math.round((Date.now() - pageInfo.ts) / 60000)) : null;
    const ago = tsAgo ? (tsAgo < 60 ? tsAgo + 'm ago' : Math.round(tsAgo / 60) + 'h ago') : '';

    // Extract key metrics from stored data
    const perf = data?.perf || {};
    const security = data?.security || {};
    const a11y = Array.isArray(data?.a11y) ? data.a11y : [];
    const links = data?.links || {};
    const images = data?.images || {};
    const spelling = Array.isArray(data?.spelling) ? data.spelling : [];

    // Scores from stored qa_audit_last
    const lastGrade = stored[AUDIT_STORAGE_KEY]?.grade || pageInfo?.grade;
    const lastScore = stored[AUDIT_STORAGE_KEY]?.score || pageInfo?.score;
    const perfScore = pageInfo?.perfScore;
    const secScore  = pageInfo?.secScore;
    const a11yScore = pageInfo?.a11yScore;

    function gradeColor(s) {
      if (s == null) return '#888';
      if (s >= 75) return '#0a6e51';
      if (s >= 45) return '#b45309';
      return '#c0392b';
    }
    function gradeFor(s) {
      if (s == null) return '–';
      if (s >= 90) return 'A'; if (s >= 75) return 'B';
      if (s >= 60) return 'C'; if (s >= 45) return 'D';
      return 'F';
    }
    function miniScore(label, score) {
      const c = gradeColor(score);
      return '<div style="flex:1;background:white;border-radius:4px;padding:3px 5px;text-align:center;border:0.5px solid ' + c + '22">' +
        '<div style="font-size:7px;color:#888">' + label + '</div>' +
        '<div style="font-size:12px;font-weight:900;color:' + c + ';font-family:monospace">' + (score ?? '–') + '</div>' +
      '</div>';
    }
    function chip(label, ok, count) {
      const bg = ok ? 'background:#d3f0e1;color:#0a6e51' : 'background:#fcebeb;color:#c0392b';
      return '<span style="padding:2px 7px;' + bg + ';border-radius:8px;font-size:8.5px;font-weight:700">' +
        (ok ? '✓ ' : '⚠ ' + (count > 0 ? count + ' ' : '')) + label + '</span>';
    }
    function warnChip(label, count, color) {
      if (!count) return '';
      return '<span style="padding:2px 7px;background:#fde8c8;color:' + color + ';border-radius:8px;font-size:8.5px;font-weight:700">⚠ ' + count + ' ' + label + '</span>';
    }

    const brokenLinks = Array.isArray(links.broken) ? links.broken.length : 0;
    const brokenImages = Array.isArray(images.broken) ? images.broken.length : 0;
    const a11yIssues = a11y.filter(i => i.type === 'error').length;
    const secIssues = (security.missingHeaders?.length || 0) + (security.mixedContent?.length || 0);
    const spellingIssues = spelling.length;
    const lcp = perf.lcp != null ? (perf.lcp / 1000).toFixed(1) + 's' : null;
    const cls = perf.cls != null ? perf.cls.toFixed(2) : null;
    const fcp = perf.fcp != null ? (perf.fcp / 1000).toFixed(1) + 's' : null;
    const ttfb = perf.ttfb != null ? perf.ttfb + 'ms' : null;

    el.innerHTML =
      '<div id="auditPrevBanner" style="margin:7px 8px;background:#f0faf5;border:1px solid #00e5a0;border-radius:7px;overflow:hidden;font-size:10px">' +
        // Header row
        '<div style="padding:7px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(0,229,160,.25)">' +
          '<span style="font-size:14px;flex-shrink:0">⏱</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:700;color:#0a6e51;font-size:10px">Previous scan available</div>' +
            '<div style="color:#555;font-size:8.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + lastUrl.replace(/"/g,'&quot;') + '">' + truncUrl + (ago ? ' · ' + ago : '') + '</div>' +
          '</div>' +
          '<button id="auditDismissPrevBtn" title="Dismiss" style="background:none;border:none;color:#888;cursor:pointer;font-size:15px;padding:0 2px;flex-shrink:0">×</button>' +
        '</div>' +
        // Score row
        '<div style="padding:7px 10px;display:flex;align-items:center;gap:8px">' +
          (lastGrade ? '<div style="background:' + gradeColor(lastScore) + ';color:#fff;border-radius:5px;padding:4px 10px;text-align:center;flex-shrink:0">' +
            '<div style="font-size:7px;opacity:.8;letter-spacing:.06em">GRADE</div>' +
            '<div style="font-size:18px;font-weight:900;line-height:1">' + lastGrade + '</div>' +
            '<div style="font-size:8px;font-family:monospace;font-weight:700">' + (lastScore ?? '') + '</div>' +
          '</div>' : '') +
          '<div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">' +
            miniScore('⚡ Perf', perfScore) + miniScore('🔒 Sec', secScore) + miniScore('♿ A11y', a11yScore) +
          '</div>' +
        '</div>' +
        // Issue chips
        '<div style="padding:0 10px 6px;display:flex;gap:4px;flex-wrap:wrap">' +
          chip('Links', brokenLinks === 0, brokenLinks) +
          chip('Images', brokenImages === 0, brokenImages) +
          (spellingIssues ? '<span style="padding:2px 7px;background:#fcebeb;color:#c0392b;border-radius:8px;font-size:8.5px;font-weight:700">⚠ ' + spellingIssues + ' Spelling</span>' : '<span style="padding:2px 7px;background:#d3f0e1;color:#0a6e51;border-radius:8px;font-size:8.5px;font-weight:700">✓ Spelling</span>') +
          (a11yIssues ? '<span style="padding:2px 7px;background:#fcebeb;color:#c0392b;border-radius:8px;font-size:8.5px;font-weight:700">⚠ ' + a11yIssues + ' A11y</span>' : '') +
          (secIssues ? '<span style="padding:2px 7px;background:#fde8c8;color:#b45309;border-radius:8px;font-size:8.5px;font-weight:700">⚠ ' + secIssues + ' Security</span>' : '') +
        '</div>' +
        // CWV quick stats + view button
        '<div style="padding:5px 10px;border-top:1px solid rgba(0,229,160,.2);display:flex;align-items:center;justify-content:space-between;background:rgba(0,229,160,.06)">' +
          '<span style="font-size:8px;color:#888;font-family:monospace">' +
            [lcp ? 'LCP ' + lcp : null, cls ? 'CLS ' + cls : null, fcp ? 'FCP ' + fcp : null, ttfb ? 'TTFB ' + ttfb : null].filter(Boolean).join(' · ') +
          '</span>' +
          '<button id="auditShowPrevBtn" style="background:#00e5a0;border:none;border-radius:4px;padding:4px 12px;color:#0f141d;font-size:9.5px;font-weight:700;cursor:pointer">View full results →</button>' +
        '</div>' +
      '</div>' +
      '<div class="empty" style="padding:22px 12px"><div class="empty-icon">🔍</div>' +
      '<div class="empty-text">Scanning a new page<br><span style="font-size:9px;opacity:.6">Click ▶ Run to audit · Links · Images · Perf · Security · A11y</span></div></div>';

    document.getElementById('auditShowPrevBtn')?.addEventListener('click', () => {
      auditResults  = data; auditPageInfo = pageInfo;
      renderAuditResults(data);
    });
    document.getElementById('auditDismissPrevBtn')?.addEventListener('click', () => {
      document.getElementById('auditPrevBanner')?.remove();
    });
    return;
  }

  // Same URL — auto-restore results
  auditResults  = data;
  auditPageInfo = pageInfo;
  renderAuditResults(data);
}

function setAuditLoading(loading) {
  auditRunning = loading;
  const btn     = document.getElementById('auditRunBtn');
  const spinner = document.getElementById('auditSpinner');
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? '⏳ Scanning…' : '▶ Run Audit';
  if (spinner) spinner.style.display = loading ? 'flex' : 'none';
}

function showAuditError(msg) {
  const el = document.getElementById('auditContent');
  if (el) el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">' + msg + '</div></div>';
  const hdr = document.getElementById('auditPageHeader');
  if (hdr) hdr.style.display = 'none';
}

function renderAuditResults(data) {
  const el = document.getElementById('auditContent');
  if (!el) return;

  const brokenLinks  = (data.linkResults || []).filter(l => !l.ok);
  const allLinks     = data.linkResults || [];
  const broken       = data.images   || [];
  const spelling     = data.spelling || [];

  // Page header
  const hdr = document.getElementById('auditPageHeader');
  if (hdr && auditPageInfo) {
    hdr.style.display = 'block';
    hdr.innerHTML =
      '<div class="audit-page-title">' + (auditPageInfo.title || 'Untitled') + '</div>' +
      '<div class="audit-page-url">' + auditPageInfo.url + '</div>' +
      '<div class="audit-page-ts">Scanned: ' + new Date(auditPageInfo.ts).toLocaleString('en-AU') + (auditResults?.spellEngine ? ' · Spell: ' + auditResults.spellEngine : '') + '</div>';
  }

  const redirectCount = allLinks.filter(l => l.ok && l.redirected).length;
  const perf     = auditResults.perf     || {};
  const security = auditResults.security || {};
  const a11y     = auditResults.a11y     || [];
  const a11yErrors = a11y.filter(i => i.type === 'error').length;
  const a11yWarns  = a11y.filter(i => i.type === 'warn').length;
  const cookieIssues = (security.cookies?.insecure?.length || 0)
                     + (security.cookies?.nonHttpOnlySensitive?.length || 0)
                     + (security.cookies?.weakSameSite?.length || 0);
  const secIssues  = (security.mixedContent?.length || 0)
                   + (security.unsafeBlankLinks?.length || 0)
                   + (!security.isHTTPS ? 1 : 0)
                   + cookieIssues;

  // A-18 Diff against previous results (if available)
  let diffBanner = '';
  if (auditPreviousResults) {
    const prevBroken = (auditPreviousResults.linkResults || []).filter(l => !l.ok).length;
    const prevImages = (auditPreviousResults.images || []).length;
    const prevSpell  = (auditPreviousResults.spelling || []).length;
    const prevA11y   = (auditPreviousResults.a11y || []).length;
    const parts = [];
    const diff = (cur, prev, label) => {
      const d = cur - prev;
      if (d === 0) return null;
      const sign = d > 0 ? '+' : '';
      const color = d > 0 ? 'var(--warn)' : 'var(--accent)';
      return '<span style="color:' + color + ';font-weight:700">' + sign + d + ' ' + label + '</span>';
    };
    [
      diff(brokenLinks.length, prevBroken, 'broken'),
      diff(broken.length, prevImages, 'image'),
      diff(spelling.length, prevSpell, 'spelling'),
      diff(a11y.length, prevA11y, 'a11y'),
    ].filter(Boolean).forEach(p => parts.push(p));
    if (parts.length) {
      diffBanner =
        '<div style="padding:5px 10px;background:var(--card);border-left:2px solid var(--accent);' +
          'font-size:9px;display:flex;gap:10px;flex-wrap:wrap">' +
          '<span style="color:var(--muted);font-weight:700">Δ vs last run:</span>' +
          parts.join('<span style="color:var(--border)">·</span>') +
        '</div>';
    } else {
      diffBanner =
        '<div style="padding:5px 10px;background:var(--accent-light);border-left:2px solid var(--accent);' +
          'font-size:9px;color:var(--accent);font-weight:700">= No change since last run</div>';
    }
  }

  // ── Compute scores (Fix 21) — Lighthouse-ish curves ─────────────────────
  function clamp01(n) { return Math.max(0, Math.min(1, n)); }
  function scoreLCP(ms)  { if (ms == null) return null; return ms <= 2500 ? 100 : ms >= 6000 ? 0 : Math.round(100 * clamp01((6000 - ms) / 3500)); }
  function scoreFCP(ms)  { if (ms == null) return null; return ms <= 1800 ? 100 : ms >= 4500 ? 0 : Math.round(100 * clamp01((4500 - ms) / 2700)); }
  function scoreTTFB(ms) { if (ms == null) return null; return ms <=  500 ? 100 : ms >= 2500 ? 0 : Math.round(100 * clamp01((2500 - ms) / 2000)); }
  function scoreCLS(c)   { if (c  == null) return null; return c  <= 0.10 ? 100 : c  >= 0.40 ? 0 : Math.round(100 * clamp01((0.40 - c) / 0.30)); }

  function avg(arr) {
    const v = arr.filter(x => x != null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  }

  const perfScore = avg([scoreLCP(perf.lcp), scoreFCP(perf.fcp), scoreTTFB(perf.ttfb), scoreCLS(perf.cls)]);

  // Security score — start at 100, deduct per category of issue
  let secScore = 100;
  if (security && Object.keys(security).length) {
    if (!security.isHTTPS) secScore -= 30;
    secScore -= Math.min(20, (security.mixedContent?.length || 0) * 5);
    secScore -= Math.min(15, (security.unsafeBlankLinks?.length || 0) * 2);
    secScore -= Math.min(10, (security.cookies?.insecure?.length || 0) * 2);
    secScore -= Math.min(10, (security.cookies?.nonHttpOnlySensitive?.length || 0) * 3);
    secScore -= Math.min(10, (security.cookies?.weakSameSite?.length || 0) * 1);
    const missingHeaders = Array.isArray(security.missingHeaders) ? security.missingHeaders.length : 0;
    secScore -= Math.min(20, missingHeaders * 4);
    secScore = Math.max(0, secScore);
  } else {
    secScore = null;
  }

  // A11y score — error worth 4 points each, warning 1 point, capped
  let a11yScore = null;
  if (Array.isArray(a11y) && a11y.length >= 0) {
    a11yScore = Math.max(0, 100 - Math.min(100, a11yErrors * 4 + a11yWarns * 1));
  }

  // Overall — weighted blend of available scores (or null if all null)
  function blend(scores, weights) {
    let sum = 0, wSum = 0;
    scores.forEach((s, i) => { if (s != null) { sum += s * weights[i]; wSum += weights[i]; } });
    return wSum ? Math.round(sum / wSum) : null;
  }
  const overallScore = blend([perfScore, secScore, a11yScore], [0.5, 0.3, 0.2]);

  function gradeFor(score) {
    if (score == null) return '–';
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    if (score >= 45) return 'D';
    return 'F';
  }
  function gradeColor(score) {
    if (score == null) return '#888';
    if (score >= 75) return '#0a6e51';
    if (score >= 45) return '#b45309';
    return '#c0392b';
  }
  const overallGrade = gradeFor(overallScore);

  // Persist scores into storage — here we have all vars in scope (Fix 47)
  chrome.storage.local.get(AUDIT_STORAGE_KEY).then(stored => {
    const existing = stored[AUDIT_STORAGE_KEY] || {};
    chrome.storage.local.set({
      qa_audit_last: { score: overallScore, grade: overallGrade, ts: Date.now(), url: auditPageInfo?.url },
      [AUDIT_STORAGE_KEY]: {
        ...existing,
        pageInfo: {
          ...(existing.pageInfo || auditPageInfo),
          grade:     overallGrade,
          score:     overallScore,
          perfScore: perfScore,
          secScore:  secScore,
          a11yScore: a11yScore,
        }
      }
    }).catch(() => {});
  }).catch(() => {});

  // Score dashboard banner — replaces the awkward "Perf shows ✓" chip
  function scoreCell(label, score, icon, sub) {
    const g = gradeFor(score);
    const c = gradeColor(score);
    return '<div data-score-nav="' + sub + '" style="display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 8px;background:var(--card);border-radius:5px;border:1.5px solid ' + c + ';flex:1;min-width:0;cursor:pointer" title="Click to view ' + label + ' details">' +
      '<div style="font-size:8px;color:' + c + ';letter-spacing:.04em;text-transform:uppercase;font-weight:700">' + icon + ' ' + label + '</div>' +
      '<div style="font-size:14px;font-weight:900;color:' + c + ';font-family:monospace;line-height:1">' + (score != null ? score : '–') + '</div>' +
      '<div style="font-size:9px;font-weight:700;color:' + c + '">' + g + '</div>' +
      '<div style="font-size:7px;color:' + c + ';opacity:.7;margin-top:1px">tap →</div>' +
    '</div>';
  }

  // Quick CWV stats row
  const lcp  = perf.lcp  != null ? (perf.lcp / 1000).toFixed(1) + 's' : null;
  const fcp  = perf.fcp  != null ? (perf.fcp / 1000).toFixed(1) + 's' : null;
  const cls  = perf.cls  != null ? perf.cls.toFixed(2) : null;
  const ttfb = perf.ttfb != null ? perf.ttfb + 'ms' : null;
  const cwvPairs = [['LCP', lcp, 2500], ['FCP', fcp, 1800], ['CLS', cls, 0.1], ['TTFB', ttfb, 600]];
  const cwvHtml = cwvPairs.filter(([, v]) => v != null).map(([k, v, thresh]) => {
    const val = parseFloat(v);
    const ok = !isNaN(val) && val <= thresh;
    return '<div style="flex:1;background:var(--card);border-radius:4px;padding:3px 5px;display:flex;justify-content:space-between;align-items:center;font-size:8px">' +
      '<span style="color:var(--muted)">' + k + '</span>' +
      '<span style="font-family:monospace;font-weight:700;color:' + (ok ? '#0a6e51' : '#c0392b') + '">' + v + (ok ? ' ✓' : '') + '</span>' +
    '</div>';
  }).join('');

  const overallC = gradeColor(overallScore);
  const dashHtml =
    '<div class="audit-score-dashboard" style="display:flex;flex-direction:column;gap:6px;padding:8px 10px;background:var(--surface);border-bottom:1px solid var(--border)">' +
      '<div style="display:flex;align-items:stretch;gap:6px">' +
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 12px;background:' + overallC + ';color:#fff;border-radius:6px;min-width:60px;flex-shrink:0">' +
          '<div style="font-size:8px;letter-spacing:.06em;font-weight:700;opacity:.85">OVERALL</div>' +
          '<div style="font-size:22px;font-weight:900;line-height:1">' + overallGrade + '</div>' +
          '<div style="font-size:9px;font-family:monospace;font-weight:700">' + (overallScore != null ? overallScore + '/100' : '—') + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:5px;flex:1">' +
          scoreCell('Perf',     perfScore,  '⚡', 'perf') +
          scoreCell('Security', secScore,   '🔒', 'security') +
          scoreCell('A11y',     a11yScore,  '♿', 'a11y') +
        '</div>' +
      '</div>' +
      (cwvHtml ? '<div style="display:flex;gap:4px">' + cwvHtml + '</div>' : '') +
    '</div>';

  let html = diffBanner + dashHtml + '<div class="audit-summary">';
  html += auditChip(brokenLinks.length === 0 ? '✓' : brokenLinks.length, 'Broken Links', brokenLinks.length > 0 ? 'warn' : 'ok', 'broken-links');
  html += auditChip(redirectCount      === 0 ? '✓' : redirectCount,      'Redirects',    redirectCount > 0 ? 'info' : 'ok', 'redirects');
  html += auditChip(broken.length      === 0 ? '✓' : broken.length,      'Images',       broken.length > 0 ? 'warn' : 'ok', 'images');
  html += auditChip(spelling.length    === 0 ? '✓' : spelling.length,    'Spelling',     spelling.length > 0 ? 'info' : 'ok', 'spelling');
  html += auditChip((a11yErrors+a11yWarns) === 0 ? '✓' : (a11yErrors+a11yWarns), 'A11y issues', a11yErrors > 0 ? 'warn' : a11yWarns > 0 ? 'info' : 'ok', 'a11y');
  html += '</div>';

  // Links — broken and redirected shown separately
  const redirectedLinks = allLinks.filter(l => l.ok && l.redirected);
  if (brokenLinks.length > 0) {
    html += '<div class="audit-section-title">🔗 Broken Links (' + brokenLinks.length + ')</div>';
    brokenLinks.forEach(l => {
      html += '<div class="audit-item warn">' +
        '<div class="audit-item-label">HTTP ' + (l.status || 'ERR') + (l.error ? ' (' + l.error.slice(0,40) + ')' : '') + ' — ' + (l.text || '') + '</div>' +
        '<div class="audit-item-url">' + l.href + '</div>' +
        '</div>';
    });
  } else {
    html += '<div class="audit-ok-row">✓ No broken links (' + allLinks.length + ' checked)</div>';
  }
  if (redirectedLinks.length > 0) {
    html += '<div class="audit-section-title">↪ Redirected Links (' + redirectedLinks.length + ')</div>';
    redirectedLinks.forEach(l => {
      // A-3 Show the redirect kind based on originalStatus
      const code = l.originalStatus || l.status;
      const kind = code === 301 ? '301 Permanent' :
                   code === 302 ? '302 Temporary' :
                   code === 307 ? '307 Temporary (preserve method)' :
                   code === 308 ? '308 Permanent (preserve method)' :
                   code === 'redirect' ? 'Cross-origin redirect' :
                   'HTTP ' + code;
      html += '<div class="audit-item info">' +
        '<div class="audit-item-label">' + kind + ' — ' + (l.text || '') + '</div>' +
        '<div class="audit-item-url">' + l.href + '</div>' +
        '<div class="audit-item-url" style="color:#00e5a0">→ ' + l.finalUrl + '</div>' +
        '</div>';
    });
  }

  // Images — show filename prominently, full URL below. A-23 oversized tagged.
  if (broken.length > 0) {
    // Separate by kind for clearer display
    const missing   = broken.filter(i => i.kind !== 'oversized' && i.kind !== 'css-bg-oversized');
    const oversized = broken.filter(i => i.kind === 'oversized' || i.kind === 'css-bg-oversized');

    if (missing.length) {
      html += '<div class="audit-section-title">🖼 Missing / Broken Images (' + missing.length + ')</div>';
      missing.forEach(img => {
        let fname = img.src;
        try { fname = new URL(img.src, auditPageInfo?.url || location.href).pathname.split('/').filter(Boolean).pop() || img.src; } catch {}
        html += '<div class="audit-item warn">' +
          '<div class="audit-item-label">' + (img.issue || 'Failed to load') + (fname && fname !== img.src ? ' — <span style="color:#b45309;font-weight:700">' + fname + '</span>' : '') + '</div>' +
          '<div class="audit-item-url">' + img.src + '</div>' +
          '</div>';
      });
    }
    if (oversized.length) {
      html += '<div class="audit-section-title">📦 Oversized Images (' + oversized.length + ', &gt;500 KB)</div>';
      oversized.forEach(img => {
        let fname = img.src;
        try { fname = new URL(img.src, auditPageInfo?.url || location.href).pathname.split('/').filter(Boolean).pop() || img.src; } catch {}
        html += '<div class="audit-item info">' +
          '<div class="audit-item-label">' + img.issue + ' — <span style="color:#b45309;font-weight:700">' + fname + '</span></div>' +
          '<div class="audit-item-url">' + img.src + '</div>' +
          '</div>';
      });
    }
  } else {
    html += '<div class="audit-ok-row">✓ No missing, broken or oversized images</div>';
  }

  // Spelling — rendered async so we can filter custom dict
  el.innerHTML = html + '<div id="spellSection"></div>';
  renderSpellingSection(spelling);

  // Show sub-tab bar and populate dedicated panels
  const subBar = document.getElementById('auditSubTabBar');
  if (subBar) subBar.style.display = '';
  // Reset to overview tab
  document.querySelectorAll('[data-auditsub]').forEach(b => b.classList.toggle('active', b.dataset.auditsub === 'overview'));
  document.getElementById('auditContent').style.display     = '';
  document.getElementById('auditPerfContent').style.display = 'none';
  document.getElementById('auditSecContent').style.display  = 'none';
  document.getElementById('auditA11yContent').style.display = 'none';

  // Populate Perf sub-panel (will show empty prompt if no data — preserves Run bar)
  const perfEl = document.getElementById('auditPerfContent');
  if (perfEl) renderPerfSection(perf, perfEl);
  // Populate Security sub-panel
  const secEl = document.getElementById('auditSecContent');
  if (secEl)  renderSecSection(security, secEl);
  // Populate A11y sub-panel
  const a11yEl = document.getElementById('auditA11yContent');
  if (a11yEl) renderA11ySection(a11y, a11yEl);

  // Wire score chip clicks to navigate to sub-tabs (Fix 42b)
  document.querySelectorAll('[data-score-nav]').forEach(chip => {
    chip.addEventListener('click', () => {
      const sub = chip.dataset.scoreNav;
      const btn = document.querySelector('[data-auditsub="' + sub + '"]');
      if (btn) btn.click();
    });
  });

  // Wire clickable summary tiles to jump to relevant sections
  wireSummaryTileJumps();
}

// Fix 5b: Make the overview summary tiles clickable. Each tile jumps to the
// relevant section — in-panel sections scroll into view, sub-tab targets
// switch sub-tab and auto-run if no data yet.
function wireSummaryTileJumps() {
  const auditEl = document.getElementById('auditContent');
  if (!auditEl) return;
  // Map of tile data-type → scroll target OR sub-tab id
  const JUMP_MAP = {
    'broken-links':  { type: 'scroll', selector: '.audit-section-title:nth-of-type(1)', needle: 'Broken Links' },
    'redirects':     { type: 'scroll', needle: 'Redirected Links' },
    'images':        { type: 'scroll', needle: 'Images' },
    'spelling':      { type: 'scroll', needle: 'Spelling' },
    'perf':          { type: 'subtab', tab: 'perf' },
    'security':      { type: 'subtab', tab: 'security' },
    'a11y':          { type: 'subtab', tab: 'a11y' },
  };
  auditEl.querySelectorAll('.audit-chip').forEach(chip => {
    const dataType = chip.dataset.jumpto || chip.dataset.type;
    if (!dataType) return;
    const target = JUMP_MAP[dataType];
    if (!target) return;
    chip.style.cursor = 'pointer';
    chip.setAttribute('title', 'Click to view ' + dataType);
    chip.addEventListener('click', () => {
      if (target.type === 'scroll') {
        // Find the section heading with the needle text
        const headings = auditEl.querySelectorAll('.audit-section-title');
        for (const h of headings) {
          if (h.textContent.includes(target.needle)) {
            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
            h.style.transition = 'background .2s';
            h.style.background = 'var(--accent-light)';
            setTimeout(() => { h.style.background = ''; }, 1200);
            return;
          }
        }
        // No matching section — probably because count was 0
        showLsToast('No ' + dataType.replace('-', ' ') + ' to show');
      } else if (target.type === 'subtab') {
        const btn = document.querySelector('[data-auditsub="' + target.tab + '"]');
        if (btn) {
          btn.click();
          // Auto-run if the sub-panel is empty
          const panelId = 'audit' + target.tab.charAt(0).toUpperCase() + target.tab.slice(1) + 'Content';
          const panel = document.getElementById(
            target.tab === 'perf' ? 'auditPerfContent' :
            target.tab === 'security' ? 'auditSecContent' :
            target.tab === 'a11y' ? 'auditA11yContent' : panelId
          );
          if (panel) {
            const hasData = panel.querySelector('.audit-section-title');
            if (!hasData) {
              // Auto-trigger the Run button inside the sub-panel after a tick
              setTimeout(() => {
                const runBtn = panel.querySelector('[data-subrun]');
                if (runBtn) runBtn.click();
              }, 120);
            }
          }
        }
      }
    });
  });
}

async function renderSpellingSection(spelling) {
  const container = document.getElementById('spellSection');
  if (!container) return;

  const customDict = await getCustomDict();
  const filtered   = spelling.filter(s => !customDict.has(s.wrong.toLowerCase()));

  // Update the chip count
  const chip = document.querySelector('.audit-chip[data-type="spelling"]');
  if (chip) {
    const cnt = filtered.length;
    chip.querySelector('.chip-val').textContent = cnt === 0 ? '✓' : cnt;
    chip.style.borderColor = cnt > 0 ? '#ff9f43' : '#007a5a';
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="audit-ok-row">✓ No spelling issues (or all added to dictionary)</div>';
    return;
  }

  // A-4 Show truncation indicator when spelling was capped at 50
  const totalFound = auditResults?.spellTotalFound || filtered.length;
  const wasTruncated = auditResults?.spellingTruncated;
  let html = '<div class="audit-section-title">✍️ Spelling Issues (' +
    filtered.length +
    (wasTruncated ? ' shown of ' + totalFound + '+ found — capped at 50' : '') +
    ')</div>';
  filtered.forEach(s => {
    const safeWord = s.wrong.replace(/"/g, '&quot;');
    html += '<div class="audit-item info" style="display:flex;align-items:flex-start;gap:6px;padding:6px 10px;">' +
      '<div style="flex:1">' +
        '<div class="audit-item-label"><span style="color:#b45309">"' + s.wrong + '"</span>' +
          (s.right && s.right !== '?' ? ' \u2192 <span style="color:#007a5a">"' + s.right + '"</span>' : '') +
        '</div>' +
        '<div class="audit-item-url">' + s.snippet + '</div>' +
      '</div>' +
      '<button class="audit-dict-btn" data-word="' + safeWord + '" ' +
        'style="font-size:8px;padding:2px 7px;border-radius:4px;border:1px solid #b45309;' +
        'background:#fef3c7;color:#b45309;cursor:pointer;white-space:nowrap;flex-shrink:0;font-family:monospace;font-weight:700">' +
        '+ Dict' +
      '</button>' +
    '</div>';
  });
  container.innerHTML = html;

  // Wire dict buttons via event delegation (avoids inline onclick quoting issues)
  container.querySelectorAll('.audit-dict-btn').forEach(btn => {
    btn.addEventListener('click', () => window.auditAddToDict(btn.dataset.word, btn));
  });
}

function renderPerfSection(perf, targetEl) {
  const el = targetEl || document.getElementById('perfSection');
  if (!el || !perf) return;
  // Preserve the sub-run bar (Run button) at top by only touching the body
  // below it. If empty perf data, show a prompt — don't replace the whole
  // panel contents.
  const body = el.querySelector('.audit-subrun-body') || (function(){
    const b = document.createElement('div');
    b.className = 'audit-subrun-body';
    el.appendChild(b);
    return b;
  })();

  if (!Object.keys(perf).length) {
    body.innerHTML = '<div class="empty" style="padding:20px 12px"><div class="empty-icon">⚡</div><div class="empty-text">No performance data yet — Run an audit from the Overview tab.</div></div>';
    return;
  }

  function metricColor(val, good, warn) {
    if (val == null) return '#888';
    return val <= good ? '#0a6e51' : val <= warn ? '#b45309' : '#c0392b';
  }
  function metricGrade(val, good, warn) {
    if (val == null) return '–';
    return val <= good ? 'Good' : val <= warn ? 'Needs work' : 'Poor';
  }
  function metricCard(label, val, unit, good, warn, desc) {
    if (val == null) return '';
    const c = metricColor(val, good, warn);
    const grade = metricGrade(val, good, warn);
    return '<div style="background:var(--card);border:2px solid ' + c + ';border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:2px">' +
      '<div style="font-size:8px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase">' + label + '</div>' +
      '<div style="font-size:18px;font-weight:900;color:' + c + ';line-height:1.1;font-family:monospace">' + val + '<span style="font-size:10px;font-weight:400"> ' + unit + '</span></div>' +
      '<div style="font-size:8px;font-weight:700;color:' + c + '">' + grade + '</div>' +
      (desc ? '<div style="font-size:8px;color:var(--muted);margin-top:2px">' + desc + '</div>' : '') +
      '</div>';
  }

  let h = '<div class="audit-section-title">⚡ Core Web Vitals</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:8px">';
  h += metricCard('LCP', perf.lcp, 'ms', 2500, 4000, 'Largest Contentful Paint');
  h += metricCard('FCP', perf.fcp, 'ms', 1800, 3000, 'First Contentful Paint');
  h += metricCard('TTFB', perf.ttfb, 'ms', 200, 500, 'Time to First Byte');
  h += metricCard('CLS', perf.cls != null ? +perf.cls : null, '', 0.1, 0.25, 'Cumulative Layout Shift');
  h += '</div>';

  // A-21 LCP element identification
  if (perf.lcpElementPath) {
    h += '<div style="padding:4px 10px;font-size:8.5px;color:var(--muted);' +
      'font-family:monospace;background:var(--card);border-radius:4px;margin:0 8px 4px">' +
      'LCP element: <span style="color:var(--text)">' + perf.lcpElementPath + '</span></div>';
  }
  // A-10 CLS methodology note
  if (perf.clsNote) {
    h += '<div style="padding:2px 10px 4px;font-size:8px;color:var(--muted);font-style:italic">' +
      '* CLS is a running total since page load — not the proper CWV session-window calculation</div>';
  }

  h += '<div class="audit-section-title" style="font-size:8.5px;padding:4px 10px 2px">📦 Page Stats</div>';
  h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:6px 8px;font-size:9px">';

  function statRow(label, val, good, warn) {
    const c = (good != null && val != null) ? metricColor(val, good, warn) : 'var(--text)';
    return '<div style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px">' +
      '<div style="font-size:8px;color:var(--muted)">' + label + '</div>' +
      '<div style="font-size:13px;font-weight:700;color:' + c + ';font-family:monospace">' + (val ?? '–') + '</div>' +
      '</div>';
  }
  h += statRow('DOM Nodes',    perf.domNodes,      1500, 3000);
  h += statRow('Resources',    perf.resourceCount, null, null);
  h += statRow('Page Weight',  (perf.totalKB != null ? perf.totalKB + ' KB' : null), null, null);
  h += statRow('Load Time',    (perf.loadTime != null ? perf.loadTime + ' ms' : null), 3000, 6000);
  h += '</div>';

  if (perf.slowResources && perf.slowResources.length) {
    h += '<div class="audit-section-title" style="font-size:8.5px;padding:4px 10px 2px">⏱ Slow Resources (&gt;1s)</div>';
    perf.slowResources.forEach(r => {
      h += '<div class="audit-item warn" style="padding:4px 10px">' +
        '<div class="audit-item-url" style="display:flex;justify-content:space-between">' +
        '<span>' + r.url + '</span>' +
        '<span style="color:var(--warn);font-weight:700;flex-shrink:0;margin-left:8px">' + r.ms + ' ms</span>' +
        '</div></div>';
    });
  } else {
    h += '<div class="audit-ok-row">✓ No slow resources (&gt;1s)</div>';
  }
  body.innerHTML = h;
}

function renderSecSection(sec, targetEl) {
  const el = targetEl || document.getElementById('secSection');
  if (!el) return;
  const body = el.querySelector('.audit-subrun-body') || (function(){
    const b = document.createElement('div');
    b.className = 'audit-subrun-body';
    el.appendChild(b);
    return b;
  })();
  if (!sec || !Object.keys(sec).length) {
    body.innerHTML = '<div class="empty" style="padding:20px 12px"><div class="empty-icon">🔒</div><div class="empty-text">No security data yet — Run an audit from the Overview tab.</div></div>';
    return;
  }
  const rows = [];
  if (!sec.isHTTPS) {
    rows.push({ type:'warn', msg:'Page served over HTTP — not HTTPS' });
  } else {
    rows.push({ type:'ok', msg:'HTTPS enabled' });
  }
  if (sec.mixedContent && sec.mixedContent.length) {
    rows.push({ type:'warn', msg: sec.mixedContent.length + ' mixed content resource(s) on HTTPS page', detail: sec.mixedContent.join(', ') });
  } else if (sec.isHTTPS) {
    rows.push({ type:'ok', msg:'No mixed content detected' });
  }
  if (sec.unsafeBlankLinks && sec.unsafeBlankLinks.length) {
    rows.push({ type:'warn', msg: sec.unsafeBlankLinks.length + ' external link(s) missing rel="noopener"', detail: sec.unsafeBlankLinks.join(', ') });
  }
  rows.push({ type: sec.hasCSP      ? 'ok' : 'info', msg: sec.hasCSP      ? 'Content-Security-Policy meta tag present' : 'No Content-Security-Policy meta tag found' });
  rows.push({ type: sec.hasReferrer ? 'ok' : 'info', msg: sec.hasReferrer ? 'Referrer-Policy meta tag present'          : 'No Referrer-Policy meta tag found' });

  // A-11 Cookie security flags
  if (sec.cookies) {
    const c = sec.cookies;
    rows.push({ type: 'info', msg: c.total + ' cookie(s) set on this domain', detail: '' });
    if (c.insecure.length) {
      rows.push({
        type: 'warn',
        msg: c.insecure.length + ' cookie(s) missing Secure flag on HTTPS page',
        detail: c.insecure.slice(0, 5).join(', ') + (c.insecure.length > 5 ? ' …' : ''),
      });
    }
    if (c.nonHttpOnlySensitive.length) {
      rows.push({
        type: 'warn',
        msg: c.nonHttpOnlySensitive.length + ' sensitive cookie(s) missing HttpOnly flag',
        detail: 'Session/auth/token/csrf cookies should set HttpOnly: ' + c.nonHttpOnlySensitive.slice(0, 5).join(', '),
      });
    }
    if (c.weakSameSite.length) {
      rows.push({
        type: 'info',
        msg: c.weakSameSite.length + ' cookie(s) with weak/unset SameSite',
        detail: 'Consider SameSite=Lax or Strict: ' + c.weakSameSite.slice(0, 5).join(', ') + (c.weakSameSite.length > 5 ? ' …' : ''),
      });
    }
    if (c.total > 0 && !c.insecure.length && !c.nonHttpOnlySensitive.length && !c.weakSameSite.length) {
      rows.push({ type: 'ok', msg: 'All cookies have appropriate security flags' });
    }
  }

  // Expanded security (3d)
  if (sec.cspIssues && sec.cspIssues.length) {
    rows.push({ type: 'warn', msg: 'CSP weaknesses detected', detail: sec.cspIssues.join(' · ') });
  }
  if (sec.sriMissingScripts && sec.sriMissingScripts.length) {
    rows.push({
      type: 'warn',
      msg: sec.sriMissingScripts.length + ' external script(s) missing SRI integrity',
      detail: sec.sriMissingScripts.join(', '),
    });
  }
  if (sec.sriMissingStyles && sec.sriMissingStyles.length) {
    rows.push({
      type: 'info',
      msg: sec.sriMissingStyles.length + ' external stylesheet(s) missing SRI integrity',
      detail: sec.sriMissingStyles.join(', '),
    });
  }
  if (sec.insecureForms && sec.insecureForms.length) {
    rows.push({
      type: 'warn',
      msg: sec.insecureForms.length + ' form(s) submit over HTTP on HTTPS page',
      detail: sec.insecureForms.join(', '),
    });
  }
  if (sec.httpPasswordInputs > 0) {
    rows.push({
      type: 'warn',
      msg: sec.httpPasswordInputs + ' password input(s) on HTTP page',
      detail: 'Password inputs require HTTPS',
    });
  }
  if (sec.thirdPartyCount != null) {
    if (sec.thirdPartyCount > 20) {
      rows.push({
        type: 'warn',
        msg: sec.thirdPartyCount + ' distinct third-party script origins',
        detail: 'Sample: ' + (sec.thirdPartyOrigins || []).slice(0, 4).join(', '),
      });
    } else if (sec.thirdPartyCount > 0) {
      rows.push({
        type: 'info',
        msg: sec.thirdPartyCount + ' third-party script origin(s)',
        detail: (sec.thirdPartyOrigins || []).slice(0, 4).join(', '),
      });
    }
  }
  if (sec.sensitiveLsKeys && sec.sensitiveLsKeys.length) {
    rows.push({
      type: 'warn',
      msg: sec.sensitiveLsKeys.length + ' sensitive-looking localStorage key(s)',
      detail: 'Review for token/auth leakage: ' + sec.sensitiveLsKeys.join(', '),
    });
  }

  // Response headers (fetched at extension level — optional)
  if (sec.responseHeaders) {
    const rh = sec.responseHeaders;
    rows.push({ type: rh.hsts        ? 'ok' : 'warn', msg: 'HSTS header: '            + (rh.hsts        || 'MISSING') });
    rows.push({ type: rh.cspHeader   ? 'ok' : 'info', msg: 'CSP response header: '    + (rh.cspHeader   ? 'present' : 'not set (meta tag only)') });
    rows.push({ type: rh.xFrameOpts  ? 'ok' : 'info', msg: 'X-Frame-Options: '        + (rh.xFrameOpts  || 'MISSING') });
    rows.push({ type: rh.xContentTypeOpts ? 'ok' : 'info', msg: 'X-Content-Type-Options: ' + (rh.xContentTypeOpts || 'MISSING') });
    rows.push({ type: rh.permissionsPolicy ? 'ok' : 'info', msg: 'Permissions-Policy: ' + (rh.permissionsPolicy ? 'set' : 'MISSING') });
  }

  let h = '<div class="audit-section-title">🔒 Security</div>';
  rows.forEach(row => {
    const c    = row.type === 'warn' ? 'var(--warn)' : row.type === 'ok' ? 'var(--accent)' : '#b45309';
    const icon = row.type === 'warn' ? '✗' : row.type === 'ok' ? '✓' : '⚠';
    h += '<div class="audit-item ' + (row.type === 'warn' ? 'warn' : 'info') + '" style="padding:5px 10px">';
    h += '<div class="audit-item-label"><span style="color:' + c + '">' + icon + '</span> ' + row.msg + '</div>';
    if (row.detail) h += '<div class="audit-item-url">' + row.detail + '</div>';
    h += '</div>';
  });
  body.innerHTML = h;
}

function renderA11ySection(a11y, targetEl) {
  const el = targetEl || document.getElementById('a11ySection');
  if (!el) return;
  const body = el.querySelector('.audit-subrun-body') || (function(){
    const b = document.createElement('div');
    b.className = 'audit-subrun-body';
    el.appendChild(b);
    return b;
  })();
  if (!a11y || !a11y.length) {
    body.innerHTML = '<div class="audit-ok-row">✓ No accessibility issues detected</div>';
    return;
  }
  const errors = a11y.filter(i => i.type === 'error');
  const warns  = a11y.filter(i => i.type === 'warn');
  const infos  = a11y.filter(i => i.type === 'info');
  const total  = errors.length + warns.length + infos.length;
  let h = '<div class="audit-section-title">♿ Accessibility (' + total + ' issue' + (total === 1 ? '' : 's') + ')</div>';
  [...errors, ...warns, ...infos].forEach(item => {
    const c    = item.type === 'error' ? 'var(--warn)' : item.type === 'warn' ? '#b45309' : 'var(--muted)';
    const icon = item.type === 'error' ? '✗' : item.type === 'warn' ? '⚠' : 'ℹ';
    h += '<div class="audit-item ' + (item.type === 'error' ? 'warn' : 'info') + '" style="padding:5px 10px">';
    h += '<div class="audit-item-label"><span style="color:' + c + '">' + icon + '</span> ' + item.msg + '</div>';
    if (item.detail) h += '<div class="audit-item-url">' + item.detail + '</div>';
    h += '</div>';
  });
  body.innerHTML = h;
}

function auditChip(val, label, chipType, dataType) {
  const c = { ok: 'var(--accent)', warn: 'var(--warn)', info: '#b45309' }[chipType] || '#888';
  return '<div class="audit-chip" style="border-color:' + c + '"' +
    (dataType ? ' data-type="' + dataType + '"' : '') + '>' +
    '<span class="chip-val" style="color:' + c + ';font-weight:700;font-size:13px">' + val + '</span>' +
    '<span style="color:var(--muted);font-size:9px">' + label + '</span></div>';
}

// A-16 Export in text / json / csv formats.
// Called from the export button with a format string; default is 'text'.
function exportAuditResults(format) {
  if (!auditResults) { showLsToast('Run an audit first', true); return; }
  const fmt = format || 'text';

  if (fmt === 'json') return exportAuditAsJSON();
  if (fmt === 'csv')  return exportAuditAsCSV();
  return exportAuditAsText();
}

function exportAuditAsJSON() {
  const payload = {
    version: '0.0.16',
    pageInfo: auditPageInfo,
    results:  auditResults,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'qa-audit-' + domainFromPage() + '-' + Date.now() + '.json');
  showLsToast('Audit exported (JSON) ✓');
}

function exportAuditAsCSV() {
  const data = auditResults;
  const rows = [];
  rows.push(['Section','Type','Message','Detail','URL']);
  // Broken links
  (data.linkResults || []).filter(l => !l.ok).forEach(l => {
    rows.push(['Broken Link', 'error', 'HTTP ' + (l.status || 'ERR'), l.text || '', l.href]);
  });
  // Redirected links
  (data.linkResults || []).filter(l => l.ok && l.redirected).forEach(l => {
    const code = l.originalStatus || l.status;
    rows.push(['Redirect', 'info', 'HTTP ' + code, l.text || '', l.href + ' → ' + l.finalUrl]);
  });
  // Images
  (data.images || []).forEach(i => {
    rows.push(['Image', i.kind === 'oversized' || i.kind === 'css-bg-oversized' ? 'warn' : 'error', i.issue, '', i.src]);
  });
  // Spelling
  (data.spelling || []).forEach(s => {
    rows.push(['Spelling', 'info', '"' + s.wrong + '" → "' + s.right + '"', s.snippet, '']);
  });
  // A11y
  (data.a11y || []).forEach(i => {
    rows.push(['Accessibility', i.type, i.msg, i.detail || '', '']);
  });
  // Perf metrics as single rows
  const perf = data.perf || {};
  if (perf.lcp != null) rows.push(['Performance', 'metric', 'LCP: ' + perf.lcp + 'ms', perf.lcpElementPath || '', '']);
  if (perf.fcp != null) rows.push(['Performance', 'metric', 'FCP: ' + perf.fcp + 'ms', '', '']);
  if (perf.ttfb != null) rows.push(['Performance', 'metric', 'TTFB: ' + perf.ttfb + 'ms', '', '']);
  if (perf.cls != null) rows.push(['Performance', 'metric', 'CLS: ' + perf.cls, '', '']);
  // Security
  const sec = data.security || {};
  if (sec.cookies) {
    sec.cookies.insecure.forEach(n => rows.push(['Security', 'warn', 'Cookie missing Secure flag', n, '']));
    sec.cookies.nonHttpOnlySensitive.forEach(n => rows.push(['Security', 'warn', 'Sensitive cookie missing HttpOnly', n, '']));
    sec.cookies.weakSameSite.forEach(n => rows.push(['Security', 'info', 'Cookie weak SameSite', n, '']));
  }

  const csvEscape = (s) => {
    s = String(s || '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, 'qa-audit-' + domainFromPage() + '-' + Date.now() + '.csv');
  showLsToast('Audit exported (CSV) ✓');
}

function domainFromPage() {
  try { return new URL(auditPageInfo?.url || 'http://unknown').hostname; }
  catch { return 'unknown'; }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function exportAuditAsText() {
  const data     = auditResults;
  const pi       = auditPageInfo || {};
  const broken   = (data.linkResults || []).filter(l => !l.ok);
  const images   = data.images   || [];
  const spelling = data.spelling || [];

  const line = '═'.repeat(54);
  let txt = line + '\n';
  txt += '  QAKit — Page Audit Report  v1.0.1\n';
  txt += line + '\n';
  txt += 'Page:    ' + (pi.title || '(no title)') + '\n';
  txt += 'URL:     ' + (pi.url   || '') + '\n';
  txt += 'Scanned: ' + (pi.ts ? new Date(pi.ts).toLocaleString('en-AU') : '') + '\n';
  const redirected = (data.linkResults || []).filter(l => l.ok && l.redirected);
  txt += '\n── BROKEN LINKS (' + broken.length + ' of ' + (data.totalLinks || 0) + ' checked) ──\n';
  if (broken.length === 0) txt += '  ✓ None found.\n';
  broken.forEach(l => { txt += '  [' + (l.status || 'ERR') + '] ' + l.href + '\n       "' + l.text + '"\n'; });
  txt += '\n── REDIRECTED LINKS (' + redirected.length + ') ──\n';
  if (redirected.length === 0) txt += '  ✓ None found.\n';
  redirected.forEach(l => {
    const code = l.originalStatus || l.status;
    txt += '  [' + code + '] ' + l.href + '\n  → ' + l.finalUrl + '\n';
  });
  txt += '\n── IMAGES (' + images.length + ') ──\n';
  if (images.length === 0) txt += '  ✓ None found.\n';
  images.forEach(i => {
    let fname = i.src;
    try { fname = new URL(i.src, pi.url || 'http://unknown').pathname.split('/').filter(Boolean).pop() || i.src; } catch {}
    txt += '  [' + (i.issue||'Error') + '] ' + fname + '\n     ' + i.src + '\n';
  });
  txt += '\n── SPELLING ISSUES (' + spelling.length +
    (auditResults.spellingTruncated ? ' shown, ' + auditResults.spellTotalFound + '+ found — capped at 50' : '') +
    ') ──\n';
  if (spelling.length === 0) txt += '  ✓ None found.\n';
  spelling.forEach(s => { txt += '  "' + s.wrong + '" → "' + s.right + '"\n     Context: ' + s.snippet + '\n'; });

  // Performance
  const perf = data.perf || {};
  txt += '\n── PERFORMANCE ──\n';
  if (Object.keys(perf).length) {
    txt += '  TTFB: '    + (perf.ttfb || '–') + 'ms  |  FCP: ' + (perf.fcp  || '–') + 'ms  |  LCP: ' + (perf.lcp || '–') + 'ms  |  CLS: ' + (perf.cls || '–') + '\n';
    if (perf.lcpElementPath) txt += '  LCP element: ' + perf.lcpElementPath + '\n';
    txt += '  DOM nodes: ' + (perf.domNodes || '–') + '  |  Resources: ' + (perf.resourceCount || 0) + '  |  Page weight: ' + (perf.totalKB || 0) + ' KB\n';
    if (perf.slowResources && perf.slowResources.length) {
      txt += '  Slow resources (>1s):\n';
      perf.slowResources.forEach(r => { txt += '    ' + r.ms + 'ms  ' + r.url + '\n'; });
    }
  } else { txt += '  No timing data available.\n'; }

  // Security
  const sec = data.security || {};
  txt += '\n── SECURITY ──\n';
  if (Object.keys(sec).length) {
    txt += '  HTTPS:            ' + (sec.isHTTPS ? '✓ Yes' : '✗ NO') + '\n';
    txt += '  Mixed content:    ' + (sec.mixedContent?.length ? '✗ ' + sec.mixedContent.join(', ') : '✓ None') + '\n';
    txt += '  CSP meta tag:     ' + (sec.hasCSP      ? '✓ Present' : '⚠ Missing') + '\n';
    txt += '  Referrer-Policy:  ' + (sec.hasReferrer ? '✓ Present' : '⚠ Missing') + '\n';
    if (sec.unsafeBlankLinks?.length) txt += '  Unsafe _blank:    ' + sec.unsafeBlankLinks.join(', ') + '\n';
    if (sec.cookies) {
      txt += '  Cookies total:    ' + sec.cookies.total + '\n';
      if (sec.cookies.insecure.length) txt += '  Cookies w/o Secure:    ' + sec.cookies.insecure.join(', ') + '\n';
      if (sec.cookies.nonHttpOnlySensitive.length) txt += '  Sensitive w/o HttpOnly: ' + sec.cookies.nonHttpOnlySensitive.join(', ') + '\n';
      if (sec.cookies.weakSameSite.length) txt += '  Weak SameSite:         ' + sec.cookies.weakSameSite.join(', ') + '\n';
    }
  } else { txt += '  No data.\n'; }

  // Accessibility
  const a11y = data.a11y || [];
  txt += '\n── ACCESSIBILITY (' + a11y.length + ' issue' + (a11y.length === 1 ? '' : 's') + ') ──\n';
  if (a11y.length === 0) txt += '  ✓ None found.\n';
  a11y.forEach(i => {
    const icon = i.type === 'error' ? '✗' : i.type === 'warn' ? '⚠' : 'ℹ';
    txt += '  [' + icon + '] ' + i.msg + (i.detail ? '\n       ' + i.detail : '') + '\n';
  });

  const blob = new Blob([txt], { type: 'text/plain' });
  downloadBlob(blob, 'qa-audit-' + domainFromPage() + '-' + Date.now() + '.txt');
  showLsToast('Audit exported (text) ✓');
}

window.initPageAudit = function() {
  document.getElementById('auditRunBtn')?.addEventListener('click', () => runPageAudit('all'));

  // Restore last audit results immediately on popup open (Fix 33)
  restoreAuditResults();

  // Inject Run button at the top of Perf/Security/A11y sub-panels so those
  // heavy checks only fire when the user wants them.
  function ensureSubRunBar(panelId, scope, desc) {
    const panel = document.getElementById(panelId);
    if (!panel || panel.querySelector('.audit-subrun-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'audit-subrun-bar';
    bar.innerHTML =
      '<span class="audit-subrun-desc">' + desc + '</span>' +
      '<button class="btn-accent" data-subrun="' + scope + '">▶ Run</button>';
    panel.insertBefore(bar, panel.firstChild);
    bar.querySelector('[data-subrun]').addEventListener('click', () => runPageAudit(scope));
  }
  // Per-section Run buttons removed (Fix 27d) — full audit runs everything
  // in one go; sub-tabs always show their data once results are available.
  // ensureSubRunBar(...) calls deleted intentionally.

  // A-16 Export format picker — cycles through or uses dropdown menu
  const exportBtn = document.getElementById('auditExportBtn');
  const exportMenu = document.getElementById('auditExportMenu');
  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
    });
    exportMenu.querySelectorAll('[data-export-format]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const fmt = item.dataset.exportFormat;
        exportAuditResults(fmt);
        exportMenu.style.display = 'none';
      });
    });
    // Close menu on outside click
    document.addEventListener('click', () => { exportMenu.style.display = 'none'; });
  } else {
    // Fallback — old export button behaviour
    exportBtn?.addEventListener('click', () => exportAuditResults('text'));
  }

  document.getElementById('auditClearBtn')?.addEventListener('click', async () => {
    auditResults = null; auditPageInfo = null; auditPreviousResults = null;
    await chrome.storage.local.remove(AUDIT_STORAGE_KEY);
    document.getElementById('auditPageHeader').style.display = 'none';
    document.getElementById('auditSubTabBar').style.display  = 'none';
    document.getElementById('auditContent').style.display    = '';
    document.getElementById('auditPerfContent').style.display    = 'none';
    document.getElementById('auditSecContent').style.display     = 'none';
    document.getElementById('auditA11yContent').style.display    = 'none';
    const histEl = document.getElementById('auditHistoryContent');
    if (histEl) histEl.style.display = 'none';
    document.getElementById('auditContent').innerHTML =
      '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text" id="auditScanStatus">Click "Run" to scan this page</div></div>';
    showLsToast('Audit cleared');
  });

  // ── Audit sub-tabs ───────────────────────────────────────────────────────
  document.querySelectorAll('[data-auditsub]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-auditsub]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sub = btn.dataset.auditsub;
      document.getElementById('auditContent').style.display     = sub === 'overview'  ? '' : 'none';
      document.getElementById('auditPerfContent').style.display = sub === 'perf'      ? '' : 'none';
      document.getElementById('auditSecContent').style.display  = sub === 'security'  ? '' : 'none';
      document.getElementById('auditA11yContent').style.display = sub === 'a11y'      ? '' : 'none';
      const histEl = document.getElementById('auditHistoryContent');
      if (histEl) histEl.style.display = sub === 'history'  ? '' : 'none';
      if (sub === 'history') renderAuditHistory();
    });
  });

  // Restore persisted results when tab first opens
  document.querySelector('[data-tab="audit"]')?.addEventListener('click', restoreAuditResults);
  // Also restore on init in case audit tab is active
  restoreAuditResults();
};

// A-22 Render the audit history for the current URL
async function renderAuditHistory() {
  const el = document.getElementById('auditHistoryContent');
  if (!el) return;
  const tab = await getAuditTab();
  const currentKey = tab?.url ? auditKeyForUrl(tab.url) : null;
  const h = await chrome.storage.local.get(AUDIT_HISTORY_KEY);
  const history = h[AUDIT_HISTORY_KEY] || {};
  const runs = currentKey ? (history[currentKey] || []) : [];

  if (!runs.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div class="empty-text">No audit history for this URL yet</div></div>';
    return;
  }

  // Sort newest first
  const sorted = [...runs].reverse();
  let html = '<div class="audit-section-title">📊 History for this URL (' + sorted.length + ' run' + (sorted.length === 1 ? '' : 's') + ')</div>';
  html += '<div style="padding:4px 10px;font-size:8.5px;color:var(--muted)">Click a run to see trend arrows vs current</div>';
  sorted.forEach((run, idx) => {
    const when = new Date(run.ts).toLocaleString('en-AU');
    html += '<div class="audit-item" style="padding:6px 10px;cursor:default">' +
      '<div class="audit-item-label" style="font-weight:700;color:var(--text)">' + when + (idx === 0 ? ' <span style="color:var(--accent);font-size:8px">(current)</span>' : '') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:9px;color:var(--muted);margin-top:3px">' +
        '<span>🔗 ' + (run.broken || 0) + ' broken</span>' +
        '<span>↪ ' + (run.redirected || 0) + ' redirects</span>' +
        '<span>🖼 ' + (run.images || 0) + ' images</span>' +
        '<span>✍️ ' + (run.spelling || 0) + ' spelling</span>' +
        '<span>♿ ' + (run.a11y || 0) + ' a11y</span>' +
        (run.lcp != null ? '<span>⚡ LCP ' + run.lcp + 'ms</span>' : '') +
        (run.cls != null ? '<span>📐 CLS ' + run.cls + '</span>' : '') +
      '</div></div>';
  });
  html += '<div style="padding:8px 10px 4px">' +
    '<button class="btn-ghost" id="auditClearHistoryBtn" style="font-size:8.5px;padding:4px 8px;color:var(--warn);border-color:var(--warn)">🗑 Clear history for this URL</button></div>';
  el.innerHTML = html;
  document.getElementById('auditClearHistoryBtn')?.addEventListener('click', async () => {
    const h2 = await chrome.storage.local.get(AUDIT_HISTORY_KEY);
    const hist = h2[AUDIT_HISTORY_KEY] || {};
    delete hist[currentKey];
    await chrome.storage.local.set({ [AUDIT_HISTORY_KEY]: hist });
    renderAuditHistory();
    showLsToast('History cleared for this URL');
  });
}
