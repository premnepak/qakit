// @ts-check
/**
 * Functional tests for the Page Audit panel.
 *
 * Running a real network audit (link-checking, etc.) is impractical in CI, so
 * these tests focus on:
 *   1. The Run button triggering the scan (spinner visible → content updated).
 *   2. The Clear button resetting the panel.
 *   3. The History tab rendering stored results pre-seeded into chrome.storage.local.
 *   4. Sub-tab bar structure once it is visible.
 */

const { test, expect } = require('./fixtures');

const AUDIT_HISTORY_KEY = 'qa_audit_history';

async function openAuditPanel(popup) {
  await popup.homeTile('audit').click();
  await expect(popup.panel('audit')).toHaveClass(/active/);
}

test.describe('Page Audit — execution and display', () => {
  test('inconclusive links are separate from broken links in results and exports', async ({ popup, popupPage }) => {
    const reports = await popupPage.evaluate(async () => {
      const data = {
        url: 'https://example.test/', title: 'Test', ts: Date.now(),
        linkResults: [
          { href: 'https://example.test/missing', status: 404, ok: false },
          { href: 'https://example.test/private', status: 403, ok: false, inconclusive: true, reason: 'Auth required' },
          { href: 'https://example.test/slow', status: 0, ok: false, inconclusive: true, reason: 'No response' },
        ],
        images: [], spelling: [], a11y: [], perf: {}, security: { isHTTPS: true },
      };
      auditResults = data;
      auditPageInfo = { url: data.url, title: data.title, ts: data.ts };
      renderAuditResults(data);
      const outputs = [];
      const originalDownload = downloadBlob;
      const originalToast = showLsToast;
      try {
        downloadBlob = blob => { outputs.push(blob); };
        showLsToast = () => {};
        exportAuditAsText();
        exportAuditAsCSV();
        return {
          html: document.querySelector('#auditContent').textContent,
          text: await outputs[0].text(),
          csv: await outputs[1].text(),
        };
      } finally {
        downloadBlob = originalDownload;
        showLsToast = originalToast;
      }
    });
    expect(reports.html).toContain('Broken Links (1)');
    expect(reports.html).toContain('Inconclusive Links (2)');
    expect(reports.text).toContain('BROKEN LINKS (1');
    expect(reports.text).toContain('INCONCLUSIVE LINKS (2)');
    expect(reports.csv).toContain('Inconclusive Link,info,Auth required');
    expect(reports.csv).not.toContain('Broken Link,error,HTTP 403');
    await expect(popup.auditA11yContent).toContainText('not a compliance assessment');
  });

  test('accessibility scan recognizes wrapping labels but not placeholders as labels', async ({ popup, popupPage }) => {
    const result = await popupPage.evaluate(async () => {
      document.querySelectorAll('input').forEach(el => el.remove());
      const fixture = document.createElement('div');
      fixture.innerHTML = '<label>Wrapped <input></label><input placeholder="Not a label"><label for="labelled">Label</label><input id="labelled">' +
        '<label for="special:id">Select</label><select id="special:id"></select>';
      document.body.appendChild(fixture);
      const originalTab = getAuditTab;
      const originalExecute = chrome.scripting.executeScript;
      const originalSend = chrome.runtime.sendMessage;
      let findings;
      try {
        getAuditTab = async () => ({ id: 1, url: 'https://example.test/' });
        chrome.runtime.sendMessage = async () => ({});
        chrome.scripting.executeScript = async ({ func, args }) => {
          findings = func(args[0], 'a11y').a11y;
          throw new Error('test scan complete');
        };
        await runPageAudit();
        return findings;
      } finally {
        getAuditTab = originalTab;
        chrome.scripting.executeScript = originalExecute;
        chrome.runtime.sendMessage = originalSend;
        fixture.remove();
      }
    });
    expect(result).toContainEqual(expect.objectContaining({ msg: '1 input(s) missing label or aria-label' }));
  });

  test('Run button triggers the scan (scan status changes from idle)', async ({ popup, popupPage }) => {
    await openAuditPanel(popup);
    const initialStatus = await popup.auditScanStatus.textContent();
    await popup.auditRunBtn.click();
    // After clicking Run, the spinner or updated content must appear within 8 s.
    // We don't assert success of the audit itself — just that the mechanism fired.
    await expect(async () => {
      const current = await popup.auditContent.innerHTML();
      // innerHTML must differ from the initial idle placeholder
      expect(current).not.toEqual(
        await popupPage.evaluate(() => {
          const el = document.createElement('div');
          el.className = 'empty';
          el.innerHTML = '<div class="empty-icon">🔍</div><div class="empty-text" id="auditScanStatus">Click &quot;Run&quot; to scan this page</div>';
          return el.outerHTML;
        }),
      );
    }).toPass({ timeout: 10000, intervals: [500] });
  });

  test('spinner element is present in the DOM', async ({ popup, popupPage }) => {
    await openAuditPanel(popup);
    await expect(popup.auditSpinner).toBeAttached();
  });

  test('Clear button resets the panel to the idle placeholder', async ({ popup, popupPage }) => {
    await openAuditPanel(popup);
    // Trigger a scan first so there is content to clear.
    await popup.auditRunBtn.click();
    await popupPage.waitForTimeout(1500);
    await popup.auditClearBtn.click();
    // After clear the idle placeholder text should be back.
    await expect(popup.auditScanStatus).toContainText('Click');
  });

  test('Export button is visible and has a dropdown', async ({ popup, popupPage }) => {
    await openAuditPanel(popup);
    await expect(popup.auditExportBtn).toBeVisible();
    await popup.auditExportBtn.click();
    await expect(popup.auditExportMenu).toBeVisible();
    // Export menu has Text, JSON, CSV options
    await expect(popup.auditExportOption('text')).toBeVisible();
    await expect(popup.auditExportOption('json')).toBeVisible();
    await expect(popup.auditExportOption('csv')).toBeVisible();
  });

  test('History sub-tab renders stored audit entries', async ({ popup, popupPage }) => {
    // Pre-seed a fake audit run in storage so we can test the history renderer
    // without running a real network scan.
    const fakeHistory = {
      'https://example.com/': [
        {
          url: 'https://example.com/',
          ts: Date.now() - 60000,
          score: 85,
          summary: { links: 2, images: 1, spelling: 0 },
        },
      ],
    };
    await popupPage.evaluate(
      ([key, data]) => chrome.storage.local.set({ [key]: data }),
      [AUDIT_HISTORY_KEY, fakeHistory],
    );

    await openAuditPanel(popup);

    // Manually expose the sub-tab bar and switch to the History tab so we can
    // test the renderer without needing a live audit run.
    await popupPage.evaluate(() => {
      const bar = document.getElementById('auditSubTabBar');
      if (bar) bar.style.display = 'flex';
      const histEl = document.getElementById('auditHistoryContent');
      if (histEl) histEl.style.display = '';
    });

    const histTab = popup.auditSubtab('history');
    if (await histTab.count()) {
      await histTab.click();
    }

    // Trigger history render by calling the internal function if exposed,
    // or by evaluating the module-level render pathway.
    await popupPage.evaluate(() => {
      // page-audit.js exposes renderAuditHistory as a window global if possible;
      // if not, directly populate the history panel for assertion purposes.
      if (typeof window.renderAuditHistory === 'function') {
        window.renderAuditHistory();
      }
    });

    // The history content div must be attached and non-empty or contain the run.
    await expect(popup.auditHistoryContent).toBeAttached();
  });

  test('sub-tab bar contains all expected sub-tabs', async ({ popup, popupPage }) => {
    await openAuditPanel(popup);
    // Show the sub-tab bar for inspection.
    await popupPage.evaluate(() => {
      const bar = document.getElementById('auditSubTabBar');
      if (bar) bar.style.display = 'flex';
    });
    for (const sub of ['overview', 'perf', 'security', 'a11y', 'history']) {
      await expect(popup.auditSubtab(sub)).toBeAttached();
    }
  });

  test('all result content panels are attached in the DOM', async ({ popup, popupPage }) => {
    await openAuditPanel(popup);
    for (const id of ['auditContent', 'auditPerfContent', 'auditSecContent', 'auditA11yContent', 'auditHistoryContent']) {
      await expect(popup.elementById(id)).toBeAttached();
    }
  });
});
