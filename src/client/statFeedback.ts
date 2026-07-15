// ONE MORE DAWN — stat-change feedback (JUICE / FEEDBACK POLISH).
//
// Purely visual, fully self-contained, and fail-silent. It watches the HUD
// dashboard's stat-bar fills (vitals, build progress, dome shield, council
// votes, the Marked pledge bar, the leaderboard, and land funding) for a
// change in their inline width and briefly flashes the bar via the CSS
// `.omd-bumped` class, so a gain or loss registers at a glance instead of
// sliding by unnoticed.
//
// Design notes:
//  - Scoped to `.dash` (the single dashboard container). That subtree holds
//    every stat bar but NOT the 3D scene's CSS2D label layer, whose inline
//    transforms churn every frame — observing the whole body would thrash.
//  - Reduced motion is honored in CSS: under `prefers-reduced-motion: reduce`
//    the `.omd-bumped` animation is disabled, so toggling the class is inert.
//  - Never throws. DOM-guarded so importing it in a non-DOM context is a no-op.

const FILL_SELECTOR =
  '.vit .track > i, .bp-bar > i, .dome-bar > i, .lb-bar > i, .mk-bar > i, .co-bar > i, .land-progress > i';
const BUMP_CLASS = 'omd-bumped';
const BUMP_MS = 640; // must outlast the flash keyframe so the class is cleaned up

type Disposer = () => void;

/**
 * Start flashing dashboard stat bars when their value changes. Returns a
 * disposer; call it to stop observing (wired into the scene's dispose()).
 * Safe to call when there is no DOM — it returns a no-op disposer.
 */
export function startStatFeedback(): Disposer {
  const noop = (): void => {};
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof MutationObserver === 'undefined'
  ) {
    return noop;
  }

  const lastWidth = new WeakMap<Element, string>();
  const clearTimers = new WeakMap<Element, number>();
  let observer: MutationObserver | null = null;
  let findTimer = 0;
  let cancelled = false;

  const flash = (fill: Element): void => {
    const bar = fill.parentElement;
    if (!bar) return;
    const pending = clearTimers.get(bar);
    if (pending !== undefined) window.clearTimeout(pending);
    // Remove + force a reflow + re-add so the animation restarts even when the
    // bar changes again mid-flash. (offsetHeight read is the reflow; the
    // comparison is always true and simply keeps the read from being dropped.)
    bar.classList.remove(BUMP_CLASS);
    if ((bar as HTMLElement).offsetHeight >= 0) bar.classList.add(BUMP_CLASS);
    const timer = window.setTimeout(() => bar.classList.remove(BUMP_CLASS), BUMP_MS);
    clearTimers.set(bar, timer);
  };

  const onMutations = (records: MutationRecord[]): void => {
    for (const rec of records) {
      const target = rec.target;
      if (!(target instanceof Element) || !target.matches(FILL_SELECTOR)) continue;
      const width = (target as HTMLElement).style.width || '';
      const previous = lastWidth.get(target);
      lastWidth.set(target, width);
      // Only flash on a genuine change (React re-renders can re-set an equal
      // width, and a bar's first appearance should not flash).
      if (previous !== undefined && previous !== width) flash(target);
    }
  };

  const observe = (root: Element): void => {
    try {
      // Seed current widths so the initial paint doesn't flash every bar at once.
      root.querySelectorAll(FILL_SELECTOR).forEach((el) => {
        lastWidth.set(el, (el as HTMLElement).style.width || '');
      });
      observer = new MutationObserver(onMutations);
      observer.observe(root, { attributes: true, attributeFilter: ['style'], subtree: true });
    } catch {
      /* observing is cosmetic — never surface a failure */
    }
  };

  const tryFind = (attempt: number): void => {
    if (cancelled) return;
    const dash = document.querySelector('.dash');
    if (dash) {
      observe(dash);
      return;
    }
    // The dashboard mounts with the rest of the HUD; poll briefly, then stop.
    if (attempt >= 40) return; // ~8s at 200ms, then give up quietly
    findTimer = window.setTimeout(() => tryFind(attempt + 1), 200);
  };

  try {
    tryFind(0);
  } catch {
    /* never throw into the caller */
  }

  return (): void => {
    cancelled = true;
    if (findTimer) window.clearTimeout(findTimer);
    try {
      observer?.disconnect();
    } catch {
      /* ignore */
    }
    observer = null;
  };
}
