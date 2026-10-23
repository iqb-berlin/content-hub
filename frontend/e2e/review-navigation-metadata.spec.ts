import { expect, test, type Page } from '@playwright/test';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

const acpId = '10000000-0000-4000-8000-000000000201';
const managerId = '10000000-0000-4000-8000-000000000002';
const configUrl = `/api/view/acp/${acpId}/review/config`;
const reviewUrl = `/view/${acpId}/sequence/review-navigation?kind=booklet`;

// Deterministic Verona contract fixture. Configuration, authorization and persistence
// use the real API; only booklet content and the player are substituted.
const playerHtml = `<!doctype html><html><body><main id="view">Warte auf Start</main><script>
  let sessionId, currentPage = '0', validPages = [];
  function report() {
    parent.postMessage({type:'vopStateChangedNotification', sessionId,
      playerState: {validPages, currentPage}}, '*');
  }
  function render() {
    document.getElementById('view').innerHTML = '<p>Player-Seite ' + (Number(currentPage)+1) +
      '</p><button id="next">Intern weiter</button><button id="previous">Intern zurück</button>';
    document.getElementById('next').onclick = () => {
      currentPage = String(Math.min(validPages.length-1, Number(currentPage)+1)); render(); report();
    };
    document.getElementById('previous').onclick = () => {
      currentPage = String(Math.max(0, Number(currentPage)-1)); render(); report();
    };
  }
  addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'vopStartCommand') {
      sessionId = msg.sessionId;
      document.body.dataset.session = sessionId;
      validPages = JSON.parse(msg.unitDefinition).pages.filter(p => !p.alwaysVisible)
        .map((_, index) => ({id:String(index)}));
      render();
      // Deliberately do not report until navigation: the host must initialize the count itself.
    }
    if (msg.type === 'vopPageNavigationCommand') {
      if (msg.sessionId !== sessionId || typeof msg.target !== 'string') throw Error('Invalid page command');
      currentPage = msg.target; render(); report();
    }
  });
  parent.postMessage({type:'vopReadyNotification'}, '*');
</script></body></html>`;

