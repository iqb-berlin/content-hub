import { expect, test } from '@playwright/test';
import { journeyUnitId, journeyUnitName } from '../../test-fixtures/browser-journey-package';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

const apId = '10000000-0000-4000-8000-000000000308';
const managerId = '10000000-0000-4000-8000-000000000002';

test('publishes an immutable private task for anonymous readers and retains its link after source deletion', async ({
  page,
  browser,
  request,
}, testInfo) => {
  await installOidcSession(page.context(), managerId, 'e2e-manager');
  await page.goto(`/manage/${apId}`);
  await page.getByRole('link', { name: /Öffentliche Aufgaben/ }).click();
  await page.getByLabel('Aufgabe', { exact: true }).selectOption(journeyUnitId);
  await page
    .getByLabel('Copyright-Hinweis zum Stimulus', { exact: true })
    .fill('© IQB · Stimulus nur zur Ansicht');
  await page
    .getByLabel('Öffentliche Kommentare (optional)', { exact: true })
    .fill('Für die Öffentlichkeit freigegebener Kommentar.');
  await page.getByRole('button', { name: 'Vorschau prüfen', exact: true }).click();
  await expect(
    page.frameLocator('app-public-task-content iframe').getByText(journeyUnitName, { exact: true }),
  ).toBeVisible();
  await expect(page.frameLocator('app-public-task-content iframe').locator('html')).toHaveAttribute(
    'data-public-task-resources',
    'ready',
  );
  await expect(
    page.getByText('Öffentliche Musterlösung für die manuelle Kodierung.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Diesen Stand öffentlich freigeben' }).click();
  const permalink = page.locator('.publication a');
  await expect(permalink).toHaveCount(1);
  const path = (await permalink.getAttribute('href'))!;
  const anonymous = await browser.newContext();
  const reader = await anonymous.newPage();
  try {
    // The source AP and its downloads remain inaccessible without authentication.
    expect((await request.get(`/api/view/ap/${apId}`)).status()).toBe(403);
    expect((await request.get(`/api/ap/${apId}/files`)).status()).toBe(403);
    const publicId = path.split('/').at(-1)!;
    const publicResponse = await request.get(`/api/public-tasks/${publicId}`);
    expect(publicResponse.status()).toBe(200);
    expect(publicResponse.headers()['cache-control']).toBe('no-store');
    const snapshot = await publicResponse.json();
    expect(JSON.stringify(snapshot)).not.toContain('/api/ap/');
    expect(snapshot).not.toHaveProperty('sourceApId');
    await reader.goto(new URL(path, page.url()).href);
    await expect(reader.getByRole('heading', { name: journeyUnitName, exact: true })).toBeVisible();
    await expect(reader.getByLabel('Copyright-Hinweis zum Stimulus')).toContainText('© IQB');
    await expect(reader.getByText('Für die Öffentlichkeit freigegebener Kommentar.')).toBeVisible();
    await expect(
      reader.frameLocator('iframe').getByText(journeyUnitName, { exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByRole('heading', { name: 'Lösungserwartung und Kodieranweisung' }),
    ).toBeVisible();
    await expect(reader.locator('app-public-task-content article')).not.toHaveCount(0);
    await expect(reader.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(reader.frameLocator('iframe').locator('html')).toHaveAttribute(
      'data-public-task-resources',
      'ready',
    );
    await expect(
      reader.getByText('Manuelle Kodieranweisung ohne Regelsets.', { exact: true }),
    ).toBeVisible();
    await expect(
      reader.getByText('Öffentliche Musterlösung für die manuelle Kodierung.', { exact: true }),
    ).toBeVisible();
    await expect(reader.getByRole('button', { name: /Download/ })).toHaveCount(0);
    await expect(reader.getByRole('alert')).toHaveCount(0);
    await reader.screenshot({
      path: testInfo.outputPath('public-task-desktop.png'),
      fullPage: true,
    });
    await reader.setViewportSize({ width: 390, height: 844 });
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await reader.screenshot({
      path: testInfo.outputPath('public-task-mobile.png'),
      fullPage: true,
    });

    const unexpectedLogoutRequests: string[] = [];
    reader.on('request', (request) => {
      if (request.url().endsWith('/api/auth/logout')) unexpectedLogoutRequests.push(request.url());
    });
    for (const oidc of [false, true]) {
      const endpoint = oidc ? '/api/auth/sync-oidc-roles' : '/api/auth/profile';
      await reader.route(`**${endpoint}`, (route) =>
        route.fulfill({ status: 503, json: { message: 'Temporary profile outage' } }),
      );
      await reader.evaluate(
        ({ token, oidc }) => {
          localStorage.setItem('ch_token', token);
          localStorage.setItem('ch_auth_type', 'oidc');
          if (oidc) localStorage.setItem('ch_oidc_id_token', token);
        },
        { token: createOidcAppToken(managerId, 'e2e-manager'), oidc },
      );
      const failedProfile = reader.waitForResponse((response) => response.url().endsWith(endpoint));
      await reader.reload();
      expect((await failedProfile).status()).toBe(503);
      await expect(reader).toHaveURL(new URL(path, page.url()).href);
      await expect(
        reader.frameLocator('iframe').getByText(journeyUnitName, { exact: true }),
      ).toBeVisible();
      expect(unexpectedLogoutRequests).toEqual([]);
      expect(await reader.evaluate(() => localStorage.getItem('ch_token'))).not.toBeNull();
      await reader.unroute(`**${endpoint}`);
    }

    await reader.evaluate(() => {
      localStorage.removeItem('ch_oidc_id_token');
      localStorage.setItem('ch_token', 'expired-or-invalid-application-token');
      localStorage.setItem('ch_auth_type', 'oidc');
    });
    await reader.reload();
    await expect.poll(() => reader.evaluate(() => localStorage.getItem('ch_token'))).toBeNull();
    await expect(reader).toHaveURL(new URL(path, page.url()).href);
    await expect(
      reader.frameLocator('iframe').getByText(journeyUnitName, { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Veröffentlichung zurückziehen', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Unter demselben Link wieder freigeben' }),
    ).toBeVisible();
    await reader.reload();
    await expect(reader.getByRole('heading', { name: 'Aufgabe nicht verfügbar' })).toBeVisible();
    await page.getByRole('button', { name: 'Unter demselben Link wieder freigeben' }).click();
    await expect(
      page.getByRole('button', { name: 'Veröffentlichung zurückziehen', exact: true }),
    ).toBeVisible();

    const removed = await request.delete(`/api/ap/${apId}`, {
      headers: {
        Authorization: `Bearer ${createOidcAppToken('10000000-0000-4000-8000-000000000005', 'e2e-publications-admin')}`,
      },
    });
    expect(removed.status()).toBe(200);
    await reader.reload();
    await expect(
      reader.frameLocator('iframe').getByText(journeyUnitName, { exact: true }),
    ).toBeVisible();
    expect(await (await request.get(`/api/public-tasks/${publicId}`)).json()).toEqual(snapshot);
  } finally {
    await anonymous.close();
  }
});
