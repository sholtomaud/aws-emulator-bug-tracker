import { BaseComponent } from '../../core/base-component.ts';
import {
  loadSnapshot,
  threatLevel,
  type Snapshot,
  type ThreatLevel,
} from '../../services/metrics.ts';
import {
  formatCount,
  formatDate,
  formatPercent,
  formatRate,
  formatSigned,
} from '../../lib/format.ts';
import {
  DATA_CSV_URL,
  TRACKED_REPO,
  TRACKED_REPO_URL,
} from '../../lib/config.ts';
import type { DoomsdayClockComponent } from '../doomsday-clock/doomsday-clock.ts';
import type { VelocityGaugeComponent } from '../velocity-gauge/velocity-gauge.ts';
import type { TrendChartComponent } from '../trend-chart/trend-chart.ts';
import '../doomsday-clock/doomsday-clock.ts';
import '../velocity-gauge/velocity-gauge.ts';
import '../trend-chart/trend-chart.ts';
import template from './dashboard-page.html?raw';
import style from './dashboard-page.css?raw';

const STATUS: Record<ThreatLevel, { icon: string; label: string }> = {
  safe: { icon: '✓', label: 'Humans hold the line' },
  elevated: { icon: '!', label: 'Elevated: agents gaining ground' },
  severe: { icon: '!', label: 'Severe: agents closing most tickets' },
  critical: { icon: '✕', label: 'Critical: midnight is near' },
};

/** The SRE dashboard: clock, velocity gauge, key numbers and trend. */
export class DashboardPageComponent extends BaseComponent {
  static tagName = 'dashboard-page';

  constructor() {
    super(template, style);
  }

  async init() {
    const tracked = this.querySelector<HTMLAnchorElement>(
      '[data-tracked-link]'
    )!;
    tracked.href = TRACKED_REPO_URL;
    tracked.textContent = TRACKED_REPO;
    this.querySelector('[data-tracked-name]')!.textContent = TRACKED_REPO;
    this.querySelector<HTMLAnchorElement>('[data-csv-link]')!.href =
      DATA_CSV_URL;

    const asOf = this.querySelector<HTMLElement>('[data-as-of]')!;
    try {
      this.render(await loadSnapshot());
    } catch (error) {
      asOf.classList.add('error');
      asOf.textContent = `Could not load the data: ${(error as Error).message}`;
    }
  }

  private render(snapshot: Snapshot) {
    const { latest, velocity } = snapshot;
    const level = threatLevel(latest.minutesToMidnight);

    this.querySelector('[data-as-of]')!.textContent =
      `Data as of ${formatDate(latest.date)} (UTC) · updated daily`;
    const status = this.querySelector<HTMLElement>('[data-status]')!;
    status.dataset.level = level;
    this.querySelector('[data-status-icon]')!.textContent = STATUS[level].icon;
    this.querySelector('[data-status-label]')!.textContent =
      STATUS[level].label;
    status.hidden = false;

    this.querySelector<DoomsdayClockComponent>('doomsday-clock')!.minutes =
      latest.minutesToMidnight;
    this.querySelector<VelocityGaugeComponent>('velocity-gauge')!.velocity =
      velocity;
    this.querySelector<TrendChartComponent>('trend-chart')!.points =
      snapshot.history;
    this.querySelector('[data-velocity-note]')!.textContent =
      velocity.days > 0
        ? `Tickets closed per day, averaged over the last ${velocity.days} ${velocity.days === 1 ? 'day' : 'days'}`
        : 'Needs at least two days of data';
    this.querySelector('[data-content]')!.setAttribute('aria-busy', 'false');

    const span = velocity.days > 0 ? `${velocity.days}d` : '';
    this.stat('open', formatCount(latest.open));
    // A shrinking backlog is good news.
    this.stat(
      'open-delta',
      span ? `${formatSigned(snapshot.openDelta)} in ${span}` : '',
      snapshot.openDelta < 0 ? 'good' : snapshot.openDelta > 0 ? 'bad' : ''
    );
    this.stat('share', formatPercent(latest.agentShare));
    this.stat(
      'share-note',
      `of ${formatCount(latest.totalClosed)} closed issues`
    );
    this.stat('agent', formatCount(latest.agentClosed));
    this.stat(
      'agent-note',
      span ? `${formatRate(velocity.agent)} per day (${span})` : ''
    );
    this.stat('human', formatCount(latest.humanClosed));
    this.stat(
      'human-note',
      span ? `${formatRate(velocity.human)} per day (${span})` : ''
    );
    const days = snapshot.daysToClearByAgents;
    this.stat(
      'clear',
      Number.isFinite(days) ? `${formatCount(Math.ceil(days))} days` : 'Never'
    );
    this.stat(
      'clear-note',
      Number.isFinite(days)
        ? 'at the current agent rate, with no new issues'
        : 'agents have not closed a ticket in this window'
    );
  }

  private stat(name: string, text: string, tone = '') {
    const element = this.querySelector<HTMLElement>(`[data-stat="${name}"]`)!;
    element.textContent = text;
    element.classList.remove('good', 'bad');
    if (tone) element.classList.add(tone);
  }
}

if (!customElements.get(DashboardPageComponent.tagName)) {
  customElements.define(DashboardPageComponent.tagName, DashboardPageComponent);
}
