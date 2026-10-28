import { expect, Page, test } from '@playwright/test';
import { installOidcSession } from './oidc-test-session';

const ACP_ID = '10000000-0000-4000-8000-000000000201';
const MANAGER_ID = '10000000-0000-4000-8000-000000000002';
const MANAGER_USERNAME = 'e2e-manager';
const VIEWER_ID = '10000000-0000-4000-8000-000000000003';
const VIEWER_USERNAME = 'e2e-viewer';

test.describe.configure({ mode: 'serial' });

async function login(page: Page, userId: string, username: string): Promise<void> {
  await installOidcSession(page, userId, username);
}

async function openExplorer(page: Page): Promise<void> {
  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.getByRole('heading', { name: 'Item-Explorer' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
}

async function saveFeatureConfig(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(page.getByText('✓ Gespeichert').last()).toBeVisible();
}

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
        response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft/save`) &&
        response.ok(),
    ),
    page.getByRole('button', { name: 'Veröffentlichen' }).click(),
  ]);
}

test('shares item comments and replies directly in the selected Item Explorer preview', async ({
  page,
  browser,
}) => {
  await login(page, MANAGER_ID, MANAGER_USERNAME);
  await page.goto(`/view/${ACP_ID}`);
  await expect(page.getByRole('button', { name: 'Kommentar hinzufügen' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Kommentare', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Item-Liste', exact: true })).toHaveCount(0);
  await Promise.all([
    page.waitForURL(`**/view/${ACP_ID}/item-explorer`),
    page
      .getByRole('link', {
        name: 'Item-Explorer Items prüfen, kommentieren und bearbeiten',
        exact: true,
      })
      .click(),
  ]);
  await expect(
    page.getByRole('heading', { name: 'Item-Explorer', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('tbody tr').first().click();

  await page.getByRole('button', { name: /Kommentare \(0\)/ }).click();
  const panel = page.getByRole('region', { name: 'Kommentare zum ausgewählten Item' });
  await expect(panel).toContainText('Geteilt');
  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();
  await login(observer, VIEWER_ID, VIEWER_USERNAME);
  await observer.goto(page.url());
  await expect(observer.locator('tbody tr')).toHaveCount(2);
  await observer.locator('tbody tr').first().click();
  await observer.getByRole('button', { name: /Kommentare \(0\)/ }).click();
  const observerPanel = observer.getByRole('region', { name: 'Kommentare zum ausgewählten Item' });
  await observerPanel
    .getByPlaceholder('Kommentar zu diesem Item …')
    .fill('Ungespeicherter Entwurf');

  await panel.getByPlaceholder('Kommentar zu diesem Item …').fill('E2E Hauptkommentar');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/review/comments`) &&
        response.ok(),
    ),
    panel.getByRole('button', { name: 'Kommentieren' }).click(),
  ]);
  await expect(panel.getByText('E2E Hauptkommentar')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(1);
  await expect(page.locator('tbody tr').first().getByLabel('1 Kommentar')).toBeVisible();
  await expect(observerPanel.getByText('E2E Hauptkommentar', { exact: true })).toBeVisible();
  await expect(observer.locator('tbody tr').first().getByLabel('1 Kommentar')).toBeVisible();

  await panel.getByRole('button', { name: 'Bearbeiten' }).click();
  await panel.locator('.edit-form textarea').fill('E2E Hauptkommentar geändert');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes(`/api/acp/${ACP_ID}/review/comments/`) &&
        response.ok(),
    ),
    panel.locator('.edit-form').getByRole('button', { name: 'Speichern' }).click(),
  ]);
  await expect(panel.getByText('E2E Hauptkommentar geändert')).toBeVisible();
  await expect(panel.locator('.edited-label')).toContainText('geändert');
  await expect(
    observerPanel.getByText('E2E Hauptkommentar geändert', { exact: true }),
  ).toBeVisible();
  await expect(observerPanel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue(
    'Ungespeicherter Entwurf',
  );
  await panel
    .getByPlaceholder('Kommentar zu diesem Item …')
    .fill('Automatisch entfernten Kommentar prüfen');
  await panel.getByRole('button', { name: 'Kommentieren', exact: true }).click();
  await expect(
    observerPanel.getByText('Automatisch entfernten Kommentar prüfen', { exact: true }),
  ).toBeVisible();
  const temporaryComment = panel
    .locator('.comment-card')
    .filter({ hasText: 'Automatisch entfernten Kommentar prüfen' });
  page.once('dialog', (dialog) => dialog.accept());
  await temporaryComment.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(
    observerPanel.getByText('Automatisch entfernten Kommentar prüfen', { exact: true }),
  ).toHaveCount(0);
  await expect(observer.locator('tbody tr').first().getByLabel('1 Kommentar')).toBeVisible();
  await expect(observerPanel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue(
    'Ungespeicherter Entwurf',
  );
  await observerContext.close();

  const firstTargetLabel = await panel.locator('.comment-panel-header strong').innerText();
  const firstItemId = firstTargetLabel.split('·').at(-1)?.trim() || '';
  expect(firstItemId).not.toBe('');
  const newCommentInput = panel.getByPlaceholder('Kommentar zu diesem Item …');
  await newCommentInput.fill('Entwurf für Item 1');
  await page.locator('tbody tr').nth(1).click();
  await expect(page.locator('tbody tr').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('.comment-panel-header strong')).not.toHaveText(firstTargetLabel);
  await newCommentInput.fill('Entwurf für Item 2');
  await page.locator('tbody tr').first().click();
  await expect(panel.locator('.comment-panel-header strong')).toHaveText(firstTargetLabel);
  await expect(newCommentInput).toHaveValue('Entwurf für Item 1');
  await newCommentInput.fill('');

  await login(page, VIEWER_ID, VIEWER_USERNAME);
  await openExplorer(page);

  let releaseDelayedThread!: () => void;
  const delayedThread = new Promise<void>((resolve) => {
    releaseDelayedThread = resolve;
  });
  let itemOneDelayed = false;
  await page.route(`**/api/acp/${ACP_ID}/review/comments?*`, async (route) => {
    const itemId = new URL(route.request().url()).searchParams.get('itemId') || '';
    if (!itemOneDelayed && itemId === firstItemId) {
      itemOneDelayed = true;
      await delayedThread;
    }
    await route.continue();
  });
  const delayedRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname.endsWith(`/api/acp/${ACP_ID}/review/comments`) &&
      url.searchParams.get('itemId') === firstItemId
    );
  });
  await page.locator('tbody tr').first().click();
  await delayedRequest;
  await page.locator('tbody tr').nth(1).click();
  await expect(page.locator('tbody tr').nth(1)).toHaveAttribute('aria-selected', 'true');
  releaseDelayedThread();
  await expect(page.getByRole('button', { name: /Kommentare \(0\)/ })).toBeVisible();

  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: /Kommentare \(1\)/ }).click();
  const viewerPanel = page.getByRole('region', {
    name: 'Kommentare zum ausgewählten Item',
  });
  await expect(viewerPanel.getByText('E2E Hauptkommentar geändert')).toBeVisible();
  await expect(viewerPanel.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
  await viewerPanel.getByRole('button', { name: 'Antworten', exact: true }).click();
  await viewerPanel.getByPlaceholder('Antwort schreiben …').fill('E2E Antwort');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/review/comments`) &&
        response.ok(),
    ),
    viewerPanel
      .locator('.reply-form')
      .getByRole('button', { name: 'Antworten', exact: true })
      .click(),
  ]);
  await expect(viewerPanel.getByText('E2E Antwort')).toBeVisible();
  await expect(page.getByRole('button', { name: /Kommentare \(2\)/ })).toBeVisible();
  await expect(page.locator('tbody tr').first().getByLabel('2 Kommentare')).toBeVisible();

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: /Kommentare \(2\)/ }).click();
  const reloadedPanel = page.getByRole('region', {
    name: 'Kommentare zum ausgewählten Item',
  });
  const expandReplies = reloadedPanel.getByRole('button', {
    name: '1 Antwort aufklappen',
  });
  await expect(expandReplies).toBeVisible();
  await expect(reloadedPanel.getByText('E2E Antwort')).not.toBeVisible();
  await expandReplies.click();
  await expect(reloadedPanel.getByText('E2E Antwort')).toBeVisible();
  await reloadedPanel.getByRole('button', { name: 'Antwort einklappen' }).click();
  await expect(reloadedPanel.getByText('E2E Antwort')).not.toBeVisible();

  const commentStatusFilter = page.getByLabel('Nach Kommentarstatus filtern');
  await commentStatusFilter.selectOption('with');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await commentStatusFilter.selectOption('without');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await commentStatusFilter.selectOption('');
  await expect(page.locator('tbody tr')).toHaveCount(2);
});

test('keeps item searches local for two users and out of the shared draft', async ({
  page,
  browser,
}) => {
  await login(page, MANAGER_ID, MANAGER_USERNAME);
  await openExplorer(page);

  const draftPatchUrls: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      request.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`)
    ) {
      draftPatchUrls.push(request.url());
    }
  });

  const filter = page.getByPlaceholder('🔍 Items filtern...');
  await filter.fill('GeoGebra');
  await expect(filter).toHaveValue('GeoGebra');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(draftPatchUrls).toEqual([]);

  const observerContext = await browser.newContext();
  const observer = await observerContext.newPage();
  await login(observer, VIEWER_ID, VIEWER_USERNAME);
  await openExplorer(observer);
  const observerFilter = observer.getByPlaceholder('🔍 Items filtern...');
  await expect(observerFilter).toHaveValue('');
  await observerFilter.fill('Item ohne ausgewählte Kodiervariable');
  await expect(observer.locator('tbody tr')).toHaveCount(1);

  await expect(filter).toHaveValue('GeoGebra');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  expect(draftPatchUrls).toEqual([]);
  await observerContext.close();
});

