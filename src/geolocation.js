// geolocation.js — Geolocation Spoofer tab logic
// Uses chrome.debugger to override Geolocation via Chrome DevTools Protocol

let geoAttachedTabId = null;
let geoActive = false;

const GEO_PRESETS = [
  // ── Oceania ──────────────────────────────────────────────────────────────
  { name: 'Sydney, Australia',       lat: -33.8688, lng: 151.2093 },
  { name: 'Melbourne, Australia',    lat: -37.8136, lng: 144.9631 },
  { name: 'Brisbane, Australia',     lat: -27.4698, lng: 153.0251 },
  { name: 'Perth, Australia',        lat: -31.9505, lng: 115.8605 },
  { name: 'Adelaide, Australia',     lat: -34.9285, lng: 138.6007 },
  { name: 'Auckland, New Zealand',   lat: -36.8485, lng: 174.7633 },
  { name: 'Wellington, New Zealand', lat: -41.2866, lng: 174.7756 },
  // ── East Asia ────────────────────────────────────────────────────────────
  { name: 'Tokyo, Japan',            lat:  35.6762, lng: 139.6503 },
  { name: 'Osaka, Japan',            lat:  34.6937, lng: 135.5023 },
  { name: 'Seoul, South Korea',      lat:  37.5665, lng: 126.9780 },
  { name: 'Beijing, China',          lat:  39.9042, lng: 116.4074 },
  { name: 'Shanghai, China',         lat:  31.2304, lng: 121.4737 },
  { name: 'Hong Kong',               lat:  22.3193, lng: 114.1694 },
  { name: 'Taipei, Taiwan',          lat:  25.0330, lng: 121.5654 },
  // ── South / SE Asia ──────────────────────────────────────────────────────
  { name: 'Singapore',               lat:   1.3521, lng: 103.8198 },
  { name: 'Bangkok, Thailand',       lat:  13.7563, lng: 100.5018 },
  { name: 'Jakarta, Indonesia',      lat:  -6.2088, lng: 106.8456 },
  { name: 'Kuala Lumpur, Malaysia',  lat:   3.1390, lng: 101.6869 },
  { name: 'Manila, Philippines',     lat:  14.5995, lng: 120.9842 },
  { name: 'Ho Chi Minh City',        lat:  10.8231, lng: 106.6297 },
  { name: 'Mumbai, India',           lat:  19.0760, lng:  72.8777 },
  { name: 'Delhi, India',            lat:  28.6139, lng:  77.2090 },
  { name: 'Bangalore, India',        lat:  12.9716, lng:  77.5946 },
  // ── Middle East ───────────────────────────────────────────────────────────
  { name: 'Dubai, UAE',              lat:  25.2048, lng:  55.2708 },
  { name: 'Abu Dhabi, UAE',          lat:  24.4539, lng:  54.3773 },
  { name: 'Riyadh, Saudi Arabia',    lat:  24.7136, lng:  46.6753 },
  { name: 'Istanbul, Turkey',        lat:  41.0082, lng:  28.9784 },
  { name: 'Tel Aviv, Israel',        lat:  32.0853, lng:  34.7818 },
  // ── Europe ───────────────────────────────────────────────────────────────
  { name: 'London, UK',              lat:  51.5074, lng:  -0.1278 },
  { name: 'Paris, France',           lat:  48.8566, lng:   2.3522 },
  { name: 'Berlin, Germany',         lat:  52.5200, lng:  13.4050 },
  { name: 'Amsterdam, Netherlands',  lat:  52.3676, lng:   4.9041 },
  { name: 'Madrid, Spain',           lat:  40.4168, lng:  -3.7038 },
  { name: 'Rome, Italy',             lat:  41.9028, lng:  12.4964 },
  { name: 'Zurich, Switzerland',     lat:  47.3769, lng:   8.5417 },
  { name: 'Stockholm, Sweden',       lat:  59.3293, lng:  18.0686 },
  { name: 'Moscow, Russia',          lat:  55.7558, lng:  37.6173 },
  // ── Americas ─────────────────────────────────────────────────────────────
  { name: 'New York, USA',           lat:  40.7128, lng: -74.0060 },
  { name: 'Los Angeles, USA',        lat:  34.0522, lng:-118.2437 },
  { name: 'Chicago, USA',            lat:  41.8781, lng: -87.6298 },
  { name: 'San Francisco, USA',      lat:  37.7749, lng:-122.4194 },
  { name: 'Miami, USA',              lat:  25.7617, lng: -80.1918 },
  { name: 'Toronto, Canada',         lat:  43.6532, lng: -79.3832 },
  { name: 'Vancouver, Canada',       lat:  49.2827, lng:-123.1207 },
  { name: 'Mexico City, Mexico',     lat:  19.4326, lng: -99.1332 },
  { name: 'São Paulo, Brazil',       lat: -23.5505, lng: -46.6333 },
  { name: 'Buenos Aires, Argentina', lat: -34.6037, lng: -58.3816 },
  { name: 'Bogotá, Colombia',        lat:   4.7110, lng: -74.0721 },
  // ── Africa ────────────────────────────────────────────────────────────────
  { name: 'Johannesburg, S. Africa', lat: -26.2041, lng:  28.0473 },
  { name: 'Cape Town, S. Africa',    lat: -33.9249, lng:  18.4241 },
  { name: 'Cairo, Egypt',            lat:  30.0444, lng:  31.2357 },
  { name: 'Lagos, Nigeria',          lat:   6.5244, lng:   3.3792 },
  { name: 'Nairobi, Kenya',          lat:  -1.2921, lng:  36.8219 },
];

