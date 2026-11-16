/** Formatting shared by the dashboard's components. */

const integer = new Intl.NumberFormat('en-US');

export function formatCount(value: number): string {
  return integer.format(Math.round(value));
}

/** One decimal place, e.g. `4.2`. */
export function formatRate(value: number): string {
  return value.toFixed(1);
}

export function formatPercent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** `+12`, `−3` or `±0`. */
export function formatSigned(value: number, digits = 0): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return `±${text}`;
  return value > 0 ? `+${text}` : `−${text}`;
}

/** `Nov 16, 2026` from `2026-11-16` (read as UTC). */
export function formatDate(date: string, withYear = true): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}
