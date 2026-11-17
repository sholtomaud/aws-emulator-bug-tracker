import { BaseComponent } from '../../core/base-component.ts';
import {
  loadSnapshot,
  nextUpdate,
  threatLevel,
  type DoomLoop,
  type Snapshot,
  type ThreatLevel,
} from '../../services/metrics.ts';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatTimeUtc,
  formatPercent,
} from '../../lib/format.ts';
import {
  DATA_CSV_URL,
  TRACKED_REPO,
  TRACKED_REPO_URL,
} from '../../lib/config.ts';
import type { DoomsdayClockComponent } from '../doomsday-clock/doomsday-clock.ts';
import type { VelocityGaugeComponent } from '../velocity-gauge/velocity-gauge.ts';
import type { TrendChartComponent } from '../trend-chart/trend-chart.ts';
import type { DoomLoopComponent } from '../doom-loop/doom-loop.ts';
import '../doomsday-clock/doomsday-clock.ts';
import '../velocity-gauge/velocity-gauge.ts';
import '../trend-chart/trend-chart.ts';
import '../doom-loop/doom-loop.ts';
import '../queue-compare/queue-compare.ts';
import '../closure-evidence/closure-evidence.ts';
import type { QueueCompareComponent } from '../queue-compare/queue-compare.ts';
import type { ClosureEvidenceComponent } from '../closure-evidence/closure-evidence.ts';
import {
  closureSummary,
  loadAgentQueue,
  strictRatios,
  type AgentQueue,
} from '../../services/insights.ts';
import {
  DEFAULT_PUBLIC_WEIGHT,
  attentionIndex,
  backlogShare,
  combinedAgentShare,
  combinedDoomLoop,
  combinedHoursToMidnight,
  combinedVelocity,
  effortShare,
  queueAgentShare,
  weightMarks,
  type Queue,
} from '../../services/combined.ts';
import '../weight-slider/weight-slider.ts';
import { WeightSliderComponent } from '../weight-slider/weight-slider.ts';
import template from './dashboard-page.html?raw';
import style from './dashboard-page.css?raw';

const NO_LOOP: DoomLoop = {
  ratio: null,
  level: 'unknown',
  history: [],
  doublingDays: null,
  clearDays: null,
};

const STATUS: Record<ThreatLevel, { icon: string; label: string }> = {
  safe: { icon: '✓', label: 'Humans hold the line' },
  elevated: { icon: '!', label: 'Elevated: agents gaining ground' },
  severe: { icon: '!', label: 'Severe: agents resolving most items' },
  critical: { icon: '✕', label: 'Critical: midnight is near' },
};

