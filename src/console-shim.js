// console-shim.js — QAKit
// Injected into MAIN world by background.js on every page load.
// Wraps console.error and dispatches CustomEvents picked up by content.js.
// Paths are configurable via window.__qConsolePaths (set before injection).

(function () {
  if (window.__qConsoleShimInstalled) return;
  window.__qConsoleShimInstalled = true;
  // Dedup tracking — capped to prevent unbounded memory growth on long-running
  // SPAs. FIFO eviction via a Map (Map preserves insertion order natively).
  window.__qConsoleSeen = window.__qConsoleSeen || new Map();
  const SEEN_CAP = 500;

  // Paths come from settings via background.js injection args
  // Default: /scripts/, /blocks/
  function getTargetPaths() {
    const raw = window.__qConsolePaths;
    // empty array or null = no path filter = capture all errors
    if (!raw) return null;
    if (Array.isArray(raw) && raw.length === 0) return null; // empty = all
    if (Array.isArray(raw)) return raw;
    return null;
  }

  function matchesTarget(urlStr) {
    const paths = getTargetPaths();
    if (!paths) return true; // no filter = match everything
    try {
      const p = new URL(urlStr || '', location.href).pathname;
      return paths.some(prefix => p.toLowerCase().startsWith(prefix.toLowerCase()));
    } catch { return false; }
  }

  // Noise filter — silently drop these well-known harmless warnings from
  // page scripts so they don't pollute the Console Errors panel. Only filters
  // out specific exact-match patterns. All other warnings/errors flow through.
  const NOISE_PATTERNS = [
    // QAKit internal (inspector/element tools)
    /New element is longer than 100 characters\. Skipping\./,
    /Hovered element is invalid or has no innerText\./,
    /New element is the same as the last element in the array\. Skipping\./,
    // @babel/polyfill loaded multiple times — bundler/page issue, not actionable
    /@babel\/polyfill is loaded more than once/,
    // Atlassian AJS / Jira platform deprecation notices
    /DEPRECATED JS - /,
    /AJS's create element functionality has been deprecated/,
    /Multiple versions of FeatureGateClients found/,
    // iFrameResizer library deprecation
    /\[iFrameSizer\].*Deprecated:/,
    // Node-style MaxListeners warning surfaced from page bundled code
    /MaxListenersExceededWarning: Possible EventEmitter memory leak/,
    // Coveo search component configuration warnings
    /The [`']platformUrl[`'] .* option will be deprecated/,
    /The [`']organizationEndpoints[`'] options was not explicitly set/,
    // Kampyle / Medallia onsite SDK
    /MODAL_DIALOGS will be deprecated! Please, use in future KAMPYLE_ONSITE_SDK/,
  ];

  function dispatch(type, message, sourceUrl) {
    const msgStr = String(message);
    // Skip noise patterns
    for (const pat of NOISE_PATTERNS) {
      if (pat.test(msgStr)) return;
    }
    // Dedup — skip if same type+message+url already seen. Cap at SEEN_CAP to
    // bound memory; evict oldest entry (Map preserves insertion order).
    const dedupKey = type + '|' + msgStr.slice(0, 200) + '|' + location.href;
    if (window.__qConsoleSeen.has(dedupKey)) return;
    window.__qConsoleSeen.set(dedupKey, 1);
    if (window.__qConsoleSeen.size > SEEN_CAP) {
      const oldest = window.__qConsoleSeen.keys().next().value;
      window.__qConsoleSeen.delete(oldest);
    }

    window.dispatchEvent(new CustomEvent('__qConsoleError', {
      detail: {
        type,
        message:   String(message).slice(0, 600),
        url:       location.href,
        path:      location.pathname,
        sourceUrl: sourceUrl || null,
        timestamp: new Date().toISOString(),
      }
    }));
  }

  // Helper: stringify arbitrary console args without blowing up on circular refs
  function argsToString(args) {
    return args.map(a => {
      try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
      catch { return String(a); }
    }).join(' ');
  }

  // ── Passthrough-first wrappers ─────────────────────────────────────────
  // The original console call runs SYNCHRONOUSLY, first. Our work
  // (dispatch / stringify / dedupe) is deferred via queueMicrotask so it
  // doesn't sit on the stack when Chrome captures error provenance. This
  // prevents page-level errors from being attributed to QAKit in the
  // chrome://extensions Errors viewer.

  const _ce = console.error;
  console.error = function (...args) {
    // Capture the value of `this` so the passthrough preserves it exactly
    const ret = _ce.apply(this, args);
    if (matchesTarget(location.href)) {
      queueMicrotask(() => {
        try { dispatch('console.error', argsToString(args), null); } catch (_) {}
      });
    }
    return ret;
  };

  // Warnings are mostly noise (polyfill advisories, deprecation notes, etc.).
  // Only forward warnings that look like actual errors. The keyword list is
  // deliberately tight to keep the Console tab signal-to-noise high.
  const WARN_PATTERN = /\b(error|failed|uncaught|exception|TypeError|ReferenceError|SyntaxError|RangeError|cannot\s+(?:read|set|access)|is not a function|is not defined)\b/i;
  // Things we explicitly DON'T forward as errors (common benign library chatter)
  const WARN_IGNORE = /@babel\/polyfill|is loaded more than once|deprecated|will be removed in|\[HMR\]|\[webpack-dev-server\]/i;

  const _cw = console.warn;
  console.warn = function (...args) {
    const ret = _cw.apply(this, args);
    if (matchesTarget(location.href)) {
      queueMicrotask(() => {
        try {
          const msg = argsToString(args);
          if (WARN_IGNORE.test(msg)) return;
          if (!WARN_PATTERN.test(msg)) return;
          dispatch('console.warn', msg, null);
        } catch (_) {}
      });
    }
    return ret;
  };

  window.addEventListener('error', (e) => {
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      const src = e.target.src || e.target.href;
      if (matchesTarget(src)) dispatch('resource.error', 'Failed to load: ' + src, src);
      return;
    }
    if (matchesTarget(e.filename || '') || matchesTarget(location.href)) {
      dispatch('window.error',
        [e.message, 'at', e.filename, (e.lineno || 0) + ':' + (e.colno || 0)].join(' '),
        e.filename);
    }
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    if (matchesTarget(location.href)) dispatch('unhandledrejection', String(e.reason), null);
  }, true);

})();
