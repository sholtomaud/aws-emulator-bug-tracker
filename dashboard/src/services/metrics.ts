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
  /** Hours left on the 24-hour Doomsday Clock. */
  hoursToMidnight: number;
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
  doomLoop: DoomLoop;
}

/** How far the issue tracker is from (or deep into) a bug doom loop. */
export type DoomLoopLevel =
  'burning' | 'steady' | 'behind' | 'doom' | 'unknown';

export interface DoomLoop {
  /**
   * Issues opened per issue closed over the window. `Infinity` when issues
   * were opened but none closed; `null` when nothing happened.
   */
  ratio: number | null;
  level: DoomLoopLevel;
  /** The ratio as of each day, each over its own trailing window. */
  history: { date: string; ratio: number | null }[];
  /** Days until the open backlog doubles at the current net rate. */
  doublingDays: number | null;
  /** Days until the backlog is empty at the current net rate. */
  clearDays: number | null;
}

/** The clock runs over one day: 0% agent share is 00:00, 100% is 24:00. */
export const HOURS_ON_CLOCK = 24;
const MS_PER_DAY = 86_400_000;

/**
 * The Developer Doomsday Clock, as documented in the repository README:
 * `(1 − agent resolution share) × 24` hours to midnight. 24 hours (00:00,
 * the start of the day) means agents have closed nothing; 0 (24:00, the
 * end of the day) means agents close every issue.
 */
export function hoursToMidnight(agentClosed: number, humanClosed: number) {
  const closed = agentClosed + humanClosed;
  const share = closed > 0 ? agentClosed / closed : 0;
  return (1 - share) * HOURS_ON_CLOCK;
}

/**
 * The time the clock reads, as `HH:MM` on a 24-hour clock: how far through
 * the day it is. `24:00` is midnight at the end of the day.
 */
export function clockTime(hoursLeft: number): string {
  const minutes = Math.round((HOURS_ON_CLOCK - hoursLeft) * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
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
      hoursToMidnight: hoursToMidnight(row.agentClosed, row.humanClosed),
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
    doomLoop: doomLoop(history, windowDays),
  };
}

/** Issues opened per issue closed, from a {@link Velocity}. */
export function doomLoopRatio(v: Velocity): number | null {
  const closed = v.agent + v.human;
  if (v.days === 0 || (closed === 0 && v.arrivals === 0)) return null;
  if (closed === 0) return Number.POSITIVE_INFINITY;
  return v.arrivals / closed;
}

/**
 * Bands of the opened-to-closed ratio: below 0.9× the backlog burns down,
 * 0.9–1.1× holds steady, up to 2× falls behind, past 2× is a doom loop.
 */
export function doomLoopLevel(ratio: number | null): DoomLoopLevel {
  if (ratio === null) return 'unknown';
  if (ratio < 0.9) return 'burning';
  if (ratio <= 1.1) return 'steady';
  if (ratio <= 2) return 'behind';
  return 'doom';
}

export function doomLoop(points: DailyPoint[], windowDays = 7): DoomLoop {
  const v = velocity(points, windowDays);
  const ratio = doomLoopRatio(v);
  const open = points.length ? points[points.length - 1].open : 0;
  return {
    ratio,
    level: doomLoopLevel(ratio),
    history: points.slice(1).map((point, i) => ({
      date: point.date,
      ratio: doomLoopRatio(velocity(points.slice(0, i + 2), windowDays)),
    })),
    doublingDays: v.netBacklog > 0 && open > 0 ? open / v.netBacklog : null,
    clearDays: v.netBacklog < 0 ? open / -v.netBacklog : null,
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

/** Bands by hours to midnight: under 25%, 50% and 83⅓% agent share. */
export function threatLevel(hours: number): ThreatLevel {
  if (hours > 18) return 'safe';
  if (hours > 12) return 'elevated';
  if (hours > 4) return 'severe';
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
