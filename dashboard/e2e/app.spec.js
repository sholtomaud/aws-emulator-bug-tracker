import { test, expect } from '@playwright/test';

// A fixed data set, so assertions don't depend on the live data.csv.
// Agents have closed 6 of 24 issues: 25% share, 18 hours to midnight.
const CSV = `date,open,agent_closed,human_closed
2026-11-01,10,0,0
2026-11-08,30,6,18
`;

// The tracker last ran at 12:05 on the newest day, so that day counts as
// about half a day: rates are over 6.5 days, not 7.
const STATUS = {
  updated_at: '2026-11-08T12:05:00Z',
  schedule: {
    cron: '5 */6 * * *',
    runs_per_day: 4,
    interval_hours: 6,
    description: 'every 6 hours',
    run_times_utc: ['00:05', '06:05', '12:05', '18:05'],
  },
};

const withFixture = async (page, body = CSV, status = 200, json = STATUS) => {
  await page.route('**/data/data.csv', (route) =>
    route.fulfill({ status, body, contentType: 'text/csv' })
  );
  await page.route('**/data/status.json', (route) =>
    json ? route.fulfill({ json }) : route.fulfill({ status: 404 })
  );
};

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
  await expect(clock.locator('[data-hours]')).toHaveText('18.0');
  await expect(clock.locator('[data-time]')).toHaveText('Clock reads 06:00');
  await expect(clock.getByRole('img')).toHaveAttribute(
    'aria-label',
    /18\.0 hours to midnight, reading 06:00/
  );

  const gauge = page.locator('velocity-gauge');
  await expect(gauge.locator('[data-readout]')).toHaveText('0.9');
  await expect(gauge.getByRole('img')).toHaveAttribute(
    'aria-label',
    /closing 0\.9 tickets per day.*averaged over 6\.5 days/
  );

  await expect(page.locator('[data-stat="open"]')).toHaveText('30');
  await expect(page.locator('[data-stat="open-delta"]')).toHaveText(
    '+20 in 6.5d'
  );
  await expect(page.locator('[data-stat="share"]')).toHaveText('25.0%');
  await expect(page.locator('[data-stat="clear"]')).toHaveText('33 days');
  await expect(page.locator('[data-status]')).toContainText('Elevated');
  // The time and schedule come from status.json, not from the page's code.
  await expect(page.locator('[data-as-of]')).toContainText(
    /Data as of Nov 8, 2026, 12:05 UTC · updated every 6 hours · next around \d\d:05 UTC/
  );
  await expect(page.locator('.foot [data-schedule]')).toHaveText(
    'Updated every 6 hours'
  );

  // Issues filed went 10 → 54 (44 opened) while 24 were closed: 1.8×.
  // The backlog grows 20 in 6.5 days, so 30 open doubles in about 10 days.
  const loop = page.locator('doom-loop');
  await expect(loop.locator('[data-ratio]')).toHaveText('1.8');
  await expect(loop.locator('[data-label]')).toHaveText('Falling behind');
  await expect(loop.locator('[data-projection]')).toHaveText(
    'At this rate the open backlog of 30 doubles in 10 days.'
  );

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

test('works without status.json, treating the newest day as complete', async ({
  page,
}) => {
  await withFixture(page, CSV, 200, null);
  await page.goto('/');
  await expect(page.locator('[data-as-of]')).toHaveText(
    'Data as of Nov 8, 2026 (UTC)'
  );
  await expect(page.locator('[data-stat="open-delta"]')).toHaveText(
    '+20 in 7d'
  );
});

test('methodology shows the schedule from status.json', async ({ page }) => {
  await withFixture(page);
  await page.goto('/methodology');
  await expect(page.locator('methodology-page [data-schedule]')).toHaveText(
    'every 6 hours (00:05, 06:05, 12:05, 18:05 UTC)'
  );
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
