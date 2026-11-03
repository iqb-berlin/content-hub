import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { test as appTest, authenticatedGet } from './synthetic-players-support';
import { createModuleTestbed, loadModule } from '../../scripts/player-coverage/module-testbed.mjs';

const directory = resolve(__dirname, '../../test-fixtures/player-generations');
interface Generation {
  id: string;
  family: string;
  major: number;
  file: string;
  sha256: string;
  protocol: string;
  integrationStatus?: string;
}
interface GenerationUnit {
  id: string;
  name: string;
  file: string;
  player: string;
  element?: string;
  uiAuthoring?: { wizard: string };
  scenario?: {
    probe: {
      kind: string;
      hidden?: string;
      visible?: string;
      connective?: string;
      param?: string;
      type?: string;
      readOnly?: boolean;
      value?: boolean;
    };
  };
  authoringCases?: { id: string; changes: Record<string, unknown> }[];
}
const pool = JSON.parse(readFileSync(resolve(directory, 'pool.json'), 'utf8')) as {
  acpId: string;
  players: Generation[];
  units: GenerationUnit[];
};
const definition = (unit: GenerationUnit) =>
  JSON.parse(readFileSync(resolve(directory, unit.file), 'utf8')).definition;
let host: Awaited<ReturnType<typeof createModuleTestbed>>;
test.beforeAll(async () => {
  host = await createModuleTestbed(directory);
});
test.afterAll(async () => {
  await host.close();
});

