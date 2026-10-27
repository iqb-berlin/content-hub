import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type FrameLocator, type Page } from '@playwright/test';
import {
  test,
  expect,
  playerPool,
  playerPoolDirectory,
  openFormat,
  formatData,
  authenticatedGet,
  type FormatUnit,
} from './synthetic-players-support';

async function textInput(frame: FrameLocator, selector = 'input:not([type=hidden]), textarea') {
  const input = frame.locator(selector).first();
  await input.fill('Synthetische Antwort');
  await expect(input).toHaveValue('Synthetische Antwort');
}

async function mediaReady(frame: FrameLocator, selector: string) {
  const media = frame.locator(selector).first();
  if (selector === 'video') {
    await expect
      .poll(() => media.evaluate((element) => (element as HTMLVideoElement).readyState))
      .toBeGreaterThanOrEqual(2);
  }
  await media.evaluate((element) => {
    const player = element as HTMLMediaElement;
    player.addEventListener(
      'playing',
      () => {
        player.setAttribute(
          'data-synthetic-played',
          String(player.readyState >= 2 && player.duration > 0),
        );
      },
      { once: true },
    );
  });
  // Run playback in response to an actual click on the player's control.
  const controls = frame.locator('button').filter({ has: frame.locator('mat-icon') });
  await controls.first().click();
  // ASPECT clears audio.src after playback. Observe the real playing event so a
  // short sample cannot finish and clear its state before the assertion polls.
  await expect(media).toHaveAttribute('data-synthetic-played', 'true');
}