test('serializes delayed draft updates while typing into a shared column filter', async ({
  page,
}) => {
  await login(page, MANAGER_ID, MANAGER_USERNAME);
  await openExplorer(page);

  const requests: Array<{ baseVersion: number; itemIdFilter: string; status: number }> = [];
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  const draftPatchUrl = `**/api/acp/${ACP_ID}/item-explorer/draft`;
  await page.route(draftPatchUrl, async (route) => {
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    const payload = route.request().postDataJSON() as {
      baseVersion: number;
      patch?: { ui?: { columnFilters?: Record<string, string> } };
    };
    await new Promise((resolve) => setTimeout(resolve, 700));
    const response = await route.fetch();
    requests.push({
      baseVersion: payload.baseVersion,
      itemIdFilter: payload.patch?.ui?.columnFilters?.['itemId'] || '',
      status: response.status(),
    });
    activeRequests -= 1;
    await route.fulfill({ response });
  });

  const filter = page.getByPlaceholder('🔍 ID...');
  await filter.pressSequentially('MDB00701', { delay: 300 });
  await expect(filter).toHaveValue('MDB00701');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect.poll(() => requests.at(-1)?.itemIdFilter).toBe('MDB00701');
  await expect.poll(() => activeRequests).toBe(0);

  expect(requests.length).toBeGreaterThan(1);
  expect(maximumActiveRequests).toBe(1);
  expect(requests.every((request) => request.status === 200)).toBe(true);
  expect(requests.map((request) => request.baseVersion)).toEqual(
    [...requests.map((request) => request.baseVersion)].sort((left, right) => left - right),
  );
  await expect(
    page.getByText('Konflikt beim Aktualisieren des Entwurfs. Der Explorer wurde neu geladen.'),
  ).toHaveCount(0);

  await filter.fill('');
  await expect.poll(() => requests.at(-1)?.itemIdFilter).toBe('');
  await expect.poll(() => activeRequests).toBe(0);
  await page.unroute(draftPatchUrl);
});

