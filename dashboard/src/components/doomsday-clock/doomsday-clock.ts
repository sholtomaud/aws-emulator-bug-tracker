import { BaseComponent } from '../../core/base-component.ts';
import {
  HOURS_ON_CLOCK,
  clockTime,
  threatLevel,
  type ThreatLevel,
} from '../../services/metrics.ts';
import { arcPath, polar, prefersReducedMotion, svg } from '../../lib/svg.ts';
import template from './doomsday-clock.html?raw';
import style from './doomsday-clock.css?raw';

const C = 160;
/** Degrees per hour on a 24-hour dial. */
const PER_HOUR = 360 / HOURS_ON_CLOCK;

/** The status colour token for each threat level. */
export const STATUS_COLOR: Record<ThreatLevel, string> = {
  safe: 'good',
  elevated: 'warning',
  severe: 'serious',
  critical: 'critical',
};

/**
 * The Developer Doomsday Clock on a 24-hour dial, midnight at the top. The
 * day starts at 00:00 (no agent activity) and ends at 24:00 (agents close
 * every issue). The hour hand turns once a day; the ring round the face is
 * the time left before midnight, coloured by threat level; the shaded band
 * is the night.
 *
 * Set `hours` (hours to midnight) to draw it.
 */
export class DoomsdayClockComponent extends BaseComponent {
  static tagName = 'doomsday-clock';

  private value: number | undefined;
  private timer: number | undefined;
  private drawn = false;

  constructor() {
    super(template, style);
  }

  set hours(value: number) {
    this.value = Math.min(HOURS_ON_CLOCK, Math.max(0, value));
    if (this.isConnected) this.draw();
  }
  get hours(): number | undefined {
    return this.value;
  }

  init() {
    if (this.value !== undefined) this.draw();
  }

  disconnectedCallback() {
    window.clearInterval(this.timer);
  }

