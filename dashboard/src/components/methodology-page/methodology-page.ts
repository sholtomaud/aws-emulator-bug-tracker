import { BaseComponent } from '../../core/base-component.ts';
import {
  DATA_CSV_URL,
  TRACKED_REPO,
  TRACKED_REPO_URL,
} from '../../lib/config.ts';
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
  }
}

if (!customElements.get(MethodologyPageComponent.tagName)) {
  customElements.define(
    MethodologyPageComponent.tagName,
    MethodologyPageComponent
  );
}
