import { expect, Page, test } from '@playwright/test';
import { installOidcSession } from './oidc-test-session';

const ACP_ID = '10000000-0000-4000-8000-000000000101';
const MANAGER_ID = '10000000-0000-4000-8000-000000000002';
const MANAGER_USERNAME = 'e2e-manager';

const rowIds = {
  direct: '#item-explorer-row-regression-item-uuid-1',
  fallback: '#item-explorer-row-regression-item-uuid-2',
  partialA: '#item-explorer-row-regression-item-uuid-3--A',
  partialB: '#item-explorer-row-regression-item-uuid-3--B',
  legacy: '#item-explorer-row-regression-item-uuid-4',
  secondUnit: '#item-explorer-row-regression-item-uuid-5',
};

test.describe.configure({ mode: 'serial' });

async function loginAsManager(page: Page): Promise<void> {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
}

async function openExplorer(page: Page): Promise<void> {
  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.getByRole('heading', { name: 'Item-Explorer' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(6);
}

async function selectAndReadResponseState(
  page: Page,
  rowSelector: string,
  itemId: string,
): Promise<any> {
  const responsePromise = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return (
      response.request().method() === 'POST' &&
      pathname.endsWith(`/items/${itemId}/response-state/with-fallback`) &&
      response.ok()
    );
  });
  await page.locator(rowSelector).click();
  const response = await responsePromise;
  await expect(page.locator(rowSelector)).toHaveAttribute('aria-selected', 'true');
  return response.json();
}

test('loads direct, fallback, partial-credit and legacy response states through the UI', async ({
  page,
}) => {
  await loginAsManager(page);
  await openExplorer(page);

  const direct = await selectAndReadResponseState(page, rowIds.direct, 'i1');
  expect(direct).toMatchObject({
    isFallback: false,
    state: { responseData: { marker: 'direct-i1' } },
  });
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i1',
  );

  const fallback = await selectAndReadResponseState(page, rowIds.fallback, 'i2');
  expect(fallback).toMatchObject({
    isFallback: true,
    fallbackItemId: 'i1',
    state: { responseData: { marker: 'direct-i1' } },
  });

  const partial = await selectAndReadResponseState(page, rowIds.partialA, 'i3');
  expect(partial).toMatchObject({
    isFallback: false,
    state: {
      rowKey: 'regression-item-uuid-3::A',
      responseData: { marker: 'partial-i3-A' },
    },
  });
  await expect(page.locator(rowIds.partialA)).toContainText('Basis');
  await expect(page.locator(rowIds.partialB)).toContainText('Erweitert');

  const legacy = await selectAndReadResponseState(page, rowIds.legacy, 'i4');
  expect(legacy).toMatchObject({
    isFallback: false,
    state: {
      rowKey: 'u1::i4',
      responseData: { marker: 'legacy-i4' },
    },
  });

  await page.getByText('Weitere Aktionen ▾', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Player-Eingaben speichern …', exact: true }).click();
  const saveDialog = page
    .getByRole('heading', { name: 'Zustand speichern' })
    .locator('xpath=ancestor::div[contains(@class, "overlay-dialog")]');
  await expect(saveDialog).toBeVisible();
  await expect(saveDialog).not.toContainText('Kein Zustand zum Speichern');
  await saveDialog.getByRole('button', { name: 'Abbrechen' }).click();
});

