# AWS Emulator Agentic Workflow Issue Tracker

Automated tracking of open and closed issues in [`aws/aws-emulator`](https://github.com/aws/aws-emulator/issues) to measure issue resolution velocity from the AWS agentic workflow.

**Why the AWS emulator?** AWS says the emulator was [built entirely by autonomous AI agents](https://www.aboutamazon.com/news/aws/how-autonomous-ai-agents-built-aws-emulator). If agents can do 100% of the development, they should also be able to resolve 100% of the issues, bugs and feature requests. And AWS is one of the largest software development organisations on Earth, so its agentic workflows should demonstrate best-in-class practice. This tracker measures how close they are.

### 🕛 [Live SRE dashboard →](https://sholtomaud.github.io/aws-emulator-bug-tracker/)

[![Track AWS Emulator Issues](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/track_issues.yml/badge.svg)](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/track_issues.yml)
[![Deploy SRE Dashboard](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/pages.yml/badge.svg)](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/pages.yml)

## Current Snapshot & Doomsday Clock

<!-- STATS_START -->
**Last Checked:** 2026-11-16 10:13 UTC  
**Update Schedule:** every 6 hours (00:05, 06:05, 12:05, 18:05 UTC)  
- **Doomsday Clock Index:** 24.0 hours to midnight (clock reads 00:00)  
- **Bug Doom Loop Ratio:** 20.2 opened per issue closed (last 4.4 days)  
- **Open Issues:** 446  
- **Closed by AI Agent:** 0  
- **Closed by Human:** 23  
- **Agent Resolution Share:** 0.0%
<!-- STATS_END -->

### The Developer Doomsday Clock
![Doomsday Clock](./doomsday_clock.png)

#### How is the AI Replacement Index Calculated?
The **Developer Doomsday Clock** measures how close we are to human software engineers being completely replaced by agentic workflows, based on **Agent Resolution Share** (the fraction of closed issues that an AI agent closed). It runs over one day on a **24-hour dial**, with midnight at the top:
* **The Formula:** $\text{Hours to Midnight} = (1.0 - \text{AI Resolution Share}) \times 24$
* **The Scale:**
  * **00:00, 24 hours to midnight:** 0% of issues are closed by AI agents. The day has just begun (human safety zone).
  * **12:00 noon, 12 hours to midnight:** half of closed issues were closed by AI agents.
  * **24:00, 0 hours to midnight:** 100% of issues are closed by AI agents. The day ends (total human replacement / doom).

#### What is the Bug Doom Loop Ratio?
Issues **opened** per issue **closed** over the last 7 days. Below 1× the backlog is burning down; above 1× it grows however hard people work; far above it, the project is in a bug doom loop.

### Issue Resolution Trend
![Issue Resolution Chart](./issues_chart.png)

## Raw Data

Historical daily counts are stored in [`data.csv`](./data.csv). The newest row is the day in progress and is rewritten on every run. [`status.json`](./status.json) records when the data was last fetched and the update schedule.

## Update Schedule

How often the data updates is set in **one place**: the `cron` line in [`track_issues.yml`](.github/workflows/track_issues.yml). `track_issues.py` reads that line on every run and writes the schedule to `status.json` and to the stats block above; the dashboard reads `status.json` for its "updated …" text and next-update time. To change the frequency, edit the cron line and nothing else. Rates such as the doom loop ratio count the day in progress as the fraction of a day that has passed, so they stay correct at any frequency.

## SRE Dashboard

[`dashboard/`](./dashboard) is an interactive version of the charts above, published to GitHub Pages: an animated 24-hour Doomsday Clock, a bug doom loop meter (issues opened per issue closed), a speedometer for how many tickets AI agents close per day (against the human closure rate and the rate new issues arrive), key numbers, and a hover-to-inspect trend chart. It is a [Boba](https://github.com/sholtomaud/boba) app (native Web Components and TypeScript, no framework runtime) and reads `data.csv` directly, so it needs no extra data pipeline.

[`pages.yml`](.github/workflows/pages.yml) tests, builds and deploys it after every successful run of the tracker workflow (so the site follows the same schedule), on pushes to `main` that touch `dashboard/` or `data.csv`, and on demand. Pull requests that touch `dashboard/` run the tests without deploying.

**One-time setup:** in *Settings → Pages*, set *Source* to **GitHub Actions**.

To work on it locally (Node.js 26+):

```bash
cd dashboard
npm install
npm run dev      # copies ../data.csv into public/data/ and starts Vite
npm test         # unit tests for the metrics
npm run e2e      # Playwright end-to-end tests
```
