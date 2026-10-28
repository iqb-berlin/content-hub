import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';
import { conditionalVisibilityDefinition } from './fixtures/conditional-visibility';

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

test('shows readable coding and a reversible partial solution in the booklet review', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installContent(page);
  const scheme = {
    variableCodings: [
      {
        id: 'internal-answer',
        alias: 'ANSWER',
        label: 'Kurzantwort',
        sourceType: 'BASE',
        manualInstruction: '<p>Die Hauptstadt nennen.</p>',
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            score: 1,
            label: 'Erwartet wird Berlin',
            manualInstruction: '<p>Sinngemäße Antworten akzeptieren.</p>',
            ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['Berlin'] }] }],
          },
          { id: 0, type: 'RESIDUAL_AUTO', score: 0 },
        ],
      },
      {
        id: 'essay',
        label: 'Begründung',
        sourceType: 'BASE',
        codeModel: 'MANUAL_ONLY',
        manualInstruction:
          '<p>Die Begründung muss einen nachvollziehbaren Zusammenhang enthalten.</p>',
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            score: 1,
            manualInstruction: '<p>Ein schlüssiges Beispiel genügt.</p>',
          },
        ],
      },
    ],
  };
  await page.route(`**/api/view/acp/${acpId}/units/review-u*`, (route) =>
    route.fulfill({
      json: {
        id: 'review-u1',
        name: 'Aufgabe 1',
        items: [],
        codingScheme: scheme,
        dependencies: [
          { type: 'PLAYER', downloadUrl: '/review-solution/player' },
          { type: 'UNIT_DEFINITION', downloadUrl: '/review-solution/definition' },
        ],
      },
    }),
  );
  const solutionPlayer = `<!doctype html><html><body><label>Antwort <input id="answer"></label>
    <script>
      let sessionId, currentPage;
      const input = document.getElementById('answer');
      function report() {
        parent.postMessage({ type:'vopStateChangedNotification', sessionId, timeStamp:new Date().toISOString(),
          unitState:{dataParts:{elementCodes:JSON.stringify([{id:'ANSWER',status:'VALUE_CHANGED',value:input.value}])}},
          playerState:{validPages:[{id:'0'},{id:'1'}],currentPage}}, '*');
      }
      input.oninput = () => setTimeout(report, 100);
      addEventListener('unload', report);
      addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'vopStartCommand') {
          sessionId = msg.sessionId; currentPage = msg.playerConfig.startPage || '0';
          const responses = JSON.parse(msg.unitState.dataParts.elementCodes || '[]');
          input.value = responses.find(r => r.id === 'ANSWER')?.value || '';
          document.body.dataset.session = sessionId; report();
        }
        if (msg.type === 'vopPageNavigationCommand' && msg.sessionId === sessionId) {
          currentPage = msg.target; report();
        }
      });
      parent.postMessage({type:'vopReadyNotification'}, '*');
    </script></body></html>`;
  await page.route('**/review-solution/*', (route) =>
    new URL(route.request().url()).pathname.endsWith('/player')
      ? route.fulfill({ contentType: 'text/html', body: solutionPlayer })
      : route.fulfill({
          json: {
            pages: [{}, { elements: [{ id: 'input', alias: 'ANSWER', type: 'text-field' }] }],
          },
        }),
  );
  await page.goto(reviewUrl);
  const answer = page
    .frameLocator('app-unit-view iframe')
    .getByRole('textbox', { name: 'Antwort' });
  await answer.fill('Hamburg');
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await expect(page.locator('.page-info')).toHaveText('Seite 2 / 2');
  // Match ASPECT: its debounced input report can still be pending when the frame unloads.
  await answer.fill('Letzte eigene Eingabe');
  await page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }).click();
  await expect(answer).toHaveValue('Berlin');
  await expect(page.locator('.page-info')).toHaveText('Seite 2 / 2');
  const coding = page.locator('.coding-content');
  await expect(coding).toContainText('Teilweise Musterlösung: 1 von 2');
  await expect(coding).toContainText('Sinngemäße Antworten akzeptieren.');
  await expect(coding).toContainText("Übereinstimmung (Zahl/Text) mit 'Berlin'");
  await expect(coding).toContainText('Ein schlüssiges Beispiel genügt.');
  await page.screenshot({
    path: testInfo.outputPath('review-solution-desktop.png'),
    fullPage: true,
  });
  await answer.fill('Änderung im Lösungsmodus');
  await page.getByRole('button', { name: 'Musterlösung ausblenden', exact: true }).click();
  await expect(answer).toHaveValue('Letzte eigene Eingabe');
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expect(answer).toHaveValue('');
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }).click();
  await expect(answer).toHaveValue('Berlin');
  await expect(coding).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('review-solution-mobile.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

for (const mode of ['move', 'copy', 'conflict'] as const) {
  test(`real ASPECT review reconciles ${mode} drag solutions and preserves personal answers`, async ({
    page,
  }, testInfo) => {
    await installContent(page);
    const errors: string[] = [];
    const answerWrites: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/\/response-state(?:\?|$)/.test(request.url()) && request.method() !== 'GET') {
        answerWrites.push(request.url());
      }
    });
    const template = conditionalVisibilityDefinition();
    const taskPage = template.pages[1];
    const section = taskPage.sections[0];
    const model = section.elements[0];
    const element = (id: string, row: number, extra: object) => ({
      ...model,
      type: 'drop-list',
      id: `internal-${id}`,
      alias: id,
      label: id === 'POOL' ? 'Vorrat' : `Rucksack ${id}`,
      isSortList: false,
      copyOnDrop: false,
      ...extra,
      position: { ...model.position, gridRow: row },
    });
    const definition = {
      ...template,
      stateVariables: [],
      pages: [
        {
          ...taskPage,
          sections: [
            {
              ...section,
              visibilityRules: [],
              height: 420,
              elements: [
                element('POOL', 1, {
                  onlyOneItem: false,
                  copyOnDrop: mode === 'copy',
                  connectedTo: ['internal-A', 'internal-B'],
                  value: [
                    { id: 'object-X', alias: 'X', text: 'Brot' },
                    { id: 'object-Y', alias: 'Y', text: 'Wasser' },
                    { id: 'object-Z', alias: 'Z', text: 'Apfel' },
                  ],
                }),
                ...['A', 'B'].map((id, index) =>
                  element(id, index + 2, {
                    onlyOneItem: true,
                    connectedTo: ['internal-POOL'],
                    value: [],
                  }),
                ),
              ],
              gridRowSizes: [1, 2, 3].map(() => ({ value: 'auto', unit: '' })),
            },
          ],
        },
      ],
    };
    const variable = (alias: string, value: string) => ({
      id: `internal-${alias}`,
      alias,
      sourceType: 'BASE',
      codes: [
        {
          id: 1,
          type: 'FULL_CREDIT',
          score: 1,
          ruleSets: [{ rules: [{ method: 'MATCH', parameters: [value] }] }],
        },
        { id: 0, type: 'RESIDUAL_AUTO', score: 0 },
      ],
    });
    const scheme = {
      variableCodings: [variable('A', 'X'), variable('B', mode === 'move' ? 'Y' : 'X')],
    };
    await page.route(`**/api/view/acp/${acpId}/units/review-u*`, (route) =>
      route.fulfill({
        json: {
          id: 'review-u1',
          name: 'Rucksäcke packen',
          items: [],
          codingScheme: scheme,
          dependencies: [
            { type: 'PLAYER', downloadUrl: '/review-drag/player' },
            { type: 'UNIT_DEFINITION', downloadUrl: '/review-drag/definition' },
          ],
        },
      }),
    );
    await page.route('**/review-drag/player*', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: readFileSync(join(__dirname, '../tmp/aspect-3.0.1.html'), 'utf8'),
      }),
    );
    await page.route('**/review-drag/definition*', (route) => route.fulfill({ json: definition }));
    await page.goto(reviewUrl);
    const player = page.frameLocator('app-unit-view iframe');
    const pool = player.locator('[data-element-id="internal-POOL"]');
    const targetA = player.locator('[data-element-id="internal-A"]');
    const targetB = player.locator('[data-element-id="internal-B"]');
    await expect(pool.getByText('Wasser', { exact: true })).toBeVisible();
    await pool.getByText('Wasser', { exact: true }).dragTo(targetA);
    await expect(targetA).toContainText('Wasser');
    await page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }).click();
    if (mode === 'conflict') {
      await expect(page.locator('.coding-content')).toContainText(
        'widersprüchliche Objektbelegungen',
      );
      await expect(targetA).toContainText('Wasser');
      await expect(
        page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
      ).toHaveAttribute('aria-pressed', 'false');
    } else {
      await expect(targetA).toContainText('Brot');
      await expect(targetA).not.toContainText('Wasser');
      await expect(targetB).toContainText(mode === 'copy' ? 'Brot' : 'Wasser');
      await expect(pool).toContainText('Apfel');
      if (mode === 'copy') {
        await expect(pool).toContainText('Brot');
        await expect(pool).toContainText('Wasser');
      } else {
        await expect(pool).not.toContainText('Brot');
        await expect(pool).not.toContainText('Wasser');
      }
      await page.getByRole('button', { name: 'Musterlösung ausblenden', exact: true }).click();
      await expect(targetA).toContainText('Wasser');
      await expect(targetA).not.toContainText('Brot');
      await expect(targetB).not.toContainText('Brot');
      await expect(targetB).not.toContainText('Wasser');
    }
    await page.screenshot({ path: testInfo.outputPath(`review-drag-${mode}.png`), fullPage: true });
    expect(answerWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
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

test('persists hiding the metadata tab across reload and task changes and can restore it', async ({
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
      name: 'Reiter „Metadaten“ ausblenden',
      exact: true,
    });
    const developerSetting = page.getByRole('checkbox', {
      name: 'Namen und Kürzel der Aufgabenentwickler/innen ausblenden',
    });
    await setting.check();
    await expect(developerSetting).toBeDisabled();
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(configUrl) && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Review-Konfiguration speichern', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    await page.reload();
    await expect(setting).toBeChecked();
    await page.goto(reviewUrl);
    await expect(
      page.getByRole('heading', { name: 'Aufgabe 1 (review-u1)', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kodierung', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Metadaten', exact: true })).toHaveCount(0);
    await expect(page.locator('.meta-dl')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('review-metadata-tab-hidden.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Aufgabe 2 (review-u2)', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Metadaten', exact: true })).toHaveCount(0);

    await page.goto(`/view/${acpId}/unit/review-u1`);
    await page.getByRole('button', { name: 'Zusatzdaten anzeigen', exact: true }).click();
    await expect(page.locator('.meta-dl')).toContainText('Deutsch');

    await page.goto(`/view/${acpId}/review/manage`);
    await setting.uncheck();
    await expect(developerSetting).toBeEnabled();
    const shown = page.waitForResponse(
      (response) => response.url().endsWith(configUrl) && response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Review-Konfiguration speichern', exact: true }).click();
    expect((await shown).ok()).toBe(true);
    await page.goto(reviewUrl);
    await page.getByRole('button', { name: 'Metadaten', exact: true }).click();
    await expect(page.locator('.meta-dl')).toContainText('Deutsch');
  } finally {
    const current = await (await request.get(configUrl, { headers })).json();
    const restored = await request.put(configUrl, {
      headers,
      data: { ...current, hideReviewMetadata: initial.hideReviewMetadata },
    });
    expect(restored.ok()).toBe(true);
  }
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
