import { test, expect } from '@playwright/test';

// A fixed data set, so assertions don't depend on the live data.csv.
// Agents have closed 6 of 24 issues: 45 minutes to midnight.
const CSV = `date,open,agent_closed,human_closed
2026-11-01,10,0,0
2026-11-08,30,6,18
`;

const withFixture = (page, body = CSV, status = 200) =>
  page.route('**/data/data.csv', (route) =>
    route.fulfill({ status, body, contentType: 'text/csv' })
  );

// Requests made by the service worker would bypass page.route().
test.use({ serviceWorkers: 'block' });

test('has title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Developer Doomsday Clock/);
});

test('dashboard shows the clock, gauge, tiles and trend from data.csv', async ({
  page,
}) => {
  await withFixture(page);
  await page.goto('/');

  const clock = page.locator('doomsday-clock');
  await expect(clock.locator('[data-minutes]')).toHaveText('45.0');
  await expect(clock.locator('[data-time]')).toHaveText('Clock reads 11:15 PM');
  await expect(clock.getByRole('img')).toHaveAttribute(
    'aria-label',
    /45\.0 minutes to midnight/
  );

  const gauge = page.locator('velocity-gauge');
  await expect(gauge.locator('[data-readout]')).toHaveText('0.9');
  await expect(gauge.getByRole('img')).toHaveAttribute(
    'aria-label',
    /closing 0\.9 tickets per day.*averaged over 7 days/
  );

  await expect(page.locator('[data-stat="open"]')).toHaveText('30');
  await expect(page.locator('[data-stat="open-delta"]')).toHaveText(
    '+20 in 7d'
  );
  await expect(page.locator('[data-stat="share"]')).toHaveText('25.0%');
  await expect(page.locator('[data-stat="clear"]')).toHaveText('35 days');
  await expect(page.locator('[data-status]')).toContainText('Elevated');
  await expect(page.locator('[data-as-of]')).toContainText('Nov 8, 2026');

  // Table view lists every day, newest first.
  await page.getByText('View as table').click();
  const rows = page.locator('trend-chart tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('2026-11-08');
});

test('trend chart: crosshair tooltip and legend toggles', async ({ page }) => {
  await withFixture(page);
  await page.goto('/');
  const chart = page.locator('trend-chart');
  const tooltip = chart.locator('[data-tooltip]');

  const plot = chart.locator('[data-plot] rect[tabindex]');
  await plot.focus();
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Nov 8, 2026');
  await page.keyboard.press('ArrowLeft');
  await expect(tooltip).toContainText('Nov 1, 2026');
  await page.keyboard.press('Escape');
  await expect(tooltip).toBeHidden();

  const open = chart.getByRole('button', { name: 'Open issues' });
  await open.click();
  await expect(open).toHaveAttribute('aria-pressed', 'false');
  await plot.hover();
  await expect(tooltip).not.toContainText('Open issues');
  await open.click();
  await expect(open).toHaveAttribute('aria-pressed', 'true');
});

test('shows an error when data.csv cannot be loaded', async ({ page }) => {
  await withFixture(page, '', 500);
  await page.goto('/');
  await expect(page.locator('[data-as-of]')).toContainText('HTTP 500');
});

test('nav links navigate without reloading and mark the current page', async ({
  page,
}) => {
  await withFixture(page);
  await page.goto('/');
  await page.evaluate(() => (window.stillSamePage = true));

  const nav = page.locator('app-nav [data-nav]');
  await nav.getByRole('link', { name: 'Methodology' }).click();
  await expect(page).toHaveURL('/methodology');
  await expect(page.locator('methodology-page h1')).toHaveText(
    'How the numbers are calculated'
  );
  await expect(nav.getByRole('link', { name: 'Methodology' })).toHaveAttribute(
    'aria-current',
    'page'
  );

  await page.getByRole('link', { name: '← Back to the dashboard' }).click();
  await expect(page.locator('dashboard-page')).toBeVisible();
  expect(await page.evaluate(() => window.stillSamePage)).toBe(true);
});

test('unknown routes show the not-found page', async ({ page }) => {
  await withFixture(page);
  await page.goto('/no/such/page');
  await expect(page.locator('not-found-page')).toContainText('Page Not Found');
  await page.getByRole('link', { name: 'Go back home' }).click();
  await expect(page.locator('dashboard-page')).toBeVisible();
});

test('is installable: manifest and icons resolve', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const href = await page
    .locator('link[rel="manifest"]')
    .evaluate((l) => l.href);
  const manifest = await (await request.get(href)).json();
  expect(manifest.name).toBe('Developer Doomsday Clock');
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, href).href)).ok()).toBe(true);
  }
});
