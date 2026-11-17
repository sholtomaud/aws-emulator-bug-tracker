import { BaseComponent } from '../../core/base-component.ts';
import { formatDate } from '../../lib/format.ts';
import template from './replay-control.html?raw';
import style from './replay-control.css?raw';

/** Seconds of playback for each day of the record. */
const SECONDS_PER_DAY = 0.45;

/**
 * Plays the record back: a play/pause button, a scrubber and the date being
 * shown. Dispatches `replay-position` whenever the position changes; the
 * detail is the position in days from the first date (fractional while
 * playing), or `null` when the view is back on the live data.
 *
 * Set `dates` (one per day, oldest first) to enable it.
 */
export class ReplayControlComponent extends BaseComponent {
  static tagName = 'replay-control';

  private days: string[] = [];
  private position = 0;
  private playing = false;
  private frame = 0;
  private lastTick = 0;

  constructor() {
    super(template, style);
  }

  set dates(value: string[]) {
    this.days = value;
    this.position = this.end;
    if (this.isConnected) this.render();
  }
  get dates(): string[] {
    return this.days;
  }

  /** The last position, which is the live data. */
  private get end(): number {
    return Math.max(0, this.days.length - 1);
  }

  init() {
    this.delegate('click', '[data-play]', () => this.toggle());
    const scrubber = this.querySelector<HTMLInputElement>('[data-scrubber]')!;
    scrubber.addEventListener('input', () => {
      // Read the value first: pausing re-renders the scrubber.
      const chosen = Number(scrubber.value);
      this.pause();
      this.moveTo(chosen);
    });
    this.render();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.frame);
  }

  private toggle() {
    if (this.playing) {
      this.pause();
      return;
    }
    // From the live view (or the end), play from the beginning.
    if (this.position >= this.end) this.position = 0;
    this.playing = true;
    this.lastTick = performance.now();
    this.frame = requestAnimationFrame((now) => this.tick(now));
    this.moveTo(this.position);
  }

  private pause() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.render();
  }

  private tick(now: number) {
    if (!this.playing) return;
    const elapsed = (now - this.lastTick) / 1000;
    this.lastTick = now;
    const next = this.position + elapsed / SECONDS_PER_DAY;
    if (next >= this.end) {
      this.playing = false;
      this.moveTo(this.end);
      return;
    }
    this.moveTo(next);
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  private moveTo(position: number) {
    this.position = Math.min(Math.max(position, 0), this.end);
    this.render();
    this.dispatchEvent(
      new CustomEvent<number | null>('replay-position', {
        detail: this.position >= this.end ? null : this.position,
        bubbles: true,
      })
    );
  }

  private render() {
    const root = this.querySelector<HTMLElement>('[data-replay]')!;
    // A replay needs at least two days.
    root.hidden = this.days.length < 2;
    if (root.hidden) return;

    const live = this.position >= this.end;
    root.dataset.state = live ? 'live' : 'replaying';
    const scrubber = this.querySelector<HTMLInputElement>('[data-scrubber]')!;
    scrubber.max = String(this.end);
    scrubber.value = String(this.position);
    const date = this.days[Math.min(Math.floor(this.position), this.end)];
    scrubber.setAttribute('aria-valuetext', live ? 'Live' : formatDate(date));
    this.querySelector('[data-date]')!.textContent = live
      ? 'Live'
      : formatDate(date);
    this.querySelector('[data-icon]')!.textContent = this.playing ? '❚❚' : '▶';
    this.querySelector('[data-play-label]')!.textContent = this.playing
      ? 'Pause'
      : live
        ? 'Replay the record'
        : 'Resume';
  }
}

if (!customElements.get(ReplayControlComponent.tagName)) {
  customElements.define(ReplayControlComponent.tagName, ReplayControlComponent);
}
