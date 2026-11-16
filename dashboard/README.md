# Developer Doomsday Clock: SRE dashboard

The GitHub Pages site for this repository, built with [Boba](https://github.com/sholtomaud/boba): native Web Components and TypeScript, no framework runtime and no chart library.

Every number comes from [`../data.csv`](../data.csv), which `track_issues.py` rewrites on the schedule set by the cron line in [`track_issues.yml`](../.github/workflows/track_issues.yml). The same run writes [`../status.json`](../status.json) with the last-updated time and that schedule, which is where the site's "updated every … · next around …" text comes from; nothing about the frequency is hard-coded here. `scripts/sync-data.ts` copies both files to `public/data/` before `dev` and `build`, and the page fetches them at load time.

## What it shows

| Component | What it is |
| --- | --- |
| `doomsday-clock` | 24-hour dial at `(1 − agent resolution share) × 24` hours to midnight: 00:00 with no agent closures, 24:00 when agents close everything. The ring is the time left, coloured by threat level. |
| `doom-loop` | Issues opened per issue closed over 7 days, on a log meter around 1× break-even, with a doubling/clearing projection and a sparkline. Above 2× is a bug doom loop. |
| `velocity-gauge` | Speedometer of tickets closed per day by AI agents over the last 7 days, with ticks for the human rate and the arrival rate of new issues. Past the arrival rate is the redline. |
| `trend-chart` | Running totals over time, with a crosshair tooltip (mouse or arrow keys), toggleable series and a table view. |
| `dashboard-page` | Lays them out with the stat tiles and threat-level status. |
| `methodology-page` | How each number is calculated. |

All calculations live in [`src/services/metrics.ts`](src/services/metrics.ts), which has no DOM code and is unit-tested in `metrics.test.ts`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Copy the data and start the Vite dev server |
| `npm run build` | Copy the data and build `dist/` (`-- --base /repo-name/` for Pages) |
| `npm test` | Unit tests (`node --test`) |
| `npm run e2e` | Playwright tests: dev server, production build and sub-path build |
| `npm run typecheck` / `npm run lint` | `tsc` and oxlint + Prettier |

Deployment is handled by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).
