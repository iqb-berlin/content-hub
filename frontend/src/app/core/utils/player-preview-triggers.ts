const visited = new WeakMap<AbortSignal, WeakSet<Element>>();

/** Let the original player execute required state triggers through its own viewport observer.
 * Keep one visit history per preview session so a global trigger is not replayed on each page.
 */
export async function presentPlayerPreviewTriggers(
  doc: Document,
  ids: string[],
  signal: AbortSignal,
): Promise<void> {
  let seen = visited.get(signal);
  if (!seen) {
    seen = new WeakSet<Element>();
    visited.set(signal, seen);
  }
  for (let round = 0; round < ids.length && !signal.aborted; round++) {
    let progressed = false;
    for (const id of ids) {
      if (signal.aborted) return;
      const escape = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const element = doc.querySelector(`[data-element-id="${escape}"]`);
      if (
        !element ||
        seen.has(element) ||
        !element.getClientRects().length ||
        doc.defaultView?.getComputedStyle(element).visibility === 'hidden'
      )
        continue;
      progressed = true;
      await presentElement(element, signal);
      if (!signal.aborted) seen.add(element);
    }
    if (!progressed) break;
  }
}

/** Wait for actual intersection and the following render, rather than a fixed delay.
 * Only the original player's observer executes the trigger; no component internals are used.
 */
function presentElement(element: Element, signal: AbortSignal): Promise<void> {
  const view = element.ownerDocument.defaultView!;
  return new Promise<void>((resolve, reject) => {
    let frame = 0;
    const finish = (error?: Error) => {
      observer.disconnect();
      view.cancelAnimationFrame(frame);
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish();
    const observer = new view.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      // The player observes the same viewport. Give its callback and Angular's
      // resulting layout a render before looking for a newly revealed trigger.
      frame = view.requestAnimationFrame(() => {
        frame = view.requestAnimationFrame(() => finish());
      });
    });
    const timeout = setTimeout(() => finish(new Error('Player trigger did not enter view')), 2000);
    signal.addEventListener('abort', abort, { once: true });
    observer.observe(element);
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}