  private draw() {
    const hours = this.value!;
    const elapsed = HOURS_ON_CLOCK - hours; // hours since the day began
    const time = clockTime(hours);
    const note =
      time === '00:00'
        ? ' (start of the day)'
        : time === '24:00'
          ? ' (midnight)'
          : '';

    this.querySelector('[data-hours]')!.textContent = hours.toFixed(1);
    this.querySelector('[data-time]')!.textContent =
      `Clock reads ${time}${note}`;
    const frame = this.querySelector<HTMLElement>('[data-clock]')!;
    frame.setAttribute(
      'aria-label',
      `24-hour doomsday clock at ${hours.toFixed(1)} hours to midnight, reading ${time}`
    );

    const root = svg('svg', { viewBox: '0 0 320 320', 'aria-hidden': 'true' });
    svg('circle', { cx: C, cy: C, r: 156, fill: 'var(--surface-2)' }, root);
    svg(
      'circle',
      {
        cx: C,
        cy: C,
        r: 146,
        fill: 'var(--clock-face)',
        stroke: 'var(--border)',
        'stroke-width': 1,
      },
      root
    );

    // Night (18:00 to 06:00) as a soft band inside the ticks.
    svg(
      'path',
      {
        d: arcPath(C, C, 112, 18 * PER_HOUR, 30 * PER_HOUR),
        fill: 'none',
        stroke: 'var(--ink)',
        'stroke-width': 14,
        opacity: 0.06,
      },
      root
    );
    // The final hour before midnight.
    svg(
      'path',
      {
        d: arcPath(C, C, 112, 23 * PER_HOUR, 24 * PER_HOUR),
        fill: 'none',
        stroke: 'var(--critical)',
        'stroke-width': 14,
        opacity: 0.35,
      },
      root
    );

    // The time left before midnight: from the hour hand round to the top.
    const remaining = (hours / HOURS_ON_CLOCK) * 360;
    svg(
      'circle',
      {
        cx: C,
        cy: C,
        r: 142,
        fill: 'none',
        stroke: 'var(--grid)',
        'stroke-width': 4,
      },
      root
    );
    const ring = svg(
      'circle',
      {
        cx: C,
        cy: C,
        r: 142,
        fill: 'none',
        stroke: `var(--${STATUS_COLOR[threatLevel(hours)]})`,
        'stroke-width': 4,
        'stroke-linecap': 'round',
        pathLength: 360,
        'stroke-dasharray': '0 360',
        transform: `rotate(${270 - remaining} ${C} ${C})`,
        class: 'countdown',
      },
      root
    );

    // Ticks: every 15 minutes, longer each hour, longest every 6 hours.
    for (let tick = 0; tick < HOURS_ON_CLOCK * 4; tick++) {
      const hour = tick % 4 === 0;
      const major = tick % 24 === 0;
      const angle = (tick / 4) * PER_HOUR;
      const outer = polar(C, C, 136, angle);
      const inner = polar(C, C, major ? 120 : hour ? 126 : 131, angle);
      svg(
        'line',
        {
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
          stroke: 'var(--clock-ink)',
          'stroke-width': major ? 3 : hour ? 1.75 : 1,
          'stroke-linecap': 'round',
          opacity: major ? 0.9 : hour ? 0.6 : 0.25,
        },
        root
      );
    }
    for (let hour = 0; hour < HOURS_ON_CLOCK; hour += 2) {
      const major = hour % 6 === 0;
      const at = polar(C, C, 92, hour * PER_HOUR);
      const label = svg(
        'text',
        {
          x: at.x,
          y: at.y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: 'var(--clock-ink)',
          'font-size': major ? 17 : 12,
          'font-weight': major ? 700 : 500,
          opacity: major ? 1 : 0.65,
          class: 'tabular',
        },
        root
      );
      label.textContent = String(hour).padStart(2, '0');
    }
    for (const [text, y] of [
      ['AI REPLACEMENT INDEX', 204],
      ['24-HOUR DIAL', 216],
    ] as const) {
      const caption = svg(
        'text',
        {
          x: C,
          y,
          'text-anchor': 'middle',
          fill: 'var(--ink-muted)',
          'font-size': 8.5,
          'font-weight': 600,
          'letter-spacing': '0.18em',
        },
        root
      );
      caption.textContent = text;
    }

    const hourHand = this.hand(root, 70, 6);
    const minuteHand = this.hand(root, 112, 3.5);

    // A ticking second hand keeps the face alive; it carries no data.
    const secondHand = svg('g', { class: 'hand second-hand' }, root);
    svg(
      'line',
      {
        x1: C,
        y1: C + 24,
        x2: C,
        y2: C - 124,
        stroke: 'var(--critical)',
        'stroke-width': 1.5,
        'stroke-linecap': 'round',
      },
      secondHand
    );
    svg('circle', { cx: C, cy: C, r: 7, fill: 'var(--clock-ink)' }, root);
    svg('circle', { cx: C, cy: C, r: 3, fill: 'var(--critical)' }, root);

    frame.replaceChildren(root);

    const rotate = (element: SVGElement, degrees: number) => {
      element.style.transform = `rotate(${degrees}deg)`;
    };
    // Start at 00:00 and sweep forward to the reading.
    rotate(hourHand, 0);
    rotate(minuteHand, 0);
    const settle = () => {
      rotate(hourHand, elapsed * PER_HOUR);
      // One full sweep plus the minutes past the hour.
      rotate(minuteHand, 360 + (elapsed % 1) * 360);
      ring.setAttribute('stroke-dasharray', `${remaining} 360`);
    };
    // Only the first drawing sweeps; later values (the weighting slider)
    // are shown at once.
    if (this.drawn || prefersReducedMotion()) settle();
    else requestAnimationFrame(() => requestAnimationFrame(settle));
    this.drawn = true;

    // Angles only grow, so 59 s → 0 s keeps turning clockwise.
    let turns = 0;
    let last = -1;
    const tickSeconds = () => {
      const seconds = new Date().getSeconds();
      if (seconds < last) turns++;
      last = seconds;
      rotate(secondHand, turns * 360 + seconds * 6);
    };
    tickSeconds();
    window.clearInterval(this.timer);
    if (!prefersReducedMotion()) {
      this.timer = window.setInterval(tickSeconds, 1000);
    }
  }

  private hand(root: SVGElement, length: number, width: number) {
    const group = svg('g', { class: 'hand' }, root);
    svg(
      'line',
      {
        x1: C,
        y1: C + 14,
        x2: C,
        y2: C - length,
        stroke: 'var(--clock-ink)',
        'stroke-width': width,
        'stroke-linecap': 'round',
      },
      group
    );
    return group;
  }
}

if (!customElements.get(DoomsdayClockComponent.tagName)) {
  customElements.define(DoomsdayClockComponent.tagName, DoomsdayClockComponent);
}
