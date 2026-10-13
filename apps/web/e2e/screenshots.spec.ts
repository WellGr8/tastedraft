import { expect, test, type Page } from '@playwright/test';

const SHOTS2 = '/cursor/stores/self/shots2';
const SHOTS3 = '/cursor/stores/self/shots3';
const SHOTS4 = '/cursor/stores/self/shots4';

async function settle(page: Page) {
  await page.evaluate(async () => {
    const pending = document.getAnimations().filter((animation) => {
      const effect = animation.effect;
      if (effect && 'getTiming' in effect) {
        const iterations = effect.getTiming().iterations;
        if (iterations === Infinity) return false;
      }
      return animation.playState !== 'finished';
    });
    await Promise.race([
      Promise.all(pending.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  });
}

test('search NewJeans shows a cover on the input brief', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /simulated customers before you spend/ })).toBeVisible();
  await page.screenshot({ path: 'screenshots/input-1440.png' });
  await page.getByTestId('reference-search').fill('NewJeans');
  const hit = page.getByTestId('search-hit').first();
  await expect(hit).toContainText('NewJeans');
  const cover = hit.locator('img');
  await expect(cover).toHaveAttribute('src', /^https:\/\/.+/);
  const coverSrc = await cover.getAttribute('src');
  expect(coverSrc ?? '').not.toContain('example.invalid');
  await page.getByTestId('reference-search').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/search-newjeans-1440.png' });
});

test('guided flow scores V1, then V2 only after approve', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('71');
  await expect(page.getByTestId('score-v2')).toHaveCount(0);
  await expect(page.getByText(/ledger is anchor|Six diffs are scored/i)).toHaveCount(0);

  await page.getByRole('button', { name: /Customize/ }).click();
  await page.getByTestId('price-slider').fill('2');
  await expect(page.getByTestId('live-score')).toHaveText('80');
  await page.getByTestId('price-slider').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/sliders-1440.png' });
  await page.getByTestId('price-slider').fill('3');
  await expect(page.getByTestId('live-score')).toHaveText('71');

  await page.getByRole('button', { name: 'TEST CONCEPT' }).click();
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await expect(page.getByTestId('analysis-screen')).toContainText('Build personas from Qloo');
  await page.screenshot({ path: 'screenshots/analyzing-1440.png' });

  await page.getByTestId('score-v1').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('score-v1')).toHaveText('71');
  await expect(page.getByTestId('score-v2')).toHaveCount(0);
  const titleOpacity = await page.locator('.ws-title').evaluate((el) => getComputedStyle(el).opacity);
  expect(titleOpacity).toBe('1');
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  await page.screenshot({ path: 'screenshots/v1-1440.png' });

  await page.getByRole('button', { name: 'Review proposal' }).click();
  await expect(page.getByTestId('proposal-modal')).toBeVisible();
  await expect(page.getByTestId('proposal-0')).toBeVisible();
  await page.screenshot({ path: 'screenshots/proposal-1440.png' });
  await page.getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByTestId('score-v2')).toHaveText('80');
  await expect(page.getByText('71 → 80')).toBeVisible();
  await expect(page.getByText(/ledger is anchor|Six diffs are scored/i)).toHaveCount(0);
  await page.locator('#sec-agent').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/v2-1440.png' });

  await page.getByRole('button', { name: 'Compare V1 and V2' }).click();
  await expect(page.getByTestId('compare-modal')).toBeVisible();
  await page.screenshot({ path: 'screenshots/compare-1440.png' });
});

test('chat drawer proposes a change the same approve path can take', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'TEST CONCEPT' }).click();
  await page.getByTestId('score-v1').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('score-v1')).toHaveText('71');
  await page.getByTestId('chat-toggle').click();
  await page.getByTestId('chat-drawer').waitFor();
  await page.getByTestId('chat-input').fill('what should we change?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('agent-step').filter({ hasText: 'Simulate' })).toBeVisible();
  await expect(page.getByTestId('agent-step').filter({ hasText: 'Rank' })).toBeVisible();
  await page.getByTestId('proposal-0').waitFor();
  await page.screenshot({ path: 'screenshots/chat-agent-1440.png' });
});

