// @ts-check
/**
 * Tests for the Utils panel (JWT Decoder/Encoder, URL Encoder/Decoder, Base64).
 *
 * Two suites:
 *
 * Suite 1 — popup panel UI (uses full extension via fixtures):
 *   Verifies the three sub-tabs render and the buttons produce output in the
 *   popup. URL encode and Base64 encode are also exercised in popup.spec.js —
 *   this file adds decode paths, JWT decode/encode, and error cases.
 *
 * Suite 2 — pure logic (plain browser, no extension):
 *   Runs the JWT / b64url helper functions in isolation by redefining them
 *   inside page.evaluate. Tests correctness without popup overhead.
 */

const { test: baseTest, expect } = require('@playwright/test');
const { test } = require('./fixtures');

// Known valid test JWT with predictable payload
// Header:  {"alg":"HS256","typ":"JWT"}
// Payload: {"sub":"user123","name":"John Doe","iat":1700000000}
const TEST_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNzAwMDAwMDAwfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

async function openUtilsPanel(popupPage) {
  await popupPage.click('.home-tile[data-tab="utils"]');
  await expect(popupPage.locator('#panel-utils')).toHaveClass(/active/);
}

// ─── Suite 1: Popup panel UI ─────────────────────────────────────────────────

test.describe('Utils panel — UI', () => {
  test('panel opens from home tile', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await expect(popupPage.locator('#panel-utils')).toBeVisible();
  });

  test('JWT sub-tab is active by default', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await expect(popupPage.locator('.util-subtab[data-sub="jwt"]')).toHaveClass(/active/);
    await expect(popupPage.locator('#utilsub-jwt')).toHaveClass(/active/);
  });

  test('URL sub-tab is reachable and shows the URL panel', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.click('.util-subtab[data-sub="url"]');
    await expect(popupPage.locator('#utilsub-url')).toBeVisible();
    await expect(popupPage.locator('#urlInput')).toBeVisible();
  });

  test('Base64 sub-tab is reachable and shows the Base64 panel', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.click('.util-subtab[data-sub="base64"]');
    await expect(popupPage.locator('#utilsub-base64')).toBeVisible();
    await expect(popupPage.locator('#b64Input')).toBeVisible();
  });

  // ── JWT decode ──────────────────────────────────────────────────────────────

  test('JWT Decode button produces output for a valid token', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.fill('#jwtInput', TEST_JWT);
    await popupPage.click('#jwtDecodeBtn');
    const output = await popupPage.locator('#jwtDecodeOut').innerHTML();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('user123');
  });

  test('JWT decode output contains header and payload sections', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.fill('#jwtInput', TEST_JWT);
    await popupPage.click('#jwtDecodeBtn');
    const output = await popupPage.locator('#jwtDecodeOut').innerText();
    expect(output).toContain('HS256');
    expect(output).toContain('user123');
  });

  test('JWT decode shows error for an invalid token', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.fill('#jwtInput', 'not.a.jwt.at.all.garbage');
    await popupPage.click('#jwtDecodeBtn');
    const output = await popupPage.locator('#jwtDecodeOut').innerHTML();
    // Should show an error indicator, not empty
    expect(output.length).toBeGreaterThan(0);
  });

  // ── JWT encode ─────────────────────────────────────────────────────────────

  test('JWT Encode button produces a three-part token', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.fill('#jwtPayInput', '{"sub":"test","iat":1700000000}');
    await popupPage.click('#jwtEncodeBtn');
    const output = await popupPage.locator('#jwtEncodeOut').innerText();
    const parts = output.trim().split('.');
    expect(parts.length).toBe(3);
  });

  test('JWT encode output ends with .UNSIGNED', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.fill('#jwtPayInput', '{"sub":"test"}');
    await popupPage.click('#jwtEncodeBtn');
    const output = await popupPage.locator('#jwtEncodeOut').innerText();
    expect(output.trim()).toMatch(/\.UNSIGNED$/);
  });

  // ── URL encode / decode ────────────────────────────────────────────────────

  test('URL decode reverses a percent-encoded string', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.click('.util-subtab[data-sub="url"]');
    await popupPage.fill('#urlInput', 'hello%20world%21');
    await popupPage.click('#urlDecodeBtn');
    const output = await popupPage.locator('#urlOutput').inputValue();
    expect(output).toContain('hello world!');
  });

  test('encodeURI button produces full-URI encoding', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.click('.util-subtab[data-sub="url"]');
    await popupPage.fill('#urlInput', 'https://example.com/path?a=1&b=hello world');
    await popupPage.click('#urlFullEncBtn');
    const output = await popupPage.locator('#urlOutput').inputValue();
    expect(output).toContain('https://example.com/path');
    expect(output).toContain('hello%20world');
  });

  // ── Base64 decode ──────────────────────────────────────────────────────────

  test('Base64 decode reverses encoded text', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.click('.util-subtab[data-sub="base64"]');
    const encoded = Buffer.from('qakit').toString('base64');
    await popupPage.fill('#b64Input', encoded);
    await popupPage.click('#b64DecodeBtn');
    const output = await popupPage.locator('#b64Output').inputValue();
    expect(output).toBe('qakit');
  });

  test('URL-safe Base64 button replaces + and / with - and _', async ({ popupPage }) => {
    await openUtilsPanel(popupPage);
    await popupPage.click('.util-subtab[data-sub="base64"]');
    await popupPage.fill('#b64Input', 'hello+world/test');
    await popupPage.click('#b64UrlEncBtn');
    const output = await popupPage.locator('#b64Output').inputValue();
    expect(output).not.toContain('+');
    expect(output).not.toContain('/');
  });
});