async function probe(page: Page, unit: FormatUnit, frame: FrameLocator) {
  switch (unit.probe) {
    case 'text-field':
    case 'text-field-simple':
    case 'text-area':
    case 'cloze':
    case 'table':
      await textInput(frame);
      break;
    case 'radio':
    case 'toggle-button':
      await frame.getByRole('radio', { name: 'See', exact: true }).click();
      await expect(frame.getByRole('radio', { name: 'See', exact: true })).toBeChecked();
      break;
    case 'checkbox':
      await frame.getByRole('checkbox', { name: 'Wasser mitnehmen', exact: true }).check();
      await frame.getByRole('checkbox', { name: 'Brot mitnehmen', exact: true }).check();
      await expect(frame.getByRole('checkbox')).toHaveCount(2);
      for (const input of await frame.getByRole('checkbox').all())
        await expect(input).toBeChecked();
      break;
    case 'dropdown':
      await frame.getByRole('combobox').click();
      await frame.getByRole('option', { name: 'See', exact: true }).click();
      await expect(frame.getByRole('combobox')).toContainText('See');
      break;
    case 'radio-group-images':
      await frame.getByRole('radio').first().check();
      await expect(frame.getByRole('radio').first()).toBeChecked();
      await expect(frame.locator('img').first()).toBeVisible();
      break;
    case 'likert':
      await frame.getByRole('radio').last().check();
      await expect(frame.getByRole('radio').last()).toBeChecked();
      await expect(frame.getByText('Wasser ist sinnvoll', { exact: true })).toBeVisible();
      break;
    case 'slider': {
      const input = frame.getByRole('slider');
      await input.focus();
      await input.press('End');
      await expect(input).toHaveValue('10');
      break;
    }
    case 'spell-correct':
      await frame.getByRole('button', { name: 'Farrad', exact: true }).click();
      await frame.locator('input').fill('Fahrrad');
      await expect(frame.locator('input')).toHaveValue('Fahrrad');
      break;
    case 'math-field': {
      const input = frame.locator('math-field').first();
      await input.click();
      await input.pressSequentially('2+3');
      await expect
        .poll(() => input.evaluate((element) => (element as HTMLElement & { value: string }).value))
        .toBe('2+3');
      break;
    }
    case 'text-area-math': {
      await frame.locator('aspect-text-area-math .text-area').click();
      const input = frame.locator('[contenteditable=true]').first();
      await input.fill('Rechnung');
      await expect(input).toContainText('Rechnung');
      await frame.getByRole('button', { name: 'Formel einfügen', exact: true }).click();
      await expect(frame.locator('math-field')).toBeVisible();
      break;
    }
    case 'math-table': {
      const cell = frame.locator('td[contenteditable=true]').last();
      await cell.click();
      await cell.press('5');
      await expect(cell).toContainText('5');
      break;
    }
    case 'drag': {
      const source = frame.locator('.drop-list-item').filter({ hasText: 'See' });
      const target = frame.locator('.drop-list').last();
      await drag(page, source, target);
      await expect(target).toContainText('See');
      await expect(frame.locator('.drop-list').first()).not.toContainText('See');
      break;
    }
    case 'sort': {
      const items = frame.locator('.drop-list-item');
      await drag(page, items.filter({ hasText: 'Start' }), items.filter({ hasText: 'Ziel' }));
      await expect(items.first()).toContainText('Start');
      break;
    }
    case 'hotspot-image': {
      const hotspot = frame.locator('.active-hotspot').first();
      await hotspot.click();
      await expect(hotspot).toHaveCSS('background-color', 'rgb(225, 156, 48)');
      break;
    }
    case 'marking':
      await frame.locator('aspect-marking-panel button').first().click();
      await frame.getByText('Wasser', { exact: true }).click();
      await expect(
        frame.locator('aspect-markable-word').filter({ hasText: 'Wasser' }).locator('span').first(),
      ).toHaveText('Wasser');
      await expect(
        frame.locator('aspect-markable-word').filter({ hasText: 'Wasser' }).locator('span').first(),
      ).toHaveCSS('background-color', 'rgb(249, 248, 113)');
      break;
    case 'image':
      await expect(frame.locator('aspect-image img')).toBeVisible();
      await expect
        .poll(() => frame.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
        .toBe(240);
      break;
    case 'audio':
    case 'video':
      await mediaReady(frame, unit.probe);
      break;
    case 'frame':
      await expect(frame.locator('aspect-frame')).toBeVisible();
      await expect(frame.locator('aspect-frame div').first()).toHaveCSS(
        'background-color',
        'rgb(229, 242, 248)',
      );
      break;
    case 'button':
      await frame.getByRole('button', { name: 'Zweite Seite öffnen', exact: true }).click();
      await expect(frame.getByText('Zweite Seite erreicht', { exact: true })).toBeVisible();
      break;
    case 'trigger':
      await expect(frame.getByText('Auslöser ausgeführt', { exact: true })).toBeVisible();
      break;
    case 'widget-periodic-table':
    case 'widget-molecule-editor':
      await frame.locator('.widget-container button').click();
      // These two tools belong to the Verona host. Content Pool currently has
      // no widget provider; verify the real request without supplying a fake tool.
      await expect
        .poll(() =>
          page.evaluate(() =>
            (
              window as unknown as { syntheticWidgetCalls: { widgetType: string }[] }
            ).syntheticWidgetCalls.map((call) => call.widgetType),
          ),
        )
        .toEqual([unit.probe === 'widget-periodic-table' ? 'PERIODIC_TABLE' : 'MOLECULE_EDITOR']);
      break;
    case 'geometry': {
      const geometry = frame.locator('aspect-geometry');
      await expect(geometry.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
      await expect(geometry.locator('.GeoGebraFrame')).toBeVisible();
      // Select the point in the real applet and move it with the keyboard;
      // read the resulting coordinate independently through the geometry API.
      const before = await geometry.evaluate((element) => {
        const api = (
          element.ownerDocument.defaultView as unknown as Window & {
            input: {
              getXcoord: (id: string) => number;
              getYcoord: (id: string) => number;
              getXML: () => string;
            };
          }
        ).input;
        const xml = new DOMParser().parseFromString(api.getXML(), 'application/xml');
        const coordinates = xml.querySelector('euclidianView coordSystem')!;
        return {
          x: api.getXcoord('A'),
          pixelX:
            Number(coordinates.getAttribute('xZero')) +
            api.getXcoord('A') * Number(coordinates.getAttribute('scale')),
          pixelY:
            Number(coordinates.getAttribute('yZero')) -
            api.getYcoord('A') * Number(coordinates.getAttribute('yscale')),
        };
      });
      const canvas = geometry.locator('canvas').first();
      await canvas.click({ position: { x: before.pixelX, y: before.pixelY } });
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(() =>
          geometry.evaluate((element) =>
            (
              element.ownerDocument.defaultView as unknown as Window & {
                input: { getXcoord: (id: string) => number };
              }
            ).input.getXcoord('A'),
          ),
        )
        .not.toBe(before.x);
      break;
    }
    case 'abi':
      await frame.locator('input:not([type]), input[type=text]').first().fill('Fahrrad');
      await expect(frame.locator('input:not([type]), input[type=text]').first()).toHaveValue(
        'Fahrrad',
      );
      await frame.locator('textarea').fill('Wasser gegen Durst');
      await expect(frame.locator('textarea')).toHaveValue('Wasser gegen Durst');
      await frame.locator('input:not([type]), input[type=text]').nth(1).fill('3');
      await expect(frame.locator('input:not([type]), input[type=text]').nth(1)).toHaveValue('3');
      await frame.getByRole('checkbox').first().check();
      await expect(frame.getByRole('checkbox').first()).toBeChecked();
      await frame.getByRole('checkbox').nth(1).check();
      await frame.getByRole('checkbox').nth(2).check();
      await expect(frame.getByRole('checkbox').nth(1)).toBeChecked();
      await expect(frame.getByRole('checkbox').nth(2)).toBeChecked();
      await frame.getByRole('radio', { name: 'See', exact: true }).check();
      await expect(frame.getByRole('radio', { name: 'See', exact: true })).toBeChecked();
      await frame.getByRole('combobox').click();
      await frame.getByRole('option', { name: 'Fahrrad', exact: true }).click();
      await expect(frame.getByRole('combobox')).toContainText('Fahrrad');
      await frame.getByRole('radio').last().check();
      await expect(frame.getByRole('radio').last()).toBeChecked();
      break;
    case 'abi-dynamic':
      await expect(frame.getByText('Noch keine Zusatzfrage', { exact: true })).toBeVisible();
      await frame.getByRole('checkbox').first().check();
      await expect(frame.getByText('Noch keine Zusatzfrage', { exact: true })).toBeHidden();
      await frame.locator('input:not([type]), input[type=text]').first().fill('Wasser');
      await frame.locator('input[type=number]').fill('2');
      await frame.getByRole('button', { name: 'Anwenden', exact: true }).click();
      for (const [index, value] of [
        [1, 'Start'],
        [2, 'See'],
      ] as const) {
        await frame.getByRole('button', { name: `Haltepunkt ${index}`, exact: true }).click();
        const input = frame.getByRole('textbox', { name: 'Ort', exact: true });
        await input.fill(value);
        await expect(input).toHaveValue(value);
      }
      await frame.locator('player-nav-button-group button').last().click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { syntheticPlayerNavigation: string[] })
                .syntheticPlayerNavigation,
          ),
        )
        .toContain('next');
      break;
    case 'speed-choice':
    case 'speed-audio':
    case 'speed-inline':
      if (unit.probe === 'speed-audio') {
        await frame.locator('.large-audio-button').click();
        await expect
          .poll(() => frame.locator('audio').evaluate((e) => (e as HTMLAudioElement).currentTime))
          .toBeGreaterThan(0);
      }
      await frame.getByRole('button', { name: 'See', exact: true }).click();
      await expect(frame.getByText('Keine weiteren Seiten.', { exact: false })).toBeVisible();
      break;
    case 'speed-image-answer':
      await expect(frame.locator('.answers img')).toHaveCount(2);
      await frame.locator('.answers img').first().click();
      await expect(frame.getByText('Keine weiteren Seiten.', { exact: false })).toBeVisible();
      break;
    case 'speed-audio-answer':
      await frame.locator('.audio-button').first().click();
      await expect
        .poll(() =>
          frame
            .locator('audio')
            .first()
            .evaluate((e) => (e as HTMLAudioElement).currentTime),
        )
        .toBeGreaterThan(0);
      await frame.getByRole('button', { name: 'See', exact: true }).click();
      await expect(frame.getByText('Keine weiteren Seiten.', { exact: false })).toBeVisible();
      break;
    case 'speed-number':
      await frame.getByRole('button', { name: '1', exact: true }).click();
      await frame.getByRole('button', { name: '2', exact: true }).click();
      await expect(frame.locator('.number-result-box')).toHaveText(['1', '2']);
      await frame.locator('.unit-nav-next button').click();
      await expect(frame.getByText('Keine weiteren Seiten.', { exact: false })).toBeVisible();
      break;
    case 'speed-word':
      await frame
        .locator('.question span')
        .filter({ hasText: /^\s*See\s*$/ })
        .click();
      await expect(frame.locator('.question span.selected')).toContainText('See');
      await frame.locator('.unit-nav-next button').click();
      await expect(frame.getByText('Keine weiteren Seiten.', { exact: false })).toBeVisible();
      break;
    case 'speed-multiple':
      await frame.getByRole('button', { name: 'See', exact: true }).click();
      await frame.getByRole('button', { name: 'Bahnhof', exact: true }).click();
      await expect(frame.locator('.answers button.selected')).toHaveCount(2);
      await frame.locator('.unit-nav-next button').click();
      await expect(frame.getByText('Keine weiteren Seiten.', { exact: false })).toBeVisible();
      break;
    case 'mono-binary':
    case 'mono-ternary':
      await frame
        .locator(unit.probe === 'mono-binary' ? '#speed-button-label-A' : '#speed-button-label-C')
        .click();
      await expect(frame.locator('input[type=radio]:checked')).toHaveValue(
        unit.probe === 'mono-binary' ? 'A' : 'C',
      );
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  syntheticPlayerStates: { unitState?: { dataParts?: { main?: string } } }[];
                }
              ).syntheticPlayerStates
                .flatMap((message) => JSON.parse(message.unitState?.dataParts?.main || '[]'))
                .find((response) => response.id === 'ANSWER')?.value,
          ),
        )
        .toBe(unit.probe === 'mono-binary' ? 'A' : 'C');
      break;
    case 'simple':
      await frame.getByLabel('Kurzantwort', { exact: true }).fill('Fahrrad');
      await expect(frame.getByLabel('Kurzantwort', { exact: true })).toHaveValue('Fahrrad');
      await frame.getByLabel('Begründung', { exact: true }).fill('Wasser gegen Durst');
      await frame.getByLabel('Anzahl', { exact: true }).fill('3');
      await frame.getByRole('checkbox', { name: 'Wasser', exact: true }).check();
      await expect(frame.getByRole('checkbox', { name: 'Wasser', exact: true })).toBeChecked();
      await frame.getByRole('radio', { name: 'See', exact: true }).check();
      await expect(frame.getByRole('radio', { name: 'See', exact: true })).toBeChecked();
      await frame.locator('select[name=LIST]').selectOption({ label: 'See' });
      await expect(frame.locator('select[name=LIST]')).toHaveValue('See');
      await frame.locator('select[name=MULTI]').selectOption(['Brot', 'Wasser']);
      await expect(frame.locator('select[name=MULTI]').locator('option:checked')).toHaveCount(2);
      await frame.getByLabel('Entfernung', { exact: true }).focus();
      await frame.getByLabel('Entfernung', { exact: true }).press('End');
      await expect(frame.getByLabel('Entfernung', { exact: true })).toHaveValue('10');
      await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
      await frame.getByLabel('Datum', { exact: true }).fill('2026-10-27');
      await frame.getByLabel('Uhrzeit', { exact: true }).fill('12:30');
      await frame.getByLabel('Farbe', { exact: true }).fill('#166b8c');
      await frame.getByRole('textbox', { name: 'Freier Text', exact: true }).fill('Eigener Text');
      await expect(frame.getByRole('textbox', { name: 'Freier Text', exact: true })).toHaveText(
        'Eigener Text',
      );
      await page.getByRole('button', { name: '← Vorherige Seite', exact: true }).click();
      await expect(frame.getByLabel('Kurzantwort', { exact: true })).toHaveValue('Fahrrad');
      break;
    case 'ib': {
      const runtime = frame.frameLocator('#ib-runtime-host');
      await runtime.locator('input[type=text]').fill('Fahrrad');
      await expect(runtime.locator('input[type=text]')).toHaveValue('Fahrrad');
      await runtime.getByText('Wasser mitnehmen', { exact: true }).click();
      await expect(runtime.locator('input[type=checkbox]')).toBeChecked();
      await runtime.getByRole('button', { name: 'Nächste Aufgabe', exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { syntheticPlayerNavigation: string[] })
                .syntheticPlayerNavigation,
          ),
        )
        .toContain('next');
      break;
    }
    default:
      throw new Error(`No browser probe for ${unit.id}: ${unit.probe}`);
  }
}

