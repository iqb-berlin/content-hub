import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, Page, test } from '@playwright/test';
import { installOidcSession } from './oidc-test-session';
import {
  conditionalVisibilityDefinition,
  firstPageTriggerDefinition,
  persistentVisibilityDefinition,
  persistentMediaVisibilityDefinition,
  responseVisibilityDefinition,
} from './fixtures/conditional-visibility';

const ACP_ID = '10000000-0000-4000-8000-000000000101';
const playerHtml = readFileSync(join(__dirname, '../tmp/aspect-3.0.1.html'), 'utf8');
const rowA = '#item-explorer-row-regression-item-uuid-1';
const rowB = '#item-explorer-row-regression-item-uuid-2';

async function openPreview(
  page: Page,
  options: {
    enabled?: boolean;
    definition?: ReturnType<typeof conditionalVisibilityDefinition>;
    saved?: Record<string, string>;
  } = {},
) {
  await installOidcSession(page, '10000000-0000-4000-8000-000000000002', 'e2e-manager');
  await page.route(`**/api/view/acp/${ACP_ID}`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.featureConfig = {
      ...json.featureConfig,
      enableItemExplorerConditionalVisibility: options.enabled !== false,
    };
    await route.fulfill({ response, json });
  });
  const targets = [
    ['regression-item-uuid-1', 'V1'],
    ['regression-item-uuid-2', 'V2'],
  ];
  // Other suites publish a V2 override for row A. Keep the synthetic definition's
  // mapping consistent in reads AND draft writes, including their response envelopes.
  await page.route(`**/api/view/acp/${ACP_ID}/item-explorer/state*`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const state of [json.activeState, json.draftState, json.publishedState]) {
      if (!state) continue;
      for (const [rowKey, target] of targets) {
        state.itemProperties = { ...state.itemProperties, [rowKey]: { previewTargetId: target } };
      }
    }
    await route.fulfill({ response, json });
  });
  await page.route(`**/api/acp/${ACP_ID}/item-explorer/draft`, async (route) => {
    const body = route.request().postDataJSON();
    for (const [rowKey, target] of targets) {
      body.patch.itemProperties = {
        ...body.patch.itemProperties,
        [rowKey]: { ...body.patch.itemProperties?.[rowKey], previewTargetId: target },
      };
    }
    await route.continue({ postData: JSON.stringify(body) });
  });
  await page.route(`**/api/acp/${ACP_ID}/items/*/response-state/with-fallback`, (route) =>
    route.fulfill({
      json: { state: options.saved ? { responseData: options.saved } : null, isFallback: false },
    }),
  );
  await page.route(`**/api/acp/${ACP_ID}/files/unit-view/u1*`, async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.dependencies = [
      {
        fileId: 'visibility-player',
        type: 'PLAYER',
        downloadUrl: '/api/visibility-fixture/player',
      },
      {
        fileId: 'visibility-definition',
        type: 'UNIT_DEFINITION',
        downloadUrl: '/api/visibility-fixture/definition',
      },
    ];
    await route.fulfill({ response, json });
  });
  await page.route('**/api/visibility-fixture/player*', (route) =>
    route.fulfill({ contentType: 'text/html', body: playerHtml }),
  );
  await page.route('**/api/visibility-fixture/definition*', (route) =>
    route.fulfill({ json: options.definition || conditionalVisibilityDefinition() }),
  );
  await page.goto(`/view/${ACP_ID}/item-explorer`);
  await expect(page.locator(rowA)).toBeVisible();
}

test('real Aspect switches stimulus A → B → A and blocks synthetic answer saving', async ({
  page,
}, info) => {
  await openPreview(page);
  const frame = page.frameLocator('iframe.player-iframe');
  for (const [row, visible, hidden] of [
    [rowA, 'A', 'B'],
    [rowB, 'B', 'A'],
    [rowA, 'A', 'B'],
  ]) {
    await page.locator(row).click();
    await expect(frame.getByText(`Aufgabe ${visible}`, { exact: true })).toBeVisible();
    await expect(frame.getByText(`Stimulus nur für ${visible}`, { exact: true })).toBeVisible();
    await expect(frame.getByText(`Stimulus nur für ${hidden}`, { exact: true })).toBeHidden();
    await expect(page.locator('.preview-state-note')).toContainText(
      'Vorbereiteter Vorschauzustand',
    );
  }
  await page.getByText('Weitere Aktionen ▾', { exact: true }).last().click();
  await expect(
    page.getByRole('button', { name: 'Player-Eingaben speichern …', exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath('conditional-stimulus.png'), fullPage: true });
});

test('disabled option keeps the existing overview with both stimulus sections', async ({
  page,
}) => {
  await openPreview(page, { enabled: false });
  await page.locator(rowA).click();
  const frame = page.frameLocator('iframe.player-iframe');
  await expect(frame.getByText('Stimulus nur für A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Stimulus nur für B', { exact: true })).toBeVisible();
  await expect(page.locator('.preview-state-note')).toHaveCount(0);
});

test('reference retains a stimulus revealed earlier on a regular task page after A → B → A', async ({
  page,
}) => {
  await openPreview(page, { definition: persistentVisibilityDefinition() });
  const frame = page.frameLocator('iframe.player-iframe');
  for (const row of [rowA, rowB, rowA]) {
    await page.locator(row).click();
    await expect(
      frame.getByText(row === rowA ? 'Aufgabe A' : 'Aufgabe B', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Itemansicht wird vorbereitet …', { exact: true })).toHaveCount(0);
    if (row === rowA)
      await expect(frame.getByText('Bleibender Stimulus', { exact: true })).toBeVisible();
  }
});

test('first-page reference executes offscreen triggers before focusing the item', async ({
  page,
}) => {
  await openPreview(page, { definition: firstPageTriggerDefinition() });
  await page.locator(rowA).click();
  const target = page.frameLocator('iframe.player-iframe').getByText('Aufgabe A', { exact: true });
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  await expect(page.getByText('Itemansicht wird vorbereitet …', { exact: true })).toHaveCount(0);
});

test('captured context and frame restarts retain persistent visibility without replay', async ({
  page,
}) => {
  await openPreview(page, { definition: persistentVisibilityDefinition() });
  await page.locator(rowA).click();
  const frame = page.frameLocator('iframe.player-iframe');
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await expect(page.getByText('Itemansicht wird vorbereitet …', { exact: true })).toHaveCount(0);
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Diese Itemansicht als Kontext übernehmen', exact: true })
    .click();
  const resetContext = page.getByRole('button', {
    name: 'Übernommenen Kontext zurücksetzen',
    exact: true,
  });
  await expect(resetContext).toBeVisible();
  await expect(frame.getByText('Bleibender Stimulus', { exact: true })).toBeVisible();
  await expect(page.getByText(/Übernommener Vorschaukontext\./)).toBeVisible();
  await page.locator('#preview-paging-mode').selectOption('separate');
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Bleibender Stimulus', { exact: true })).toBeVisible();
  await resetContext.click();
  await expect(resetContext).toHaveCount(0);
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Bleibender Stimulus', { exact: true })).toBeVisible();
});

test('reference context ignores stored answers until the editing view is explicitly selected', async ({
  page,
}) => {
  await openPreview(page, {
    saved: {
      stateVariableCodes: JSON.stringify([{ id: 'Context', status: 'VALUE_CHANGED', value: '1' }]),
    },
  });
  await page.locator(rowB).click();
  const frame = page.frameLocator('iframe.player-iframe');
  await expect(frame.getByText('Stimulus nur für B', { exact: true })).toBeVisible();
  await expect(frame.getByText('Stimulus nur für A', { exact: true })).toBeHidden();
  await expect(page.locator('.preview-state-note')).toContainText('Vorbereiteter Vorschauzustand');
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page.locator('#preview-context-mode').selectOption('answers');
  await expect(frame.getByText('Stimulus nur für A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Stimulus nur für B', { exact: true })).toBeHidden();
  await expect(page.locator('.preview-state-note')).toHaveCount(0);
  await page.getByText('Weitere Aktionen ▾', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Player-Eingaben speichern …', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zustand speichern' })).toBeVisible();
  await expect(page.locator('.overlay-dialog')).not.toContainText('Kein Zustand zum Speichern');
});

test('numeric predicates keep the original flow available and accept an explicit item context', async ({
  page,
}) => {
  const definition = conditionalVisibilityDefinition();
  definition.pages[1].sections[0].visibilityRules[0].operator = '>';
  await openPreview(page, { definition });
  await page.locator(rowA).click();
  await expect(page.locator('iframe.player-iframe')).toHaveCount(1);
  await expect(page.getByText(/Diese Ansicht benötigt den regulären Aufgabenablauf/)).toBeVisible();
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page.locator('#preview-state-context').fill('2');
  await page.locator('#preview-state-context').press('Tab');
  const frame = page.frameLocator('iframe.player-iframe');
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Stimulus nur für B', { exact: true })).toBeVisible();
  await expect(frame.getByText('Stimulus nur für A', { exact: true })).toBeHidden();
});

test('media history uses the original flow and a captured context retains its stimulus', async ({
  page,
}) => {
  const definition = persistentMediaVisibilityDefinition();
  await openPreview(page, { definition });
  await page.locator(rowA).click();
  const frame = page.frameLocator('iframe.player-iframe');
  await expect(page.getByText(/Diese Ansicht benötigt den regulären Aufgabenablauf/)).toBeVisible();
  await expect(frame.getByText('Bleibender Medienstimulus', { exact: true })).toBeVisible();
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeHidden();
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page.locator('#preview-context-mode').selectOption('flow');
  // Drive the native media events with generated audio, independently of control-bar styling.
  await frame.locator('audio').evaluate(
    (audio: HTMLAudioElement, src) => {
      audio.src = src;
      audio.muted = true;
      return audio.play();
    },
    (definition.pages[0].sections[0].elements[0] as unknown as { src: string }).src,
  );
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await frame.locator('audio').evaluate((audio: HTMLAudioElement) => audio.pause());
  await expect(frame.getByText('Bleibender Medienstimulus', { exact: true })).toBeVisible();
  const capture = page.getByRole('button', {
    name: 'Diese Itemansicht als Kontext übernehmen',
    exact: true,
  });
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByText(/Übernommener Vorschaukontext\./)).toBeVisible();
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Bleibender Medienstimulus', { exact: true })).toBeVisible();
  await page.locator('#preview-paging-mode').selectOption('separate');
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await expect(frame.getByText('Bleibender Medienstimulus', { exact: true })).toBeVisible();
});

