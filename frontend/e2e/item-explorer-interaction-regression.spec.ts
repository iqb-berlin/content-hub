import { expect, Page, test } from '@playwright/test';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

const ACP_ID = '10000000-0000-4000-8000-000000000201';
const MANAGER_ID = '10000000-0000-4000-8000-000000000002';

const headers = { Authorization: `Bearer ${createOidcAppToken(MANAGER_ID, 'e2e-manager')}` };
const stateUrl = `/api/view/acp/${ACP_ID}/item-explorer/state`;
let originalItemOrder: string[] = [];

test.beforeEach(async ({ request }) => {
  const response = await request.get(stateUrl, { headers });
  expect(response.ok()).toBeTruthy();
  originalItemOrder = [...((await response.json()).activeState.itemOrder || [])];
});

test.afterEach(async ({ page, request }) => {
  // Stop pending UI requests before restoring the shared fixture, even after a failed assertion.
  await page.close();
  const response = await request.get(stateUrl, { headers });
  expect(response.ok()).toBeTruthy();
  const state = await response.json();
  const restored = await request.patch(`/api/acp/${ACP_ID}/item-explorer/draft`, {
    headers,
    data: {
      baseVersion: state.version,
      changeType: 'ITEM_ORDER_CHANGED',
      patch: { itemOrder: originalItemOrder },
    },
  });
  expect(restored.ok()).toBeTruthy();
  const verification = await request.get(stateUrl, { headers });
  expect(verification.ok()).toBeTruthy();
  expect((await verification.json()).activeState.itemOrder).toEqual(originalItemOrder);
});

async function openExplorer(page: Page) {
  const accessUrl = `/api/acp/${ACP_ID}/access`;
  const accessResponse = await page.request.get(accessUrl, { headers });
  expect(accessResponse.ok()).toBeTruthy();
  const access = await accessResponse.json();
  const update = await page.request.put(accessUrl, {
    headers,
    data: {
      accessModel: access.accessModel,
      allowRegistered: access.allowRegistered,
      featureConfig: { ...access.featureConfig, enableItemCollections: true },
    },
  });
  expect(update.ok()).toBeTruthy();
  await installOidcSession(page, MANAGER_ID, 'e2e-manager');
  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.locator('.collection-management summary')).toBeVisible();
  await page.locator('input[placeholder="🔍 Items filtern..."]').clear();
  await expect(page.locator('.explorer-table tbody tr').first()).toBeVisible();
}