test('mobile story matches the same steps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('71');
  await page.screenshot({ path: 'screenshots/input-390.png' });
  await page.getByRole('button', { name: 'TEST CONCEPT' }).click();
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await page.screenshot({ path: 'screenshots/analyzing-390.png' });
  await page.getByTestId('score-v1').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('score-v1')).toHaveText('71');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'screenshots/v1-390.png' });
  await page.getByRole('button', { name: 'Review proposal' }).click();
  await page.screenshot({ path: 'screenshots/proposal-390.png' });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('score-v2')).toHaveText('80');
  await page.locator('#sec-agent').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/v2-390.png' });
  await page.getByRole('button', { name: 'Compare V1 and V2' }).click();
  await page.screenshot({ path: 'screenshots/compare-390.png' });
});

test('mobile input and the agent drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('71');
  await page.screenshot({ path: 'screenshots/input-390.png' });
  await page.getByTestId('reference-search').fill('BTS');
  await expect(page.getByTestId('search-hit').first()).toContainText(/BTS/i);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'screenshots/mobile-390.png' });
  await page.getByTestId('chat-toggle').click();
  await page.getByTestId('chat-drawer').waitFor();
  await page.screenshot({ path: 'screenshots/chat-390.png' });
});

test('persona loop screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await settle(page);
  await expect(page.getByRole('heading', { name: /simulated customers before you spend/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS2}/landing-1440.png` });

  await page.getByTestId('try-example').click();
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await expect(page.getByTestId('loop-output')).toContainText(/Tokyo|I'd try it|Not for me|Still measuring/);
  await settle(page);
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await page.screenshot({ path: `${SHOTS2}/agent-loop-1440.png` });

  await expect(page.getByTestId('persona-card').first()).toBeVisible();
  await expect(page.getByTestId('persona-card').first()).toContainText(/Tokyo/);
  const anchorNames = await page.locator('.td-anchor small').allTextContents();
  expect(new Set(anchorNames.map((name) => name.trim()).filter(Boolean)).size).toBeGreaterThan(3);
  await expect(page.locator('.td-anchor img').first()).toBeVisible();
  await expect(page.locator('.byb-pin')).toHaveCount(0);
  await expect(page.getByTestId('heatmap')).toBeVisible();
  await settle(page);
  const opacity = await page.locator('.ws-title').evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe('1');
  const issueCount = await page.locator('nextjs-portal').evaluate((el) => {
    const node = el.shadowRoot?.querySelector('.dev-tools-indicator-issue-count');
    return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  });
  expect(issueCount).toBe('');
  await page.locator('#sec-score').scrollIntoViewIfNeeded();
  const scoreCovered = await page.evaluate(() => {
    const score = document.querySelector('#sec-score')?.getBoundingClientRect();
    const bar = document.querySelector('.np')?.getBoundingClientRect();
    if (!score || !bar) return true;
    return score.bottom > bar.top + 1 && score.top < bar.bottom;
  });
  expect(scoreCovered).toBe(false);
  await page.getByTestId('personas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS2}/personas-1440.png` });

  await page.getByRole('button', { name: 'Talk' }).first().click();
  await page.getByTestId('persona-chat-input').fill('why would you reject this?');
  await page.getByTestId('persona-chat-send').click();
  await expect(page.getByTestId('evidence-chip').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS2}/persona-chat-1440.png` });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({ path: `${SHOTS2}/personas-768.png` });

  await page.goto('/');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'TEST CONCEPT' }).click();
  await page.getByTestId('score-v1').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('score-v1')).toHaveText('71');
  await page.getByRole('button', { name: 'Review proposal' }).click();
  await expect(page.getByTestId('proposal-modal')).toBeVisible();
  await page.screenshot({ path: `${SHOTS2}/proposal-1440.png` });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('score-v2')).toHaveText('80');
  await expect(page.getByTestId('reinterview')).toBeVisible();
  await page.locator('#sec-agent').scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: `${SHOTS2}/reinterview-1440.png` });

  await page.getByTestId('target-score').fill('90');
  await page.getByTestId('chase-target').click();
  await expect(page.getByTestId('score-timeline')).toBeVisible();
  await expect(page.getByTestId('score-timeline')).toContainText('71');
  await expect(page.getByTestId('score-timeline')).toContainText('80');
  await page.screenshot({ path: `${SHOTS2}/timeline-1440.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('personas').scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: `${SHOTS2}/mobile-390.png` });
});