test('offers configured columns and persists widths plus an explicitly empty selection', async ({
  page,
}) => {
  await login(page, MANAGER_ID, MANAGER_USERNAME);

  await page.goto(`/manage/${ACP_ID}/access`);
  await page.getByText('Inhalte und Darstellung', { exact: true }).click();
  await page
    .getByText('Erweiterte Einstellungen: Datenzuordnung und Player-Diagnose', { exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Zugriff & Funktionen' })).toBeVisible();
  await expect(page.getByLabel('ID der zusätzlichen Spalte 1')).toHaveValue('customQuality');
  await expect(page.getByLabel('Name der zusätzlichen Spalte 1')).toHaveValue(
    'Eigene Qualitätsspalte',
  );
  await expect(page.getByLabel('Allgemeine Kodierungshinweise anzeigen')).not.toBeChecked();
  await expect(page.getByLabel('Manuelle Kodieranweisungen bevorzugt anzeigen')).toBeChecked();
  await page.getByLabel('Persönliche Kategorien, Markierungen und Notizen aktivieren').check();
  await saveFeatureConfig(page);

  await openExplorer(page);
  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const dialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  await expect(dialog).toContainText('Eigene Qualitätsspalte');
  await expect(dialog).toContainText('ID: customQuality');
  await expect(dialog).toContainText('Aufgabe');
  await expect(dialog).toContainText('Kompetenzstufe');
  await dialog.getByLabel('Breite für Eigene Qualitätsspalte').fill('260');
  await dialog.getByLabel('Breite für Aufgabe').fill('310');
  await dialog.getByLabel('Breite für Kompetenzstufe', { exact: true }).fill('230');

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
        response.ok(),
    ),
    dialog.getByRole('button', { name: /Speichern/ }).click(),
  ]);
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  const customHeader = page.locator('thead tr').first().locator('th', {
    hasText: 'Eigene Qualitätsspalte',
  });
  await expect(customHeader).toHaveCount(1);
  await expect(customHeader).toHaveCSS('width', '260px');
  await expect(page.getByRole('columnheader', { name: /^Aufgabe(?:\s|$)/ })).toHaveCSS(
    'width',
    '310px',
  );
  await expect(page.getByRole('columnheader', { name: 'Kompetenzstufe', exact: true })).toHaveCSS(
    'width',
    '230px',
  );

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const orderDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  const orderedIdsBefore = await orderDialog.locator('.tile-id').allTextContents();
  const customIndexBefore = orderedIdsBefore.findIndex((value) => value.includes('customQuality'));
  expect(customIndexBefore).toBeGreaterThanOrEqual(0);
  const customTile = orderDialog.locator('.column-tile', { hasText: 'ID: customQuality' });
  if (customIndexBefore > 0) {
    await customTile.getByTitle('Nach oben').click();
  } else {
    await customTile.getByTitle('Nach unten').click();
  }
  const expectedCustomIndex = customIndexBefore > 0 ? customIndexBefore - 1 : 1;
  await expect
    .poll(async () => {
      const orderedIdsAfter = await orderDialog.locator('.tile-id').allTextContents();
      return orderedIdsAfter.findIndex((value) => value.includes('customQuality'));
    })
    .toBe(expectedCustomIndex);
  const taskTile = orderDialog.locator('.column-tile', { hasText: 'ID: unitLabel' });
  await taskTile.getByTitle('Nach unten').click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
        response.ok(),
    ),
    orderDialog.getByRole('button', { name: /Speichern/ }).click(),
  ]);

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const selectionDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  await expect
    .poll(async () => {
      const persistedOrder = await selectionDialog.locator('.tile-id').allTextContents();
      return persistedOrder.findIndex((value) => value.includes('customQuality'));
    })
    .toBe(expectedCustomIndex);

  await selectionDialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(selectionDialog).toHaveCount(0);
  const reorderedCustomHeader = page.locator('thead tr').first().locator('th', {
    hasText: 'Eigene Qualitätsspalte',
  });
  const expectedCustomCellIndex = await reorderedCustomHeader.evaluate(
    (header) => (header as HTMLTableCellElement).cellIndex,
  );
  const reorderedTaskHeader = page.getByRole('columnheader', { name: /^Aufgabe(?:\s|$)/ });
  const expectedTaskCellIndex = await reorderedTaskHeader.evaluate(
    (header) => (header as HTMLTableCellElement).cellIndex,
  );
  await expect(reorderedTaskHeader).toHaveCSS('width', '310px');
  const reorderedCompetenceHeader = page.getByRole('columnheader', {
    name: 'Kompetenzstufe',
    exact: true,
  });
  const expectedCompetenceCellIndex = await reorderedCompetenceHeader.evaluate(
    (header) => (header as HTMLTableCellElement).cellIndex,
  );
  await expect(reorderedCompetenceHeader).toHaveCSS('width', '230px');
  await publishExplorerDraft(page);
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await expect(page.getByText('Leseansicht aktiv.')).toBeVisible();
  const readOnlyCustomHeader = page.locator('thead tr').first().locator('th', {
    hasText: 'Eigene Qualitätsspalte',
  });
  await expect(readOnlyCustomHeader).toHaveCSS('width', '260px');
  await expect
    .poll(() =>
      readOnlyCustomHeader.evaluate((header) => (header as HTMLTableCellElement).cellIndex),
    )
    .toBe(expectedCustomCellIndex);
  const readOnlyTaskHeader = page.getByRole('columnheader', { name: /^Aufgabe(?:\s|$)/ });
  await expect(readOnlyTaskHeader).toHaveCSS('width', '310px');
  await expect
    .poll(() => readOnlyTaskHeader.evaluate((header) => (header as HTMLTableCellElement).cellIndex))
    .toBe(expectedTaskCellIndex);
  const readOnlyCompetenceHeader = page.getByRole('columnheader', {
    name: 'Kompetenzstufe',
    exact: true,
  });
  await expect(readOnlyCompetenceHeader).toHaveCSS('width', '230px');
  await expect
    .poll(() =>
      readOnlyCompetenceHeader.evaluate((header) => (header as HTMLTableCellElement).cellIndex),
    )
    .toBe(expectedCompetenceCellIndex);
  await page.getByRole('button', { name: 'Bearbeitungsansicht' }).click();
  await expect(page.getByText('Leseansicht aktiv.')).toHaveCount(0);

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const emptySelectionDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');

  await expect.poll(() => emptySelectionDialog.locator('.tile-id').count()).toBeGreaterThan(0);
  const selectedColumnIds = await emptySelectionDialog
    .locator('.column-tile.active .tile-id')
    .allTextContents();
  let remainingSelectedColumns = selectedColumnIds.length;
  for (const columnId of selectedColumnIds) {
    await emptySelectionDialog.getByText(columnId.trim(), { exact: true }).click();
    remainingSelectedColumns -= 1;
    await expect(emptySelectionDialog.locator('.selection-info')).toContainText(
      new RegExp(`^\\s*${remainingSelectedColumns} von \\d+ Spalten gewählt\\s*$`),
    );
  }
  await expect(emptySelectionDialog.locator('.selection-info')).toContainText(
    /^\s*0 von \d+ Spalten gewählt\s*$/,
  );
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
        response.ok(),
    ),
    emptySelectionDialog.getByRole('button', { name: /Speichern/ }).click(),
  ]);

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const reloadedDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  await expect(reloadedDialog.locator('.selection-info')).toContainText(
    /^\s*0 von \d+ Spalten gewählt\s*$/,
  );
  await expect(reloadedDialog.getByLabel('Breite für Eigene Qualitätsspalte')).toHaveValue('260');
  await reloadedDialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(reloadedDialog).toHaveCount(0);
  await publishExplorerDraft(page);
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await expect(page.getByText('Leseansicht aktiv.')).toBeVisible();
  await expect(page.locator('tbody tr').first().locator('td.meta-cell')).toHaveCount(0);
  await expect(
    page.locator('thead tr').first().locator('th', { hasText: 'Eigene Qualitätsspalte' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Bearbeitungsansicht' }).click();
  await expect(page.getByText('Leseansicht aktiv.')).toHaveCount(0);

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const resetDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  const resetButton = resetDialog.getByRole('button', { name: /Standard/ });
  await expect(resetButton).toBeEnabled();
  await resetButton.click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
        response.ok(),
    ),
    resetDialog.getByRole('button', { name: /Speichern/ }).click(),
  ]);
  await expect(
    page.locator('thead tr').first().locator('th', { hasText: 'Eigene Qualitätsspalte' }),
  ).toHaveCount(1);

  const oldTag = page.locator('tbody tr').first().locator('.tag-badge', { hasText: 'Alt' });
  await expect(oldTag).toBeVisible();
  const tagPatch = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
      response.ok(),
  );
  await oldTag.click();
  await expect(oldTag).toHaveCount(0);
  await tagPatch;
  await page.reload();
  await expect(
    page.locator('tbody tr').first().locator('.tag-badge', { hasText: 'Alt' }),
  ).toHaveCount(0);

  await publishExplorerDraft(page);
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await expect(page.getByText('Leseansicht aktiv.')).toBeVisible();
  await expect(
    page.locator('tbody tr').first().locator('.tag-badge', { hasText: 'Alt' }),
  ).toHaveCount(0);

  await page.goto(`/manage/${ACP_ID}/access`);
  await page.getByText('Inhalte und Darstellung', { exact: true }).click();
  await page
    .getByText('Erweiterte Einstellungen: Datenzuordnung und Player-Diagnose', { exact: true })
    .click();
  await page.getByLabel('Persönliche Kategorien, Markierungen und Notizen aktivieren').uncheck();
  await saveFeatureConfig(page);
});

