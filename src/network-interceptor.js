// Network Mock interceptor, injected into the page's MAIN world.
(() => {
  if (window.__qNetInterceptorInstalled) return;
  window.__qNetInterceptorInstalled = true;
  window.__qNetLog = window.__qNetLog || [];

  function matchRule(url, rule) {
    try {
      switch (rule.matchType) {
        case 'contains': return url.includes(rule.pattern);
        case 'exact': return url === rule.pattern;
        case 'regex': return new RegExp(rule.pattern).test(url);
        case 'path': {
          const up = new URL(url, location.href).pathname;
          const pp = rule.pattern.startsWith('http') ? new URL(rule.pattern).pathname : rule.pattern;
          return up === pp;
        }
        default: return url.includes(rule.pattern);
      }
    } catch (e) {
      console.warn('[QAKit] Could not match network rule:', e.message);
      return false;
    }
  }

  function findMatch(url) {
    return (window.__qNetRules || []).find(r => r.active && matchRule(url, r)) || null;
  }

  function logIt(url, rule, status) {
    const entry = { url, ruleName: rule.name, status, timestamp: new Date().toISOString() };
    window.__qNetLog.unshift(entry);
    if (window.__qNetLog.length > 100) window.__qNetLog.pop();
    window.dispatchEvent(new CustomEvent('__qNetIntercepted', { detail: entry }));
  }

  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    const rule = findMatch(url);
    if (!rule) return origFetch.apply(this, arguments);
    const status = rule.responseStatus || 200;
    logIt(url, rule, status);
    return new Response(
      typeof rule.responseBody === 'string' ? rule.responseBody : JSON.stringify(rule.responseBody),
      { status, headers: { 'Content-Type': 'application/json', 'X-Mocked-By': 'QA-Tools' } }
    );
  };

  const OrigXHR = window.XMLHttpRequest;
  function MockXHR() {
    const xhr = new OrigXHR();
    const origOpen = xhr.open.bind(xhr);
    const origSend = xhr.send.bind(xhr);
    const origAbort = xhr.abort.bind(xhr);
    let url = '';
    let async = true;
    let pending = false;
    let timer = null;
    let generation = 0;
    const mockedProperties = ['readyState', 'status', 'statusText', 'responseText', 'response',
      'responseURL', 'responseXML', 'getResponseHeader', 'getAllResponseHeaders'];

    function clearMock() {
      mockedProperties.forEach(name => { delete xhr[name]; });
    }

    xhr.open = function(method, requestUrl, ...args) {
      generation++;
      clearTimeout(timer);
      pending = false;
      clearMock();
      url = String(requestUrl);
      async = args[0] !== false;
      return origOpen(method, requestUrl, ...args);
    };

    xhr.abort = function() {
      if (!pending) return origAbort();
      generation++;
      clearTimeout(timer);
      pending = false;
      clearMock();
      origAbort();
      xhr.dispatchEvent(new Event('readystatechange'));
      xhr.dispatchEvent(new ProgressEvent('abort'));
      xhr.dispatchEvent(new ProgressEvent('loadend'));
    };

    xhr.send = function(body) {
      const rule = findMatch(url);
      if (!rule) return origSend(body);
      if (pending || xhr.readyState !== 1) throw new DOMException('Invalid state', 'InvalidStateError');
      pending = true;
      const current = ++generation;
      xhr.dispatchEvent(new ProgressEvent('loadstart'));
      if (!pending || current !== generation) return;
      const complete = () => {
        if (!pending || current !== generation) return;
        const text = typeof rule.responseBody === 'string' ? rule.responseBody : JSON.stringify(rule.responseBody);
        const status = rule.responseStatus || 200;
        let state = 2;
        const responseType = xhr.responseType;
        let response = text;
        if (responseType === 'json') {
          try { response = JSON.parse(text); } catch { response = null; }
        } else if (responseType === 'arraybuffer') {
          response = new TextEncoder().encode(text).buffer;
        } else if (responseType === 'blob') {
          response = new Blob([text], { type: 'application/json' });
        } else if (responseType === 'document') {
          response = null;
        }
        Object.defineProperties(xhr, {
          readyState: { get: () => state, configurable: true },
          status: { get: () => status, configurable: true },
          statusText: { get: () => 'OK', configurable: true },
          responseURL: { get: () => new URL(url, location.href).href, configurable: true },
          responseXML: { get: () => null, configurable: true },
          responseText: { get: () => {
            if (responseType && responseType !== 'text') throw new DOMException('Invalid response type', 'InvalidStateError');
            return state === 4 ? text : '';
          }, configurable: true },
          response: { get: () => state === 4 ? response : (responseType === '' || responseType === 'text' ? '' : null), configurable: true },
          getResponseHeader: { value: name => {
            const header = String(name).toLowerCase();
            return header === 'content-type' ? 'application/json' : header === 'x-mocked-by' ? 'QA-Tools' : null;
          }, configurable: true },
          getAllResponseHeaders: { value: () => 'content-type: application/json\r\nx-mocked-by: QA-Tools\r\n', configurable: true },
        });
        logIt(url, rule, status);
        for (const nextState of [2, 3, 4]) {
          state = nextState;
          if (state === 4) pending = false;
          xhr.dispatchEvent(new Event('readystatechange'));
          if (current !== generation) return;
          if (state === 3) {
            const length = new TextEncoder().encode(text).byteLength;
            xhr.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: length, total: length }));
            if (current !== generation) return;
          }
        }
        xhr.dispatchEvent(new ProgressEvent('load'));
        if (current === generation) xhr.dispatchEvent(new ProgressEvent('loadend'));
      };
      if (async) timer = setTimeout(complete, 0);
      else complete();
    };
    return xhr;
  }
  Object.setPrototypeOf(MockXHR.prototype, OrigXHR.prototype);
  Object.setPrototypeOf(MockXHR, OrigXHR);
  window.XMLHttpRequest = MockXHR;
})();
