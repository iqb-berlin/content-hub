import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

export const poolDirectory = resolve(__dirname, '../../test-fixtures/synthetic-aspect');
export interface PoolUnit {
  id: string;
  name: string;
  file: string;
  expected: {
    scenario: string;
    pageCount: number;
    solution: Record<string, string | number>;
    unsupported: string[];
  };
}
export const pool = JSON.parse(readFileSync(resolve(poolDirectory, 'pool.json'), 'utf8')) as {
  acpId: string;
  bookletId: string;
  definitionVersion: string;
  player: { file: string; version: string; sha256: string; source: string };
  units: PoolUnit[];
};
const managerId = '10000000-0000-4000-8000-000000000002';
export const reviewUrl = `/view/${pool.acpId}/sequence/${pool.bookletId}?kind=booklet`;
export const frame = (page: Page) => page.frameLocator('app-unit-view iframe');
export const show = (page: Page) =>
  page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }).click();
export const hide = (page: Page) =>
  page.getByRole('button', { name: 'Musterlösung ausblenden', exact: true }).click();

export async function authenticatedGet(page: Page, url: string) {
  const response = await page.request.get(url, {
    headers: { Authorization: `Bearer ${createOidcAppToken(managerId, 'e2e-manager')}` },
  });
  expect(response.ok()).toBe(true);
  return response;
}

export async function unitData(page: Page, id: string) {
  const response = await authenticatedGet(page, `/api/view/acp/${pool.acpId}/units/${id}`);
  return response.json() as Promise<{
    id: string;
    name: string;
    dependencies: { type: string; downloadUrl: string }[];
  }>;
}

export async function jump(page: Page, id: string) {
  const unit = pool.units.find((entry) => entry.id === id)!;
  await page.getByRole('button', { name: 'Aufgabenliste', exact: false }).click();
  await page.locator('.unit-list-item').filter({ hasText: unit.name }).click();
  await expect(page.locator('app-unit-view h1')).toContainText(unit.name);
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toBeEnabled();
}

export async function open(page: Page, id = 'u1') {
  await page.goto(reviewUrl);
  await expect(frame(page).getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toBeEnabled();
  if (id !== 'u1') await jump(page, id);
}

// Every synthetic case uses a fresh authenticated session, the real API and real
// player. Fault-injection cases replace only the requested coding-file response.
export const test = base.extend<{ checkBrowser: void }>({
  checkBrowser: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const writes: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (
          new URL(request.url()).pathname.startsWith('/api/') &&
          !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        ) {
          writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
        }
      });
      await installOidcSession(page, managerId, 'e2e-manager');
      await use();
      expect(errors, 'No unhandled browser errors').toEqual([]);
      expect(writes, 'Reviewing must not persist synthetic answers').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };
