// time.js — QAKit v1.0.1
// Two sub-tabs: 🌍 World Clock (default) + ⏱ Epoch & Timezone (combined)

const WORLD_CITIES = [
  { name: 'Sydney',          tz: 'Australia/Sydney',         flag: '🇦🇺' },
  { name: 'Melbourne',       tz: 'Australia/Melbourne',      flag: '🇦🇺' },
  { name: 'Brisbane',        tz: 'Australia/Brisbane',       flag: '🇦🇺' },
  { name: 'Perth',           tz: 'Australia/Perth',          flag: '🇦🇺' },
  { name: 'Adelaide',        tz: 'Australia/Adelaide',       flag: '🇦🇺' },
  { name: 'Auckland',        tz: 'Pacific/Auckland',         flag: '🇳🇿' },
  { name: 'Tokyo',           tz: 'Asia/Tokyo',               flag: '🇯🇵' },
  { name: 'Seoul',           tz: 'Asia/Seoul',               flag: '🇰🇷' },
  { name: 'Shanghai',        tz: 'Asia/Shanghai',            flag: '🇨🇳' },
  { name: 'Hong Kong',       tz: 'Asia/Hong_Kong',           flag: '🇭🇰' },
  { name: 'Taipei',          tz: 'Asia/Taipei',              flag: '🇹🇼' },
  { name: 'Singapore',       tz: 'Asia/Singapore',           flag: '🇸🇬' },
  { name: 'Bangkok',         tz: 'Asia/Bangkok',             flag: '🇹🇭' },
  { name: 'Jakarta',         tz: 'Asia/Jakarta',             flag: '🇮🇩' },
  { name: 'Kuala Lumpur',    tz: 'Asia/Kuala_Lumpur',        flag: '🇲🇾' },
  { name: 'Manila',          tz: 'Asia/Manila',              flag: '🇵🇭' },
  { name: 'Mumbai',          tz: 'Asia/Kolkata',             flag: '🇮🇳' },
  { name: 'Delhi',           tz: 'Asia/Kolkata',             flag: '🇮🇳' },
  { name: 'Bangalore',       tz: 'Asia/Kolkata',             flag: '🇮🇳' },
  { name: 'Dubai',           tz: 'Asia/Dubai',               flag: '🇦🇪' },
  { name: 'Riyadh',          tz: 'Asia/Riyadh',              flag: '🇸🇦' },
  { name: 'Istanbul',        tz: 'Europe/Istanbul',          flag: '🇹🇷' },
  { name: 'London',          tz: 'Europe/London',            flag: '🇬🇧' },
  { name: 'Paris',           tz: 'Europe/Paris',             flag: '🇫🇷' },
  { name: 'Berlin',          tz: 'Europe/Berlin',            flag: '🇩🇪' },
  { name: 'Amsterdam',       tz: 'Europe/Amsterdam',         flag: '🇳🇱' },
  { name: 'Madrid',          tz: 'Europe/Madrid',            flag: '🇪🇸' },
  { name: 'Rome',            tz: 'Europe/Rome',              flag: '🇮🇹' },
  { name: 'Zurich',          tz: 'Europe/Zurich',            flag: '🇨🇭' },
  { name: 'Stockholm',       tz: 'Europe/Stockholm',         flag: '🇸🇪' },
  { name: 'Moscow',          tz: 'Europe/Moscow',            flag: '🇷🇺' },
  { name: 'New York',        tz: 'America/New_York',         flag: '🇺🇸' },
  { name: 'Los Angeles',     tz: 'America/Los_Angeles',      flag: '🇺🇸' },
  { name: 'Chicago',         tz: 'America/Chicago',          flag: '🇺🇸' },
  { name: 'San Francisco',   tz: 'America/Los_Angeles',      flag: '🇺🇸' },
  { name: 'Toronto',         tz: 'America/Toronto',          flag: '🇨🇦' },
  { name: 'Vancouver',       tz: 'America/Vancouver',        flag: '🇨🇦' },
  { name: 'Mexico City',     tz: 'America/Mexico_City',      flag: '🇲🇽' },
  { name: 'São Paulo',       tz: 'America/Sao_Paulo',        flag: '🇧🇷' },
  { name: 'Buenos Aires',    tz: 'America/Argentina/Buenos_Aires', flag: '🇦🇷' },
  { name: 'Johannesburg',    tz: 'Africa/Johannesburg',      flag: '🇿🇦' },
  { name: 'Cairo',           tz: 'Africa/Cairo',             flag: '🇪🇬' },
  { name: 'Lagos',           tz: 'Africa/Lagos',             flag: '🇳🇬' },
  { name: 'Nairobi',         tz: 'Africa/Nairobi',           flag: '🇰🇪' },
  { name: 'UTC',             tz: 'UTC',                      flag: '🌍' },
];