test('cancels stale selections during a rapid unit switch', async ({ page }) => {
  await loginAsManager(page);
  await page.route(`**/api/acp/${ACP_ID}/files/unit-view/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/unit-view/u1')) {
      await new Promise((resolve) => setTimeout(resolve, 2400));
    }
    try {
      await route.continue();
    } catch {
      // An aborted stale request is an expected switchMap outcome.
    }
  });
  await openExplorer(page);

  const firstUnitRequest = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith('/unit-view/u1'),
  );
  await page.locator(rowIds.direct).click();
  await firstUnitRequest;
  await expect(page.locator('.slow-load-hint')).toBeVisible();

  const secondUnitResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/unit-view/u2'),
  );
  await page.locator(rowIds.secondUnit).click();
  await secondUnitResponse;
  await expect(page.locator('.slow-load-hint')).toBeHidden();
  await expect(page.locator(rowIds.secondUnit)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i5',
  );

  await page.waitForTimeout(1000);
  await expect(page.locator(rowIds.secondUnit)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i5',
  );
});

test('does not retain unit-view or asset failures and recovers on retry', async ({ page }) => {
  await loginAsManager(page);
  let failUnitView = true;
  let firstUnitRequests = 0;
  await page.route(`**/api/acp/${ACP_ID}/files/unit-view/u1*`, async (route) => {
    firstUnitRequests += 1;
    if (failUnitView) {
      await new Promise((resolve) => setTimeout(resolve, 2400));
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Synthetic unit-view failure' }),
      });
      return;
    }
    await route.continue();
  });
  await openExplorer(page);

  await page.locator(rowIds.direct).click();
  await expect(page.locator('.slow-load-hint')).toBeVisible();
  await expect(
    page
      .locator('.player-container .empty-state')
      .getByText('Die Aufgaben-Vorschau konnte nicht geladen werden.'),
  ).toBeVisible();
  await expect(page.locator('.slow-load-hint')).toBeHidden();
  await expect(page.locator('iframe.player-iframe')).toHaveCount(0);

  failUnitView = false;
  await page.locator(rowIds.secondUnit).click();
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i5',
  );
  await page.locator(rowIds.direct).click();
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i1',
  );
  expect(firstUnitRequests).toBe(2);

  let failAssets = true;
  let failedAssetRequests = 0;
  await page.route(`**/api/acp/${ACP_ID}/files/*/download*`, async (route) => {
    if (failAssets) {
      failedAssetRequests += 1;
      await route.fulfill({ status: 503, body: 'Synthetic asset failure' });
      return;
    }
    await route.continue();
  });

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await page.locator(rowIds.direct).click();
  await expect(
    page
      .locator('.player-container .empty-state')
      .getByText('Die Aufgaben-Vorschau konnte nicht geladen werden.'),
  ).toBeVisible();
  expect(failedAssetRequests).toBeGreaterThan(0);

  failAssets = false;
  await page.locator(rowIds.secondUnit).click();
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i5',
  );
  await page.locator(rowIds.direct).click();
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i1',
  );
});

test('records every documented browser performance phase', async ({ page }, testInfo) => {
  const diagnosticPhases = new Set<string>();
  page.on('console', async (message) => {
    if (message.type() !== 'debug' || !message.text().includes('[ItemExplorer performance]')) {
      return;
    }
    const args = message.args();
    if (args.length < 2) return;
    const detail = (await args[1].jsonValue()) as { phase?: string };
    if (detail.phase) diagnosticPhases.add(detail.phase);
  });
  await page.addInitScript(() => {
    localStorage.setItem('cp.itemExplorer.performance', '1');
  });
  await loginAsManager(page);
  await openExplorer(page);

  await selectAndReadResponseState(page, rowIds.direct, 'i1');
  await expect(page.locator('iframe.player-iframe')).toBeVisible();
  await selectAndReadResponseState(page, rowIds.fallback, 'i2');
  await selectAndReadResponseState(page, rowIds.secondUnit, 'i5');
  await expect(page.locator('iframe.player-iframe')).toHaveAttribute(
    'title',
    'Player-Vorschau für Item i5',
  );

  const measures = await page.evaluate(() =>
    performance
      .getEntriesByType('measure')
      .filter((entry) => entry.name.startsWith('item-explorer:'))
      .map((entry) => ({ name: entry.name, duration: entry.duration })),
  );
  const measureNames = new Set(measures.map((entry) => entry.name));
  for (const phase of [
    'item-list',
    'item-selection-total',
    'unit-view',
    'response-state',
    'player-html',
    'definition',
    'player-ready',
  ]) {
    expect(measureNames).toContain(`item-explorer:${phase}`);
    expect(diagnosticPhases).toContain(phase);
  }
  expect(measures.every((entry) => Number.isFinite(entry.duration) && entry.duration >= 0)).toBe(
    true,
  );
  await testInfo.attach('browser-performance-measures', {
    body: JSON.stringify(measures, null, 2),
    contentType: 'application/json',
  });
});

test('renders the preview without document overflow on desktop and narrow screens', async ({
  page,
}) => {
  await loginAsManager(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openExplorer(page);
  await selectAndReadResponseState(page, rowIds.direct, 'i1');
  await expect(page.locator('iframe.player-iframe')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
  await page.screenshot({
    path: '/tmp/content-pool-item-explorer-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.preview-panel')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
  const previewBounds = await page.locator('.preview-panel').boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(previewBounds!.x).toBeGreaterThanOrEqual(0);
  expect(previewBounds!.x + previewBounds!.width).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: '/tmp/content-pool-item-explorer-mobile.png',
    fullPage: true,
  });
});

test('keeps coding, draft, published and read-only perspectives functional', async ({ page }) => {
  await loginAsManager(page);
  await openExplorer(page);
  await expect(page.locator('.table-panel .player-target-badge')).toHaveCount(0);
  await selectAndReadResponseState(page, rowIds.direct, 'i1');
  await expect(page.locator('iframe.player-iframe')).toBeVisible();

  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  const codingDialog = page.getByRole('heading', { name: /Kodierung – Regression Aufgabe 1/ });
  await expect(codingDialog).toBeVisible();
  const codingFocus = page.getByTestId('coding-variable-focus');
  await expect(codingFocus).toContainText('Kodierung für Item');
  await expect(codingFocus).not.toContainText('Interne Kodier-ID');
  await expect(codingFocus).not.toContainText('Player-/Anzeige-Ziel');
  await expect(page.getByRole('heading', { name: 'Kodiervariable V1' })).toBeVisible();
  await expect(page.getByText('Bezeichnung: Direkte Antwort', { exact: true })).toBeVisible();
  await expect(page.getByText('Richtig')).toBeVisible();
  await page.getByRole('button', { name: /Schließen/ }).click();

  const patchResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
      response.ok(),
  );
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page.getByText('Zuordnung korrigieren …', { exact: true }).click();
  await page.getByLabel('Manuelles Sprungziel').fill('V2');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await patchResponse;
  await expect(page.getByText(/Manueller Override aktiv:/)).toContainText('V2');

  const readOnlyList = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/acp/${ACP_ID}/files/item-list`) &&
      response.url().includes('perspective=read-only') &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await readOnlyList;
  await expect(page.getByText('Leseansicht aktiv.')).toBeVisible();
  await expect(page.getByText(/unveröffentlichter Explorer-Entwurf/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Itemparameter/ })).toHaveCount(0);

  const editorList = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith(`/api/acp/${ACP_ID}/files/item-list`) &&
      !url.searchParams.has('perspective') &&
      response.ok()
    );
  });
  await page.getByRole('button', { name: 'Bearbeitungsansicht' }).click();
  await editorList;
  await expect(page.locator(rowIds.direct)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/Manueller Override aktiv:/)).toContainText('V2');

  const saveButton = page.getByRole('button', { name: 'Änderungen prüfen …', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(
    page.getByRole('heading', { name: 'Änderungsübersicht vor Speichern' }),
  ).toBeVisible();
  const publishResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft/save`) &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await publishResponse;
  await expect(page.locator('.status-pill')).toContainText(/Gespeichert|Unverändert/);

  const publishedReadOnlyList = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/acp/${ACP_ID}/files/item-list`) &&
      response.url().includes('perspective=read-only') &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await publishedReadOnlyList;
  await expect(page.getByText('Leseansicht aktiv.')).toBeVisible();
  await expect(page.getByText(/unveröffentlichter Explorer-Entwurf/)).toHaveCount(0);
  await expect(page.locator('iframe.player-iframe')).toBeVisible();
});

test('edits, saves, reloads and deletes current-session player answers', async ({ page }) => {
  await loginAsManager(page);
  await openExplorer(page);
  await selectAndReadResponseState(page, rowIds.legacy, 'i4');
  const answer = page.frameLocator('iframe.player-iframe').getByLabel('Testantwort');
  await answer.fill('Neue Antwort aus der aktiven Sitzung');
  await page.getByText('Weitere Aktionen ▾', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Player-Eingaben speichern …', exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/items/i4/response-state') &&
      response.ok(),
  );
  await page.getByRole('button', { name: '💾 Speichern', exact: true }).click();
  const saveResponse = await saved;
  expect(saveResponse.request().postDataJSON().responseData.answer).toBe(
    'Neue Antwort aus der aktiven Sitzung',
  );
  await page.reload();
  await selectAndReadResponseState(page, rowIds.legacy, 'i4');
  await expect(answer).toHaveValue('Neue Antwort aus der aktiven Sitzung');
  await page.getByText('Weitere Aktionen ▾', { exact: true }).last().click();
  await page
    .getByRole('button', { name: 'Gespeicherte Player-Eingaben löschen …', exact: true })
    .click();
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.endsWith('/items/i4/response-state') &&
      response.ok(),
  );
  await page
    .getByRole('button', { name: /Löschen/, exact: false })
    .last()
    .click();
  await deleted;
  await page.reload();
  const state = await selectAndReadResponseState(page, rowIds.legacy, 'i4');
  expect(state.state?.responseData?.answer).toBeUndefined();
});
