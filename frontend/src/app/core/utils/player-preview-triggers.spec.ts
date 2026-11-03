import { afterEach, expect, it, vi } from 'vitest';
import { presentPlayerPreviewTriggers } from './player-preview-triggers';

function createViewport() {
  vi.useFakeTimers();
  const callbacks = new Map<Element, IntersectionObserverCallback>();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        callbacks.set(element, this.callback);
      }
      disconnect() {
        disconnect();
      }
    },
  );
  const enter = (element: Element) =>
    callbacks.get(element)?.(
      [{ target: element, isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  document.body.innerHTML =
    '<div data-element-id="first"></div><div data-element-id="second" style="display:none"></div>';
  const [first, second] = Array.from(document.querySelectorAll<HTMLElement>('[data-element-id]'));
  for (const element of [first, second])
    Object.defineProperty(element, 'getClientRects', {
      value: () => (element.style.display === 'none' ? [] : [{}]),
    });
  return { first, second, enter, disconnect };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('reaches newly revealed triggers once per session after viewport and rendering notifications', async () => {
  const { first, second, enter } = createViewport();
  const firstScroll = vi.fn(() => {
    second.style.display = 'block';
    // A slower render must not make preparation race ahead of the player's viewport event.
    setTimeout(() => enter(first), 300);
  });
  const secondScroll = vi.fn(() => enter(second));
  Object.defineProperty(first, 'scrollIntoView', { value: firstScroll });
  Object.defineProperty(second, 'scrollIntoView', { value: secondScroll });
  const session = new AbortController();
  const prepared = presentPlayerPreviewTriggers(document, ['first', 'second'], session.signal);
  await vi.advanceTimersByTimeAsync(100);
  expect(secondScroll).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  await prepared;
  expect(firstScroll).toHaveBeenCalledOnce();
  expect(secondScroll).toHaveBeenCalledOnce();
  await presentPlayerPreviewTriggers(document, ['first', 'second'], session.signal);
  expect(firstScroll).toHaveBeenCalledOnce();
  expect(secondScroll).toHaveBeenCalledOnce();
});

it('disconnects pending viewport work when the session is cancelled', async () => {
  const { first, disconnect } = createViewport();
  const scroll = vi.fn();
  Object.defineProperty(first, 'scrollIntoView', { value: scroll });
  const session = new AbortController();
  const prepared = presentPlayerPreviewTriggers(document, ['first'], session.signal);
  session.abort();
  await prepared;
  expect(disconnect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  await presentPlayerPreviewTriggers(document, ['first'], session.signal);
  expect(scroll).toHaveBeenCalledOnce();
});

it('fails boundedly if a scrolled trigger never intersects the viewport', async () => {
  const { first, disconnect } = createViewport();
  Object.defineProperty(first, 'scrollIntoView', { value: vi.fn() });
  const prepared = presentPlayerPreviewTriggers(document, ['first'], new AbortController().signal);
  const rejected = expect(prepared).rejects.toThrow('did not enter view');
  await vi.runAllTimersAsync();
  await rejected;
  expect(disconnect).toHaveBeenCalledOnce();
});
