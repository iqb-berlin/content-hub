import { expect, Page, test } from '@playwright/test';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

const ACP_ID = '10000000-0000-4000-8000-000000000001';
const MANAGER_ID = '10000000-0000-4000-8000-000000000002';
const MANAGER_USERNAME = 'e2e-manager';

async function publishExplorerDraft(page: Page): Promise<void> {
  const saveButton = page.getByRole('button', { name: 'Änderungen prüfen …', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(
    page.getByRole('heading', { name: 'Änderungsübersicht vor Speichern' }),
  ).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/item-explorer/draft/save') &&
        response.ok(),
    ),
    page.getByRole('button', { name: 'Veröffentlichen' }).click(),
  ]);
}

test('toggles manual sorting without discarding the edited item order', async ({
  page,
  request,
}) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  const headers = {
    Authorization: `Bearer ${createOidcAppToken(MANAGER_ID, MANAGER_USERNAME)}`,
  };
  const stateUrl = `/api/view/acp/${ACP_ID}/item-explorer/state`;
  const draftUrl = `/api/acp/${ACP_ID}/item-explorer/draft`;
  const originalResponse = await request.get(stateUrl, { headers });
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json();

  const change = async (action: () => Promise<unknown>) => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) => response.request().method() === 'PATCH' && response.url().endsWith(draftUrl),
      ),
      action(),
    ]);
    expect(response.ok()).toBeTruthy();
    return response.json();
  };

  try {
    const setup = await request.patch(draftUrl, {
      headers,
      data: {
        baseVersion: original.version,
        changeType: 'UI_STATE_CHANGED',
        patch: {
          ui: {
            filterText: '',
            columnFilters: {},
            sortField: 'unitLabel',
            sortDir: 'asc',
            sortIsMeta: false,
          },
        },
      },
    });
    expect(setup.ok()).toBeTruthy();
    await page.goto(`/view/${ACP_ID}/item-explorer`);
    const toggle = page.getByRole('button', { name: 'Manuell sortieren' });
    const idHeader = page.getByRole('columnheader', { name: /^Item-ID/ });
    const up = page.getByRole('button', { name: 'Ausgewähltes Item nach oben verschieben' });
    const down = page.getByRole('button', { name: 'Ausgewähltes Item nach unten verschieben' });
    const rows = page.locator('.explorer-table tbody tr');
    const rowIds = () => rows.evaluateAll((elements) => elements.map((element) => element.id));
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(up).toHaveCount(0);
    await expect(down).toHaveCount(0);

    await change(() => idHeader.click());
    await change(() => idHeader.click());
    await expect(idHeader).toContainText('↓');
    const descendingIds = await rowIds();

    await change(() => toggle.click());
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveCSS('font-weight', '700');
    await expect(up).toBeVisible();
    await expect(down).toBeVisible();
    await rows.first().click();
    await expect(up).toBeDisabled();
    await expect(down).toBeEnabled();
    const moved = await change(() => down.click());
    const manualIds = await rowIds();

    const restored = await change(() => toggle.click());
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(up).toHaveCount(0);
    await expect(down).toHaveCount(0);
    await expect(idHeader).toContainText('↓');
    expect(await rowIds()).toEqual(descendingIds);
    expect(restored.draftState.itemOrder).toEqual(moved.draftState.itemOrder);
    expect(restored.draftState.ui).toMatchObject({
      sortField: 'itemId',
      sortDir: 'desc',
      sortIsMeta: false,
    });

    await change(() => toggle.click());
    expect(await rowIds()).toEqual(manualIds);
    await rows.last().click();
    await expect(up).toBeEnabled();
    await expect(down).toBeDisabled();
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const fallback = await change(() => toggle.click());
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(up).toHaveCount(0);
    await expect(down).toHaveCount(0);
    expect(fallback.draftState.ui).toMatchObject({
      sortField: 'unitLabel',
      sortDir: 'asc',
      sortIsMeta: false,
    });
    expect(fallback.draftState.itemOrder).toEqual(moved.draftState.itemOrder);
  } finally {
    await page.close();
    const current = await request.get(stateUrl, { headers });
    expect(current.ok()).toBeTruthy();
    const cleanup = await request.patch(draftUrl, {
      headers,
      data: {
        baseVersion: (await current.json()).version,
        changeType: 'UI_STATE_CHANGED',
        patch: { ui: original.draftState.ui, itemOrder: original.draftState.itemOrder },
      },
    });
    expect(cleanup.ok()).toBeTruthy();
  }
});