/**
 * The dashboard: the Developer Doomsday Clock, the velocity dials and the
 * doom loops, each combined and per queue, with the indices and trends.
 */
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
    const asOf = snapshot.status?.updatedAt;

    const tracker = snapshot.status;
    const next = tracker && nextUpdate(tracker);
    this.querySelector('[data-as-of]')!.textContent = tracker
      ? `Data as of ${formatDateTime(tracker.updatedAt)} · updated ${tracker.schedule.description}` +
        (next ? ` · next around ${formatTimeUtc(next)}` : '')
      : `Data as of ${formatDate(latest.date)} (UTC)`;
    this.querySelector('[data-schedule]')!.textContent = tracker
      ? `Updated ${tracker.schedule.description}`
      : 'Updated';

    const publicQueue: Queue = {
      latest,
      velocity,
      loop: snapshot.doomLoop,
    };

    // Per-queue panels for the public issues.
    const publicDial = this.dial('public');
    publicDial.heading = 'Public GitHub issues';
    publicDial.velocity = velocity;
    const publicLoop = this.loop('public');
    publicLoop.queue = 'Public GitHub issues';
    publicLoop.open = latest.open;
    publicLoop.windowDays = velocity.days;
    publicLoop.strict = strictRatios(snapshot.history, 7, asOf);
    publicLoop.loop = snapshot.doomLoop;

    const closures = closureSummary(latest);
    const evidence =
      this.querySelector<ClosureEvidenceComponent>('closure-evidence')!;
    evidence.closures = closures;
    evidence.issues = tracker?.issues;
    evidence.update();

    this.querySelector<TrendChartComponent>('[data-trend="public"]')!.points =
      snapshot.history;
    this.querySelector('[data-content]')!.setAttribute('aria-busy', 'false');

    this.stat(
      'verified',
      closures ? formatPercent(closures.referencedShare) : '—'
    );
    this.stat(
      'verified-note',
      closures
        ? `${formatCount(closures.byEvidence.fix_referenced)} of ${formatCount(closures.total)} public closures reference a fix`
        : 'available after the next tracker run'
    );
    const issues = tracker?.issues;
    const reopened = issues?.reopened;
    const everClosed = issues?.everClosed ?? 0;
    this.stat(
      'reopen',
      reopened !== undefined && everClosed > 0
        ? formatPercent(reopened / everClosed)
        : '—'
    );
    this.stat(
      'reopen-note',
      reopened !== undefined
        ? `${formatCount(reopened)} of ${formatCount(everClosed)} closed public issues were reopened`
        : 'available after the next tracker run'
    );

    // Everything that needs both queues waits for the agents' own queue.
    loadAgentQueue(asOf).then((queue) => {
      const agents: Queue | null = queue && {
        latest: queue.points[queue.points.length - 1],
        velocity: queue.velocity,
        loop: queue.loop,
      };
      this.renderAgents(queue, agents);
      this.renderQueues(publicQueue, agents);

      const slider =
        this.querySelector<WeightSliderComponent>('weight-slider')!;
      const defaultWeight =
        tracker?.defaultPublicWeight ?? DEFAULT_PUBLIC_WEIGHT;
      slider.hidden = !agents;
      if (agents) {
        slider.marks = weightMarks(publicQueue, agents, defaultWeight);
        slider.weight = WeightSliderComponent.saved() ?? defaultWeight;
        slider.addEventListener('weight-change', (event) =>
          this.renderCombined(
            publicQueue,
            agents,
            (event as CustomEvent<number>).detail
          )
        );
      }
      // Without the agents' queue the combined figures are the public ones.
      this.renderCombined(publicQueue, agents, agents ? slider.weight : 1);
    });
  }

  /** The panels for the agents' own queue. */
  private renderAgents(queue: AgentQueue | null, agents: Queue | null) {
    const dial = this.dial('agents');
    dial.heading = "Agents' own queue";
    dial.arrivalsLabel = 'new problems';
    dial.hidden = !agents;
    if (agents) dial.velocity = agents.velocity;

    const loop = this.loop('agents');
    loop.queue = "Agents' own queue";
    loop.caption = 'problems filed per problem resolved';
    loop.open = queue?.open ?? 0;
    loop.windowDays = queue?.velocity.days ?? 0;
    loop.loop = queue?.loop ?? NO_LOOP;

    const trend = this.querySelector<HTMLElement>('[data-queue-trend]')!;
    trend.hidden = !queue;
    if (queue) {
      const chart = this.querySelector<TrendChartComponent>(
        '[data-trend="agents"]'
      )!;
      chart.labels = {
        open: 'Open problems',
        agentClosed: 'Resolved by AI agents',
        humanClosed: 'Resolved by humans',
        totalClosed: 'Total resolved',
      };
      chart.points = queue.points;
    }
  }

  /** The side-by-side comparison and the figures that span both queues. */
  private renderQueues(publicQueue: Queue, agents: Queue | null) {
    const figures = (queue: Queue) => ({
      open: queue.latest.open,
      resolved: queue.latest.totalClosed,
      resolvedByAgents: queue.latest.agentClosed,
      resolvedByHumans: queue.latest.humanClosed,
      arrivals: queue.velocity.arrivals,
      agentResolved: queue.velocity.agent,
      humanResolved: queue.velocity.human,
      days: queue.velocity.days,
    });
    this.querySelector<QueueCompareComponent>('queue-compare')!.comparison = {
      agents: agents && figures(agents),
      publicIssues: figures(publicQueue),
    };

    this.stat(
      'open',
      formatCount(publicQueue.latest.open + (agents?.latest.open ?? 0))
    );
    this.stat(
      'open-note',
      agents
        ? `${formatCount(publicQueue.latest.open)} public issues · ${formatCount(agents.latest.open)} in the agents' queue`
        : 'public issues'
    );

    const attention = agents ? attentionIndex(publicQueue, agents) : null;
    this.stat('attention', attention === null ? '—' : attention.toFixed(2));
    this.stat(
      'attention-note',
      agents
        ? `public issues get ${formatPercent(effortShare(publicQueue, agents))} of resolutions and hold ${formatPercent(backlogShare(publicQueue, agents))} of the backlog`
        : "needs the agents' own queue"
    );
  }

  /** The clock, large dial and top doom loop, at a weighting. */
  private renderCombined(
    publicQueue: Queue,
    agents: Queue | null,
    publicWeight: number
  ) {
    const hours = combinedHoursToMidnight(publicQueue, agents, publicWeight);
    this.querySelector<DoomsdayClockComponent>('doomsday-clock')!.hours = hours;
    const level = threatLevel(hours);
    const status = this.querySelector<HTMLElement>('[data-status]')!;
    status.dataset.level = level;
    this.querySelector('[data-status-icon]')!.textContent = STATUS[level].icon;
    this.querySelector('[data-status-label]')!.textContent =
      STATUS[level].label;
    status.hidden = false;

    const weights = agents
      ? `public issues ${Math.round(publicWeight * 100)}%, agents' queue ${Math.round((1 - publicWeight) * 100)}%`
      : 'public issues only';
    this.querySelector('[data-clock-note]')!.textContent =
      `Weighted: ${weights}.`;

    const share = combinedAgentShare(publicQueue, agents, publicWeight);
    const percent = (queue: Queue | null) => {
      const value = queue && queueAgentShare(queue);
      return value === null ? 'n/a' : formatPercent(value);
    };
    this.stat('share', formatPercent(share));
    this.stat(
      'share-note',
      `combined · public issues ${percent(publicQueue)} · agents' queue ${percent(agents)}`
    );

    const dial = this.dial('combined');
    dial.heading = agents ? 'Both queues, weighted' : 'Public GitHub issues';
    dial.arrivalsLabel = 'new items';
    dial.velocity = combinedVelocity(publicQueue, agents, publicWeight);

    const loop = this.loop('combined');
    loop.queue = agents ? 'Both queues, weighted' : 'Public GitHub issues';
    loop.caption = 'items opened per item resolved, weighted across queues';
    loop.note = agents
      ? `Weighted geometric mean of the two queues' ratios: ${weights}.`
      : '';
    loop.open = publicQueue.latest.open;
    loop.loop = combinedDoomLoop(publicQueue, agents, publicWeight);
  }

  private dial(name: string) {
    return this.querySelector<VelocityGaugeComponent>(`[data-dial="${name}"]`)!;
  }

  private loop(name: string) {
    return this.querySelector<DoomLoopComponent>(
      `[data-queue-loop="${name}"]`
    )!;
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
