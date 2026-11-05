import { expect, test } from '@playwright/test';
import { journeyUnitId, journeyUnitName } from '../../test-fixtures/browser-journey-package';
import { installOidcSession } from './oidc-test-session';

test.use({ actionTimeout: 15_000 });

const credentialAcp = '10000000-0000-4000-8000-000000000001';
const unitAcp = '10000000-0000-4000-8000-000000000303';
const managerId = '10000000-0000-4000-8000-000000000002';
const explorerAcps: Record<string, string> = {
  chromium: '10000000-0000-4000-8000-000000000304',
  firefox: '10000000-0000-4000-8000-000000000305',
  webkit: '10000000-0000-4000-8000-000000000306',
};

test('credential login rejects a bad password and survives reload after a valid login', async ({
  page,
}) => {
  await page.goto(`/credential-login/${credentialAcp}`);
  await page.getByLabel('Benutzername').fill('e2e-reviewer');
  await page.getByLabel('Kennwort').fill('incorrect-password');
  await page.getByRole('button', { name: 'Zugang öffnen' }).click();
  await expect(page.locator('.alert-error')).toBeVisible();
  await expect(page).toHaveURL(`/credential-login/${credentialAcp}`);

  await page.getByLabel('Kennwort').fill('Reviewer-E2E-123!');
  await page.getByRole('button', { name: 'Zugang öffnen' }).click();
  await expect(page).toHaveURL(`/view/${credentialAcp}`);
  await expect(page.getByRole('link', { name: /Item-Explorer/ })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(`/view/${credentialAcp}`);
  await expect(page.getByRole('link', { name: /Item-Explorer/ })).toBeVisible();
});

test('unit navigation renders real ASPECT content and applies display modes', async ({ page }) => {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(`/view/${unitAcp}/units`);
  await expect(page.getByRole('heading', { name: 'Aufgaben' })).toBeVisible();
  await page
    .locator('tbody tr')
    .filter({ hasText: journeyUnitName })
    .getByRole('link', { name: 'Ansehen' })
    .click();
  await expect(page).toHaveURL(`/view/${unitAcp}/unit/${journeyUnitId}`);
  const player = page.frameLocator('iframe.player-iframe');
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
  await player.getByRole('radio', { name: 'zum See', exact: true }).check();
  await expect(player.getByRole('radio', { name: 'zum See', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await expect(player.getByText('Die Fahrt zum See', { exact: true })).toBeVisible();
  await player.getByRole('textbox').fill('Fahrrad');
  await expect(player.getByRole('textbox')).toHaveValue('Fahrrad');
  const mode = page.getByRole('combobox', { name: 'Seitendarstellung der Aufgabe' });
  await mode.selectOption('concat-scroll');
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
  await expect(player.getByText('Die Fahrt zum See', { exact: true })).toBeVisible();
  await expect(page.locator('.page-nav')).toHaveCount(0);
  await page.reload();
  // Display mode is session-local; a new page starts with button navigation.
  await expect(mode).toHaveValue('buttons');
  await expect(page.locator('.page-info')).toHaveText('Seite 1 / 2');
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
});

test('item preview omits player arrows and explorer navigation keeps selection and coding aligned', async ({
  page,
}, testInfo) => {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(`/view/${unitAcp}/item-explorer`);
  const choiceRow = page.locator('#item-explorer-row-journey-choice');
  await choiceRow.click();
  const player = page.frameLocator('iframe.player-iframe');
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
  await expect(player.locator('aspect-page-nav-button')).toHaveCount(0);

  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  const mode = page.getByRole('combobox', { name: 'Seitendarstellung der Player-Vorschau' });
  await expect(mode).toHaveValue('separate');
  await expect(mode.locator('option[value="buttons"]')).toHaveCount(0);
  for (const value of [
    'concat-scroll',
    'concat-scroll-snap',
    'view-all',
    'print-ids',
    'separate',
  ]) {
    const reloaded = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame.parentFrame() === page.mainFrame(),
    });
    await mode.selectOption(value);
    await reloaded;
    await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
    await expect(player.locator('aspect-page-nav-button')).toHaveCount(0);
    await expect(choiceRow).toHaveAttribute('aria-selected', 'true');
  }

  await page.getByRole('button', { name: '← Vorheriges Item', exact: true }).click();
  await expect(page.locator('#item-explorer-row-journey-transport')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(choiceRow).toHaveAttribute('aria-selected', 'false');
  await expect(player.getByText('Die Fahrt zum See', { exact: true })).toBeVisible();
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Kodiervariable.*FAHRT/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Kodiervariable.*WAHL/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Schließen/ }).click();

  await page.getByRole('button', { name: 'Nächstes Item →', exact: true }).click();
  await expect(choiceRow).toHaveAttribute('aria-selected', 'true');
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
  await expect(player.getByText('Die Fahrt zum See', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Kodiervariable.*WAHL/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Kodiervariable.*FAHRT/ })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('item-preview-navigation.png'),
    fullPage: true,
  });
});