test('shows a slow-connection hint while the Explorer item list is delayed', async ({ page }) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  await page.route('**/api/acp/*/files/item-list*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await route.continue();
  });

  await page.goto(`/view/${ACP_ID}/item-explorer`);

  const slowHint = page.getByText(/Das Laden dauert länger als erwartet/);
  await expect(slowHint).toBeVisible();
  await expect(page.locator('.item-list-loading')).toHaveAttribute('aria-live', 'polite');
  await expect(slowHint).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('tbody tr').first()).toBeVisible();
});

test('shows and clears the slow-connection hint for a delayed preview phase', async ({ page }) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  await page.route('**/api/acp/*/files/unit-view/*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await route.continue();
  });

  await page.goto(`/view/${ACP_ID}/item-explorer`);
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();

  const slowHint = page.getByText(/Aktuelle Phase:/);
  await expect(slowHint).toBeVisible();
  await expect(slowHint).toContainText('Aufgabendaten, Player und Definition');
  await expect(page.locator('.slow-load-hint')).toHaveAttribute('aria-live', 'polite');
  await expect(slowHint).toBeHidden({ timeout: 10_000 });
  await expect(page.locator('iframe.player-iframe')).toBeVisible();
});

test('reuses preview assets and requests only response state within one unit', async ({ page }) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);

  const requestCounts = {
    unitView: 0,
    responseState: 0,
    previewAssets: 0,
  };
  const sameUnitReuseRequests: Array<keyof typeof requestCounts> = [];
  let trackSameUnitReuse = false;
  page.on('request', (browserRequest) => {
    const pathname = new URL(browserRequest.url()).pathname;
    let requestType: keyof typeof requestCounts | null = null;
    if (pathname.includes('/files/unit-view/')) {
      requestType = 'unitView';
    } else if (pathname.endsWith('/response-state/with-fallback')) {
      requestType = 'responseState';
    } else if (/\/files\/[^/]+\/download$/.test(pathname)) {
      requestType = 'previewAssets';
    }
    if (!requestType) return;

    requestCounts[requestType] += 1;
    if (trackSameUnitReuse) sameUnitReuseRequests.push(requestType);
  });

  await page.goto(`/view/${ACP_ID}/item-explorer`);
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);

  await rows.nth(0).click();
  await expect.poll(() => requestCounts.unitView).toBe(1);
  await expect.poll(() => requestCounts.previewAssets).toBe(2);
  await expect.poll(() => requestCounts.responseState).toBe(1);
  await expect(page.locator('iframe.player-iframe')).toBeVisible();
  expect(requestCounts).toEqual({ unitView: 1, responseState: 1, previewAssets: 2 });

  trackSameUnitReuse = true;
  await rows.nth(1).click();
  await expect.poll(() => requestCounts.responseState).toBe(2);
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(requestCounts.unitView).toBe(1);
  expect(requestCounts.previewAssets).toBe(2);

  await rows.nth(0).click();
  await expect.poll(() => requestCounts.responseState).toBe(3);
  expect(requestCounts.unitView).toBe(1);
  expect(requestCounts.previewAssets).toBe(2);
  expect(sameUnitReuseRequests).toEqual(['responseState', 'responseState']);
});

test('imports booklet assignments without positions and retains known positions', async ({
  page,
  request,
}) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.getByRole('heading', { name: 'Item-Explorer' })).toBeVisible();

  const upload = async (content: string): Promise<void> => {
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().includes('/upload-item-parameters') &&
          response.ok(),
      ),
      page.locator('input[type="file"][accept=".csv"]').setInputFiles({
        name: 'booklets.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(content),
      }),
    ]);
    await expect(page.getByRole('heading', { name: 'Upload Bericht' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Booklet-Zuordnungen überspringen?' }),
    ).toBeHidden();
    await page.getByRole('button', { name: /Schließen/ }).click();
    await publishExplorerDraft(page);
  };

  await upload('item;booklet;position\ni1;B1;3\ni2;B2;4');
  await upload('item;booklet\ni1;B1\ni2;B3');

  const managerToken = await page.evaluate(() => localStorage.getItem('cp_token'));
  expect(managerToken).toBeTruthy();
  const itemListResponse = await request.get(`/api/acp/${ACP_ID}/files/item-list`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  expect(itemListResponse.ok()).toBeTruthy();
  const itemList = (await itemListResponse.json()) as {
    items: Array<{
      itemId: string;
      bookletOccurrences: Array<{ booklet: string; position: number | null }>;
    }>;
  };
  const item1 = itemList.items.find((item) => item.itemId === 'i1');
  const item2 = itemList.items.find((item) => item.itemId === 'i2');
  expect(item1?.bookletOccurrences).toEqual([{ booklet: 'B1', position: 3 }]);
  expect(item2?.bookletOccurrences).toEqual([{ booklet: 'B3', position: null }]);
});