async function drag(
  page: Page,
  source: ReturnType<FrameLocator['locator']>,
  target: ReturnType<FrameLocator['locator']>,
) {
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  const end = await target.boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(start!.x + start!.width / 2 + 10, start!.y + start!.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 20 });
  await page.mouse.up();
}

for (const unit of playerPool.units) {
  test(`covers ${unit.player} / ${unit.id}: ${unit.formats.join(', ')}`, async ({
    page,
  }, testInfo) => {
    const data = await formatData(page, unit.id);
    expect(data.name).toBe(unit.name);
    const player = playerPool.players.find((entry) => entry.id === unit.player)!;
    const local = readFileSync(resolve(playerPoolDirectory, player.file));
    expect(createHash('sha256').update(local).digest('hex')).toBe(player.sha256);
    const served = await authenticatedGet(
      page,
      data.dependencies.find((entry) => entry.type === 'PLAYER')!.downloadUrl,
    );
    expect(
      createHash('sha256')
        .update(await served.body())
        .digest('hex'),
    ).toBe(player.sha256);
    const frame = await openFormat(page, unit);
    await probe(page, unit, frame);
    if (unit.expected.response) {
      await expect
        .poll(() =>
          page.evaluate(() => {
            const states = (
              window as unknown as {
                syntheticPlayerStates: { unitState?: { dataParts?: Record<string, string> } }[];
              }
            ).syntheticPlayerStates;
            const responses = states.flatMap((message) =>
              JSON.parse(message.unitState?.dataParts?.['question_0'] || '[]'),
            );
            const answer = responses.find((response) => response.id === 'value');
            return answer && { value: answer.value, code: answer.code, score: answer.score };
          }),
        )
        .toEqual(unit.expected.response);
    }
    if (unit.player === 'speed-mono') {
      const time = await page.evaluate(() => {
        const states = (
          window as unknown as {
            syntheticPlayerStates: { unitState?: { dataParts?: Record<string, string> } }[];
          }
        ).syntheticPlayerStates;
        return states
          .flatMap((message) => JSON.parse(message.unitState?.dataParts?.['main'] || '[]'))
          .find((response) => response.id === 'TIME')?.value;
      });
      expect(time).toBeGreaterThanOrEqual(0);
    }
    const path = testInfo.outputPath(`${unit.id}.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(`${unit.player}: ${unit.name}`, { path, contentType: 'image/png' });
  });
}
