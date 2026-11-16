/**
 * The dashboard's numbers, worked out from `data.csv` (written daily by
 * `track_issues.py`). Every column in the CSV is a running total as of that
 * day, so rates come from the difference between two days.
 *
 * Nothing here touches the DOM, so it is unit-tested with `node --test`.
 */

/** One row of `data.csv`: cumulative counts at the end of a UTC day. */
export interface DailyRow {
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  open: number;
  agentClosed: number;
  humanClosed: number;
}

/** A daily row with the derived totals the charts plot. */
export interface DailyPoint extends DailyRow {
  totalClosed: number;
  /** Every issue filed so far: open plus closed. */
  created: number;
  /** Share of closed issues that an AI agent closed, 0–1. */
  agentShare: number;
  minutesToMidnight: number;
}

/** Tickets per day over a trailing window. */
export interface Velocity {
  /** Issues closed by AI agents per day. */
  agent: number;
  /** Issues closed by humans per day. */
  human: number;
  /** New issues filed per day (the arrival rate). */
  arrivals: number;
  /** Change in the open backlog per day; negative means it is shrinking. */
  netBacklog: number;
  /** Days the window actually spans (shorter than asked when data is new). */
  days: number;
}

export interface Snapshot {
  latest: DailyPoint;
  history: DailyPoint[];
  velocity: Velocity;
  /** Days for agents alone to clear today's backlog; `Infinity` if never. */
  daysToClearByAgents: number;
  /** Open backlog `windowDays` ago, for the stat tile's delta. */
  openDelta: number;
}

export const MINUTES_ON_CLOCK = 60;
const MS_PER_DAY = 86_400_000;

/**
 * The Developer Doomsday Clock, as documented in the repository README:
 * `(1 − agent resolution share) × 60`. 60 minutes means agents have closed
 * nothing; 0 means agents close every issue.
 */
export function minutesToMidnight(agentClosed: number, humanClosed: number) {
  const closed = agentClosed + humanClosed;
  const share = closed > 0 ? agentClosed / closed : 0;
  return (1 - share) * MINUTES_ON_CLOCK;
}

/** Parses `data.csv`. Columns are found by header name, in any order. */
export function parseCsv(text: string): DailyRow[] {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map((name) => name.trim());
  const column = (name: string) => {
    const index = header.indexOf(name);
    if (index === -1) throw new Error(`data.csv has no "${name}" column`);
    return index;
  };
  const date = column('date');
  const open = column('open');
  const agent = column('agent_closed');
  const human = column('human_closed');

  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const number = (index: number) => {
      const value = Number(cells[index]);
      if (!Number.isFinite(value)) {
        throw new Error(
          `data.csv line ${i + 2}: "${cells[index]}" is not a number`
        );
      }
      return value;
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[date] ?? '')) {
      throw new Error(`data.csv line ${i + 2}: bad date "${cells[date]}"`);
    }
    return {
      date: cells[date],
      open: number(open),
      agentClosed: number(agent),
      humanClosed: number(human),
    };
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Adds the derived totals to each row. */
export function toPoints(rows: DailyRow[]): DailyPoint[] {
  return rows.map((row) => {
    const totalClosed = row.agentClosed + row.humanClosed;
    return {
      ...row,
      totalClosed,
      created: row.open + totalClosed,
      agentShare: totalClosed > 0 ? row.agentClosed / totalClosed : 0,
      minutesToMidnight: minutesToMidnight(row.agentClosed, row.humanClosed),
    };
  });
}

/** Whole days between two `YYYY-MM-DD` dates. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY);
}

/**
 * Average tickets per day over the last `windowDays` days of history. The
 * window starts at the newest row at least `windowDays` old, or the first
 * row when the history is shorter than that.
 */
export function velocity(points: DailyPoint[], windowDays = 7): Velocity {
  const zero = { agent: 0, human: 0, arrivals: 0, netBacklog: 0, days: 0 };
  if (points.length < 2) return zero;

  const last = points[points.length - 1];
  let first = points[0];
  for (const point of points) {
    if (daysBetween(point.date, last.date) >= windowDays) first = point;
  }
  const days = daysBetween(first.date, last.date);
  if (days <= 0) return zero;

  const rate = (key: 'agentClosed' | 'humanClosed' | 'created' | 'open') =>
    (last[key] - first[key]) / days;
  return {
    agent: rate('agentClosed'),
    human: rate('humanClosed'),
    arrivals: rate('created'),
    netBacklog: rate('open'),
    days,
  };
}

/** Everything the dashboard shows, from the CSV text. */
export function buildSnapshot(csv: string, windowDays = 7): Snapshot {
  const history = toPoints(parseCsv(csv));
  if (history.length === 0) throw new Error('data.csv has no rows yet');

  const latest = history[history.length - 1];
  const rates = velocity(history, windowDays);
  const start = history.find(
    (point) => daysBetween(point.date, latest.date) <= rates.days
  )!;
  return {
    latest,
    history,
    velocity: rates,
    daysToClearByAgents:
      rates.agent > 0 ? latest.open / rates.agent : Number.POSITIVE_INFINITY,
    openDelta: latest.open - start.open,
  };
}

/**
 * A round upper bound for a scale: the smallest of 1, 2, 2.5, 5 × 10ⁿ that
 * is at least `value`.
 */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value - 1e-9) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Status band of the clock, from calm to doom. */
export type ThreatLevel = 'safe' | 'elevated' | 'severe' | 'critical';

export function threatLevel(minutes: number): ThreatLevel {
  if (minutes > 45) return 'safe';
  if (minutes > 30) return 'elevated';
  if (minutes > 10) return 'severe';
  return 'critical';
}

/** Loads and summarises the CSV, relative to the app's base URL. */
export async function loadSnapshot(
  fetchImpl: typeof fetch = fetch,
  url = 'data/data.csv'
): Promise<Snapshot> {
  const response = await fetchImpl(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status})`);
  }
  return buildSnapshot(await response.text());
}
