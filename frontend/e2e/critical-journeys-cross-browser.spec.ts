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
