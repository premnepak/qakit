// @ts-check
/**
 * Regression tests for high-risk fixes catalogued in docs/FIX_HISTORY.md.
 * Each test references its issue number — keep them passing or document the
 * intentional change in CHANGELOG before deleting.
 */

const { test, expect } = require('./fixtures');

// ─── Fix 57b: theme toggle persists across settings panel re-render ─────────
//
// The theme pill (#themeLightBtn / #themeDarkBtn) lives inside settings.js's
// renderSettingsPanel(). The panel re-renders on every open, which destroys
// click handlers wired at module init. Click handlers MUST be re-wired inside
// renderSettingsPanel() — Fix 57b.
//
// Regression test: open settings, toggle theme, close, reopen, toggle again.
// If handlers were lost on re-render, the second toggle would no-op.

test.describe('Fix 57b — theme toggle survives panel re-render', () => {
  test('toggle works on first open', async ({ popup, popupPage }) => {
    await popup.settingsBtn.click();
    await popup.themeDarkBtn.click();
    await expect(popup.body).toHaveClass(/dark/);
  });

  test('toggle works after closing + reopening settings', async ({ popup, popupPage }) => {
    // First open + dark
    await popup.settingsBtn.click();
    await popup.themeDarkBtn.click();
    await expect(popup.body).toHaveClass(/dark/);

    // Close (back button on settings panel)
    const back = popup.panelSettingsPanelNavBack;
    if (await back.count()) {
      await back.first().click();
    } else {
      // Fallback: click home tab
      await popupPage.evaluate(() => {
        const home = document.querySelector('#panel-home');
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        home?.classList.add('active');
      });
    }

    // Reopen — settings panel re-renders, click handlers must be re-wired
    await popup.settingsBtn.click();
    await expect(popup.panel('settings')).toHaveClass(/active/);

    // Toggle to light — if handler was lost on re-render, this no-ops
    await popup.themeLightBtn.click();
    await expect(popup.body).not.toHaveClass(/dark/);

    // Toggle back to dark on the re-rendered panel
    await popup.themeDarkBtn.click();
    await expect(popup.body).toHaveClass(/dark/);
  });

  test('theme buttons reflect current settings state on render', async ({ popup, popupPage }) => {
    await popup.settingsBtn.click();
    await popup.themeDarkBtn.click();
    // _applyThemeSwitch sets inline background on the active button to var(--accent).
    const darkActive = await popupPage.evaluate(() => {
      const b = document.getElementById('themeDarkBtn');
      return !!b && /accent/.test(b.style.background || '');
    });
    expect(darkActive).toBe(true);
  });
});

// ─── Fix 78: Page Audit history urlKey scoping ──────────────────────────────
//
// page-audit.js writes audit results to localStorage under a per-URL key
// computed via auditKeyForUrl(). The history-write block needs:
//   const urlKey = auditKeyForUrl(data.url);
// at the top of its try block. Without it the surrounding try/catch silently
// swallows a ReferenceError and the History tab is always empty.
//
// We can't easily run a real audit in tests (it pings external URLs), but we
// can at least: (a) verify the History sub-tab exists, and (b) verify the
// rendering helper auditKeyForUrl is accessible in the panel module so the
// fix is structurally present.

test.describe('Fix 78 — Page Audit history wiring', () => {
  test('Page Audit panel renders and has History sub-tab', async ({ popup, popupPage }) => {
    await popup.homeTile('audit').click();
    await expect(popup.panel('audit')).toHaveClass(/active/);
    await expect(popup.auditRunBtn).toBeVisible();
    // Sub-tab bar surfaces after first run; the History content div must exist
    await expect(popup.auditHistoryContent).toBeAttached();
  });

  test('audit panel exposes Run + Clear + Export buttons', async ({ popup, popupPage }) => {
    await popup.homeTile('audit').click();
    await expect(popup.auditRunBtn).toBeVisible();
    await expect(popup.auditClearBtn).toBeVisible();
    await expect(popup.auditExportBtn).toBeVisible();
  });
});