const PINNED_CITIES_KEY = 'qakit_time_pinned_cities';
const DEFAULT_PINS = ['Sydney', 'London', 'New York', 'Tokyo', 'UTC'];

window.initTime = function () {
  let pinnedCities = DEFAULT_PINS.slice();
  let clockInterval = null;

  function pad(n) { return String(n).padStart(2, '0'); }
  function copyText(text, btn) {
    navigator.clipboard?.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    });
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓';
      btn.style.color = 'var(--accent)';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 800);
    }
  }
  function detectEpochUnit(val) {
    const s = String(Math.abs(val));
    if (s.length <= 11) return 's';
    if (s.length <= 14) return 'ms';
    return 'us';
  }
  function epochToMs(val, unit) {
    const n = Number(val);
    if (!isFinite(n)) return null;
    const u = unit === 'auto' ? detectEpochUnit(n) : unit;
    if (u === 's')  return n * 1000;
    if (u === 'ms') return n;
    if (u === 'us') return Math.floor(n / 1000);
    return n;
  }
  function fmtRelative(ms) {
    const delta = ms - Date.now();
    const abs = Math.abs(delta);
    const sec = Math.round(abs / 1000);
    const future = delta > 0;
    let out;
    if (sec < 45)             out = 'just now';
    else if (sec < 3600)      out = Math.round(sec / 60) + 'm';
    else if (sec < 86400)     out = Math.round(sec / 3600) + 'h';
    else if (sec < 30*86400)  out = Math.round(sec / 86400) + 'd';
    else if (sec < 365*86400) out = Math.round(sec / (30*86400)) + 'mo';
    else                      out = Math.round(sec / (365*86400)) + 'y';
    if (out === 'just now') return out;
    return future ? 'in ' + out : out + ' ago';
  }

  async function loadPersisted() {
    try {
      const s = await chrome.storage.local.get(PINNED_CITIES_KEY);
      if (Array.isArray(s[PINNED_CITIES_KEY]) && s[PINNED_CITIES_KEY].length) {
        pinnedCities = s[PINNED_CITIES_KEY];
      }
    } catch(_) {}
  }
  async function savePinned() {
    try { await chrome.storage.local.set({ [PINNED_CITIES_KEY]: pinnedCities }); } catch(_) {}
  }

  function rowHtml(label, val) {
    return '<div class="epoch-out-row">' +
      '<span class="epoch-out-label">' + label + '</span>' +
      '<span class="epoch-out-val">' + val + '</span>' +
      '<button class="epoch-out-copy" data-copy="' + String(val).replace(/"/g, '&quot;') + '" title="Copy">⎘</button>' +
    '</div>';
  }
  function wireCopyButtons(scope) {
    scope.querySelectorAll('.epoch-out-copy').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); copyText(b.dataset.copy, b); });
    });
  }

  // ── Epoch ↔ Human ───────────────────────────────────────────────────────
  function renderEpochOutput(ms) {
    const out = document.getElementById('epochResult');
    if (!out) return;
    if (ms == null || isNaN(ms)) { out.innerHTML = ''; return; }
    const d = new Date(ms);
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localStr = new Intl.DateTimeFormat('en-AU', {
      timeZone: localTz, year:'numeric',month:'short',day:'numeric',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short',
    }).format(d);
    out.innerHTML =
      rowHtml('Local',    localStr) +
      rowHtml('UTC',      d.toUTCString()) +
      rowHtml('ISO 8601', d.toISOString()) +
      rowHtml('Relative', fmtRelative(ms)) +
      rowHtml('Epoch s',  Math.floor(ms/1000)) +
      rowHtml('Epoch ms', ms);
    wireCopyButtons(out);
  }
  function handleEpochInput() {
    const raw = (document.getElementById('epochInput')?.value || '').trim();
    const unit = document.getElementById('epochUnit')?.value || 'auto';
    const detectedEl = document.getElementById('epochDetected');
    if (!raw) {
      if (detectedEl) detectedEl.textContent = '';
      renderEpochOutput(null);
      return;
    }
    if (!/^-?\d+$/.test(raw)) {
      if (detectedEl) detectedEl.textContent = '⚠ Enter a numeric epoch value';
      renderEpochOutput(null);
      return;
    }
    const detected = unit === 'auto' ? detectEpochUnit(Number(raw)) : unit;
    if (detectedEl) detectedEl.textContent = 'Detected: ' + detected;
    renderEpochOutput(epochToMs(raw, unit));
  }

  function handleHumanDateInput() {
    const raw = document.getElementById('humanDateInput')?.value;
    const out = document.getElementById('humanResult');
    if (!out) return;
    if (!raw) { out.innerHTML = ''; return; }
    const ms = new Date(raw).getTime();
    if (isNaN(ms)) {
      out.innerHTML = '<div class="epoch-out-row" style="color:var(--warn)">Invalid date</div>';
      return;
    }
    out.innerHTML =
      rowHtml('Epoch s',  Math.floor(ms/1000)) +
      rowHtml('Epoch ms', ms) +
      rowHtml('Epoch μs', ms*1000) +
      rowHtml('ISO 8601', new Date(ms).toISOString());
    wireCopyButtons(out);
  }

  // ── Timezone converter ─────────────────────────────────────────────────
  function getTzOffsetMinutes(tz, ms) {
    try {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,
      });
      const parts = dtf.formatToParts(new Date(ms));
      const o = {};
      parts.forEach(p => { if (p.type !== 'literal') o[p.type] = p.value; });
      const tzMs = Date.UTC(o.year, o.month - 1, o.day, o.hour === '24' ? 0 : o.hour, o.minute, o.second);
      return Math.round((tzMs - ms) / 60000);
    } catch { return 0; }
  }
  function handleTzConvert() {
    const dateInput = document.getElementById('tzDateInput')?.value;
    const fromTz   = document.getElementById('tzFrom')?.value;
    const toTz     = document.getElementById('tzTo')?.value;
    const out      = document.getElementById('tzResult');
    if (!out) return;
    if (!dateInput || !fromTz || !toTz) {
      out.innerHTML = '<div class="epoch-out-row" style="color:var(--muted)">Pick date/time and zones, then Convert</div>';
      return;
    }
    const [datePart, timePart] = dateInput.split('T');
    const [y, mo, d] = datePart.split('-').map(Number);
    const [h, mi]    = (timePart || '00:00').split(':').map(Number);
    const utcMs = Date.UTC(y, mo - 1, d, h, mi, 0);
    const fromOffset = getTzOffsetMinutes(fromTz, utcMs);
    const realMs = utcMs - fromOffset * 60000;

    const fromStr = new Intl.DateTimeFormat('en-AU', {
      timeZone: fromTz, year:'numeric',month:'short',day:'numeric',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short',
    }).format(new Date(realMs));
    const toStr = new Intl.DateTimeFormat('en-AU', {
      timeZone: toTz, year:'numeric',month:'short',day:'numeric',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZoneName:'short',
    }).format(new Date(realMs));

    out.innerHTML =
      '<div class="epoch-out-row"><span class="epoch-out-label">From</span><span class="epoch-out-val">' + fromStr + '</span></div>' +
      '<div class="epoch-out-row"><span class="epoch-out-label">To</span><span class="epoch-out-val" style="color:var(--accent);font-weight:700">' + toStr + '</span><button class="epoch-out-copy" data-copy="' + toStr + '" title="Copy">⎘</button></div>';
    wireCopyButtons(out);
  }

  // ── World Clock ────────────────────────────────────────────────────────
  function renderWorldClock() {
    const grid = document.getElementById('worldClockGrid');
    if (!grid) return;
    const q = (document.getElementById('clockFilter')?.value || '').toLowerCase();
    const now = Date.now();

    const pinned = WORLD_CITIES.filter(c => pinnedCities.includes(c.name));
    const others = WORLD_CITIES.filter(c =>
      !pinnedCities.includes(c.name) && (!q || c.name.toLowerCase().includes(q))
    );

    function cityRow(c, isPinned) {
      const timeStr = new Intl.DateTimeFormat('en-AU', {
        timeZone: c.tz, hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
      }).format(new Date(now));
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: c.tz, weekday:'short', timeZoneName:'short',
      }).formatToParts(new Date(now));
      const wd = parts.find(p => p.type === 'weekday')?.value || '';
      const tzAbbr = parts.find(p => p.type === 'timeZoneName')?.value || '';
      const hourPart = new Intl.DateTimeFormat('en-US', {
        timeZone: c.tz, hour:'numeric', hour12:false,
      }).formatToParts(new Date(now)).find(p => p.type === 'hour');
      const h = parseInt(hourPart?.value || '0', 10);
      const isWeekend = ['Sat','Sun'].includes(wd);
      const biz = !isWeekend && h >= 9 && h < 18;

      return '<div class="wc-row">' +
        '<span class="wc-flag">' + c.flag + '</span>' +
        '<span class="wc-biz" style="background:' + (biz ? '#22c55e' : '#9ca3af') + '" title="' + (biz ? 'Business hours' : 'Outside business hours') + '"></span>' +
        '<span class="wc-name">' + c.name + '</span>' +
        '<span class="wc-time">' + timeStr + '</span>' +
        '<span class="wc-meta">' + wd + ' · ' + tzAbbr + '</span>' +
        '<button class="wc-copy" data-copy="' + c.name + ' ' + timeStr + ' ' + tzAbbr + '" title="Copy">⎘</button>' +
        '<button class="wc-pin" data-city="' + c.name + '" title="' + (isPinned ? 'Unpin' : 'Pin to top') + '" style="color:' + (isPinned ? '#f9c74f' : 'var(--muted)') + '">📌</button>' +
        '</div>';
    }

    let html = '';
    if (pinned.length) {
      html += '<div class="wc-section-label">PINNED</div>';
      pinned.forEach(c => { html += cityRow(c, true); });
    }
    if (others.length) {
      html += '<div class="wc-section-label">' + (q ? 'RESULTS' : 'ALL CITIES') + '</div>';
      others.forEach(c => { html += cityRow(c, false); });
    }
    if (!pinned.length && !others.length) {
      html = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:11px">No cities match your filter</div>';
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.wc-pin').forEach(b => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const city = b.dataset.city;
        if (pinnedCities.includes(city)) pinnedCities = pinnedCities.filter(c => c !== city);
        else pinnedCities.push(city);
        await savePinned();
        renderWorldClock();
      });
    });
    grid.querySelectorAll('.wc-copy').forEach(b => {
      b.addEventListener('click', (e) => { e.stopPropagation(); copyText(b.dataset.copy, b); });
    });
  }

  // ── Wire up ────────────────────────────────────────────────────────────
  let zones = [];
  try { zones = Intl.supportedValuesOf?.('timeZone') || WORLD_CITIES.map(c => c.tz); }
  catch { zones = WORLD_CITIES.map(c => c.tz); }
  zones = [...new Set(zones)].sort();
  const zoneOpts = zones.map(z => '<option value="' + z + '">' + z + '</option>').join('');
  const tzFromEl = document.getElementById('tzFrom');
  const tzToEl   = document.getElementById('tzTo');
  if (tzFromEl) {
    tzFromEl.innerHTML = zoneOpts;
    try { tzFromEl.value = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  }
  if (tzToEl) {
    tzToEl.innerHTML = zoneOpts;
    tzToEl.value = 'UTC';
  }

  document.getElementById('epochInput')?.addEventListener('input', handleEpochInput);
  document.getElementById('epochUnit')?.addEventListener('change', handleEpochInput);
  document.getElementById('epochNowBtn')?.addEventListener('click', () => {
    const input = document.getElementById('epochInput');
    if (input) { input.value = String(Date.now()); handleEpochInput(); }
  });
  document.getElementById('epochPasteBtn')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const input = document.getElementById('epochInput');
      if (input && text) { input.value = text.trim(); handleEpochInput(); }
    } catch(_) {}
  });

  document.getElementById('humanDateInput')?.addEventListener('input', handleHumanDateInput);
  document.getElementById('humanNowBtn')?.addEventListener('click', () => {
    const d = new Date();
    const input = document.getElementById('humanDateInput');
    if (input) {
      input.value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      handleHumanDateInput();
    }
  });

  document.getElementById('tzNowBtn')?.addEventListener('click', () => {
    const d = new Date();
    const input = document.getElementById('tzDateInput');
    if (input) {
      input.value = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      handleTzConvert();
    }
  });
  document.getElementById('tzConvertBtn')?.addEventListener('click', handleTzConvert);
  document.getElementById('tzSwapBtn')?.addEventListener('click', () => {
    if (!tzFromEl || !tzToEl) return;
    const tmp = tzFromEl.value; tzFromEl.value = tzToEl.value; tzToEl.value = tmp;
    handleTzConvert();
  });
  tzFromEl?.addEventListener('change', handleTzConvert);
  tzToEl?.addEventListener('change', handleTzConvert);

  document.getElementById('clockFilter')?.addEventListener('input', renderWorldClock);

  document.querySelectorAll('.time-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.time-sub').forEach(p => {
        const isActive = p.id === 'timesub-' + btn.dataset.sub;
        p.classList.toggle('active', isActive);
        p.style.display = isActive ? '' : 'none';
      });
    });
  });

  loadPersisted().then(() => { renderWorldClock(); });

  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(renderWorldClock, 1000);
};
