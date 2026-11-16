# AWS Emulator Agentic Workflow Issue Tracker

Automated daily tracking of open and closed issues in [`aws/aws-emulator`](https://github.com/aws/aws-emulator/issues) to measure issue resolution velocity from the AWS agentic workflow.

### 🕛 [Live SRE dashboard →](https://sholtomaud.github.io/aws-emulator-bug-tracker/)

[![Track AWS Emulator Issues](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/track_issues.yml/badge.svg)](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/track_issues.yml)
[![Deploy SRE Dashboard](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/pages.yml/badge.svg)](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/pages.yml)

## Current Snapshot & Doomsday Clock

<!-- STATS_START -->
**Last Checked:** 2026-11-16 (UTC)  
- **Doomsday Clock Index:** 60.0 minutes to midnight  
- **Open Issues:** 444  
- **Closed by AI Agent:** 0  
- **Closed by Human:** 22  
- **Agent Resolution Share:** 0.0%
<!-- STATS_END -->

### The Developer Doomsday Clock
![Doomsday Clock](./doomsday_clock.png)

#### How is the AI Replacement Index Calculated?
The **Developer Doomsday Clock** measures how close we are to human software engineers being completely replaced by agentic workflows, based on **Agent Resolution Share**:
* **The Formula:** $\text{Minutes to Midnight} = (1.0 - \text{AI Resolution Share}) \times 60$
* **The Scale:** 
  * **0 Minutes to Midnight:** 100% of issues are closed by AI agents (Total human replacement / Doom).
  * **60 Minutes to Midnight:** 0% of issues are closed by AI agents (Human safety zone / Agents are doing nothing).

### Issue Resolution Trend
![Issue Resolution Chart](./issues_chart.png)

## Raw Data

Historical daily counts are stored in [`data.csv`](./data.csv).

## SRE Dashboard

[`dashboard/`](./dashboard) is an interactive version of the charts above, published to GitHub Pages: an animated Doomsday Clock, a speedometer for how many tickets AI agents close per day (against the human closure rate and the rate new issues arrive), key numbers, and a hover-to-inspect trend chart. It is a [Boba](https://github.com/sholtomaud/boba) app (native Web Components and TypeScript, no framework runtime) and reads `data.csv` directly, so it needs no extra data pipeline.

[`pages.yml`](.github/workflows/pages.yml) tests, builds and deploys it after every successful run of the tracker workflow, on pushes to `main` that touch `dashboard/` or `data.csv`, and on demand. Pull requests that touch `dashboard/` run the tests without deploying.

**One-time setup:** in *Settings → Pages*, set *Source* to **GitHub Actions**.

To work on it locally (Node.js 26+):

```bash
cd dashboard
npm install
npm run dev      # copies ../data.csv into public/data/ and starts Vite
npm test         # unit tests for the metrics
npm run e2e      # Playwright end-to-end tests
```
