import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Page, type FrameLocator } from '@playwright/test';
import { test as base, expect, authenticatedGet } from './synthetic-aspect-support';

export const playerPoolDirectory = resolve(__dirname, '../../test-fixtures/synthetic-players');
export interface FormatUnit {
  id: string;
  name: string;
  file: string;
  player: string;
  formats: string[];
  probe: string;
  expected: {
    pageCount: number;
    solution: Record<string, unknown>;
    unsupported: string[];
    response?: { value: number | number[]; code: number; score: number };
  };
}
export const playerPool = JSON.parse(
  readFileSync(resolve(playerPoolDirectory, 'pool.json'), 'utf8'),
) as {
  acpId: string;
  bookletId: string;
  players: { id: string; file: string; version: string; source: string; sha256: string }[];
  units: FormatUnit[];
};
export const playerFrame = (page: Page) => page.frameLocator('app-unit-view iframe');

export async function openFormat(page: Page, unit: FormatUnit): Promise<FrameLocator> {
  await page.goto(`/view/${playerPool.acpId}/unit/${unit.id}`);
  await expect(page.locator('app-unit-view h1')).toContainText(unit.name);
  return playerFrame(page);
}

export async function formatData(page: Page, id: string) {
  return (
    await authenticatedGet(page, `/api/view/acp/${playerPool.acpId}/units/${id}`)
  ).json() as Promise<{ name: string; dependencies: { type: string; downloadUrl: string }[] }>;
}

export const test = base.extend<{ checkPlayerRuntime: void }>({
  checkPlayerRuntime: [
    async ({ page }, use) => {
      page.setDefaultTimeout(12_000);
      await page.addInitScript(() => {
        if (window !== window.parent) return;
        const errors: unknown[] = [];
        Object.defineProperty(window, 'syntheticPlayerErrors', { value: errors });
        const widgetCalls: unknown[] = [];
        Object.defineProperty(window, 'syntheticWidgetCalls', { value: widgetCalls });
        const states: unknown[] = [];
        Object.defineProperty(window, 'syntheticPlayerStates', { value: states });
        const navigation: string[] = [];
        Object.defineProperty(window, 'syntheticPlayerNavigation', { value: navigation });
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'vopRuntimeErrorNotification') errors.push(event.data);
          if (event.data?.type === 'vopWidgetCall') widgetCalls.push(event.data);
          if (event.data?.type === 'vopStateChangedNotification') states.push(event.data);
          if (event.data?.type === 'vopUnitNavigationRequestedNotification')
            navigation.push(event.data.target);
        });
      });
      const resourceFailures: string[] = [];
      page.on('response', (response) => {
        if (
          response.status() >= 400 &&
          new URL(response.url()).pathname.startsWith('/api/shared-assets/')
        ) {
          resourceFailures.push(`${response.status()} ${response.url()}`);
        }
      });
      await use();
      const errors = await page.evaluate(
        () =>
          (window as unknown as { syntheticPlayerErrors?: unknown[] }).syntheticPlayerErrors || [],
      );
      expect(errors, 'No player runtime error notifications').toEqual([]);
      expect(resourceFailures, 'All real runtime resources must load').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect, authenticatedGet };