test('applies coding configuration defaults and the alternative combinations in editor and read-only views', async ({
  browser,
  page,
}) => {
  await login(page, MANAGER_ID, MANAGER_USERNAME);
  await openExplorer(page);

  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  const codingDialog = page
    .getByRole('heading', { name: /Kodierung – Lieblingsbücher_2/ })
    .locator('xpath=ancestor::div[contains(@class, "overlay-dialog")]');
  await expect(codingDialog.getByTestId('coding-variable-focus')).toContainText('01');
  await expect(codingDialog.getByTestId('coding-information')).toContainText('Richtige Antwort');
  await expect(codingDialog.getByTestId('coding-information')).toContainText(
    'Bilderbücher ausgewählt',
  );
  await expect(codingDialog.getByTestId('coding-information')).toContainText('ausgewählt');
  await expect(codingDialog.getByTestId('coding-information')).toContainText(
    'Bilderbuchsegment markiert',
  );
  await expect(codingDialog.getByTestId('coding-information')).toContainText('nicht ausgewählt');
  await expect(codingDialog).not.toContainText('Abgeleitete/aggregierte Kodierung');
  await expect(codingDialog.locator('.coding-item')).toHaveCount(3);
  await expect(codingDialog).not.toContainText('Nur Segment Bilderbücher markieren.');
  await expect(codingDialog.locator('.rule-list li')).toHaveCount(3);
  for (const technicalId of ['_button01', '_intro01', '_outro01', '_source01']) {
    await expect(codingDialog).not.toContainText(technicalId);
  }
  await codingDialog.getByRole('button', { name: /Schließen/ }).click();

  await page.locator('tbody tr').nth(1).click();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.getByTestId('coding-information')).toContainText(
    'Keine eindeutige Kodiervariable',
  );
  await expect(page.getByText('Allgemeiner Testhinweis zur Kodierung.')).toHaveCount(0);
  await page.getByRole('button', { name: /Schließen/ }).click();

  await page.goto(`/manage/${ACP_ID}/access`);
  await page.getByText('Inhalte und Darstellung', { exact: true }).click();
  await page
    .getByText('Erweiterte Einstellungen: Datenzuordnung und Player-Diagnose', { exact: true })
    .click();
  const preferManualCodingInstructions = page.getByLabel(
    'Manuelle Kodieranweisungen bevorzugt anzeigen',
  );
  const showGeneralCodingInstructions = page.getByLabel('Allgemeine Kodierungshinweise anzeigen');
  await expect(preferManualCodingInstructions).toBeChecked();
  await expect(showGeneralCodingInstructions).not.toBeChecked();
  await preferManualCodingInstructions.uncheck();
  await showGeneralCodingInstructions.check();
  await saveFeatureConfig(page);

  await openExplorer(page);
  await page.locator('tbody tr').first().click();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  const alternativeDialog = page
    .getByRole('heading', { name: /Kodierung – Lieblingsbücher_2/ })
    .locator('xpath=ancestor::div[contains(@class, "overlay-dialog")]');
  await expect(alternativeDialog).toContainText('Nur Segment Bilderbücher markieren.');
  await expect(alternativeDialog.locator('.rule-list li')).toHaveCount(3);
  await alternativeDialog.getByRole('button', { name: /Schließen/ }).click();

  await page.locator('tbody tr').nth(1).click();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.getByText('Allgemeiner Testhinweis zur Kodierung.')).toBeVisible();
  await page.getByRole('button', { name: /Schließen/ }).click();

  const viewerContext = await browser.newContext();
  await login(await viewerContext.newPage(), VIEWER_ID, VIEWER_USERNAME);
  const viewerPage = viewerContext.pages()[0];
  await openExplorer(viewerPage);
  await viewerPage.locator('tbody tr').first().click();
  await viewerPage.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(viewerPage.getByTestId('coding-information')).toContainText('Richtige Antwort');
  await viewerPage.getByRole('button', { name: /Schließen/ }).click();
  await viewerPage.locator('tbody tr').nth(1).click();
  await viewerPage.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(viewerPage.getByTestId('coding-information')).toContainText(
    'Keine eindeutige Kodiervariable',
  );
  await expect(viewerPage.getByText('Allgemeiner Testhinweis zur Kodierung.')).toBeVisible();
  await viewerContext.close();
});

