# Developer Doomsday Clock: SRE dashboard

The GitHub Pages site for this repository, built with [Boba](https://github.com/sholtomaud/boba): native Web Components and TypeScript, no framework runtime and no chart library.

Every number comes from [`../data.csv`](../data.csv), which `track_issues.py` rewrites daily. `scripts/sync-data.ts` copies it to `public/data/data.csv` before `dev` and `build`, and the page fetches it at load time.

## What it shows

| Component | What it is |
| --- | --- |
| `doomsday-clock` | Analogue clock at `(1 − agent resolution share) × 60` minutes to midnight. The ring is the time left, coloured by threat level. |
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
