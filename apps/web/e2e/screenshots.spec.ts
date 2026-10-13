import { expect, test } from '@playwright/test';

test('search NewJeans shows a cover', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByTestId('reference-search').fill('NewJeans');
  const hit = page.getByTestId('search-hit').first();
  await expect(hit).toContainText('NewJeans');
  await expect(hit.locator('img')).toHaveAttribute('src', /commons\.wikimedia\.org|upload\.wikimedia\.org/);
  await page.getByTestId('reference-search').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/search-newjeans-1440.png' });
});

test('agent activity, approve, and the live price slider', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('71');
  await expect(page.getByTestId('score-v2')).toHaveCount(0);
  await expect(page.getByText(/ledger is anchor|Six diffs are scored/i)).toHaveCount(0);

  await page.getByTestId('price-slider').fill('2');
  await expect(page.getByTestId('live-score')).toHaveText('80');
  await page.screenshot({ path: 'screenshots/sliders-1440.png' });
  await page.getByTestId('price-slider').fill('3');
  await expect(page.getByTestId('live-score')).toHaveText('71');

  await page.getByRole('button', { name: 'Score profile' }).click();
  await expect(page.getByTestId('score-v1')).toHaveText('71');
  await page.getByTestId('chat-panel').waitFor();
  await page.getByTestId('chat-input').fill('what should we change?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('agent-step').filter({ hasText: 'Simulating' })).toBeVisible();
  await expect(page.getByTestId('agent-step').filter({ hasText: 'Ranking' })).toBeVisible();
  await page.getByTestId('proposal-0').waitFor();
  await page.screenshot({ path: 'screenshots/chat-agent-1440.png' });

  await page.getByTestId('proposal-0').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('score-v2')).toHaveText('80');
  await expect(page.getByText('71 → 80')).toBeVisible();
  await expect(page.getByText(/ledger is anchor|Six diffs are scored/i)).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/approve-1440.png' });
});

test('tablet keeps the profile and the agent sheet', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('71');
  await page.getByTestId('chat-toggle').click();
  await page.getByTestId('chat-sheet').waitFor();
  await page.screenshot({ path: 'screenshots/tablet-768.png' });
});

test('mobile opens the agent sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('71');
  await page.getByTestId('reference-search').fill('BTS');
  await expect(page.getByTestId('search-hit').first()).toContainText(/BTS/i);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('chat-toggle').click();
  await page.getByTestId('chat-sheet').waitFor();
  await page.screenshot({ path: 'screenshots/mobile-390.png' });
});
