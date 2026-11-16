import { BaseComponent } from '../../core/base-component.ts';
import { niceCeil, type Velocity } from '../../services/metrics.ts';
import { formatRate } from '../../lib/format.ts';
import { arcPath, polar, prefersReducedMotion, svg } from '../../lib/svg.ts';
import template from './velocity-gauge.html?raw';
import style from './velocity-gauge.css?raw';

const CX = 160;
const CY = 150;
const R = 118;
/** The dial sweeps 240°, from −120° (zero) to +120° (full scale). */
const START = -120;
const SWEEP = 240;

/**
 * A speedometer for how fast AI agents close tickets, in tickets per day.
 * The needle is the agents' rate; ticks on the dial mark the human rate and
 * the rate new issues arrive. Past the arrival rate is the redline: agents
 * closing tickets faster than they are filed.
 *
 * Set `velocity` to draw it.
 */
export class VelocityGaugeComponent extends BaseComponent {
  static tagName = 'velocity-gauge';

  private value: Velocity | undefined;

  constructor() {
    super(template, style);
  }

  set velocity(value: Velocity) {
    this.value = value;
    if (this.isConnected) this.draw();
  }
  get velocity(): Velocity | undefined {
    return this.value;
  }

  init() {
    if (this.value) this.draw();
  }

