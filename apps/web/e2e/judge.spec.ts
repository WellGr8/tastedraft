import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const STORE = '/cursor/stores/self/lab-shots';
const ART = '/opt/cursor/artifacts/screenshots/lab';

function prepare() {
  fs.mkdirSync(STORE, { recursive: true });
  fs.mkdirSync(ART, { recursive: true });
}

async function shot(page: Page, name: string) {
  const temp = `/tmp/lab-${name}.png`;
  await page.screenshot({ path: temp, fullPage: false });
  fs.copyFileSync(temp, `${STORE}/${name}.png`);
  fs.copyFileSync(temp, `${ART}/${name}.png`);
}

async function noOverflow(page: Page) {
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(extra).toBeLessThanOrEqual(1);
}

test('mobile and tablet layouts keep the library in a drawer', async ({ page }) => {
  test.setTimeout(120_000);
  prepare();
  for (const width of [390, 440, 820]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('live-score')).toHaveText('52', { timeout: 20_000 });
    await noOverflow(page);
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await page.getByTestId('lab-menu').click();
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await page.getByTestId('sidebar').getByRole('button', { name: 'Austin' }).click();
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await expect(page.locator('#lab-city')).toHaveValue('Austin');
    await shot(page, `drawer-${width}`);
  }
});

test('judge flow screenshots at 390 and 440', async ({ page }) => {
  test.setTimeout(240_000);
  prepare();
  for (const width of [390, 440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('live-score')).toHaveText('52', { timeout: 20_000 });
    await expect(page.getByTestId('sidebar')).toBeHidden();
    await noOverflow(page);
    await shot(page, `step1-${width}`);

    await page.getByRole('button', { name: 'Test this idea' }).click();
    await expect(page.getByTestId('persona-card').first()).toBeVisible({ timeout: 40_000 });
    await noOverflow(page);
    await shot(page, `step2-${width}`);

    await page.getByRole('button', { name: 'Talk' }).first().click();
    await expect(page.getByTestId('persona-chat')).toBeVisible();
    await page.getByTestId('chat-input').fill('Would you go to this show?');
    await page.getByTestId('chat-send').click();
    await expect.poll(async () => page.locator('.lab-lines p').count(), { timeout: 60_000 }).toBeGreaterThanOrEqual(3);
    await noOverflow(page);
    await shot(page, `chat-${width}`);
    await page.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Let the Agent fix it' }).click();
    await expect(page.getByTestId('agent-round').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('agent-stop')).toContainText(/at least 4 points/);
    await noOverflow(page);
    await shot(page, `rounds-${width}`);

    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('score-v2')).not.toHaveText('—', { timeout: 30_000 });
    const before = Number(await page.getByTestId('score-v1').innerText());
    const after = Number(await page.getByTestId('score-v2').innerText());
    expect(after).toBeGreaterThan(before);
    await expect(page.getByText('Changed mind').first()).toBeVisible();
    await expect(page.getByTestId('benchmark-headline')).toHaveText('16 of 36');
    await expect(page.getByTestId('benchmark-sentence')).toContainText('backed by real taste data');
    await expect(page.getByTestId('benchmark-source')).toHaveCount(0);
    await noOverflow(page);
    await shot(page, `step4-${width}`);
    await page.getByTestId('benchmark-slot').evaluate((node) => node.scrollIntoView({ block: 'start' }));
    await shot(page, `benchmark-${width}`);

    await page.getByTestId('open-report').click();
    await expect(page.getByTestId('launch-report')).toBeVisible();
    await expect(page.getByTestId('report-score')).toBeVisible();
    const report = page.getByTestId('report-text');
    await expect(report).not.toContainText(/Round \d/);
    await expect(report).not.toContainText(/Qloo calls/);
    const hoods = page.getByTestId('report-neighborhoods');
    await expect(hoods).toContainText('Best bet');
    await expect(hoods).toContainText('Safe big market');
    await expect(hoods).not.toContainText('MEGURO');
    await noOverflow(page);
    await shot(page, `report-${width}`);
  }
});