test('paginates large personal collections and removes selections across pages', async ({
  page,
}) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);

  const collectionId = '20000000-0000-4000-8000-000000000001';
  const rowKeys = Array.from({ length: 51 }, (_, index) => `missing-row-${index + 1}`);
  const summary = {
    rowCount: rowKeys.length,
    itemCount: 0,
    unitCount: 0,
    itemTimeSeconds: 0,
    stimulusTimeSeconds: 0,
    testTimeSeconds: 0,
    missingItemTimeCount: 0,
    missingStimulusTimeUnitCount: 0,
    complete: true,
  };
  let removePayload: { removeRowKeys?: string[]; rowKeys?: string[] } | null = null;
  await page.route(`**/api/view/acp/${ACP_ID}/items/collections**`, async (route) => {
    const browserRequest = route.request();
    const pathname = new URL(browserRequest.url()).pathname;
    if (browserRequest.method() === 'GET' && pathname.endsWith('/items/collections')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          activeCollectionId: collectionId,
          collectionViewMode: 'all',
          collections: [
            {
              id: collectionId,
              name: 'Große Auswahlliste',
              rowKeys,
              version: 1,
              createdAt: '2026-07-22T10:00:00.000Z',
              updatedAt: '2026-07-22T10:00:00.000Z',
              unavailableRowKeys: rowKeys,
              summary,
            },
          ],
        }),
      });
      return;
    }
    if (browserRequest.method() === 'PATCH' && pathname.endsWith('/rows')) {
      removePayload = browserRequest.postDataJSON();
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          collectionId,
          version: 2,
          updatedAt: '2026-07-22T10:01:00.000Z',
          summary: { ...summary, rowCount: 49 },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await page.getByText('Liste verwalten ▾', { exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const collectionDialog = page.getByRole('dialog', { name: 'Große Auswahlliste' });
  await expect(collectionDialog.locator('.collection-table tbody tr')).toHaveCount(50);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await collectionDialog.evaluate((dialog) => {
    const containedSelectors = [
      '.collection-modal-header',
      '.collection-modal-toolbar',
      '.collection-modal-actions',
      '.collection-modal-footer',
    ];
    const dialogRect = dialog.getBoundingClientRect();
    return {
      dialogLeft: dialogRect.left,
      dialogRight: dialogRect.right,
      viewportWidth: window.innerWidth,
      children: containedSelectors.map((selector) => {
        const element = dialog.querySelector<HTMLElement>(selector)!;
        const rect = element.getBoundingClientRect();
        return {
          selector,
          left: rect.left,
          right: rect.right,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      }),
    };
  });
  expect(mobileLayout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.dialogRight).toBeLessThanOrEqual(mobileLayout.viewportWidth);
  for (const child of mobileLayout.children) {
    expect(child.left, `${child.selector} starts outside the dialog`).toBeGreaterThanOrEqual(
      mobileLayout.dialogLeft,
    );
    expect(child.right, `${child.selector} ends outside the dialog`).toBeLessThanOrEqual(
      mobileLayout.dialogRight,
    );
    expect(child.scrollWidth, `${child.selector} overflows horizontally`).toBeLessThanOrEqual(
      child.clientWidth,
    );
  }
  await expect(collectionDialog.getByRole('searchbox')).toBeInViewport();
  await expect(collectionDialog.getByRole('button', { name: 'CSV exportieren' })).toBeInViewport();
  await expect(
    collectionDialog.getByRole('button', { name: 'Auswahlliste löschen' }),
  ).toBeInViewport();
  await expect(
    collectionDialog.getByRole('button', { name: 'Details schließen' }),
  ).toBeInViewport();

  await collectionDialog.getByRole('checkbox', { name: 'Eintrag 1 auswählen' }).check();
  await collectionDialog.getByRole('button', { name: 'Weiter' }).click();
  await expect(collectionDialog.getByText('Seite 2 von 2')).toBeVisible();
  await expect(collectionDialog.locator('.collection-table tbody tr')).toHaveCount(1);
  await collectionDialog.getByRole('checkbox', { name: 'Eintrag 51 auswählen' }).check();
  await expect(collectionDialog.getByText('2 ausgewählt')).toBeVisible();

  await collectionDialog.getByRole('button', { name: 'Ausgewählte entfernen (2)' }).click();
  const confirmation = page.locator('.collection-remove-confirmation');
  await expect(confirmation).toContainText(
    '2 Einträge aus der Auswahlliste „Große Auswahlliste“ entfernen?',
  );
  const confirmRemovalButton = confirmation.getByRole('button', {
    name: 'Entfernen',
    exact: true,
  });
  await expect(confirmRemovalButton).toBeFocused();
  await confirmRemovalButton.click();

  await expect.poll(() => removePayload).not.toBeNull();
  expect(removePayload).toMatchObject({
    removeRowKeys: ['missing-row-1', 'missing-row-51'],
  });
  expect(removePayload?.rowKeys).toBeUndefined();
  await expect(collectionDialog.getByText('Seite 1 von 1')).toBeVisible();
  await expect(collectionDialog.locator('.collection-table tbody tr')).toHaveCount(49);
});

test('keeps collection management actions inside wide, narrow and mobile panels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  await page.goto(`/view/${ACP_ID}/item-explorer`);

  const trigger = page.getByText('Liste verwalten ▾', { exact: true });
  const menu = page.locator('.collection-management-actions');
  const panel = page.locator('.table-panel');
  const checkMenu = async () => {
    await trigger.click();
    await expect(menu).toBeVisible();
    const panelBox = await panel.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(panelBox!.x);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
    await menu.getByRole('button', { name: 'Neu', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Neue Auswahlliste' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  };

  await checkMenu();
  const divider = await page.locator('.divider').boundingBox();
  const splitPane = await page.locator('.split-pane').boundingBox();
  expect(divider).not.toBeNull();
  expect(splitPane).not.toBeNull();
  await page.mouse.move(divider!.x + divider!.width / 2, divider!.y + 20);
  await page.mouse.down();
  await page.mouse.move(splitPane!.x + 350, divider!.y + 20);
  await page.mouse.up();
  await expect(panel).toHaveCSS('width', '350px');
  await checkMenu();

  await page.setViewportSize({ width: 390, height: 844 });
  await checkMenu();
});

test('hides, persists, and restores the position column through column management', async ({
  page,
  request,
}) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  const headers = {
    Authorization: `Bearer ${createOidcAppToken(MANAGER_ID, MANAGER_USERNAME)}`,
  };
  const stateUrl = `/api/view/acp/${ACP_ID}/item-explorer/state`;
  const draftUrl = `/api/acp/${ACP_ID}/item-explorer/draft`;
  const originalResponse = await request.get(stateUrl, { headers });
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json();

  const saveColumnSettings = async () => {
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'PATCH' && candidate.url().endsWith(draftUrl),
      ),
      page
        .getByRole('button', { name: /Speichern/ })
        .last()
        .click(),
    ]);
    expect(response.ok()).toBeTruthy();
  };

  try {
    await page.goto(`/view/${ACP_ID}/item-explorer`);
    const positionHeader = page.getByRole('columnheader', { name: 'Pos.' });
    await expect(positionHeader).toBeVisible();
    await expect(page.locator('tbody tr td.number-col')).toHaveText(['1', '2']);

    await page.getByRole('button', { name: /Spalten verwalten/ }).click();
    const positionCheckbox = page.getByRole('checkbox', { name: 'Position', exact: true });
    await expect(positionCheckbox).toBeChecked();
    await positionCheckbox.uncheck();
    await saveColumnSettings();

    await expect(positionHeader).toHaveCount(0);
    await expect(page.locator('tbody tr td.number-col')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.getByRole('columnheader', { name: /^Item-ID/ })).toBeVisible();
    await expect(positionHeader).toHaveCount(0);

    const tableScroll = page.locator('.table-scroll');
    await tableScroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    await expect
      .poll(async () =>
        page.locator('table.explorer-table').evaluate((table) => {
          const itemId = Array.from(
            table.querySelectorAll<HTMLElement>('thead tr:first-child th'),
          ).find((header) => header.textContent?.trim().startsWith('Item-ID'));
          const selection = table.querySelector<HTMLElement>('thead th.collection-select-col');
          const scroller = table.closest<HTMLElement>('.table-scroll');
          if (!itemId || !scroller) throw new Error('Leading table cells are missing');
          return Math.abs(
            itemId.getBoundingClientRect().left -
              (selection?.getBoundingClientRect().right ?? scroller.getBoundingClientRect().left),
          );
        }),
      )
      .toBeLessThanOrEqual(1);

    await page.getByRole('button', { name: /Spalten verwalten/ }).click();
    await expect(positionCheckbox).not.toBeChecked();
    await page.getByRole('button', { name: /Standard/ }).click();
    await expect(positionCheckbox).toBeChecked();
    await saveColumnSettings();

    await expect(positionHeader).toBeVisible();
    await expect(page.locator('tbody tr td.number-col')).toHaveText(['1', '2']);
  } finally {
    await page.close();
    const current = await request.get(stateUrl, { headers });
    expect(current.ok()).toBeTruthy();
    const cleanup = await request.patch(draftUrl, {
      headers,
      data: {
        baseVersion: (await current.json()).version,
        changeType: 'METADATA_COLUMNS_CHANGED',
        patch: { metadataColumns: original.draftState.metadataColumns },
      },
    });
    expect(cleanup.ok()).toBeTruthy();
  }
});

