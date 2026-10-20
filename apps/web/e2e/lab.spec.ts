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
  await expect(page.getByTestId('case-studies')).toContainText('No live ranks yet');
  await expect(page.getByTestId('case-studies')).toContainText('city-rank-2 locked 2026-10-14');
  await expect(page.locator('.lab-case', { hasText: 'Awaiting live Qloo' })).toHaveCount(8);
  await expect(page.getByTestId('case-studies')).toContainText('Not a sales forecast');
  await page.getByTestId('case-studies').evaluate((node) => node.scrollIntoView({ block: 'end' }));
  await shot(page, 'case-studies-1440');
  await shotLocator(page.getByTestId('case-studies'), 'case-studies-list-1440');
  await expect(page.getByTestId('cost-avoided')).toHaveText('$10,400');
  await expect(page.getByText('Not a sales forecast').first()).toBeVisible();
  await expect(page.getByText('Estimate, not a forecast').first()).toBeVisible();
  await shot(page, 'step1-1440');
  await shotLocator(page.getByTestId('sidebar'), 'sidebar-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'step1-1280');
  await shotLocator(page.getByTestId('sidebar'), 'sidebar-1280');
  await page.getByTestId('judge-examples').getByRole('button', { name: 'Comedy special' }).click();
  await expect(page.locator('#lab-idea')).toHaveValue(/comedy special/i);
  await expect(page.locator('#lab-city')).toHaveValue('New York');
  await shot(page, 'judge-comedy-1280');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'judge-comedy-1440');
  await page.getByRole('button', { name: 'Venue concession' }).click();
  await expect(page.locator('#lab-idea')).toHaveValue(/venue concession/i);
  await shot(page, 'judge-venue-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'judge-venue-1280');
  await page.getByRole('button', { name: 'Tokyo tour + merch' }).click();
  await expect(page.locator('#lab-idea')).toHaveValue(/Tokyo tour \+ merch/);

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
  await expect(page.getByTestId('heatmap')).toBeVisible();
  await expect(page.getByTestId('heatmap')).not.toContainText(/Area \d/);
  await expect(page.getByRole('img', { name: 'Map of Tokyo' })).toBeVisible();
  await page.getByRole('button', { name: 'Talk' }).first().click();
  await expect(page.getByTestId('persona-chat')).toBeVisible();
  await page.getByTestId('chat-input').fill('Would you go to this show?');
  await page.getByTestId('chat-send').click();
  await expect.poll(async () => page.locator('.lab-lines p').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('persona-chat')).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const chatText = await page.getByTestId('persona-chat').innerText();
  expect(/Template reply|would|like|go|show/i.test(chatText)).toBe(true);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('red-team')).toBeVisible();
  await expect(page.getByTestId('red-team-quote')).toContainText(/argue against/i);
  await page.getByTestId('red-team').getByRole('button', { name: 'Talk' }).click();
  await expect(page.getByTestId('persona-chat')).toContainText(/argue against/i);
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('red-team').evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, 'red-team-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await shot(page, 'red-team-1280');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('heatmap').evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await shot(page, 'step2-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('heatmap').evaluate((node) => node.scrollIntoView({ block: 'center' }));
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
  await expect(page.getByTestId('benchmark-slot')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('benchmark-headline')).toHaveText('16 of 36');
  await page.getByTestId('benchmark-slot').evaluate((node) => node.scrollIntoView({ block: 'start' }));
  await shot(page, 'benchmark-with-1440');
  await page.getByRole('button', { name: 'Without Qloo' }).click();
  await expect(page.getByTestId('benchmark-headline')).toHaveText('0 of 36');
  await shot(page, 'benchmark-without-1440');
  await page.getByRole('button', { name: 'With Qloo' }).click();
  await expect(page.getByTestId('benchmark-headline')).toHaveText('16 of 36');
  await expect.poll(async () => {
    const flags = await page.getByTestId('score-reveal').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-settled')));
    return flags.length > 0 && flags.every((flag) => flag === 'true');
  }).toBe(true);
  const resultOpacity = await page.locator('.lab-result').evaluate((node) => getComputedStyle(node).opacity);
  expect(resultOpacity).toBe('1');
  await expect(page.locator('body')).not.toContainText('could not score both versions');
  await expect(page.locator('.lab-log')).not.toContainText(/budget exhausted/i);
  await expect(page.getByText('Changed mind').first()).toBeVisible();
  const afterQuotes = (await page.getByTestId('persona-quote').allTextContents()).map((quote) => quote.trim()).filter(Boolean);
  expect(new Set(afterQuotes).size).toBe(afterQuotes.length);
  await expect(page.getByTestId('analysis-status')).not.toContainText('Asking Qloo');
  await expect(page.getByTestId('analysis-elapsed')).not.toHaveText('Elapsed 0:00');
  await page.locator('.lab-result .lab-go').evaluate((node) => node.scrollIntoView({ block: 'end' }));
  await shot(page, 'step4-1440');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.lab-result .lab-go').evaluate((node) => node.scrollIntoView({ block: 'end' }));
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

