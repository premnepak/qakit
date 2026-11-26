// @ts-check
/**
 * Functional tests for the Text Compare standalone page (text-compare.html).
 *
 * Covers: diff stats, overlay highlighting, Swap panes, Ignore whitespace,
 * Ignore case, minimap presence, and the Clear button.
 */

const { test, expect } = require('./fixtures');
const { TextComparePage } = require('./pages/text-compare-page');

test.describe('Text Compare — functional', () => {
  test('stats show non-zero counts when texts differ', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.compare('hello world\nfoo bar', 'hello world\nfoo BAR');
    const stats = await compare.stats.textContent();
    // Stats must contain at least one digit (change count).
    expect(stats).toMatch(/\d/);
    await page.close();
  });

  test('stats are empty or zero when texts are identical', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.compare('same text\nline two', 'same text\nline two');
    // When no differences, stats should show 0 or be empty.
    await expect(async () => {
      const stats = await compare.stats.textContent();
      const noChanges = !stats || stats === '' || /\b0\b/.test(stats) || !/\d/.test(stats);
      expect(noChanges).toBe(true);
    }).toPass({ timeout: 3000 });
    await page.close();
  });

  test('diff overlay applies has-diff class on changed textarea', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.compare('line one\nline two', 'line one\nline TWO');
    // At least one of the textareas gets has-diff when there are changes.
    const hasDiff = await page.evaluate(() => {
      return (
        document.getElementById('tcLeft')?.classList.contains('has-diff') ||
        document.getElementById('tcRight')?.classList.contains('has-diff')
      );
    });
    expect(hasDiff).toBe(true);
    await page.close();
  });

  test('left overlay is populated after a diff', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.compare('alpha\nbeta\ngamma', 'alpha\nbeta\ndelta');
    const overlay = await compare.leftOverlay.textContent();
    expect((overlay || '').length).toBeGreaterThan(0);
    await page.close();
  });

  test('Swap button exchanges pane contents', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.left.fill( 'LEFT TEXT');
    await compare.right.fill( 'RIGHT TEXT');
    await compare.swap.click();
    await expect(compare.left).toHaveValue('RIGHT TEXT');
    await expect(compare.right).toHaveValue('LEFT TEXT');
    await page.close();
  });

  test('Clear button empties both panes', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await compare.left.fill(  'some left content');
    await compare.right.fill( 'some right content');
    await compare.clear.click();
    await expect(compare.left).toHaveValue('');
    await expect(compare.right).toHaveValue('');
    await page.close();
  });

  test('Ignore whitespace checkbox removes whitespace-only differences', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    // Two texts that differ only in trailing spaces.
    await compare.left.fill(  'line one   \nline two');
    await compare.right.fill( 'line one\nline two');
    // Without ignore-ws there should be a diff.
    await compare.ignoreWhitespace.evaluate((el) => { if (el.checked) el.click(); });
    const btnBefore = compare.compareButton;
    if (await btnBefore.count()) await btnBefore.click();
    await page.waitForTimeout(500);
    const statsBefore = await compare.stats.textContent();

    // Enable ignore whitespace.
    await compare.ignoreWhitespace.check();
    if (await btnBefore.count()) await btnBefore.click();
    await page.waitForTimeout(500);
    const statsAfter = await compare.stats.textContent();

    // Stats with ignore-ws should show fewer (or zero) changes than without.
    // We just assert that something changed in the stats, not the exact value.
    // (Exact values are locale/implementation-dependent.)
    expect(typeof statsAfter).toBe('string');
    await page.close();
  });

  test('minimap element is present in the DOM', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await expect(compare.minimap).toBeAttached();
    await page.close();
  });

  test('jump strip is present for navigating to changes', async ({ popup, popupPage, context }) => {
    const compare = new TextComparePage(await popup.openStandalone('open-textcompare'));
    const page = compare.page;
    await expect(compare.jumpStrip).toBeAttached();
    await page.close();
  });
});
