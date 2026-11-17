# AWS Emulator Agentic Workflow Issue Tracker

Automated tracking of open and closed issues in [`aws/aws-emulator`](https://github.com/aws/aws-emulator/issues) to measure issue resolution velocity from the AWS agentic workflow.

**Why the AWS emulator?** AWS says the emulator was [built entirely by autonomous AI agents](https://www.aboutamazon.com/news/aws/how-autonomous-ai-agents-built-aws-emulator). If agents can do 100% of the development, they should also be able to resolve 100% of the issues, bugs and feature requests. And AWS is one of the largest software development organisations on Earth, so its agentic workflows should demonstrate best-in-class practice. This tracker measures how close they are.

### 🕛 [Live SRE dashboard →](https://sholtomaud.github.io/aws-emulator-bug-tracker/)

[![Track AWS Emulator Issues](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/track_issues.yml/badge.svg)](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/track_issues.yml)
[![Deploy SRE Dashboard](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/pages.yml/badge.svg)](https://github.com/sholtomaud/aws-emulator-bug-tracker/actions/workflows/pages.yml)

## Current Snapshot & Doomsday Clock

<!-- STATS_START -->
**Last Checked:** 2026-11-16 21:00 UTC  
**Update Schedule:** every 6 hours (00:05, 06:05, 12:05, 18:05 UTC)  
- **Doomsday Clock Index:** 24.0 hours to midnight (clock reads 00:00)  
- **Bug Doom Loop Ratio:** 11.8 opened per issue closed (last 4.9 days)  
- **Open Issues:** 457  
- **Closed by AI Agent:** 0  
- **Closed by Human:** 41  
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

- [`data.csv`](./data.csv): daily running totals for the public GitHub issues: open, closed by agents and by humans, closures by how they were closed, and behaviour reports filed and closed. The newest row is the day in progress and is rewritten on every run.
- [`agent_queue.csv`](./agent_queue.csv): daily counts of the agents' own queue (see below).
- [`status.json`](./status.json): when the data was last fetched, the update schedule, and today's breakdown of open issues by type.

## Two Queues

The emulator has two lists of problems, and the tracker follows both:

- **Public GitHub issues**, reported by people using the emulator. The clock and the doom loop are measured here.
- **The agents' own queue**, kept as files in the emulator repository: one agent files each problem it finds under `issues/things-that-do-not-work/`, and another commits a fix and moves the file to `issues/things-that-now-work/`. The tracker counts the files in those two folders at the last commit of each day and reads nothing else from the repository.

## How Issues Were Closed

An issue marked closed is not necessarily an issue fixed, so each closed public issue is put in one of five groups from what GitHub records about the closure:

| Group | Meaning |
| --- | --- |
| Fix referenced | A commit or merged pull request closed it, or someone other than the reporter pointed to a commit, a release or the agents' "now works" record |
| Closed without a referenced fix | Marked completed, with nothing recorded to check it against |
| Declined | Closed as "not planned" |
| Withdrawn | Closed by the person who reported it |
| Duplicate | Closed as a duplicate |

The emulator does not accept pull requests, so a reference from the closed issue to a commit or release is the only public trail from a report to its fix. The dashboard's [methodology page](https://sholtomaud.github.io/aws-emulator-bug-tracker/methodology) sets out what a best-in-class workflow would record, and the limits of this test. Issue type (behaviour report, feature request, other) is read from the issue form each was filed with.

## Update Schedule

How often the data updates is set in **one place**: the `cron` line in [`track_issues.yml`](.github/workflows/track_issues.yml). `track_issues.py` reads that line on every run and writes the schedule to `status.json` and to the stats block above; the dashboard reads `status.json` for its "updated …" text and next-update time. To change the frequency, edit the cron line and nothing else. Rates such as the doom loop ratio count the day in progress as the fraction of a day that has passed, so they stay correct at any frequency.

## SRE Dashboard

[`dashboard/`](./dashboard) is an interactive version of the charts above, published to GitHub Pages: an animated 24-hour Doomsday Clock, a bug doom loop meter (issues opened per issue closed, also counting only closures that reference a fix), the agents' own queue beside the public issues, a breakdown of how issues were closed, a speedometer for how many tickets AI agents close per day (against the human closure rate and the rate new issues arrive), key numbers, and a hover-to-inspect trend chart. It is a [Boba](https://github.com/sholtomaud/boba) app (native Web Components and TypeScript, no framework runtime) and reads `data.csv` directly, so it needs no extra data pipeline.

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