for (const player of pool.players) {
  if (player.family === 'ib') continue; // Its external runtime is checked through the real app below.
  const unit = pool.units.find(
    (unit) =>
      unit.player === player.id &&
      (player.family === 'aspect'
        ? unit.element === 'text-field'
        : unit.id === player.id + '-inputs'),
  )!;
  if (player.integrationStatus) {
    test(`records the upstream ABI 2 development-build limitation`, async ({ page }) => {
      await page.goto(host.url);
      await page.evaluate((file) => {
        document.querySelector('iframe')!.src = '/module/' + file;
      }, player.file);
      await expect(
        page.frameLocator('iframe').getByText('Testscript Title', { exact: true }),
      ).toBeVisible();
      const ready = await page.evaluate(() =>
        (window as unknown as { moduleMessages: { type: string }[] }).moduleMessages.filter(
          (message) => message.type === 'vopReadyNotification',
        ),
      );
      expect(ready).toEqual([]);
    });
    continue;
  }
  test(`runs an authored task in ${player.id}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const bytes = readFileSync(resolve(directory, player.file));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(player.sha256);
    const content = definition(unit);
    // Major compatibility uses the task's independently selectable baseline page.
    if (player.family === 'aspect') content.pages = [content.pages[0]];
    const frame = await loadModule(page, host.url, player.file, content, false, player.protocol);
    if (player.family === 'speed-multi') {
      await frame.getByRole('button', { name: 'Richtig', exact: true }).click();
    } else if (player.family === 'speed-mono') {
      await frame.locator('#speed-button-label-A').click();
      await expect(frame.locator('input[type=radio]:checked')).toHaveValue('A');
    } else {
      const input = frame
        .locator('input[type=text]:visible, input:not([type]):visible, textarea:visible')
        .first();
      if (player.protocol === 'legacy-vo') await input.pressSequentially('Fahrrad');
      else await input.fill('Fahrrad');
      await expect(input).toHaveValue('Fahrrad');
      await input.press('Tab');
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.stringify((window as unknown as { moduleMessages: unknown[] }).moduleMessages),
          ),
        )
        .toContain('Fahrrad');
    }
    if (player.family === 'abi') await expect(frame.getByText(/Scriptfehler/)).toHaveCount(0);
    expect(errors).toEqual([]);
    await testInfo.attach(`${player.id}: authored task`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

for (const unit of pool.units.filter((unit) => unit.player === 'aspect-m3' && unit.element)) {
  test(`round-trips every authored ${unit.element} setting through ASPECT 3.1 UI`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const original = definition(unit);
    // tet.folio starts a separate runtime iframe per page, including offscreen pages.
    // Bound concurrent runtimes while still importing and exporting every original variant.
    const batchSize = unit.element === 'tetfolio' ? 8 : original.pages.length;
    for (let offset = 0; offset < original.pages.length; offset += batchSize) {
      const content = { ...original, pages: original.pages.slice(offset, offset + batchSize) };
      const frame = await loadModule(
        page,
        host.url,
        'players/aspect-editor-3.1.0.html',
        content,
        true,
      );
      // A real edit makes the original editor publish the definition it actually accepted.
      const alias = frame
        .locator('aspect-element-properties')
        .getByRole('textbox', { name: 'ID', exact: true });
      await alias.fill('UI_AUDIT');
      await alias.press('Tab');
      await page.waitForFunction(() =>
        (window as unknown as { moduleMessages: { type: string }[] }).moduleMessages.some(
          (message) => message.type === 'voeDefinitionChangedNotification',
        ),
      );
      const accepted = await page.evaluate(() => {
        const messages = (
          window as unknown as { moduleMessages: { type: string; unitDefinition: string }[] }
        ).moduleMessages;
        return JSON.parse(
          messages.filter((message) => message.type === 'voeDefinitionChangedNotification').at(-1)!
            .unitDefinition,
        );
      });
      expect(accepted.pages).toHaveLength(content.pages.length);
      for (const [index, scenario] of unit
        .authoringCases!.slice(offset, offset + batchSize)
        .entries()) {
        const first = accepted.pages[index].sections[0].elements[0];
        const element = unit.element === 'likert-row' ? first.rows[0] : first;
        for (const [path, expected] of Object.entries(scenario.changes)) {
          const actual = path.split('.').reduce((value, key) => value?.[key], element);
          expect(actual, `${unit.id} / ${scenario.id} / ${path}`).toEqual(expected);
        }
      }
      await expect(frame.getByText('Unerwarteter Fehler', { exact: true })).toHaveCount(0);
    }
  });
}

appTest(
  'serves every original generation and the ItemBuilder task through the real API',
  async ({ page }) => {
    appTest.setTimeout(90_000);
    for (const player of pool.players) {
      const unit = pool.units.find((unit) => unit.player === player.id)!;
      const data = await (
        await authenticatedGet(page, `/api/view/acp/${pool.acpId}/units/${unit.id}`)
      ).json();
      const download = data.dependencies.find(
        (entry: { type: string }) => entry.type === 'PLAYER',
      ).downloadUrl;
      const bytes = await (await authenticatedGet(page, download)).body();
      expect(createHash('sha256').update(bytes).digest('hex'), player.id).toBe(player.sha256);
    }
    const ib = pool.units.find((unit) => unit.player === 'ib-m0')!;
    await page.goto(`/view/${pool.acpId}/unit/${ib.id}`);
    const runtime = page.frameLocator('app-unit-view iframe').frameLocator('#ib-runtime-host');
    await runtime.locator('input[type=text]').fill('Fahrrad');
    await expect(runtime.locator('input[type=text]')).toHaveValue('Fahrrad');
    await runtime.getByText('Wasser mitnehmen', { exact: true }).click();
    await expect(runtime.locator('input[type=checkbox]')).toBeChecked();
  },
);

for (const wizard of [
  ...new Set(pool.units.filter((unit) => unit.uiAuthoring).map((unit) => unit.uiAuthoring!.wizard)),
]) {
  appTest(`renders every UI-created ${wizard} task through the app`, async ({ page }, testInfo) => {
    appTest.setTimeout(180_000);
    for (const unit of pool.units.filter((unit) => unit.uiAuthoring?.wizard === wizard)) {
      await page.goto(`/view/${pool.acpId}/unit/${unit.id}`);
      await expect(page.locator('app-unit-view h1')).toContainText(unit.name);
      const frame = page.frameLocator('app-unit-view iframe');
      await expect(frame.locator('aspect-page').first(), unit.id).toBeVisible();
      await expect(frame.getByText('Unerwarteter Fehler', { exact: true })).toHaveCount(0);
    }
    await testInfo.attach('UI-created ' + wizard, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
for (const unit of pool.units.filter((unit) =>
  [
    'visibility',
    'two-rules',
    'page-nav',
    'state',
    'unit-nav',
    'trigger-state',
    'trigger-highlight',
    'trigger-remove',
    'highlight',
    'media-chain',
    'hotspot',
  ].includes(unit.scenario?.probe.kind || ''),
)) {
  test(`executes connected ASPECT scenario ${unit.id}`, async ({ page }) => {
    const frame = await loadModule(page, host.url, 'players/aspect-major-3.html', definition(unit));
    const probe = unit.scenario!.probe;
    const result = frame.getByText(/^Treffer:/);
    if (probe.kind === 'visibility') {
      const input = frame.locator('input[type=text], input:not([type])');
      await input.fill(probe.hidden!);
      await input.press('Tab');
      await expect(result).toBeHidden();
      await input.fill(probe.visible!);
      await input.press('Tab');
      await expect(result).toBeVisible();
      await input.fill(probe.hidden!);
      await input.press('Tab');
      await expect(result).toBeHidden();
    } else if (probe.kind === 'two-rules') {
      const boxes = frame.getByRole('checkbox');
      await boxes.nth(0).check();
      if (probe.connective === 'conjunction') await expect(result).toBeHidden();
      else await expect(result).toBeVisible();
      await boxes.nth(1).check();
      await expect(result).toBeVisible();
    } else if (probe.kind === 'page-nav') {
      await frame.getByRole('button', { name: 'Weiter zur Packliste', exact: true }).click();
      await expect(frame.getByText('Zielseite: Packliste', { exact: true })).toBeVisible();
    } else if (probe.kind === 'state') {
      await expect(result).toBeHidden();
      await frame.getByRole('button', { name: 'Packliste freigeben', exact: true }).click();
      await expect(result).toBeVisible();
    } else if (probe.kind === 'hotspot') {
      const hotspot = frame.locator('.hotspot:not(.triangle-half-bottom-border)').first();
      const before = probe.value ? 'rgb(225, 156, 48)' : 'rgba(0, 0, 0, 0)';
      await expect(hotspot).toHaveCSS('background-color', before);
      if (probe.readOnly) await expect(hotspot).not.toHaveClass(/active-hotspot/);
      else {
        const image = frame.locator('aspect-hotspot-image .image-container');
        // Rotated/clipped triangles do not fill their bounding rectangle. Find a
        // visible hit target, then use a real pointer click through Playwright.
        const point = await image.evaluate((element: HTMLElement) => {
          const rect = element.getBoundingClientRect();
          for (let row = 0; row < 32; row++)
            for (let column = 0; column < 32; column++) {
              const x = ((column + 0.5) * rect.width) / 32;
              const y = ((row + 0.5) * rect.height) / 32;
              const inside = [
                [0, 0],
                [-4, -4],
                [-4, 4],
                [4, -4],
                [4, 4],
              ].every(([dx, dy]) => {
                const hit = element.ownerDocument.elementFromPoint(
                  rect.left + x + dx,
                  rect.top + y + dy,
                );
                return hit?.closest('.active-hotspot') && element.contains(hit);
              });
              if (inside) return { x, y };
            }
          return null;
        });
        expect(point, 'a visible, interactive hotspot point').not.toBeNull();
        await image.click({ position: point! });
        await expect(hotspot).toHaveCSS(
          'background-color',
          probe.value ? 'rgba(0, 0, 0, 0)' : 'rgb(225, 156, 48)',
        );
      }
    } else if (probe.kind === 'media-chain') {
      const players = frame.locator('aspect-audio');
      const first = players.nth(0).locator('button').filter({ hasText: 'play_arrow' });
      const second = players.nth(1).locator('button').filter({ hasText: 'play_arrow' });
      await expect(second).toBeDisabled();
      await first.click();
      await expect(second).toBeEnabled();
      const audio = players.nth(1).locator('audio');
      await audio.evaluate((element: HTMLAudioElement) =>
        element.addEventListener('playing', () => element.setAttribute('data-played', 'true'), {
          once: true,
        }),
      );
      await players.nth(1).locator('img.image-control').click();
      await expect(audio).toHaveAttribute('data-played', 'true');
    } else if (probe.kind === 'highlight') {
      await frame.getByRole('button', { name: 'See hervorheben', exact: true }).click();
      await expect(frame.locator('aspect-anchor[data-anchor-id=see]')).toHaveClass(/active-anchor/);
    } else if (probe.kind === 'trigger-state') {
      await expect(result).toBeVisible();
    } else if (probe.kind === 'trigger-highlight') {
      await expect(frame.locator('aspect-anchor[data-anchor-id=see]')).toHaveClass(/active-anchor/);
    } else if (probe.kind === 'trigger-remove') {
      const anchor = frame.locator('aspect-anchor[data-anchor-id=see]');
      await frame.getByRole('button', { name: 'See hervorheben', exact: true }).click();
      await expect(anchor).toHaveClass(/active-anchor/);
      await frame.getByRole('checkbox', { name: 'Hervorhebung entfernen', exact: true }).check();
      await expect(anchor).not.toHaveClass(/active-anchor/);
    } else {
      if (probe.type === 'button')
        await frame
          .getByRole('button', { name: 'Navigation: ' + probe.param, exact: true })
          .click();
      await expect
        .poll(() =>
          page.evaluate(() =>
            JSON.stringify((window as unknown as { moduleMessages: unknown[] }).moduleMessages),
          ),
        )
        .toContain('"target":"' + probe.param + '"');
    }
  });
}

test('interacts with the ASPECT 3 tet.folio element', async ({ page }, testInfo) => {
  await page.addInitScript(() =>
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'tetfolioReady')
        document.documentElement.setAttribute('data-tetfolio-ready', 'true');
    }),
  );
  const unit = pool.units.find(
    (unit) => unit.player === 'aspect-m3' && unit.element === 'tetfolio',
  )!;
  const content = definition(unit);
  content.pages = [content.pages[0]];
  const frame = await loadModule(page, host.url, 'players/aspect-major-3.html', content);
  // The original bridge reports readiness after its initial state/restore phase.
  await expect(frame.locator('html')).toHaveAttribute('data-tetfolio-ready', 'true');
  const embedded = frame.frameLocator('aspect-tetfolio iframe');
  await embedded.getByRole('button', { name: 'Flasche hinzufügen', exact: true }).click();
  await expect(embedded.locator('output')).toHaveText('1');
  await embedded.getByRole('button', { name: 'Flasche hinzufügen', exact: true }).click();
  await expect(embedded.locator('output')).toHaveText('2');
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.stringify((window as unknown as { moduleMessages: unknown[] }).moduleMessages),
      ),
    )
    .toContain('ibe_logger-fixture');
  await testInfo.attach('tet.folio interaction', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('uses the historical ASPECT string-grid settings in the original players', async ({
  page,
}) => {
  for (const major of [0, 1])
    for (const property of ['gridColumnSizes', 'gridRowSizes'])
      for (const unit of pool.units.filter((unit) =>
        unit.id.startsWith(`aspect-m${major}-section-${property}-`),
      )) {
        const content = definition(unit),
          value = content.pages[0].sections[0][property];
        const frame = await loadModule(
          page,
          host.url,
          `players/aspect-major-${major}.html`,
          content,
        );
        expect(
          await frame
            .locator('body')
            .evaluate(
              ({ ownerDocument }: HTMLElement, args: { property: string; value: string }) =>
                ownerDocument.defaultView!.CSS.supports(args.property, args.value),
              {
                property:
                  property === 'gridColumnSizes' ? 'grid-template-columns' : 'grid-template-rows',
                value,
              },
            ),
        ).toBe(true);
        const input = frame.locator('input[type=text],input:not([type])').first();
        await input.fill('Wasser');
        await expect(input).toHaveValue('Wasser');
      }
});

test('renders populated ASPECT table headers and the sticky-header setting', async ({ page }) => {
  const unit = pool.units.find((unit) => unit.id === 'aspect-m3-table')!;
  for (const id of ['headerRows-1', 'headerEnabled-1', 'stickyHeader-1']) {
    const content = definition(unit);
    const index = unit.authoringCases!.findIndex((scenario) => scenario.id === id);
    expect(index).toBeGreaterThan(-1);
    content.pages = [content.pages[index]];
    const frame = await loadModule(page, host.url, 'players/aspect-major-3.html', content);
    await expect(frame.locator('aspect-table .header-text')).toHaveText(['Gegenstand', 'Anzahl']);
    await expect(frame.locator('aspect-table .sticky-header')).toHaveCount(
      id === 'stickyHeader-1' ? 2 : 0,
    );
    const input = frame.locator('aspect-table input').first();
    await input.fill('Wasser');
    await expect(input).toHaveValue('Wasser');
  }
});