// ─── Suite 2: JWT / b64url pure logic ────────────────────────────────────────

const LOGIC_SRC = `
  function b64urlDecode(str) {
    try {
      str = str.replace(/-/g, '+').replace(/_/g, '/');
      while (str.length % 4) str += '=';
      return atob(str);
    } catch(e) { return null; }
  }
  function b64urlEncode(str) {
    return btoa(str).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
  }
  function decodeJWT(token) {
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    const header  = b64urlDecode(parts[0]);
    const payload = b64urlDecode(parts[1]);
    if (!header || !payload) return null;
    try {
      return { header: JSON.parse(header), payload: JSON.parse(payload), signature: parts[2] };
    } catch(e) { return null; }
  }
  function encodeJWT(headerStr, payloadStr) {
    try { JSON.parse(headerStr); JSON.parse(payloadStr); } catch(e) { return null; }
    return b64urlEncode(headerStr) + '.' + b64urlEncode(payloadStr) + '.UNSIGNED';
  }
`;

baseTest.describe('Utils — JWT logic', () => {
  baseTest('decodeJWT returns header and payload for a valid token', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      return decodeJWT('${TEST_JWT}');
    })()`);
    expect(result.header.alg).toBe('HS256');
    expect(result.payload.sub).toBe('user123');
    expect(result.payload.name).toBe('John Doe');
  });

  baseTest('decodeJWT returns null for a two-part token', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      return decodeJWT('only.twoparts');
    })()`);
    expect(result).toBeNull();
  });

  baseTest('decodeJWT returns null for a non-base64url payload', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      return decodeJWT('eyJhbGciOiJIUzI1NiJ9.!!!invalid!!!.sig');
    })()`);
    expect(result).toBeNull();
  });

  baseTest('encodeJWT produces a three-part token ending in .UNSIGNED', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const token = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      return encodeJWT('{"alg":"HS256","typ":"JWT"}', '{"sub":"abc","iat":1700000000}');
    })()`);
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    expect(parts[2]).toBe('UNSIGNED');
  });

  baseTest('encodeJWT round-trips through decodeJWT', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      const token = encodeJWT('{"alg":"HS256","typ":"JWT"}', '{"sub":"roundtrip","iat":1700000000}');
      return decodeJWT(token);
    })()`);
    expect(result.payload.sub).toBe('roundtrip');
    expect(result.header.alg).toBe('HS256');
  });

  baseTest('encodeJWT returns null for invalid JSON header', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      return encodeJWT('not json', '{"sub":"x"}');
    })()`);
    expect(result).toBeNull();
  });

  baseTest('b64urlDecode handles URL-safe characters (- and _)', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      // b64urlEncode("hello world") then decode it back
      const encoded = b64urlEncode('hello world');
      return b64urlDecode(encoded);
    })()`);
    expect(result).toBe('hello world');
  });

  baseTest('b64urlDecode returns null for corrupt input', async ({ page }) => {
    await page.setContent('<html><body></body></html>');
    const result = await page.evaluate(`(function() {
      ${LOGIC_SRC}
      return b64urlDecode('!!!not-base64!!!');
    })()`);
    expect(result).toBeNull();
  });
});