test('example launches fill the form and reach customers', async ({ page }) => {
  test.setTimeout(600_000);
  prepare();
  const errors = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('launch-kind')).toContainText('Music');
  await expect(page.getByTestId('impact-compare')).toContainText(/music focus group/i);
  await shot(page, 'examples-home');
  const examples = [
    { name: 'Bangkok coffee shop', idea: /coffee shop in Bangkok/, kind: /Cafe/, city: 'Bangkok', file: 'example-bangkok', cost: '$3,600' },
    { name: 'Seoul indie game', idea: /video game launch in Seoul/, kind: /Video game/, city: 'Seoul', file: 'example-seoul', cost: '$12,000' },
    { name: 'NYC skincare', idea: /skincare brand/, kind: /TV series/, city: 'New York', file: 'example-nyc', cost: '$8,200' },
    { name: 'Lisbon eco tour', idea: /eco travel tour in Lisbon/, kind: /Travel/, city: 'Lisbon', file: 'example-lisbon', cost: '$7,600' },
    { name: 'Tokyo tour + merch', idea: /Tokyo tour \+ merch/, kind: /Music/, city: 'Tokyo', file: 'example-tokyo', cost: '$10,400' },
  ];
  for (const example of examples) {
    await page.getByRole('button', { name: example.name }).click();
    await expect(page.locator('#lab-idea')).toHaveValue(example.idea);
    await expect(page.locator('#lab-city')).toHaveValue(example.city);
    await expect(page.getByTestId('launch-kind')).toContainText(example.kind);
    await shot(page, example.file);
  }
  for (const example of examples) {
    await page.goto('/');
    await page.getByRole('button', { name: example.name }).click();
    await expect(page.getByTestId('cost-avoided')).toHaveText(example.cost);
    await page.getByRole('button', { name: 'Test this idea' }).click();
    await expect(page.getByTestId('persona-card').first()).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('taste-graph').first()).toBeVisible();
    const scores = await page.getByTestId('persona-score').allTextContents();
    expect(new Set(scores.map((score) => score.trim())).size).toBeGreaterThan(1);
    const summary = page.getByTestId('customer-summary');
    await expect(summary).toBeVisible();
    const summaryText = await summary.innerText();
    const pills = await page.locator('[data-testid="persona-card"] .lab-pill').allTextContents();
    const curious = pills.some((pill) => /curious/i.test(pill));
    const passing = pills.some((pill) => /would pass/i.test(pill));
    const buying = pills.some((pill) => /would buy/i.test(pill));
    if (curious) expect(summaryText).toMatch(/curious/i);
    if (passing) expect(summaryText).toMatch(/would pass/i);
    if (!passing) expect(summaryText).not.toMatch(/would pass/i);
    if (buying) expect(summaryText).toMatch(/would buy/i);
    await expect(page.locator('.lab-log')).not.toContainText(/No Qloo entity for/i);
    const stub = await page.getByTestId('feature-stub').boundingBox();
    const action = await page.getByRole('button', { name: 'Let the Agent fix it' }).boundingBox();
    expect(stub && action && stub.y + stub.height < action.y - 8).toBe(true);
    await page.getByTestId('customer-summary').evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await shot(page, `${example.file}-customers`);
  }
  expect(errors.join('\n')).not.toMatch(/409|Conflict|same key/);
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