test('accepts another draft edit after a conflict reload fails', async ({ page }) => {
  await openExplorer(page);

  let draftPatches = 0;
  let stateReloads = 0;
  await page.route(`**/api/view/acp/${ACP_ID}/item-explorer/state*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    stateReloads += 1;
    if (stateReloads === 1) {
      return route.fulfill({ status: 503, json: { message: 'Simulated reload failure' } });
    }
    return route.continue();
  });
  await page.route(`**/api/acp/${ACP_ID}/item-explorer/draft`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    draftPatches += 1;
    return route.fulfill({ status: 409, json: { message: 'Simulated version conflict' } });
  });

  const changeTaskColumnWidth = async (width: number) => {
    await page.getByRole('button', { name: /Spalten verwalten/ }).click();
    const dialog = page.locator('.column-manager-dialog');
    await dialog.getByLabel('Breite für Aufgabe').fill(String(width));
    await dialog.getByRole('button', { name: /Speichern/ }).click();
    await expect(dialog).toBeHidden();
  };

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const dialog = page.locator('.column-manager-dialog');
  const initialWidth = Number(await dialog.getByLabel('Breite für Aufgabe').inputValue());
  expect(initialWidth).toBeGreaterThanOrEqual(80);
  const delta = initialWidth < 570 ? 10 : -10;
  await dialog.getByLabel('Breite für Aufgabe').fill(String(initialWidth + delta));
  await dialog.getByRole('button', { name: /Speichern/ }).click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => draftPatches).toBe(1);
  await expect.poll(() => stateReloads).toBe(1);
  await expect(
    page.getByText(
      'Konflikt beim Aktualisieren des Entwurfs. Der Explorer konnte nicht neu geladen werden. Bitte erneut versuchen.',
    ),
  ).toBeVisible();

  await changeTaskColumnWidth(initialWidth + 2 * delta);

  await expect.poll(() => draftPatches).toBe(2);
  await expect.poll(() => stateReloads).toBe(2);
  await expect(
    page.getByText('Konflikt beim Aktualisieren des Entwurfs. Der Explorer wurde neu geladen.'),
  ).toBeVisible();
  await expect(page.locator('.explorer-table tbody tr').first()).toBeVisible();
});

test('shows only the existing player preview in fullscreen and restores the explorer state', async ({
  page,
}) => {
  await openExplorer(page);
  const firstRow = page.locator('.explorer-table tbody tr').first();
  await firstRow.click();
  await expect(firstRow).toHaveAttribute('aria-selected', 'true');

  const container = page.locator('.player-container');
  const frame = page.locator('iframe.player-iframe');
  await expect(frame).toBeVisible();
  await frame.evaluate((element) => {
    element.dataset['fullscreenStateMarker'] = 'preserved';
  });
  await container.evaluate((element) => {
    Object.defineProperty(element, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new Error('Fullscreen API blocked for fallback test')),
    });
  });

  const openFullscreen = page.getByRole('button', {
    name: 'Player-Vorschau im Vollbild anzeigen',
  });
  await openFullscreen.click();

  await expect(container).toHaveClass(/player-fullscreen-fallback/);
  await expect(
    page.getByRole('button', { name: 'Vollbild der Player-Vorschau beenden' }),
  ).toBeVisible();
  const viewport = page.viewportSize();
  const bounds = await container.boundingBox();
  expect(viewport).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds!.width - viewport!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds!.height - viewport!.height)).toBeLessThanOrEqual(1);
  await expect(frame).toHaveAttribute('data-fullscreen-state-marker', 'preserved');

  await page.keyboard.press('Escape');

  await expect(container).not.toHaveClass(/player-fullscreen-fallback/);
  await expect(openFullscreen).toBeFocused();
  await expect(firstRow).toHaveAttribute('aria-selected', 'true');
  await expect(frame).toHaveAttribute('data-fullscreen-state-marker', 'preserved');
});

test('shrinks narrow metadata immediately with keyboard and pointer after resizing the viewport', async ({
  page,
}, info) => {
  await openExplorer(page);
  await page.locator('.explorer-table tbody tr').first().click();
  await page.getByRole('button', { name: 'Metadaten', exact: true }).click();
  const drawer = page.locator('.drawer-container');
  const handle = page.getByRole('separator', { name: 'Breite der Metadaten ändern' });
  await handle.hover();
  await page.setViewportSize({ width: 390, height: 844 });
  await handle.focus();
  await handle.press('ArrowRight');
  await expect(drawer).toHaveCSS('width', '350px');
  await expect(handle).toHaveAttribute('aria-valuenow', '350');
  await handle.press('ArrowLeft');
  await expect(drawer).toHaveCSS('width', '390px');
  await handle.hover();
  const bounds = await handle.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 4, bounds!.y + 100);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 44, bounds!.y + 100);
  await page.mouse.up();
  await expect(drawer).toHaveCSS('width', '350px');
  await page.screenshot({ path: info.outputPath('narrow-metadata.png'), fullPage: true });
});

test('keeps global save shortcuts out of a pending native dialog even when focus leaves its disabled controls', async ({
  page,
}, info) => {
  await openExplorer(page);
  const stateResponse = await page.request.get(stateUrl, { headers });
  expect(stateResponse.ok()).toBeTruthy();
  const state = await stateResponse.json();
  const pendingItemOrder = Object.keys(state.activeState.itemProperties || {}).reverse();
  expect(pendingItemOrder.length).toBeGreaterThan(1);
  const pendingDraft = await page.request.patch(`/api/acp/${ACP_ID}/item-explorer/draft`, {
    headers,
    data: {
      baseVersion: state.version,
      changeType: 'ITEM_ORDER_CHANGED',
      patch: { itemOrder: pendingItemOrder },
    },
  });
  expect(pendingDraft.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Änderungen prüfen …', exact: true }),
  ).toBeEnabled();
  await page.locator('.collection-management summary').click();
  await page
    .locator('.collection-management-actions')
    .getByRole('button', { name: 'Neu', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Neue Auswahlliste' });
  await dialog.getByLabel('Name der Auswahlliste').fill(`Pending ${info.project.name}`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/items/collections', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    requests++;
    await gate;
    await route.continue();
  });
  try {
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expect(dialog.getByLabel('Name der Auswahlliste')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    for (const shortcut of ['Control+s', 'Meta+s']) {
      await page.keyboard.press(shortcut);
      await expect(
        page.getByRole('heading', { name: 'Änderungsübersicht vor Speichern' }),
      ).toHaveCount(0);
    }
    // Model the body-targeted event seen when browsers blur disabled modal controls.
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const prevented = await page.evaluate(
        (key) =>
          !document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 's',
              [key]: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
        modifier,
      );
      expect(prevented).toBe(true);
      await expect(
        page.getByRole('heading', { name: 'Änderungsübersicht vor Speichern' }),
      ).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath('pending-dialog.png'), fullPage: true });
  } finally {
    release();
  }
  await expect(dialog).toBeHidden();
  expect(requests).toBe(1);
});
