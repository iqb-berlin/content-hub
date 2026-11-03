import { expect, type FrameLocator } from '@playwright/test';

export async function clickInteractiveHotspot(frame: FrameLocator) {
  const image = frame.locator('aspect-hotspot-image .image-container');
  // Rotated/clipped triangles do not fill their bounding rectangle. Find a
  // visible hit target, then use a real pointer click through Playwright.
  const point = await image.evaluate((element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    for (let row = 0; row < 32; row++)
      for (let column = 0; column < 32; column++) {
        const x = ((column + 0.5) * rect.width) / 32;
        const y = ((row + 0.5) * rect.height) / 32;
        const inside = [
          [0, 0],
          [-4, -4],
          [-4, 4],
          [4, -4],
          [4, 4],
        ].every(([dx, dy]) => {
          const hit = element.ownerDocument.elementFromPoint(rect.left + x + dx, rect.top + y + dy);
          return hit?.closest('.active-hotspot') && element.contains(hit);
        });
        if (inside) return { x, y };
      }
    return null;
  });
  expect(point, 'a visible, interactive hotspot point').not.toBeNull();
  await image.click({ position: point! });
}
