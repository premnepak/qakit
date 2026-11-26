// Regression check — validates manifest, critical fixes, and core features
// Run with: node scripts/regression-check.js
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  OK   ' + name); }
  else    { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

// 1. Manifest
const m = JSON.parse(fs.readFileSync('src/manifest.json','utf8'));
check('manifest_version=3', m.manifest_version === 3);
check('version present', !!m.version);
const reqPerm = ['activeTab','scripting','storage','tabs','cookies','debugger','declarativeNetRequest','declarativeNetRequestWithHostAccess','windows','contextMenus'];
reqPerm.forEach(p => check('permission: ' + p, m.permissions.includes(p)));
check('optional permission: downloads', (m.optional_permissions || []).includes('downloads'));
const cmds = Object.keys(m.commands || {});
const withKey = cmds.filter(c => m.commands[c].suggested_key).length;
check('shortcuts <= 4', withKey <= 4, 'got ' + withKey);

const war = m.web_accessible_resources[0].resources;
const requiredWar = ['inspector.js','console-shim.js','analytics-interceptor.js','spell-bundle.js','pagescripts.js','env-marker.js','json-diff-tool.html','json-diff-tool.js','text-compare.html','text-compare.js','privacy-policy.html','help.html','changelog.html','markup.html','markup.js','markup.css'];
requiredWar.forEach(r => check('WAR: ' + r, war.includes(r)));

// 2. Core files exist
['src/popup.html','src/popup.js','src/background.js','src/spell-bundle.js','src/inspector.js','src/page-audit.js','src/console-shim.js','src/settings.js','src/pagescripts.js','src/network-interceptor.js'].forEach(f => check('file: ' + f, fs.existsSync(f)));

// 3. spell-bundle untouched (size sanity)
const ssize = fs.statSync('src/spell-bundle.js').size;
check('spell-bundle size > 800KB (Critical Rule 1)', ssize > 800*1024, ssize + 'B');

// 4. Theme toggle (Fix 57b)
const settings = fs.readFileSync('src/settings.js','utf8');
check('theme handlers in renderSettingsPanel (Fix 57b)', /function renderSettingsPanel[\s\S]*?themeLightBtn[\s\S]*?themeDarkBtn/.test(settings));
check('_applyThemeSwitch helper exists (Fix 57b)', settings.includes('_applyThemeSwitch'));

// 5. Inspector race (Fix 75)
const insp = fs.readFileSync('src/inspector.js','utf8');
check('inspector __qInspectorActive flag (Fix 75)', insp.includes('__qInspectorActive'));
check('inspector cancelAnimationFrame guard (Fix 75)', insp.includes('cancelAnimationFrame'));
check('__qInspectorRafId mirror (Fix 75)', insp.includes('__qInspectorRafId'));

// 6. Page Audit (Fix 78)
const pa = fs.readFileSync('src/page-audit.js','utf8');
check('urlKey declared in audit (Fix 78)', /const urlKey\s*=\s*auditKeyForUrl/.test(pa));

// 7. Console shim (Fix 80)
const cs = fs.readFileSync('src/console-shim.js','utf8');
check('NOISE_PATTERNS in console-shim (Fix 80)', cs.includes('NOISE_PATTERNS'));

// 8. Inspect/Spacing/Ruler tile cases — NO storage flags / tile-active / window.close
//    (Critical Rule 6 — reverts of Issues 67/68/74)
const popupjs = fs.readFileSync('src/popup.js','utf8');
const inspectMatch = popupjs.match(/case 'inspect':[\s\S]*?break;/);
check('inspect case found', !!inspectMatch);
if (inspectMatch) {
  const blk = inspectMatch[0];
  check('inspect tile: no qakit_inspect_active (Rule 6)', !blk.includes('qakit_inspect_active'));
  check('inspect tile: no tile-active class (Rule 6)', !blk.includes('tile-active'));
  check('inspect tile: no window.close (Rule 6)', !blk.includes('window.close'));
}
const spacingMatch = popupjs.match(/case 'spacing':[\s\S]*?break;/);
if (spacingMatch) check('spacing tile: no window.close (Rule 6)', !spacingMatch[0].includes('window.close'));
const rulerMatch = popupjs.match(/case 'ruler':[\s\S]*?break;/);
if (rulerMatch) check('ruler tile: no window.close (Rule 6)', !rulerMatch[0].includes('window.close'));

// 9. Home tiles structure
const popup = fs.readFileSync('src/popup.html','utf8');
const bg = fs.readFileSync('src/background.js','utf8');
check('Inspect tile present', popup.includes('data-action="inspect"'));
check('Spacing tile present', popup.includes('data-action="spacing"'));
check('Ruler tool present', popup.includes('id="pt-rulerBtn"'));
check('Region tile present', popup.includes('data-action="region"'));
check('Full Page tile present', popup.includes('data-action="fullpage"'));
check('Element screenshot context menu present', bg.includes("id: 'qakit-element-shot'") && bg.includes("case 'qakit-element-shot':"));
check('Annotate tile present', popup.includes('data-action="annotate"'));
check('JSON Viewer tile present', popup.includes('data-action="open-jsondiff"'));
check('Text Compare tile present', popup.includes('data-action="open-textcompare"'));

// 10. Privacy / no telemetry / no remote code (Critical Rules 7-8)
check('no eval() in background (Rule 7)', !/[^.\w]eval\s*\(/.test(bg));
check('no eval() in popup.js (Rule 7)', !/[^.\w]eval\s*\(/.test(popupjs));
check('no Function() ctor in background (Rule 7)', !/new\s+Function\s*\(/.test(bg));

// 11. Required background message handlers
['EVENT','GET_EVENTS','CLEAR_ALL','CAPTURE_FULL_PAGE','REGION_SELECTED','ELEMENT_SELECTED','SAVE_SCREENSHOT','OPEN_IN_EDITOR'].forEach(h => {
  check('background handles ' + h, bg.includes("msg.action === '" + h + "'"));
});

// 12. Context menus + commands wiring
check('contextMenus.create called', bg.includes('chrome.contextMenus.create'));
check('contextMenus.onClicked handler', bg.includes('chrome.contextMenus.onClicked'));
check('commands.onCommand handler', bg.includes('chrome.commands.onCommand'));

// 13. HTML balance (div count)
['popup.html','json-diff-tool.html','text-compare.html','help.html','privacy-policy.html'].forEach(f => {
  const txt = fs.readFileSync('src/' + f,'utf8');
  const open = (txt.match(/<div\b/g) || []).length;
  const close = (txt.match(/<\/div>/g) || []).length;
  check('HTML balanced: ' + f, open === close, open + ' opens / ' + close + ' closes');
});

// 14. JS brace sanity (catches truncated edits)
['popup.js','background.js','content.js','pagescripts.js','inspector.js','page-audit.js','console-shim.js','settings.js','cookie-manager.js','network-mock.js','headers.js','json-diff-tool.js','text-compare.js','markup.js','utils.js','time.js','geolocation.js','env-marker.js','envmarker.js','pagetools.js','analytics-interceptor.js'].forEach(f => {
  if (!fs.existsSync('src/' + f)) { check('JS file: ' + f, false, 'missing'); return; }
  const txt = fs.readFileSync('src/' + f,'utf8');
  const opens = (txt.match(/\{/g) || []).length;
  const closes = (txt.match(/\}/g) || []).length;
  check('JS braces balanced: ' + f, Math.abs(opens - closes) < 5, opens + '{ vs ' + closes + '}');
});

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
process.exit(fail > 0 ? 1 : 0);