  private draw() {
    const v = this.value!;
    const max = niceCeil(Math.max(v.agent, v.human, v.arrivals, 4) * 1.08);
    const angle = (rate: number) =>
      START + (Math.min(Math.max(rate, 0), max) / max) * SWEEP;

    const frame = this.querySelector<HTMLElement>('[data-gauge]')!;
    frame.setAttribute(
      'aria-label',
      `AI agents are closing ${formatRate(v.agent)} tickets per day. ` +
        `Humans close ${formatRate(v.human)} and ${formatRate(v.arrivals)} ` +
        `new issues arrive per day, averaged over ${v.days} days.`
    );

    const root = svg('svg', { viewBox: '0 0 320 236', 'aria-hidden': 'true' });

    // Track, then the redline past the arrival rate.
    svg(
      'path',
      {
        d: arcPath(CX, CY, R, START, START + SWEEP),
        fill: 'none',
        stroke: 'var(--grid)',
        'stroke-width': 16,
        'stroke-linecap': 'round',
      },
      root
    );
    if (v.arrivals > 0 && v.arrivals < max) {
      svg(
        'path',
        {
          d: arcPath(CX, CY, R + 15, angle(v.arrivals), START + SWEEP),
          fill: 'none',
          stroke: 'var(--critical)',
          'stroke-width': 4,
          'stroke-linecap': 'round',
          opacity: 0.85,
        },
        root
      );
    }

    // The agents' rate, filled along the dial.
    const valueArc = svg(
      'path',
      {
        d: arcPath(CX, CY, R, START, START + SWEEP),
        fill: 'none',
        stroke: 'var(--series-2)',
        'stroke-width': 16,
        'stroke-linecap': 'round',
        pathLength: SWEEP,
        'stroke-dasharray': `0 ${SWEEP + 1}`,
        class: 'value-arc',
        visibility: v.agent > 0 ? 'visible' : 'hidden',
      },
      root
    );

    // Scale: five labelled steps with minor ticks between.
    const steps = 5;
    for (let i = 0; i <= steps * 4; i++) {
      const major = i % 4 === 0;
      const a = START + (i / (steps * 4)) * SWEEP;
      const outer = polar(CX, CY, R - 13, a);
      const inner = polar(CX, CY, R - (major ? 24 : 18), a);
      svg(
        'line',
        {
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
          stroke: major ? 'var(--ink-2)' : 'var(--axis)',
          'stroke-width': major ? 2 : 1,
          'stroke-linecap': 'round',
        },
        root
      );
      if (major) {
        const at = polar(CX, CY, R - 38, a);
        const label = svg(
          'text',
          {
            x: at.x,
            y: at.y,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            fill: 'var(--ink-muted)',
            'font-size': 11,
            class: 'tabular',
          },
          root
        );
        const tick = (max / steps) * (i / 4);
        label.textContent = Number.isInteger(tick)
          ? String(tick)
          : tick.toFixed(1);
      }
    }

    // Reference marks on the outside of the dial.
    const marker = (rate: number, color: string) => {
      const a = angle(rate);
      const outer = polar(CX, CY, R + 13, a);
      const inner = polar(CX, CY, R - 9, a);
      svg(
        'line',
        {
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
          stroke: 'var(--surface)',
          'stroke-width': 7,
          'stroke-linecap': 'round',
        },
        root
      );
      svg(
        'line',
        {
          x1: inner.x,
          y1: inner.y,
          x2: outer.x,
          y2: outer.y,
          stroke: color,
          'stroke-width': 3,
          'stroke-linecap': 'round',
        },
        root
      );
    };
    marker(v.human, 'var(--series-3)');
    marker(v.arrivals, 'var(--series-1)');

    // Needle.
    const needle = svg('g', { class: 'needle' }, root);
    svg(
      'path',
      {
        d: `M ${CX - 4} ${CY + 14} L ${CX} ${CY - R + 50} L ${CX + 4} ${CY + 14} Z`,
        fill: 'var(--ink)',
      },
      needle
    );
    svg('circle', { cx: CX, cy: CY, r: 10, fill: 'var(--ink)' }, root);
    svg('circle', { cx: CX, cy: CY, r: 4, fill: 'var(--series-2)' }, root);

    const readout = svg(
      'text',
      {
        x: CX,
        y: CY + 54,
        'text-anchor': 'middle',
        fill: 'var(--ink)',
        'font-size': 34,
        'font-weight': 700,
        'letter-spacing': '-0.02em',
        'data-readout': '',
      },
      root
    );
    readout.textContent = formatRate(v.agent);
    const unit = svg(
      'text',
      {
        x: CX,
        y: CY + 76,
        'text-anchor': 'middle',
        fill: 'var(--ink-muted)',
        'font-size': 11,
        'font-weight': 600,
        'letter-spacing': '0.08em',
      },
      root
    );
    unit.textContent = 'AGENT TICKETS / DAY';

    frame.replaceChildren(root);

    const settle = () => {
      needle.style.transform = `rotate(${angle(v.agent)}deg)`;
      valueArc.setAttribute(
        'stroke-dasharray',
        `${angle(v.agent) - START} ${SWEEP + 1}`
      );
    };
    needle.style.transform = `rotate(${START}deg)`;
    if (prefersReducedMotion()) settle();
    else requestAnimationFrame(() => requestAnimationFrame(settle));

    this.renderLegend(v);
  }

  private renderLegend(v: Velocity) {
    const legend = this.querySelector('[data-legend]')!;
    const item = (
      color: string,
      label: string,
      value: number,
      tick = false
    ) => {
      const li = document.createElement('li');
      const key = document.createElement('span');
      key.className = tick ? 'key key-tick' : 'key';
      key.style.background = color;
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.className = 'tabular';
      strong.textContent = formatRate(value);
      text.append(strong, ` ${label}`);
      li.append(key, text);
      return li;
    };
    legend.replaceChildren(
      item('var(--series-2)', 'AI agents', v.agent),
      item('var(--series-3)', 'humans', v.human, true),
      item('var(--series-1)', 'new issues', v.arrivals, true)
    );
    const redline = document.createElement('li');
    const key = document.createElement('span');
    key.className = 'key';
    key.style.background = 'var(--critical)';
    redline.append(key, 'Redline: agents outpace new issues');
    legend.append(redline);
  }
}

if (!customElements.get(VelocityGaugeComponent.tagName)) {
  customElements.define(VelocityGaugeComponent.tagName, VelocityGaugeComponent);
}