test('normalizes legacy VOMD time columns without duplicating or rewriting the draft', async ({
  page,
  request,
}) => {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  const headers = {
    Authorization: `Bearer ${createOidcAppToken(MANAGER_ID, MANAGER_USERNAME)}`,
  };
  const stateUrl = `/api/view/acp/${ACP_ID}/item-explorer/state`;
  const draftUrl = `/api/acp/${ACP_ID}/item-explorer/draft`;
  const originalResponse = await request.get(stateUrl, { headers });
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json();

  try {
    const setup = await request.patch(draftUrl, {
      headers,
      data: {
        baseVersion: original.version,
        changeType: 'METADATA_COLUMNS_CHANGED',
        patch: {
          ui: {
            ...original.draftState.ui,
            columnFilters: {},
            sortField: 'iqb_item_time',
            sortDir: 'desc',
            sortIsMeta: true,
          },
          metadataColumns: {
            visible: ['iqb_item_time', 'iqb_time_stimulus'],
            order: ['iqb_item_time', 'iqb_time_stimulus'],
            configured: true,
            widths: { iqb_item_time: 180, iqb_time_stimulus: 190 },
            layout: {
              configured: true,
              visible: ['system:itemId', 'metadata:iqb_item_time', 'metadata:iqb_time_stimulus'],
              order: ['system:itemId', 'metadata:iqb_item_time', 'metadata:iqb_time_stimulus'],
              widths: {
                'metadata:iqb_item_time': 180,
                'metadata:iqb_time_stimulus': 190,
              },
              schemaVersion: 3,
            },
          },
        },
      },
    });
    expect(setup.ok()).toBeTruthy();

    await page.route(`**/api/acp/${ACP_ID}/files/item-list*`, async (route) => {
      const response = await route.fetch();
      const itemList = await response.json();
      itemList.columns = [
        ...(itemList.columns || []),
        { id: 'iqb_item_time', label: 'Itemzeit' },
        { id: 'iqb_time_stimulus', label: 'Stimuluszeit' },
      ];
      itemList.items = itemList.items.map((item: Record<string, unknown>, index: number) => ({
        ...item,
        metadata: {
          ...((item['metadata'] as Record<string, string>) || {}),
          iqb_item_time: index === 0 ? '00:30' : '00:45',
          iqb_time_stimulus: '00:20',
        },
        itemTimeSeconds: index === 0 ? 30 : 45,
        stimulusTimeSeconds: 20,
      }));
      await route.fulfill({ response, json: itemList });
    });

    let draftPatchCount = 0;
    page.on('request', (browserRequest) => {
      if (
        browserRequest.method() === 'PATCH' &&
        new URL(browserRequest.url()).pathname.endsWith(draftUrl)
      ) {
        draftPatchCount += 1;
      }
    });
    await page.goto(`/view/${ACP_ID}/item-explorer`);

    const itemTimeHeader = page.getByRole('columnheader', { name: /^Itemzeit \(s\)/ });
    const stimulusTimeHeader = page.getByRole('columnheader', { name: /^Stimuluszeit \(s\)/ });
    await expect(itemTimeHeader).toHaveCount(1);
    await expect(stimulusTimeHeader).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: /^Itemzeit$/ })).toHaveCount(0);

    const table = page.locator('table.explorer-table');
    const itemTimeIndex = await table
      .locator('thead tr:first-child th')
      .evaluateAll((elements) =>
        elements.findIndex((element) => element.textContent?.trim().startsWith('Itemzeit (s)')),
      );
    const stimulusTimeIndex = await table
      .locator('thead tr:first-child th')
      .evaluateAll((elements) =>
        elements.findIndex((element) => element.textContent?.trim().startsWith('Stimuluszeit (s)')),
      );
    expect(itemTimeIndex).toBeGreaterThanOrEqual(0);
    expect(stimulusTimeIndex).toBeGreaterThanOrEqual(0);
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('td').nth(itemTimeIndex)).toHaveText('45');
    await expect(rows.nth(1).locator('td').nth(itemTimeIndex)).toHaveText('30');
    await expect(rows.nth(0).locator('td').nth(stimulusTimeIndex)).toHaveText('20');

    await page.reload();
    await expect(itemTimeHeader).toHaveCount(1);
    await expect(stimulusTimeHeader).toHaveCount(1);
    await expect(rows.nth(0).locator('td').nth(itemTimeIndex)).toHaveText('45');
    expect(draftPatchCount).toBe(0);
  } finally {
    await page.close();
    const current = await request.get(stateUrl, { headers });
    expect(current.ok()).toBeTruthy();
    const cleanup = await request.patch(draftUrl, {
      headers,
      data: {
        baseVersion: (await current.json()).version,
        changeType: 'METADATA_COLUMNS_CHANGED',
        patch: {
          ui: original.draftState.ui,
          metadataColumns: original.draftState.metadataColumns,
        },
      },
    });
    expect(cleanup.ok()).toBeTruthy();
  }
});

