import { expect, test } from '@playwright/test';
import { installOidcSession } from './oidc-test-session';

const acpId = '10000000-0000-4000-8000-000000000201';
const managerId = '10000000-0000-4000-8000-000000000002';
const viewerId = '10000000-0000-4000-8000-000000000003';
const reviewManagerId = '10000000-0000-4000-8000-000000000004';
const overview = `/manage/${acpId}`;

test('manager opens content directly and returns to the same overview', async ({
  page,
}, testInfo) => {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(`/view/${acpId}`);
  await expect(page).toHaveURL(overview);
  await expect(page.getByRole('link', { name: /Vorschau/ })).toHaveCount(0);
  await expect(page.locator('.primary-content .tile-icon')).toHaveText('🔭');
  await page.getByRole('link', { name: /^Item-Explorer/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('link', { name: 'ACP-Übersicht', exact: true }).click();
  await expect(page).toHaveURL(overview);
  await page.getByRole('link', { name: /^Aufgaben ansehen/ }).click();
  await expect(page).toHaveURL(`/view/${acpId}/units`);
  await page.getByRole('link', { name: 'ACP-Übersicht', exact: true }).click();
  await page.locator('details.index-section summary').click();
  await page.getByRole('link', { name: 'Struktur ansehen', exact: true }).click();
  await page.getByRole('link', { name: '← Zur ACP-Übersicht', exact: true }).click();
  await expect(page).toHaveURL(overview);
  for (const [label, target] of [
    ['Dateien verwalten', `${overview}/files`],
    ['Sicherungsstände', `${overview}/snapshots`],
    ['Zugriff & Funktionen', `${overview}/access`],
    ['Review', `/view/${acpId}/review/manage`],
    ['API-Zugänge', `${overview}/application-tokens`],
  ]) {
    await page.getByRole('link', { name: new RegExp(`^${label}`) }).click();
    await expect(page).toHaveURL(target);
    if (label === 'Review') {
      await expect(page.getByRole('heading', { name: '1. Bereitschaft prüfen' })).toBeVisible();
      await expect(page.locator('a[href*="/unit/"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Bereitschaft prüfen' }).click();
      await expect(page.getByText('Blockiert', { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('review-management.png'), fullPage: true });
    }
    await page.getByRole('link', { name: '← Zur ACP-Übersicht', exact: true }).click();
    await expect(page).toHaveURL(overview);
  }
});

for (const size of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`compact index and bounded JSON dialog at ${size.width} × ${size.height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(size);
    await installOidcSession(page, managerId, 'e2e-manager');
    await page.route(`**/api/acp/${acpId}`, async (route) => {
      const response = await route.fetch();
      const acp = await response.json();
      acp.acpIndex = {
        longIndex: Array.from({ length: 500 }, (_, i) => ({
          id: i,
          name: 'Langer Eintrag '.repeat(15),
        })),
      };
      await route.fulfill({ json: acp });
    });
    await page.goto(overview);
    const roles = page.getByRole('region', { name: 'Personen & Rollen' });
    await expect(roles).toBeVisible();
    const details = page.locator('details.index-section');
    await expect(details).not.toHaveAttribute('open');
    await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
    await details.locator('summary').click();
    const trigger = page.getByRole('button', { name: 'JSON anzeigen', exact: true });
    await trigger.scrollIntoViewIfNeeded();
    const before = await roles.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'ACP-Index als JSON' });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(size.height * 0.8 + 1);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(size.width);
    expect(await dialog.locator('pre').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    expect(await roles.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)).toBe(
      before,
    );
    await page.screenshot({ path: testInfo.outputPath('json-dialog.png') });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('button', { name: 'Schließen' }).click();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page).toHaveURL(overview);
  });
}

test('index export, import and reset remain available without leaving the overview', async ({
  page,
}) => {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(overview);
  await page.locator('details.index-section summary').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportieren', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe(`acp-index-${acpId}.json`);
  await expect(page).toHaveURL(overview);
  let imported: unknown;
  let resets = 0;
  await page.route(new RegExp(`/api/acp/${acpId}/index/import(?:\\?.*)?$`), (route) => {
    imported = route.request().postDataJSON();
    return route.fulfill({ json: imported });
  });
  await page.route(new RegExp(`/api/acp/${acpId}/index(?:\\?.*)?$`), (route) => {
    if (route.request().method() === 'DELETE') {
      resets++;
      return route.fulfill({ json: {} });
    }
    return route.continue();
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'index.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"assessmentParts":[]}'),
  });
  await expect(page.getByText('ACP-Index wurde importiert.', { exact: true })).toBeVisible();
  expect(imported).toEqual({ assessmentParts: [] });
  await page.getByRole('button', { name: 'Index zurücksetzen', exact: true }).click();
  const confirmation = page.locator('app-confirm-dialog .dialog');
  await confirmation.getByRole('button', { name: 'Abbrechen' }).click();
  expect(resets).toBe(0);
  await page.getByRole('button', { name: 'Index zurücksetzen', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Zurücksetzen', exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  expect(resets).toBe(1);
  await expect(page).toHaveURL(overview);
});

test('readers keep the content entry and return there without management links', async ({
  page,
}) => {
  await installOidcSession(page, viewerId, 'e2e-viewer');
  await page.goto(`/view/${acpId}`);
  await page.getByRole('link', { name: /Item-Explorer/ }).click();
  const back = page.getByRole('link', { name: 'ACP-Übersicht', exact: true });
  await expect(back).toHaveAttribute('href', `/view/${acpId}`);
  await back.click();
  await expect(page.getByRole('link', { name: /Aufgaben ansehen/ })).toBeVisible();
  await expect(page.locator('a[href^="/manage/"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Paketstruktur (ACP-Index) ansehen', exact: true }).click();
  await page.getByRole('link', { name: '← Zur ACP-Übersicht', exact: true }).click();
  await expect(page).toHaveURL(`/view/${acpId}`);
});

test('delegated Review managers open management without an ACP manager role', async ({ page }) => {
  await installOidcSession(page, reviewManagerId, 'e2e-review-manager');

  await page.goto(`/view/${acpId}`);
  await page.getByRole('link', { name: 'Review verwalten', exact: true }).click();

  await expect(page).toHaveURL(`/view/${acpId}/review/manage`);
  await expect(page.getByRole('heading', { name: '1. Bereitschaft prüfen' })).toBeVisible();
  await expect(page.locator('a[href^="/manage/"]')).toHaveCount(0);
});