test('regular multi-page flow retains answers and captures the selected item context', async ({
  page,
}, testInfo) => {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.route(`**/api/view/acp/${unitAcp}`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.featureConfig = { ...json.featureConfig, enableItemExplorerConditionalVisibility: true };
    await route.fulfill({ response, json });
  });
  await page.goto(`/view/${unitAcp}/item-explorer`);
  const transportRow = page.locator('#item-explorer-row-journey-transport');
  await transportRow.click();
  const player = page.frameLocator('iframe.player-iframe');
  await expect(player.getByText('Die Fahrt zum See', { exact: true })).toBeVisible();
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  const mode = page.locator('#preview-context-mode');
  await mode.selectOption('flow');
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeVisible();
  await expect(page.locator('#preview-paging-mode')).toHaveValue('separate');
  await expect(player.locator('aspect-page-nav-button')).toHaveCount(0);

  const previous = page.getByRole('button', { name: '← Vorherige Aufgabenseite', exact: true });
  const next = page.getByRole('button', { name: 'Nächste Aufgabenseite →', exact: true });
  const pageInfo = page.getByRole('navigation', {
    name: 'Seitennavigation im regulären Aufgabenablauf',
  });
  await expect(pageInfo).toContainText('Aufgabenseite 1 von 2');
  await page.locator('.player-container').scrollIntoViewIfNeeded();
  await expect(previous).toBeInViewport();
  await expect(next).toBeInViewport();
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  await player.getByRole('radio', { name: 'zum See', exact: true }).check();
  await next.click();
  await expect(player.getByText('Die Fahrt zum See', { exact: true })).toBeVisible();
  await expect(player.getByText('Ein Ausflug zum See', { exact: true })).toBeHidden();
  await expect(pageInfo).toContainText('Aufgabenseite 2 von 2');
  await expect(next).toBeDisabled();
  await expect(transportRow).toHaveAttribute('aria-selected', 'true');
  await player.getByRole('textbox').fill('Fahrrad');

  await previous.click();
  await expect(player.getByRole('radio', { name: 'zum See', exact: true })).toBeChecked();
  await next.click();
  await expect(player.getByRole('textbox')).toHaveValue('Fahrrad');
  await expect(mode).toHaveValue('flow');
  await expect(transportRow).toHaveAttribute('aria-selected', 'true');
  await expect(player.locator('aspect-page-nav-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }).click();
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  await page.getByRole('button', { name: 'Musterlösung ausblenden', exact: true }).click();
  await expect(previous).toBeEnabled();
  await expect(player.getByRole('textbox')).toHaveValue('Fahrrad');
  await page
    .locator('.player-container')
    .screenshot({ path: testInfo.outputPath('multi-page-flow.png') });
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Kodiervariable.*FAHRT/ })).toBeVisible();
  await page.getByRole('button', { name: /Schließen/ }).click();

  const capture = page.getByRole('button', {
    name: 'Diese Itemansicht als Kontext übernehmen',
    exact: true,
  });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(mode).toHaveValue('reference');
  await expect(pageInfo).toHaveCount(0);
  await expect(player.getByRole('textbox')).toHaveValue('Fahrrad');
  await expect(page.getByText(/Übernommener Vorschaukontext\./)).toBeVisible();
  await expect(transportRow).toHaveAttribute('aria-selected', 'true');
  await expect(player.locator('aspect-page-nav-button')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('multi-page-flow-context.png'),
    fullPage: true,
  });
});

