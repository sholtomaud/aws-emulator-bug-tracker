# Developer Doomsday Clock: dashboard

The GitHub Pages site for this repository, built with [Boba](https://github.com/sholtomaud/boba): native Web Components and TypeScript, no framework runtime and no chart library.

Every number comes from [`../data.csv`](../data.csv), which `track_issues.py` rewrites on the schedule set by the cron line in [`track_issues.yml`](../.github/workflows/track_issues.yml). The same run writes [`../status.json`](../status.json) with the last-updated time and that schedule, which is where the site's "updated every … · next around …" text comes from; nothing about the frequency is hard-coded here. `scripts/sync-data.ts` copies both files to `public/data/` before `dev` and `build`, and the page fetches them at load time.

## What it shows

| Component | What it is |
| --- | --- |
| `doomsday-clock` | The Developer Doomsday Clock (version 2, both queues combined): a 24-hour dial at `(1 − combined agent resolution share) × 24` hours to midnight: 00:00 with no agent closures, 24:00 when agents close everything. The ring is the time left, coloured by threat level. |
| `doom-loop` | Shown three times in the same form: combined on top, then one per queue. Issues opened per issue closed over 7 days, on a log meter around 1× break-even, with a doubling/clearing projection and a sparkline. Above 2× is a bug doom loop. |
| `velocity-gauge` | Shown three times: a large dial for both queues and a smaller one for each. Items resolved per day by AI agents over the last 7 days, with ticks for the human rate and the arrival rate of new issues. Past the arrival rate is the redline. |
| `trend-chart` | Running totals over time, with a crosshair tooltip (mouse or arrow keys), toggleable series and a table view. |
| `queue-compare` | The agents' own in-repository queue beside the public GitHub issues: open, resolved, and new and agent-resolved per day on a shared scale. |
| `closure-evidence` | Closed issues by how they were closed (fix referenced, no referenced fix, declined, withdrawn, duplicate) and open issues by type. |
| `weight-slider` | Sets how the public issues and the agents' queue are weighted in the combined clock, dial and doom loop, with presets derived from the data. Remembered per browser. |
| `replay-control` | Play/pause and a scrubber that run the clock, dials and doom loops through the whole record and on into the forecast, interpolated between days. |
| `dashboard-page` | Lays them out with the stat tiles and threat-level status. |
| `methodology-page` | How each number is calculated. |

All calculations live in [`src/services/metrics.ts`](src/services/metrics.ts) and [`src/services/insights.ts`](src/services/insights.ts) , [`src/services/combined.ts`](src/services/combined.ts), [`src/services/replay.ts`](src/services/replay.ts) and [`src/services/forecast.ts`](src/services/forecast.ts), which have no DOM code and are unit-tested alongside. Panels whose data is missing (an older `data.csv`, no `agent_queue.csv`) show a note instead of failing.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Copy the data and start the Vite dev server |
| `npm run build` | Copy the data and build `dist/` (`-- --base /repo-name/` for Pages) |
| `npm test` | Unit tests (`node --test`) |
| `npm run e2e` | Playwright tests: dev server, production build and sub-path build |
| `npm run typecheck` / `npm run lint` | `tsc` and oxlint + Prettier |

Deployment is handled by [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

## Forecast

The forecast runs in the browser on [GSSK](https://github.com/energese-project/GSSK-Giannantoni), vendored as WebAssembly in [`src/vendor/gssk/`](src/vendor/gssk/) (MIT). [`src/lib/gssk-simulator.ts`](src/lib/gssk-simulator.ts) builds the two-queue model; [`src/services/forecast.ts`](src/services/forecast.ts) calibrates it, runs 200 simulations and decides where the forecast stops. The page's Content Security Policy allows `wasm-unsafe-eval` for this.