async function getGeoTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => { resolve(); });
  });
}

async function sendDebuggerCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(result);
    });
  });
}

const GEO_STORAGE_KEY = 'qakit_geo_override';

async function saveGeoState(state) {
  try { await chrome.storage.local.set({ [GEO_STORAGE_KEY]: state }); } catch(_) {}
}
async function loadGeoState() {
  try {
    const s = await chrome.storage.local.get(GEO_STORAGE_KEY);
    return s[GEO_STORAGE_KEY] || null;
  } catch { return null; }
}
async function clearGeoState() {
  try { await chrome.storage.local.remove(GEO_STORAGE_KEY); } catch(_) {}
}

async function applyGeolocation(lat, lng, accuracy, label) {
  const tab = await getGeoTab();
  if (!tab) { showGeoStatus('No active tab', 'error'); return; }

  try {
    // Fix 11: Cancel any existing override first. If we're already attached
    // to this tab, clear the override before setting the new one so there's
    // never a moment of double-spoofing. If attached to another tab, detach.
    if (geoAttachedTabId) {
      try {
        await sendDebuggerCommand(geoAttachedTabId, 'Emulation.clearGeolocationOverride', {});
      } catch(_) {}
      if (geoAttachedTabId !== tab.id) {
        await detachDebugger(geoAttachedTabId).catch(() => {});
        geoAttachedTabId = null;
      }
    }

    if (!geoAttachedTabId) {
      await attachDebugger(tab.id);
      geoAttachedTabId = tab.id;
    }

    await sendDebuggerCommand(tab.id, 'Emulation.setGeolocationOverride', {
      latitude:  lat,
      longitude: lng,
      accuracy:  accuracy || 10,
    });

    geoActive = true;
    updateGeoStatus(lat, lng, tab.url);
    showGeoStatus(`📍 Active: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'active');

    // Fix 11: Persist state so popup reopen can restore UI
    await saveGeoState({
      active: true,
      lat, lng,
      accuracy: accuracy || 10,
      label: label || '',
      tabId: tab.id,
      ts: Date.now(),
    });
  } catch(e) {
    showGeoStatus('Error: ' + (e.message || String(e)), 'error');
    geoAttachedTabId = null;
    geoActive = false;
    await clearGeoState();
  }
}

async function clearGeolocation() {
  const tab = await getGeoTab();
  if (!tab) return;

  if (geoAttachedTabId) {
    try {
      await sendDebuggerCommand(geoAttachedTabId, 'Emulation.clearGeolocationOverride', {});
      await detachDebugger(geoAttachedTabId);
    } catch(e) {}
    geoAttachedTabId = null;
  }
  geoActive = false;
  await clearGeoState();
  showGeoStatus('Geolocation cleared — using real location', 'idle');
  const indicator = document.getElementById('geoActiveIndicator');
  if (indicator) indicator.style.display = 'none';
}

function updateGeoStatus(lat, lng, url) {
  const indicator = document.getElementById('geoActiveIndicator');
  if (!indicator) return;
  indicator.style.display = 'flex';
  indicator.querySelector('.geo-active-coords').textContent = lat.toFixed(4) + ', ' + lng.toFixed(4);
}

function showGeoStatus(msg, type) {
  const el = document.getElementById('geoStatusMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'geo-status-msg geo-status-' + (type || 'idle');
}

window.initGeolocation = function() {
  if (!chrome.debugger) {
    document.querySelectorAll('[data-tab="geo"]').forEach(el => el.style.display = 'none');
    const statusEl = document.getElementById('geoStatusMsg');
    if (statusEl) {
      statusEl.textContent = 'Geolocation spoofing uses the Chrome Debugger API and is not available on this browser.';
      statusEl.className = 'geo-status-msg geo-status-error';
    }
    return;
  }
  // Populate presets
  const select = document.getElementById('geoPresetSelect');
  if (select) {
    GEO_PRESETS.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = p.name;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      const preset = GEO_PRESETS[select.value];
      if (!preset) return;
      document.getElementById('geoLat').value = preset.lat;
      document.getElementById('geoLng').value = preset.lng;
    });
  }

  document.getElementById('geoApplyBtn')?.addEventListener('click', async () => {
    const lat = parseFloat(document.getElementById('geoLat').value);
    const lng = parseFloat(document.getElementById('geoLng').value);
    const acc = parseFloat(document.getElementById('geoAccuracy').value) || 10;
    if (isNaN(lat) || isNaN(lng)) { showGeoStatus('Enter valid lat/lng values', 'error'); return; }
    if (lat < -90 || lat > 90)    { showGeoStatus('Latitude must be between -90 and 90', 'error'); return; }
    if (lng < -180 || lng > 180)  { showGeoStatus('Longitude must be between -180 and 180', 'error'); return; }
    const presetSel = document.getElementById('geoPresetSelect');
    const preset    = presetSel ? GEO_PRESETS[presetSel.value] : null;
    await applyGeolocation(lat, lng, acc, preset?.name || '');
  });

  document.getElementById('geoClearBtn')?.addEventListener('click', clearGeolocation);

  // Fix 11: Restore active override state on popup reopen
  (async () => {
    const saved = await loadGeoState();
    if (saved?.active) {
      const latEl = document.getElementById('geoLat');
      const lngEl = document.getElementById('geoLng');
      const accEl = document.getElementById('geoAccuracy');
      if (latEl) latEl.value = saved.lat;
      if (lngEl) lngEl.value = saved.lng;
      if (accEl && saved.accuracy) accEl.value = saved.accuracy;
      updateGeoStatus(saved.lat, saved.lng);
      geoActive = true;
      geoAttachedTabId = saved.tabId;
      showGeoStatus(`📍 Active: ${saved.lat.toFixed(4)}, ${saved.lng.toFixed(4)}${saved.label ? ' (' + saved.label + ')' : ''}`, 'active');
    }
  })();

  // Cleanup on tab change via debugger detach listener
  chrome.debugger?.onDetach.addListener((source) => {
    if (source.tabId === geoAttachedTabId) {
      geoAttachedTabId = null;
      geoActive = false;
      clearGeoState();
      showGeoStatus('Debugger detached', 'idle');
    }
  });
};