test('shares personal lists ACP-wide as read-only and creates independent private copies', async ({
  browser,
  page,
}) => {
  await login(page, MANAGER_ID, MANAGER_USERNAME);
  await openExplorer(page);

  await page.getByText('Liste verwalten ▾', { exact: true }).click();
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const nameDialog = page.getByRole('dialog', { name: 'Neue Auswahlliste' });
  await nameDialog.getByLabel('Name der Auswahlliste').fill('E2E Freigabetest');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/view/acp/${ACP_ID}/items/collections`) &&
        response.ok(),
    ),
    nameDialog.getByRole('button', { name: 'Anlegen', exact: true }).click(),
  ]);
  const managerRowCheckbox = page.getByLabel('Item 01 in Auswahlliste auswählen');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().includes('/items/collections/') &&
        response.url().endsWith('/rows') &&
        response.ok(),
    ),
    managerRowCheckbox.check(),
  ]);
  await page.getByText('Liste verwalten ▾', { exact: true }).click();
  await page.getByRole('button', { name: 'Freigeben …', exact: true }).click();
  const shareToggle = page.getByLabel('Für diesen ACP freigeben');
  await shareToggle.check();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        /\/items\/collections\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.ok(),
    ),
    page
      .getByRole('dialog', { name: 'Auswahlliste freigeben' })
      .getByRole('button', { name: 'Speichern', exact: true })
      .click(),
  ]);
  await expect(shareToggle).toBeChecked();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await login(viewerPage, VIEWER_ID, VIEWER_USERNAME);
  await openExplorer(viewerPage);
  const viewerSelect = viewerPage.getByLabel('Aktive persönliche Auswahlliste auswählen');
  const sharedOption = viewerSelect.locator('option', { hasText: 'E2E Manager' });
  await expect(sharedOption).toHaveCount(1);
  const sharedId = await sharedOption.getAttribute('value');
  expect(sharedId).toBeTruthy();
  await viewerSelect.selectOption(sharedId!);
  await expect(viewerPage.getByTitle(/^Geteilt von E2E Manager\./)).toBeVisible();
  await viewerPage.getByText('Liste verwalten ▾', { exact: true }).click();
  await expect(viewerPage.getByRole('button', { name: 'Umbenennen' })).toBeDisabled();
  await expect(viewerPage.getByRole('button', { name: 'Liste leeren …' })).toBeDisabled();
  await expect(viewerPage.getByLabel('Item 01 in Auswahlliste auswählen')).toBeDisabled();
  await expect(viewerPage.getByRole('button', { name: 'Private Kopie erstellen' })).toBeEnabled();

  await Promise.all([
    viewerPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/items/collections/${sharedId}/copy`) &&
        response.ok(),
    ),
    viewerPage.getByRole('button', { name: 'Private Kopie erstellen' }).click(),
  ]);
  await expect(viewerSelect).toContainText('(Kopie)');
  await expect(viewerPage.getByText('Geteilt', { exact: true })).toHaveCount(0);
  await expect(viewerPage.getByLabel('Item 01 in Auswahlliste auswählen')).toBeEnabled();
  await page.getByText('Liste verwalten ▾', { exact: true }).click();
  await page.getByRole('button', { name: 'Freigabe verwalten …', exact: true }).click();
  await shareToggle.uncheck();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        /\/items\/collections\/[^/]+$/.test(new URL(response.url()).pathname) &&
        response.ok(),
    ),
    page
      .getByRole('dialog', { name: 'Auswahlliste freigeben' })
      .getByRole('button', { name: 'Speichern', exact: true })
      .click(),
  ]);
  await viewerPage.reload();
  await expect(viewerPage.getByLabel('Aktive persönliche Auswahlliste auswählen')).toContainText(
    '(Kopie)',
  );
  await expect(
    viewerPage.getByLabel('Aktive persönliche Auswahlliste auswählen'),
  ).not.toContainText('E2E Manager');
  await viewerContext.close();
});