test('context capture waits for the state report following a newly visible item', async ({
  page,
}) => {
  // Hold the real player's answer report to make the DOM/protocol race deterministic.
  await page.addInitScript(() => {
    const state = window as typeof window & {
      holdAnswer?: boolean;
      heldAnswer?: unknown;
      releaseAnswer?: () => void;
    };
    window.addEventListener(
      'message',
      (event) => {
        if (!state.holdAnswer || event.data?.type !== 'vopStateChangedNotification') return;
        const codes = event.data.unitState?.dataParts?.elementCodes;
        if (
          !codes ||
          !JSON.parse(codes).some(
            (code: { id: string; value: unknown }) => code.id === 'Gate' && code.value === 'open',
          )
        )
          return;
        event.stopImmediatePropagation();
        state.heldAnswer = event.data;
      },
      true,
    );
    state.releaseAnswer = () => {
      state.holdAnswer = false;
      window.dispatchEvent(
        new MessageEvent('message', {
          data: state.heldAnswer,
          source: document.querySelector<HTMLIFrameElement>('iframe.player-iframe')!.contentWindow,
        }),
      );
    };
  });
  await openPreview(page, { definition: responseVisibilityDefinition() });
  await page.locator(rowA).click();
  await page.getByText('Vorschau einstellen ▾', { exact: true }).click();
  await page.locator('#preview-context-mode').selectOption('flow');
  const frame = page.frameLocator('iframe.player-iframe');
  const capture = page.getByRole('button', {
    name: 'Diese Itemansicht als Kontext übernehmen',
    exact: true,
  });
  await expect(frame.getByRole('textbox')).toBeVisible();
  await expect(capture).toBeEnabled();
  await page.evaluate(() => {
    (window as any).holdAnswer = true;
  });
  await frame.getByRole('textbox').fill('open');
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
  await page.waitForFunction(() => (window as any).heldAnswer);
  await expect(capture).toBeDisabled();
  await page.evaluate(() => (window as any).releaseAnswer());
  await expect(capture).toBeEnabled();
  await capture.click();
  await expect(page.getByText(/Übernommener Vorschaukontext\./)).toBeVisible();
  await expect(frame.getByRole('textbox')).toHaveValue('open');
  await expect(frame.getByText('Aufgabe A', { exact: true })).toBeVisible();
});