test('try example approves until a stop reason', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('try-example').click();
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await expect(page.getByTestId('analysis-screen')).toContainText('Build personas from Qloo');
  await expect(page.getByTestId('loop-output')).toContainText(/Tokyo|I'd try it|Not for me|Still measuring/);
  await settle(page);
  await page.screenshot({ path: `${SHOTS3}/agent-loop-1440.png` });
  await expect(page.getByTestId('results-screen')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('trace-why').click();
  await expect(page.getByTestId('decision-trace')).toBeVisible();
  const stop = page.getByTestId('stop-reason');
  const reason = /target you set|cultural evidence|move the score|used its questions|approved_target|insufficient_evidence|no_meaningful_improvement|max_rounds_or_budget/;
  for (let turn = 0; turn < 5; turn += 1) {
    if ((await stop.count()) > 0 && reason.test((await stop.textContent()) ?? '')) break;
    const closer = page.getByRole('button', { name: 'Close' });
    if (await closer.isVisible()) await closer.click();
    const review = page.getByRole('button', { name: 'Review proposal' });
    if (await review.isVisible()) {
      await review.click();
      await page.getByTestId('proposal-modal').getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByTestId('proposal-modal')).toBeHidden();
      continue;
    }
    const pending = page.getByTestId('target-proposal').getByRole('button', { name: 'Approve' });
    if (await pending.isVisible()) {
      await pending.click({ force: true });
      await page.waitForTimeout(400);
      continue;
    }
    break;
  }
  await expect(stop).toHaveText(reason);
  if (!(await page.getByTestId('decision-trace').isVisible())) await page.getByTestId('trace-why').click();
  await expect(page.getByTestId('decision-trace')).toContainText('Build personas from Qloo');
  const issueCount = await page.locator('nextjs-portal').evaluate((el) => {
    const node = el.shadowRoot?.querySelector('.dev-tools-indicator-issue-count');
    return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  });
  expect(issueCount).toBe('');
  await page.locator('#sec-agent').scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: `${SHOTS3}/stop-1440.png` });
});

test('launch report and why qloo', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByText('Not another AI focus group. Every change is traceable to cultural evidence.')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS4}/landing-1440.png` });
  await page.getByTestId('try-example').click();
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await expect(page.getByTestId('analysis-screen')).toContainText('Build personas from Qloo');
  await settle(page);
  await page.screenshot({ path: `${SHOTS4}/analysis-1440.png` });
  await expect(page.getByTestId('results-screen')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Cultural resonance score')).toBeVisible();
  await expect(page.getByText('Not a sales forecast')).toBeVisible();
  await expect(page.getByText('Evidence confidence')).toBeVisible();
  await expect(page.getByText('Simulated').first()).toBeVisible();
  await page.locator('#sec-score').scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: `${SHOTS4}/result-1440.png` });
  await page.getByTestId('why-qloo').click();
  await expect(page.getByTestId('why-qloo-panel')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('llm-stop')).toContainText(/cultural evidence|insufficient_evidence/);
  await expect(page.getByTestId('why-qloo-panel')).toContainText('LLM-only');
  await settle(page);
  await page.screenshot({ path: `${SHOTS4}/why-qloo-1440.png` });
  const stop = page.getByTestId('stop-reason');
  const reason = /target you set|cultural evidence|move the score|used its questions|approved_target|insufficient_evidence|no_meaningful_improvement|max_rounds_or_budget/;
  for (let turn = 0; turn < 5; turn += 1) {
    if ((await stop.count()) > 0 && reason.test((await stop.textContent()) ?? '')) break;
    const closer = page.getByRole('button', { name: 'Close' });
    if (await closer.isVisible()) await closer.click();
    const review = page.getByRole('button', { name: 'Review proposal' });
    if (await review.isVisible()) {
      await review.click();
      await page.getByTestId('proposal-modal').getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByTestId('proposal-modal')).toBeHidden();
      continue;
    }
    const pending = page.getByTestId('target-proposal').getByRole('button', { name: 'Approve' });
    if (await pending.isVisible()) {
      await pending.click({ force: true });
      await page.waitForTimeout(400);
      continue;
    }
    break;
  }
  await expect(stop).toHaveText(reason);
  await page.getByTestId('trace-why').click();
  await expect(page.getByTestId('decision-trace')).toContainText('Build personas from Qloo');
  await expect(page.getByTestId('decision-trace')).toContainText(/entities|heatmap/);
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('launch-report')).toBeVisible();
  await expect(page.getByTestId('report-score')).toBeVisible();
  await expect(page.getByTestId('heatmap')).toBeVisible();
  await expect(page.getByTestId('report-stop')).toHaveText(reason);
  const issueCount = await page.locator('nextjs-portal').evaluate((el) => {
    const node = el.shadowRoot?.querySelector('.dev-tools-indicator-issue-count');
    return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  });
  expect(issueCount).toBe('');
  await settle(page);
  await page.screenshot({ path: `${SHOTS4}/report-1440.png` });
});