test('keeps positions gapless and persists the personal selection view across perspectives', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);

  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.getByRole('columnheader', { name: 'Pos.' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /Referenz-Nr/ })).toBeHidden();
  await expect(page.locator('tbody tr td.number-col')).toHaveText(['1', '2']);

  await page.getByText('Weitere Aktionen ▾', { exact: true }).click();
  await page.getByRole('button', { name: /Referenznummern neu vergeben/ }).click();
  await expect(page.getByRole('heading', { name: 'Referenznummern neu vergeben' })).toBeVisible();
  await expect(page.getByText(/Alle 2 Zeilen des vollständigen Itembestands/)).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/item-list/renumber') &&
        response.ok(),
    ),
    page.getByRole('button', { name: 'Referenznummern neu vergeben', exact: true }).last().click(),
  ]);
  await expect(page.getByText(/2 Referenznummern im vollständigen Itembestand/)).toBeVisible();

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  await page.getByRole('checkbox', { name: 'Referenz-Nr.' }).check();
  await page
    .getByRole('button', { name: /Speichern/ })
    .last()
    .click();
  await expect(page.getByRole('columnheader', { name: /Referenz-Nr/ })).toBeVisible();
  await expect(page.locator('tbody tr td.reference-number-col')).toHaveText(['1', '2']);

  const tableScroll = page.locator('.table-scroll');
  await tableScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const [selectionBox, positionBox, referenceBox, itemIdBox] = await Promise.all([
    page.getByTitle('Zur aktiven Auswahlliste hinzufügen').boundingBox(),
    page.getByRole('columnheader', { name: 'Pos.' }).boundingBox(),
    page.getByRole('columnheader', { name: /Referenz-Nr/ }).boundingBox(),
    page.getByRole('columnheader', { name: /Item-ID/ }).boundingBox(),
  ]);
  expect(selectionBox).not.toBeNull();
  expect(positionBox).not.toBeNull();
  expect(referenceBox).not.toBeNull();
  expect(itemIdBox).not.toBeNull();
  expect(selectionBox!.x + selectionBox!.width).toBeLessThanOrEqual(positionBox!.x + 1);
  expect(positionBox!.x + positionBox!.width).toBeLessThanOrEqual(referenceBox!.x + 1);
  expect(referenceBox!.x + referenceBox!.width).toBeLessThanOrEqual(itemIdBox!.x + 1);

  await page.getByText('Liste verwalten ▾', { exact: true }).click();
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/items/collections') &&
        response.ok(),
    ),
    page.getByRole('button', { name: 'Anlegen', exact: true }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'Nur Auswahlliste (0)' })).toBeEnabled();

  const itemSelection = page.getByRole('checkbox', { name: /in Auswahlliste auswählen/ }).first();
  await expect(itemSelection).toBeVisible();
  await expect(itemSelection).toBeEnabled();
  const scrollLeftBeforeSelection = await tableScroll.evaluate((element) => element.scrollLeft);
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/items/collections/') &&
        response.ok(),
    ),
    itemSelection.check(),
  ]);
  expect(await tableScroll.evaluate((element) => element.scrollLeft)).toBe(
    scrollLeftBeforeSelection,
  );
  const activeOnlyButton = page.getByRole('button', { name: 'Nur Auswahlliste (1)' });

  await page.getByText('Liste verwalten ▾', { exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  const collectionDialog = page.getByRole('dialog', { name: 'Meine Auswahlliste' });
  await expect(collectionDialog).toBeVisible();
  const collectionSearch = collectionDialog.getByRole('searchbox', {
    name: 'Einträge der Auswahlliste durchsuchen',
  });
  await expect(collectionSearch).toBeFocused();
  await collectionSearch.fill('ohne-treffer');
  await expect(collectionDialog.getByText('Keine passenden Einträge.')).toBeVisible();
  await collectionSearch.clear();
  await collectionDialog.getByRole('checkbox', { name: 'Eintrag 1 auswählen' }).check();
  await collectionDialog.getByRole('button', { name: 'Ausgewählte entfernen (1)' }).click();
  const [removeResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith('/rows') &&
        response.ok(),
    ),
    page
      .locator('.collection-remove-confirmation')
      .getByRole('button', { name: 'Entfernen', exact: true })
      .click(),
  ]);
  const removePayload = removeResponse.request().postDataJSON();
  expect(removePayload.removeRowKeys).toHaveLength(1);
  expect(removePayload.rowKeys).toBeUndefined();
  await expect(page.getByRole('button', { name: 'Nur Auswahlliste (0)' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(collectionDialog).toBeHidden();
  await expect(page.getByText('Liste verwalten ▾', { exact: true })).toBeFocused();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith('/rows') &&
        response.ok(),
    ),
    page
      .getByRole('checkbox', { name: /in Auswahlliste auswählen/ })
      .first()
      .check(),
  ]);

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().endsWith('/items/collections/active') &&
        response.ok(),
    ),
    activeOnlyButton.click(),
  ]);
  await expect(page.locator('tbody tr')).toHaveCount(1);

  await page.reload();
  const activeCollectionFilter = page.getByRole('button', { name: 'Nur Auswahlliste (1)' });
  const allItemsFilter = page.getByRole('button', { name: 'Alle Items' });
  await expect(activeCollectionFilter).toHaveAttribute('aria-pressed', 'true');
  await expect(activeCollectionFilter).toHaveCSS('font-weight', '700');
  await expect(allItemsFilter).toHaveAttribute('aria-pressed', 'false');
  await expect(allItemsFilter).not.toHaveCSS('font-weight', '700');
  await expect(page.locator('tbody tr')).toHaveCount(1);

  const editingViewButton = page.getByRole('button', { name: 'Bearbeitungsansicht' });
  if (await editingViewButton.isVisible()) {
    await editingViewButton.click();
  }
  const readOnlyPreviewButton = page.getByRole('button', { name: 'Leseansicht' });
  await expect(readOnlyPreviewButton).toBeVisible();
  await readOnlyPreviewButton.click();
  await expect(page.getByRole('button', { name: 'Bearbeitungsansicht' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nur Auswahlliste (1)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('tbody tr')).toHaveCount(1);

  await allItemsFilter.click();
  await expect(allItemsFilter).toHaveCSS('font-weight', '700');
  await expect(activeCollectionFilter).not.toHaveCSS('font-weight', '700');
  await expect(page.locator('tbody tr')).toHaveCount(2);

  await page.getByRole('button', { name: 'Bearbeitungsansicht' }).click();
  const discardButton = page.getByRole('button', { name: /Verwerfen/ }).first();
  await expect(discardButton).toBeEnabled();
  await discardButton.click();
  await page.getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: /Referenz-Nr/ })).toBeHidden();
});
