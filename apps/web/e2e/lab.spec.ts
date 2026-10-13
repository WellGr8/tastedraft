import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

const STORE = '/cursor/stores/self/lab-shots';
const ART = '/opt/cursor/artifacts/screenshots/lab';

function prepare() {
  fs.mkdirSync(STORE, { recursive: true });
  fs.mkdirSync(ART, { recursive: true });
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/favicon|Failed to load resource|net::ERR|React DevTools/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  const temp = `/tmp/lab-${name}.png`;
  await page.screenshot({ path: temp });
  fs.copyFileSync(temp, `${STORE}/${name}.png`);
  fs.copyFileSync(temp, `${ART}/${name}.png`);
}

async function shotLocator(locator: Locator, name: string) {
  const temp = `/tmp/lab-${name}.png`;
  await locator.screenshot({ path: temp });
  fs.copyFileSync(temp, `${STORE}/${name}.png`);
  fs.copyFileSync(temp, `${ART}/${name}.png`);
}

test('tokyo tour raises the score and shows the cost within 30 seconds', async ({ page }) => {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#lab-idea')).toHaveValue(/Tokyo tour \+ merch/);
  await expect(page.getByTestId('live-score')).toHaveText('52', { timeout: 15_000 });
  await expect(page.getByTestId('cost-avoided')).toHaveText('$10,400');
  await expect(page.getByText('Not a sales forecast').first()).toBeVisible();
  const started = Date.now();
  await page.getByRole('button', { name: 'Test this idea' }).click();
  await expect(page.getByRole('button', { name: 'Let the Agent fix it' })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Let the Agent fix it' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('score-v2')).not.toHaveText('—', { timeout: 20_000 });
  const before = Number(await page.getByTestId('score-v1').innerText());
  const after = Number(await page.getByTestId('score-v2').innerText());
  expect(after).toBeGreaterThan(before);
  await expect(page.getByTestId('cost-avoided')).toHaveText('$10,400');
  expect(Date.now() - started).toBeLessThan(30_000);
});

test('lab walks four steps with live progress and a plain report', async ({ page }) => {
  test.setTimeout(360_000);
  prepare();
  const errors = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Test the taste/ })).toBeVisible();
  await expect(page.getByTestId('live-score')).toHaveText('52', { timeout: 30_000 });
  await expect(page.getByTestId('cost-avoided')).toHaveText('$10,400');
  await expect(page.getByText('Not a sales forecast').first()).toBeVisible();
  await expect(page.getByText('Estimate, not a forecast').first()).toBeVisible();
  await shot(page, 'step1-1440');
  await shotLocator(page.getByTestId('sidebar'), 'sidebar-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'step1-1280');
  await shotLocator(page.getByTestId('sidebar'), 'sidebar-1280');

  await page.getByRole('button', { name: 'Test this idea' }).click();
  await expect(page.getByTestId('analysis-screen')).toBeVisible();
  await expect(page.getByTestId('analysis-status')).toContainText(/Asking Qloo|Searching Qloo|Reading|Scoring/);
  await expect(page.getByTestId('analysis-elapsed')).toContainText(/Elapsed \d+:\d{2}/);
  await expect(page.getByTestId('analysis-bar')).toHaveClass(/is-busy/);
  await shot(page, 'working-1280');
  await expect(page.getByTestId('analysis-status')).toContainText(/[1-9]\d*\/\d+ calls|Recorded run/, { timeout: 20_000 });

  const ask = page.getByTestId('evidence-ask');
  await expect(page.getByTestId('persona-card').nth(2).or(ask)).toBeVisible({ timeout: 180_000 });
  if (await ask.count()) {
    await page.getByTestId('evidence-ask-action').click();
    await expect(page.getByTestId('persona-card').nth(2)).toBeVisible({ timeout: 180_000 });
  }
  await expect(page.getByText('Simulated').first()).toBeVisible();
  await expect(page.getByText('PASSING')).toHaveCount(0);
  await expect(page.locator('.lab-log')).not.toContainText(/budget exhausted/i);
  const quotes = (await page.getByTestId('persona-quote').allTextContents()).map((quote) => quote.trim()).filter(Boolean);
  expect(quotes.length).toBeGreaterThanOrEqual(3);
  expect(new Set(quotes).size).toBe(quotes.length);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'step2-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'step2-1280');

  await page.getByRole('button', { name: 'Let the Agent fix it' }).click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
  await shot(page, 'step3-1280');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'step3-1440');
  await page.getByTestId('why-qloo').click();
  await expect(page.getByTestId('why-qloo-panel')).toContainText('LLM-only', { timeout: 120_000 });

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('score-v2')).not.toHaveText('—', { timeout: 180_000 });
  await expect(page.locator('.lab-result')).toBeVisible();
  const resultOpacity = await page.locator('.lab-result').evaluate((node) => getComputedStyle(node).opacity);
  expect(resultOpacity).toBe('1');
  await expect(page.locator('body')).not.toContainText('could not score both versions');
  await expect(page.locator('.lab-log')).not.toContainText(/budget exhausted/i);
  await expect(page.getByText('Changed mind').first()).toBeVisible();
  const afterQuotes = (await page.getByTestId('persona-quote').allTextContents()).map((quote) => quote.trim()).filter(Boolean);
  expect(new Set(afterQuotes).size).toBe(afterQuotes.length);
  await expect(page.getByTestId('analysis-status')).not.toContainText('Asking Qloo');
  await expect(page.getByTestId('analysis-elapsed')).not.toHaveText('Elapsed 0:00');
  await shot(page, 'step4-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'step4-1280');
  await page.getByTestId('open-report').click();
  await expect(page.getByTestId('launch-report')).toBeVisible();
  await expect(page.getByTestId('report-score')).toBeVisible();
  const report = page.getByTestId('report-text');
  await expect(report).not.toContainText(/Round \d/);
  await expect(report).not.toContainText(/Qloo calls/);
  await shot(page, 'report-1280');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'report-1440');
  expect(errors.join('\n')).not.toMatch(/409|Conflict/);
});

test('reduced motion keeps the live status without the busy bar', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('live-score')).toHaveText('52', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Test this idea' }).click();
  const analysis = page.getByTestId('analysis-screen');
  await expect(analysis).toBeVisible();
  await expect(analysis).toHaveAttribute('data-motion', 'reduce');
  await expect(page.getByTestId('analysis-status')).toContainText(/Asking Qloo|Searching Qloo|Reading|Scoring/);
  await expect(page.getByTestId('analysis-elapsed')).toContainText(/Elapsed \d+:\d{2}/);
  await expect(page.getByTestId('analysis-bar')).not.toHaveClass(/is-busy/);
});
