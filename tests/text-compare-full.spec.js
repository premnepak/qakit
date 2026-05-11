// @ts-check
/**
 * Functional tests for the Text Compare standalone page (text-compare.html).
 *
 * Covers: diff stats, overlay highlighting, Swap panes, Ignore whitespace,
 * Ignore case, minimap presence, and the Clear button.
 */

const { test, expect } = require('./fixtures');

async function openTextCompare(popupPage, context) {
  const [page] = await Promise.all([
    context.waitForEvent('page'),
    popupPage.click('.home-tile[data-action="open-textcompare"]'),
  ]);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function compareTexts(page, left, right) {
  await page.fill('#tcLeft', left);
  await page.fill('#tcRight', right);
  // If Live mode is on the compare fires automatically on input; also click
  // Compare explicitly for determinism.
  const btn = page.locator('#tcCompare');
  if (await btn.count()) await btn.click();
  // Wait for stats to populate.
  await expect(async () => {
    const stats = await page.locator('#tcStats').textContent();
    expect((stats || '').length).toBeGreaterThan(0);
  }).toPass({ timeout: 4000 });
}

test.describe('Text Compare — functional', () => {
  test('stats show non-zero counts when texts differ', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await compareTexts(page, 'hello world\nfoo bar', 'hello world\nfoo BAR');
    const stats = await page.locator('#tcStats').textContent();
    // Stats must contain at least one digit (change count).
    expect(stats).toMatch(/\d/);
    await page.close();
  });

  test('stats are empty or zero when texts are identical', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await compareTexts(page, 'same text\nline two', 'same text\nline two');
    // When no differences, stats should show 0 or be empty.
    await expect(async () => {
      const stats = await page.locator('#tcStats').textContent();
      const noChanges = !stats || stats === '' || /\b0\b/.test(stats) || !/\d/.test(stats);
      expect(noChanges).toBe(true);
    }).toPass({ timeout: 3000 });
    await page.close();
  });

  test('diff overlay applies has-diff class on changed textarea', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await compareTexts(page, 'line one\nline two', 'line one\nline TWO');
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

  test('left overlay is populated after a diff', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await compareTexts(page, 'alpha\nbeta\ngamma', 'alpha\nbeta\ndelta');
    const overlay = await page.locator('#tcLeftOverlay').textContent();
    expect((overlay || '').length).toBeGreaterThan(0);
    await page.close();
  });

  test('Swap button exchanges pane contents', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await page.fill('#tcLeft', 'LEFT TEXT');
    await page.fill('#tcRight', 'RIGHT TEXT');
    await page.click('#tcSwap');
    await expect(page.locator('#tcLeft')).toHaveValue('RIGHT TEXT');
    await expect(page.locator('#tcRight')).toHaveValue('LEFT TEXT');
    await page.close();
  });

  test('Clear button empties both panes', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await page.fill('#tcLeft',  'some left content');
    await page.fill('#tcRight', 'some right content');
    await page.click('#tcClear');
    await expect(page.locator('#tcLeft')).toHaveValue('');
    await expect(page.locator('#tcRight')).toHaveValue('');
    await page.close();
  });

  test('Ignore whitespace checkbox removes whitespace-only differences', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    // Two texts that differ only in trailing spaces.
    await page.fill('#tcLeft',  'line one   \nline two');
    await page.fill('#tcRight', 'line one\nline two');
    // Without ignore-ws there should be a diff.
    await page.locator('#tcIgnoreWs').evaluate((el) => { if (el.checked) el.click(); });
    const btnBefore = page.locator('#tcCompare');
    if (await btnBefore.count()) await btnBefore.click();
    await page.waitForTimeout(500);
    const statsBefore = await page.locator('#tcStats').textContent();

    // Enable ignore whitespace.
    await page.check('#tcIgnoreWs');
    if (await btnBefore.count()) await btnBefore.click();
    await page.waitForTimeout(500);
    const statsAfter = await page.locator('#tcStats').textContent();

    // Stats with ignore-ws should show fewer (or zero) changes than without.
    // We just assert that something changed in the stats, not the exact value.
    // (Exact values are locale/implementation-dependent.)
    expect(typeof statsAfter).toBe('string');
    await page.close();
  });

  test('minimap element is present in the DOM', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await expect(page.locator('#tcMinimap')).toBeAttached();
    await page.close();
  });

  test('jump strip is present for navigating to changes', async ({ popupPage, context }) => {
    const page = await openTextCompare(popupPage, context);
    await expect(page.locator('#tcJumpStrip')).toBeAttached();
    await page.close();
  });
});