async function installContent(page: Page) {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.route(`**/api/view/acp/${acpId}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.featureConfig = { ...data.featureConfig, showMetadata: true, enableCommenting: false };
    await route.fulfill({ json: data });
  });
  await page.route(`**/api/view/acp/${acpId}/sequences/review-navigation?*`, (route) =>
    route.fulfill({
      json: {
        id: 'review-navigation',
        name: 'Navigationstest',
        units: [
          { id: 'review-u1', name: 'Aufgabe 1' },
          { id: 'review-u2', name: 'Aufgabe 2' },
        ],
      },
    }),
  );
  await page.route(`**/api/view/acp/${acpId}/units/review-u*`, (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    return route.fulfill({
      json: {
        id,
        name: id === 'review-u1' ? 'Aufgabe 1' : 'Aufgabe 2',
        items: [],
        dependencies: [
          { type: 'PLAYER', downloadUrl: '/review-test/player' },
          { type: 'UNIT_DEFINITION', downloadUrl: `/review-test/${id}` },
          { type: 'METADATA', fileId: 'review-metadata', downloadUrl: '/review-test/metadata' },
        ],
      },
    });
  });
  await page.route('**/review-test/*', (route) => {
    const player = new URL(route.request().url()).pathname.endsWith('/player');
    return player
      ? route.fulfill({ contentType: 'text/html', body: playerHtml })
      : route.fulfill({
          json: {
            pages: [
              { alwaysVisible: true },
              {},
              ...(route.request().url().includes('review-u1') ? [{}] : []),
            ],
          },
        });
  });
  await page.route(`**/api/acp/${acpId}/files/review-metadata/preview`, (route) =>
    route.fulfill({
      json: {
        structuredData: {
          type: 'vomd',
          unitProfiles: [
            { id: 'iqb_author', label: 'Entwickler:in', value: 'Elsa Mignon (EM)' },
            { id: 'subject', label: 'Fach', value: 'Deutsch' },
          ],
        },
      },
    }),
  );
}

test('synchronizes initial totals, both navigation directions, display modes and unit changes', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installContent(page);
  await page.goto(reviewUrl);
  const player = page.frameLocator('app-unit-view iframe');
  const info = page.locator('.page-info');
  await expect(info).toHaveText('Seite 1 / 2');
  await expect(player.getByText('Player-Seite 1')).toBeVisible();
  await player.getByRole('button', { name: 'Intern weiter', exact: true }).click();
  await expect(info).toHaveText('Seite 2 / 2');
  await expect(page.getByRole('button', { name: 'Nächste Seite →', exact: true })).toBeDisabled();
  await player.getByRole('button', { name: 'Intern zurück', exact: true }).click();
  await expect(info).toHaveText('Seite 1 / 2');
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await expect(player.getByText('Player-Seite 2')).toBeVisible();
  await page.getByRole('button', { name: '← Vorherige Seite', exact: true }).click();
  await expect(player.getByText('Player-Seite 1')).toBeVisible();
  const mode = page.getByRole('combobox', { name: 'Seitendarstellung der Aufgabe' });
  for (const value of [
    'separate',
    'concat-scroll',
    'concat-scroll-snap',
    'view-all',
    'print-ids',
  ]) {
    const previousSession = await player.locator('body').getAttribute('data-session');
    await mode.selectOption(value);
    await expect(player.locator('body')).not.toHaveAttribute('data-session', previousSession!);
    await expect(player.getByText('Player-Seite 1')).toBeVisible();
    await expect(page.locator('.page-nav')).toHaveCount(0);
  }
  await mode.selectOption('buttons');
  await expect(info).toHaveText('Seite 1 / 2');
  await player.getByRole('button', { name: 'Intern weiter', exact: true }).click();
  await expect(info).toHaveText('Seite 2 / 2');
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Aufgabe 2 (review-u2)', exact: true }),
  ).toBeVisible();
  await expect(player.getByText('Player-Seite 1')).toBeVisible();
  await expect(page.locator('.page-nav')).toHaveCount(0);
  await page.getByRole('button', { name: '← Zurück', exact: true }).click();
  await expect(info).toHaveText('Seite 1 / 2');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const button of await page.locator('.page-nav button').all()) {
    const box = await button.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await expect(player.getByText('Player-Seite 1')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('review-navigation-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('persists the visibility choice and limits hiding to review metadata', async ({
  page,
  request,
}, testInfo) => {
  const headers = { Authorization: `Bearer ${createOidcAppToken(managerId, 'e2e-manager')}` };
  const initialResponse = await request.get(configUrl, { headers });
  expect(initialResponse.ok()).toBe(true);
  const initial = await initialResponse.json();
  await installContent(page);
  try {
    await page.goto(`/view/${acpId}/review/manage`);
    const setting = page.getByRole('checkbox', {
      name: 'Namen und Kürzel der Aufgabenentwickler/innen ausblenden',
    });
    await setting.check();
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(configUrl) && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Review-Konfiguration speichern', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(setting).toBeChecked();
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Metadaten', exact: true }).click();
    await expect(page.locator('.meta-dl')).toContainText('Deutsch');
    await expect(page.locator('.meta-dl')).not.toContainText('Elsa Mignon');
    await page.screenshot({
      path: testInfo.outputPath('review-metadata-hidden.png'),
      fullPage: true,
    });

    await page.goto(`/view/${acpId}/unit/review-u1`);
    await page.getByRole('button', { name: 'Zusatzdaten anzeigen', exact: true }).click();
    await expect(page.locator('.meta-dl')).toContainText('Elsa Mignon (EM)');

    await page.goto(`/view/${acpId}/review/manage`);
    await setting.uncheck();
    const shown = page.waitForResponse(
      (response) => response.url().endsWith(configUrl) && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Review-Konfiguration speichern', exact: true }).click();
    expect((await shown).ok()).toBe(true);
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Metadaten', exact: true }).click();
    await expect(page.locator('.meta-dl')).toContainText('Elsa Mignon (EM)');
  } finally {
    const current = await (await request.get(configUrl, { headers })).json();
    const restored = await request.put(configUrl, {
      headers,
      data: {
        ...current,
        hideReviewDeveloperNames: initial.hideReviewDeveloperNames,
      },
    });
    expect(restored.ok()).toBe(true);
  }
});