test('sorts VERA items by the complete visible Item-ID in both directions', async ({ page }) => {
  const veraItems = [
    {
      itemId: '01',
      uuid: 'vera-mdv010-01',
      rowKey: 'vera-mdv010-01',
      rowNumber: 6,
      unitId: 'MDV010',
      unitLabel: 'VERA Aufgabe 10',
      description: 'Item 01',
      variableId: '',
      metadata: {},
    },
    {
      itemId: '10',
      uuid: 'vera-mdv002-10',
      rowKey: 'vera-mdv002-10',
      rowNumber: 5,
      unitId: 'MDV002',
      unitLabel: 'VERA Aufgabe 2',
      description: 'Item 10',
      variableId: '',
      metadata: {},
    },
    {
      itemId: '01',
      uuid: 'vera-mdv002-01',
      rowKey: 'vera-mdv002-01::10',
      rowNumber: 3,
      subId: '10',
      subIdDisplay: '10',
      unitId: 'MDV002',
      unitLabel: 'VERA Aufgabe 2',
      description: 'Partial Credit 10',
      variableId: '',
      metadata: {},
    },
    {
      itemId: '02',
      uuid: 'vera-mdv002-02',
      rowKey: 'vera-mdv002-02',
      rowNumber: 4,
      unitId: 'MDV002',
      unitLabel: 'VERA Aufgabe 2',
      description: 'Item 02',
      variableId: '',
      metadata: {},
    },
    {
      itemId: '01',
      uuid: 'vera-mdv002-01',
      rowKey: 'vera-mdv002-01::2-b',
      rowNumber: 2,
      subId: '2',
      subIdDisplay: '2',
      unitId: 'MDV002',
      unitLabel: 'VERA Aufgabe 2',
      description: 'Partial Credit 2b',
      variableId: '',
      metadata: {},
    },
    {
      itemId: '01',
      uuid: 'vera-mdv002-01',
      rowKey: 'vera-mdv002-01::2-a',
      rowNumber: 1,
      subId: '2',
      subIdDisplay: '2',
      unitId: 'MDV002',
      unitLabel: 'VERA Aufgabe 2',
      description: 'Partial Credit 2a',
      variableId: '',
      metadata: {},
    },
  ];
  await page.route(`**/api/acp/${ACP_ID}/files/item-list*`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, items: veraItems } });
  });
  await login(page, MANAGER_ID, MANAGER_USERNAME);
  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.getByRole('heading', { name: 'Item-Explorer' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(veraItems.length);

  const itemIdHeader = page.getByRole('columnheader', { name: /Item-ID/ });
  const ascendingPatch = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
      response.ok(),
  );
  await itemIdHeader.click();
  await ascendingPatch;
  await expect(itemIdHeader).toContainText('↑');

  const rows = page.locator('tbody tr');
  const ascendingRowIds = await rows.evaluateAll((elements) => elements.map((row) => row.id));
  expect(ascendingRowIds).toEqual([
    'item-explorer-row-vera-mdv002-01--2-a',
    'item-explorer-row-vera-mdv002-01--2-b',
    'item-explorer-row-vera-mdv002-01--10',
    'item-explorer-row-vera-mdv002-02',
    'item-explorer-row-vera-mdv002-10',
    'item-explorer-row-vera-mdv010-01',
  ]);
  await expect(rows.first().locator('.unit-id')).toHaveText('MDV002');
  await expect(rows.first().locator('.item-id')).toHaveText('01');

  const descendingPatch = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft`) &&
      response.ok(),
  );
  await itemIdHeader.click();
  await descendingPatch;
  await expect(itemIdHeader).toContainText('↓');
  await expect
    .poll(() => rows.evaluateAll((elements) => elements.map((row) => row.id)))
    .toEqual([...ascendingRowIds].reverse());

  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(veraItems.length);
  await expect(page.getByRole('columnheader', { name: /Item-ID/ })).toContainText('↓');
  await expect
    .poll(() => page.locator('tbody tr').evaluateAll((elements) => elements.map((row) => row.id)))
    .toEqual([...ascendingRowIds].reverse());

  const discardButton = page.getByRole('button', { name: /Verwerfen/ }).first();
  await expect(discardButton).toBeEnabled();
  await discardButton.click();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/acp/${ACP_ID}/item-explorer/draft/discard`) &&
        response.ok(),
    ),
    page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.url().includes(`/api/acp/${ACP_ID}/files/item-list`) &&
        response.ok(),
    ),
    page.getByRole('button', { name: 'Änderungen verwerfen', exact: true }).click(),
  ]);
  await expect(discardButton).toBeDisabled();
});