test('coding draft, publish and reader perspective remain consistent', async ({
  page,
  browser,
}, testInfo) => {
  const acpId = explorerAcps[testInfo.project.name];
  expect(acpId).toBeTruthy();
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(`/view/${acpId}/item-explorer`);
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.locator('#item-explorer-row-journey-choice').click();
  await expect(page.locator('iframe.player-iframe')).toBeVisible();
  await expect(
    page.frameLocator('iframe.player-iframe').getByRole('radio', { name: 'zum See', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Kodiervariable.*WAHL/ })).toBeVisible();
  await expect(page.getByText('Bezeichnung: Ziel des Ausflugs', { exact: true })).toBeVisible();
  await expect(page.locator('.overlay-content')).toContainText(
    "Übereinstimmung (Zahl/Text) mit '2'",
  );
  await expect(page.getByTestId('coding-variable-focus')).toContainText('Kodierung für Item');
  await expect(page.getByTestId('coding-variable-focus')).not.toContainText('Interne Kodier-ID');
  await expect(page.getByTestId('coding-variable-focus')).not.toContainText('Player-/Anzeige-Ziel');
  await page.getByRole('button', { name: /Schließen/ }).click();

  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page.getByText('Zuordnung korrigieren …', { exact: true }).click();
  await page.getByLabel('Manuelles Sprungziel').fill('FAHRT');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByText(/Manueller Override aktiv:/)).toContainText('FAHRT');
  await page.getByRole('button', { name: 'Leseansicht' }).click();
  await expect(page.getByText(/unveröffentlichter Explorer-Entwurf/)).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeitungsansicht' }).click();
  await page.getByRole('button', { name: 'Änderungen prüfen …' }).click();
  await expect(
    page.getByRole('heading', { name: 'Änderungsübersicht vor Speichern' }),
  ).toBeVisible();
  // The independent reader must still receive the old target while the draft is pending.
  const readerContext = await browser.newContext();
  const reader = await readerContext.newPage();
  await installOidcSession(reader, '10000000-0000-4000-8000-000000000003', 'e2e-viewer');
  const readTarget = async (reload = false, published = false) => {
    const responsePromise = reload
      ? undefined
      : reader.waitForResponse(
          (response) =>
            response.url().includes(`/api/view/acp/${acpId}/item-explorer/state`) && response.ok(),
        );
    if (reload) await reader.reload();
    else await reader.goto(`/view/${acpId}/item-explorer`);
    const data = responsePromise ? await (await responsePromise).json() : undefined;
    await expect(reader.locator('tbody tr')).toHaveCount(2);
    await reader.locator('#item-explorer-row-journey-choice').click();
    const preview = reader.frameLocator('iframe.player-iframe');
    if (published) {
      await expect(preview.getByRole('textbox')).toBeVisible();
      await expect(preview.getByText('Die Fahrt zum See', { exact: true })).toBeVisible();
    } else {
      await expect(preview.getByRole('radio', { name: 'zum See', exact: true })).toBeVisible();
      await expect(preview.getByRole('textbox')).toHaveCount(0);
    }
    await expect(reader.getByRole('button', { name: 'Bearbeitungsansicht' })).toHaveCount(0);
    await expect(reader.getByRole('button', { name: /Itemparameter/ })).toHaveCount(0);
    return data?.activeState.itemProperties['journey-choice']?.previewTargetId;
  };
  try {
    expect(await readTarget()).toBeFalsy();
    await page.getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page.locator('.status-pill')).toContainText(/Gespeichert|Unverändert/);
    await page.getByRole('button', { name: 'Leseansicht' }).click();
    await expect(page.getByText(/unveröffentlichter Explorer-Entwurf/)).toHaveCount(0);
    expect(await readTarget(false, true)).toBe('FAHRT');
    // Firefox may revalidate the response with 304. Check the rendered target after reload.
    await readTarget(true, true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Leseansicht' })).toBeVisible();
    await page.locator('#item-explorer-row-journey-choice').click();
    await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
    await expect(page.getByText(/Manueller Override aktiv:/)).toContainText('FAHRT');
  } finally {
    await readerContext.close();
  }
});
