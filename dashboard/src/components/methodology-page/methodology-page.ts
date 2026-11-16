import { BaseComponent } from '../../core/base-component.ts';
import {
  DATA_CSV_URL,
  TRACKED_REPO,
  TRACKED_REPO_URL,
  WHY_URL,
} from '../../lib/config.ts';
import { loadStatus } from '../../services/metrics.ts';
import template from './methodology-page.html?raw';
import style from './methodology-page.css?raw';

/** How each number on the dashboard is worked out. */
export class MethodologyPageComponent extends BaseComponent {
  static tagName = 'methodology-page';

  constructor() {
    super(template, style);
  }

  init() {
    this.querySelector<HTMLAnchorElement>('[data-csv-link]')!.href =
      DATA_CSV_URL;
    const tracked = this.querySelector<HTMLAnchorElement>(
      '[data-tracked-link]'
    )!;
    tracked.href = TRACKED_REPO_URL;
    tracked.textContent = TRACKED_REPO;
    this.querySelector<HTMLAnchorElement>('[data-why-link]')!.href = WHY_URL;

    // The schedule is set in the tracker workflow's cron line and reaches
    // the site through status.json.
    loadStatus().then((status) => {
      if (!status) return;
      const { description, runTimesUtc } = status.schedule;
      this.querySelector('[data-schedule]')!.textContent =
        `${description} (${runTimesUtc.join(', ')} UTC)`;
    });
  }
}

if (!customElements.get(MethodologyPageComponent.tagName)) {
  customElements.define(
    MethodologyPageComponent.tagName,
    MethodologyPageComponent
  );
}
