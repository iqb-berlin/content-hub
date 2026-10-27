import { expect, test, type Page } from '@playwright/test';
import { journeyBookletId, journeyUnitName } from '../../test-fixtures/browser-journey-package';
import { installOidcSession } from './oidc-test-session';

const acpId = '10000000-0000-4000-8000-000000000307';
const baseUrl = `/view/${acpId}/sequence/${journeyBookletId}?kind=booklet`;

async function expectPosition(page: Page, position: number, total = 3) {
  await expect(page.locator('.nav-info')).toContainText(`Aufgabe ${position} / ${total}`);
  await expect(
    page.frameLocator('app-unit-view iframe').getByText(journeyUnitName, { exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await installOidcSession(context, '10000000-0000-4000-8000-000000000002', 'e2e-manager');
});

test('copies an exact repeated occurrence into a new tab and survives reload', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // All content, manifest parsing and permissions come from the isolated backend.
  const sequenceResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/view/acp/${acpId}/sequences/${journeyBookletId}?`),
  );
  await page.goto(baseUrl);
  const booklet = await (await sequenceResponse).json();
  await expectPosition(page, 1);
  await page.getByRole('button', { name: '📋 Aufgabenliste', exact: true }).click();
  const links = page.locator('.unit-direct-link');
  await expect(links).toHaveCount(3);
  const hrefs = await links.evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')!));
  expect(new Set(hrefs).size).toBe(3);
  const secondHref = hrefs[1];
  expect(new URL(secondHref, page.url()).searchParams.get('occurrence')).toMatch(
    /^[A-Za-z0-9_-]{16}$/,
  );
  await links.nth(1).click();
  await expectPosition(page, 2);
  await expect(page).toHaveURL(secondHref);
  await expect(
    page.getByRole('link', { name: '🔗 Direktlink zur Aufgabe', exact: true }),
  ).toHaveAttribute('href', secondHref);
  await page.reload();
  await expectPosition(page, 2);
  await page.getByRole('button', { name: '📋 Aufgabenliste', exact: true }).click();
  await expect(page.locator('.unit-list-item[aria-current="step"]')).toContainText('Alias: second');
  const copied = await context.newPage();
  try {
    await copied.goto(secondHref);
    await expectPosition(copied, 2);
    await copied.reload();
    await expectPosition(copied, 2);
    await copied.goto(`${baseUrl}&occurrence=${encodeURIComponent(booklet.units[1].occurrenceId)}`);
    await expectPosition(copied, 2);
    await expect(
      copied.getByRole('link', { name: '🔗 Direktlink zur Aufgabe', exact: true }),
    ).toHaveAttribute('href', secondHref);
    await copied.setViewportSize({ width: 390, height: 844 });
    await expect(
      copied.getByRole('link', { name: '🔗 Direktlink zur Aufgabe', exact: true }),
    ).toBeVisible();
    expect(await copied.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await copied.screenshot({ path: testInfo.outputPath('task-link-mobile.png'), fullPage: true });
  } finally {
    await copied.close();
  }
  expect(errors).toEqual([]);
});

test('synchronizes next, previous, task list and browser history without refetching', async ({
  page,
}) => {
  let sequenceRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/api/view/acp/${acpId}/sequences/${journeyBookletId}?`)) {
      sequenceRequests += 1;
    }
  });
  await page.goto(baseUrl);
  await expectPosition(page, 1);
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 2);
  const secondUrl = page.url();
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 3);
  await page.goBack();
  await expectPosition(page, 2);
  await expect(page).toHaveURL(secondUrl);
  await page.goBack();
  await expectPosition(page, 1);
  await page.goForward();
  await expectPosition(page, 2);
  await page.getByRole('button', { name: '← Zurück', exact: true }).click();
  await expectPosition(page, 1);
  await page.getByRole('button', { name: '📋 Aufgabenliste', exact: true }).click();
  await page.locator('.unit-list-row').nth(2).getByRole('button').click();
  await expectPosition(page, 3);
  await page.goBack();
  await expectPosition(page, 1);
  expect(sequenceRequests).toBe(1);
});

test('clears the task selection on booklet switch and restores it through browser history', async ({
  page,
}) => {
  await page.goto(`${baseUrl}&position=3`);
  await expectPosition(page, 3);
  await page.getByRole('button', { name: /^Testheft wechseln, aktuell/ }).click();
  await page.locator('.booklet-list-item').filter({ hasText: 'review-other' }).click();
  await expectPosition(page, 1, 1);
  await expect(page).toHaveURL(`/view/${acpId}/sequence/review-other?kind=booklet`);
  await page.goBack();
  await expectPosition(page, 3);
  await page.reload();
  await expectPosition(page, 3);
});

test('reports a stale link and lets navigation recover to a valid target', async ({ page }) => {
  await page.goto(`${baseUrl}&occurrence=not-in-this-booklet`);
  await expectPosition(page, 1);
  await expect(page.getByRole('status')).toContainText(
    'Die verlinkte Aufgabe wurde in diesem Testheft nicht gefunden.',
  );
  await expect(page.getByRole('status')).toContainText('ungültig oder veraltet');
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 2);
  await expect(
    page.getByText('Die verlinkte Aufgabe wurde in diesem Testheft nicht gefunden.'),
  ).toHaveCount(0);
  await page.reload();
  await expectPosition(page, 2);
});
