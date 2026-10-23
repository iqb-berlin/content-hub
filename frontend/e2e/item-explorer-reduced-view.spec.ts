import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

const acpId = '10000000-0000-4000-8000-000000000101';
const managerId = '10000000-0000-4000-8000-000000000002';
const viewerId = '10000000-0000-4000-8000-000000000003';
const accessUrl = `/api/acp/${acpId}/access`;
const stateUrl = `/api/view/acp/${acpId}/item-explorer/state`;
const explorerUrl = `/view/${acpId}/item-explorer`;
const headers = { Authorization: `Bearer ${createOidcAppToken(managerId, 'e2e-manager')}` };
let originalAccess: Record<string, any>;
let originalViewerRole: Record<string, any> | undefined;
let originalPublishedOrder: string[];

async function configure(request: APIRequestContext, reduced: Record<string, unknown> | undefined) {
  const response = await request.put(accessUrl, {
    headers,
    data: {
      ...originalAccess,
      featureConfig: {
        ...originalAccess['featureConfig'],
        enablePersonalItemData: true,
        itemExplorerReducedView: reduced,
      },
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function open(page: Page, manager = false) {
  await installOidcSession(
    page,
    manager ? managerId : viewerId,
    manager ? 'e2e-manager' : 'e2e-viewer',
  );
  await page.goto(explorerUrl);
  await expect(page.locator('.explorer-table tbody tr')).toHaveCount(6);
}

async function patch(request: APIRequestContext) {
  const state = await (await request.get(stateUrl, { headers })).json();
  const response = await request.patch(`/api/acp/${acpId}/item-explorer/draft`, {
    headers,
    data: {
      baseVersion: state.version,
      changeType: 'UI_UPDATE',
      patch: { itemOrder: [...state.draftState.itemOrder, 'reduced-view-test'] },
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test.beforeEach(async ({ request }) => {
  const response = await request.get(accessUrl, { headers });
  expect(response.ok()).toBeTruthy();
  const roles = await (await request.get(`/api/acp/${acpId}/roles`, { headers })).json();
  originalViewerRole = roles.find((role: any) => role.userId === viewerId);
  const assigned = await request.post(`/api/acp/${acpId}/roles`, {
    headers,
    data: { userId: viewerId, role: 'READ_ONLY', capabilities: ['item-explorer:view'] },
  });
  expect(assigned.ok()).toBeTruthy();
  const state = await (await request.get(stateUrl, { headers })).json();
  originalPublishedOrder = [...state.publishedState.itemOrder];
  const access = await response.json();
  originalAccess = {
    accessModel: access.accessModel,
    allowRegistered: access.allowRegistered,
    featureConfig: access.featureConfig,
  };
});

test.afterEach(async ({ page, request }) => {
  await page.close();
  const state = await (await request.get(stateUrl, { headers })).json();
  const discard = await request.post(`/api/acp/${acpId}/item-explorer/draft/discard`, {
    headers,
    data: { baseVersion: state.version },
  });
  expect(discard.ok()).toBeTruthy();
  const clean = await discard.json();
  if (JSON.stringify(clean.publishedState.itemOrder) !== JSON.stringify(originalPublishedOrder)) {
    const reset = await request.patch(`/api/acp/${acpId}/item-explorer/draft`, {
      headers,
      data: {
        baseVersion: clean.version,
        changeType: 'ITEM_ORDER_CHANGED',
        patch: { itemOrder: originalPublishedOrder },
      },
    });
    expect(reset.ok()).toBeTruthy();
    const resetState = await reset.json();
    const published = await request.post(`/api/acp/${acpId}/item-explorer/draft/save`, {
      headers,
      data: { baseVersion: resetState.version },
    });
    expect(published.ok()).toBeTruthy();
  }
  const roleRestore = originalViewerRole
    ? await request.post(`/api/acp/${acpId}/roles`, {
        headers,
        data: {
          userId: viewerId,
          role: originalViewerRole['role'],
          capabilities: originalViewerRole['capabilities'],
        },
      })
    : await request.delete(`/api/acp/${acpId}/roles/${viewerId}`, { headers });
  expect(roleRestore.ok()).toBeTruthy();
  const restored = await request.put(accessUrl, { headers, data: originalAccess });
  expect(restored.ok()).toBeTruthy();
});

test('saves the reviewer view directly in access settings independently of publishing or discarding', async ({
  page,
  request,
  browser,
}) => {
  await configure(request, undefined);
  const draft = await patch(request);
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(`/manage/${acpId}/access`);
  const settings = page
    .locator('details')
    .filter({ has: page.locator('summary', { hasText: 'Reduzierte Ansicht des Item-Explorers' }) });
  await settings.locator('summary').click();
  await settings.getByRole('button', { name: 'Nur Tabelle', exact: true }).click();
  await expect(
    settings.getByRole('checkbox', { name: 'Reduzierte Ansicht aktivieren' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(page.getByText('✓ Gespeichert', { exact: true })).toBeVisible();
  const state = await (await request.get(stateUrl, { headers })).json();
  expect(state.publishedVersion).toBe(draft.publishedVersion);
  expect(state.version).toBe(draft.version);
  expect(state.status).toBe('DIRTY');

  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  try {
    await open(reviewer);
    await expect(reviewer.locator('.table-toolbar')).toHaveCount(0);
    await expect(reviewer.locator('.pane-right')).toHaveCount(0);
    const viewerHeaders = { Authorization: `Bearer ${createOidcAppToken(viewerId, 'e2e-viewer')}` };
    const denied = await request.put(accessUrl, { headers: viewerHeaders, data: originalAccess });
    expect(denied.status()).toBe(403);
    const deniedDraft = await request.patch(`/api/acp/${acpId}/item-explorer/draft`, {
      headers: viewerHeaders,
      data: { baseVersion: state.version, patch: { ui: {} } },
    });
    expect(deniedDraft.status()).toBe(403);
  } finally {
    await reviewerContext.close();
  }

  for (const operation of ['discard', 'save']) {
    const current = operation === 'save' ? await patch(request) : state;
    const response = await request.post(`/api/acp/${acpId}/item-explorer/draft/${operation}`, {
      headers,
      data: { baseVersion: current.version },
    });
    expect(response.ok()).toBeTruthy();
    const access = await (await request.get(accessUrl, { headers })).json();
    expect(access.featureConfig.itemExplorerReducedView).toMatchObject({
      enabled: true,
      showExplorerItemPanel: false,
    });
  }
});

test('retains the complete default view and all manager controls', async ({ page, request }) => {
  await configure(request, undefined);
  await open(page, true);
  await expect(page.getByRole('heading', { name: 'Item-Explorer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spalten verwalten', exact: true })).toBeVisible();
  await expect(page.locator('.table-toolbar')).toBeVisible();
  await expect(page.locator('.pane-right')).toBeVisible();
  await page.getByRole('button', { name: 'Leseansicht', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.table-toolbar')).toBeVisible();
  await expect(page.locator('.pane-right')).toBeVisible();
});

for (const setting of ['showTableToolbarArea', 'showItemInfo', 'showPlayerPreview']) {
  test(`hides only ${setting} while preserving table filters and essential controls`, async ({
    page,
    request,
  }, testInfo) => {
    await configure(request, { enabled: true, [setting]: false });
    await open(page);
    await page.locator('.explorer-table tbody tr').first().click();
    await expect(page.locator('.table-toolbar')).toHaveCount(
      setting === 'showTableToolbarArea' ? 0 : 1,
    );
    await expect(page.locator('.preview-target-info')).toHaveCount(
      setting === 'showItemInfo' ? 0 : 1,
    );
    await expect(page.locator('.player-container')).toHaveCount(
      setting === 'showPlayerPreview' ? 0 : 1,
    );
    await expect(page.getByRole('button', { name: 'Vollbild', exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Meine Eingaben (XLSX)', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.explorer-table .filter-row')).toBeVisible();
    await expect(page.locator('.pane-right')).toBeVisible();
    await testInfo.attach(setting, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

test('hides optional header actions without trapping managers in their preview', async ({
  page,
  request,
}) => {
  await configure(request, {
    enabled: true,
    headerActions: { columnManager: false, readonlyPreview: false },
  });
  await open(page, true);
  await expect(page.getByRole('button', { name: 'Spalten verwalten', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leseansicht', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Spalten verwalten', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vollbild', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Spalten verwalten', exact: true })).toBeVisible();
});

test('uses the full table area on desktop, narrow screens and fullscreen and restores the previous split', async ({
  page,
  request,
}, testInfo) => {
  await configure(request, {
    enabled: true,
    showHeader: false,
    showTableToolbarArea: false,
    showExplorerItemPanel: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, true);
  const divider = page.locator('.divider');
  const dividerBox = await divider.boundingBox();
  if (!dividerBox) throw new Error('Missing divider');
  await page.mouse.move(dividerBox.x + 4, dividerBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(dividerBox.x + 160, dividerBox.y + 20);
  await page.mouse.up();
  const previousWidth = await page
    .locator('.pane-left')
    .evaluate((el) => (el as HTMLElement).style.width);
  await page.getByRole('button', { name: 'Leseansicht', exact: true }).click();
  await expect(page.locator('.table-toolbar')).toHaveCount(0);
  await expect(page.locator('.pane-right')).toHaveCount(0);
  await expect(divider).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Item-Explorer', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Meine Eingaben (XLSX)', exact: true }),
  ).toBeVisible();

  async function verifyArea() {
    const bounds = await page.locator('.split-pane').evaluate((el) => {
      const table = el.querySelector('.table-scroll')!.getBoundingClientRect();
      const pane = el.getBoundingClientRect();
      return {
        width: Math.abs(table.width - pane.width),
        top: Math.abs(table.top - pane.top),
        bottom: Math.abs(table.bottom - pane.bottom),
      };
    });
    expect(bounds.width).toBeLessThanOrEqual(2);
    expect(bounds.top).toBeLessThanOrEqual(2);
    expect(bounds.bottom).toBeLessThanOrEqual(2);
  }
  await verifyArea();
  await page.locator('.table-scroll').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.explorer-table tbody tr[aria-selected="true"]')).toHaveCount(1);
  await testInfo.attach('table-only-desktop', {
    body: await page.screenshot({ path: testInfo.outputPath('table-only-desktop.png') }),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 600, height: 900 });
  await verifyArea();
  await testInfo.attach('table-only-narrow', {
    body: await page.screenshot({ path: testInfo.outputPath('table-only-narrow.png') }),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Vollbild', exact: true }).click();
  await expect(page.locator('.explorer-shell')).toHaveJSProperty('isConnected', true);
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await verifyArea();
  await testInfo.attach('table-only-fullscreen', {
    body: await page.screenshot({ path: testInfo.outputPath('table-only-fullscreen.png') }),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Vollbild beenden', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Bearbeitungsansicht', exact: true }).click();
  await expect(divider).toBeVisible();
  await expect(page.locator('.pane-left')).toHaveAttribute('style', `width: ${previousWidth};`);
  await expect(page.locator('.table-toolbar')).toBeVisible();
});
