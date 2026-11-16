import { BaseComponent } from '../../core/base-component.ts';
import {
  MINUTES_ON_CLOCK,
  threatLevel,
  type ThreatLevel,
} from '../../services/metrics.ts';
import { prefersReducedMotion, svg, wedgePath, polar } from '../../lib/svg.ts';
import template from './doomsday-clock.html?raw';
import style from './doomsday-clock.css?raw';

const C = 160;

/** The status colour token for each threat level. */
export const STATUS_COLOR: Record<ThreatLevel, string> = {
  safe: 'good',
  elevated: 'warning',
  severe: 'serious',
  critical: 'critical',
};

/**
 * The Developer Doomsday Clock: an analogue face reading `60 − minutes`
 * past 11 pm, so 60 minutes to midnight shows 11:00 and 0 shows midnight.
 * The ring round the face is the time left in the hour, coloured by
 * threat level; the shaded sector is the final hour before midnight.
 *
 * Set `minutes` to draw it.
 */
export class DoomsdayClockComponent extends BaseComponent {
  static tagName = 'doomsday-clock';

  private value: number | undefined;
  private timer: number | undefined;

  constructor() {
    super(template, style);
  }

  set minutes(value: number) {
    this.value = Math.min(MINUTES_ON_CLOCK, Math.max(0, value));
    if (this.isConnected) this.draw();
  }
  get minutes(): number | undefined {
    return this.value;
  }

  init() {
    if (this.value !== undefined) this.draw();
  }

  disconnectedCallback() {
    window.clearInterval(this.timer);
  }

  private draw() {
    const minutes = this.value!;
    const frame = this.querySelector<HTMLElement>('[data-clock]')!;
    const elapsed = MINUTES_ON_CLOCK - minutes; // minutes past 11 pm
    const clockTime = `11:${String(Math.floor(elapsed)).padStart(2, '0')} PM`;

    this.querySelector('[data-minutes]')!.textContent = minutes.toFixed(1);
    this.querySelector('[data-time]')!.textContent = `Clock reads ${clockTime}`;
    frame.setAttribute(
      'aria-label',
      `Doomsday clock at ${minutes.toFixed(1)} minutes to midnight (${clockTime})`
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

    // The last hour before midnight, and the part of it still remaining.
    svg(
      'path',
      {
        d: wedgePath(C, C, 138, 330, 360),
        fill: 'var(--critical)',
        opacity: 0.08,
      },
      root
    );
    // A ring for the time left in the hour, from the minute hand round to
    // midnight, in the colour of the threat level.
    const remaining = (minutes / MINUTES_ON_CLOCK) * 360;
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
        stroke: `var(--${STATUS_COLOR[threatLevel(minutes)]})`,
        'stroke-width': 4,
        'stroke-linecap': 'round',
        pathLength: 360,
        'stroke-dasharray': '0 360',
        transform: `rotate(${270 - remaining} ${C} ${C})`,
        class: 'countdown',
      },
      root
    );
    for (let tick = 0; tick < 60; tick++) {
      const hour = tick % 5 === 0;
      const outer = polar(C, C, 136, tick * 6);
      const inner = polar(C, C, hour ? 120 : 129, tick * 6);
      svg(
        'line',
        {
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
          stroke: 'var(--clock-ink)',
          'stroke-width': hour ? 3 : 1,
          'stroke-linecap': 'round',
          opacity: hour ? 0.9 : 0.35,
        },
        root
      );
    }
    for (let hour = 1; hour <= 12; hour++) {
      const at = polar(C, C, 102, hour * 30);
      const label = svg(
        'text',
        {
          x: at.x,
          y: at.y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          fill: 'var(--clock-ink)',
          'font-size': hour % 3 === 0 ? 20 : 15,
          'font-weight': hour % 3 === 0 ? 700 : 500,
          opacity: hour % 3 === 0 ? 1 : 0.7,
        },
        root
      );
      label.textContent = String(hour);
    }
    const brand = svg(
      'text',
      {
        x: C,
        y: 214,
        'text-anchor': 'middle',
        fill: 'var(--ink-muted)',
        'font-size': 9,
        'font-weight': 600,
        'letter-spacing': '0.18em',
      },
      root
    );
    brand.textContent = 'AI REPLACEMENT INDEX';

    const hourAngle = 330 + (elapsed / MINUTES_ON_CLOCK) * 30;
    const minuteAngle = (elapsed / MINUTES_ON_CLOCK) * 360;
    const hourHand = this.hand(root, 62, 7, 'var(--clock-ink)');
    const minuteHand = this.hand(root, 112, 4.5, 'var(--clock-ink)');

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
    // Start at 11:00 and sweep to the reading.
    rotate(hourHand, 330);
    rotate(minuteHand, 0);
    const settle = () => {
      rotate(hourHand, hourAngle);
      rotate(minuteHand, minuteAngle);
      ring.setAttribute('stroke-dasharray', `${remaining} 360`);
    };
    if (prefersReducedMotion()) settle();
    else requestAnimationFrame(() => requestAnimationFrame(settle));

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

  private hand(root: SVGElement, length: number, width: number, color: string) {
    const group = svg('g', { class: 'hand' }, root);
    svg(
      'line',
      {
        x1: C,
        y1: C + 14,
        x2: C,
        y2: C - length,
        stroke: color,
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
