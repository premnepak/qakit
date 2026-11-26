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

async function openUtilsPanel(popup) {
  await popup.homeTile('utils').click();
  await expect(popup.panel('utils')).toHaveClass(/active/);
}

// ─── Suite 1: Popup panel UI ─────────────────────────────────────────────────

test.describe('Utils panel — UI', () => {
  test('panel opens from home tile', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await expect(popup.panel('utils')).toBeVisible();
  });

  test('JWT sub-tab is active by default', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await expect(popup.subtab('util', 'jwt')).toHaveClass(/active/);
    await expect(popup.utilsubJwt).toHaveClass(/active/);
  });

  test('URL sub-tab is reachable and shows the URL panel', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.subtab('util', 'url').click();
    await expect(popup.utilsubUrl).toBeVisible();
    await expect(popup.urlInput).toBeVisible();
  });

  test('Base64 sub-tab is reachable and shows the Base64 panel', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.subtab('util', 'base64').click();
    await expect(popup.utilsubBase64).toBeVisible();
    await expect(popup.b64Input).toBeVisible();
  });

  // ── JWT decode ──────────────────────────────────────────────────────────────

  test('JWT Decode button produces output for a valid token', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.jwtInput.fill( TEST_JWT);
    await popup.jwtDecodeBtn.click();
    const output = await popup.jwtDecodeOut.innerHTML();
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('user123');
  });

  test('JWT decode output contains header and payload sections', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.jwtInput.fill( TEST_JWT);
    await popup.jwtDecodeBtn.click();
    const output = await popup.jwtDecodeOut.innerText();
    expect(output).toContain('HS256');
    expect(output).toContain('user123');
  });

  test('JWT decode shows error for an invalid token', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.jwtInput.fill( 'not.a.jwt.at.all.garbage');
    await popup.jwtDecodeBtn.click();
    const output = await popup.jwtDecodeOut.innerHTML();
    // Should show an error indicator, not empty
    expect(output.length).toBeGreaterThan(0);
  });

  // ── JWT encode ─────────────────────────────────────────────────────────────

  test('JWT Encode button produces a three-part token', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.jwtPayInput.fill( '{"sub":"test","iat":1700000000}');
    await popup.jwtEncodeBtn.click();
    const output = await popup.jwtEncodeOut.innerText();
    const parts = output.trim().split('.');
    expect(parts.length).toBe(3);
  });

  test('JWT encode output ends with .UNSIGNED', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.jwtPayInput.fill( '{"sub":"test"}');
    await popup.jwtEncodeBtn.click();
    const output = await popup.jwtEncodeOut.innerText();
    expect(output.trim()).toMatch(/\.UNSIGNED$/);
  });

  // ── URL encode / decode ────────────────────────────────────────────────────

  test('URL decode reverses a percent-encoded string', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.subtab('util', 'url').click();
    await popup.urlInput.fill( 'hello%20world%21');
    await popup.urlDecodeBtn.click();
    const output = await popup.urlOutput.inputValue();
    expect(output).toContain('hello world!');
  });

  test('encodeURI button produces full-URI encoding', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.subtab('util', 'url').click();
    await popup.urlInput.fill( 'https://example.com/path?a=1&b=hello world');
    await popup.urlFullEncBtn.click();
    const output = await popup.urlOutput.inputValue();
    expect(output).toContain('https://example.com/path');
    expect(output).toContain('hello%20world');
  });

  // ── Base64 decode ──────────────────────────────────────────────────────────

  test('Base64 decode reverses encoded text', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.subtab('util', 'base64').click();
    const encoded = Buffer.from('qakit').toString('base64');
    await popup.b64Input.fill( encoded);
    await popup.b64DecodeBtn.click();
    const output = await popup.b64Output.inputValue();
    expect(output).toBe('qakit');
  });

  test('URL-safe Base64 button replaces + and / with - and _', async ({ popup, popupPage }) => {
    await openUtilsPanel(popup);
    await popup.subtab('util', 'base64').click();
    await popup.b64Input.fill( 'hello+world/test');
    await popup.b64UrlEncBtn.click();
    const output = await popup.b64Output.inputValue();
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
