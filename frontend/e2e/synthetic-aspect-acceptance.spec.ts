import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type FrameLocator, type Page } from '@playwright/test';
import { createModuleTestbed, loadModule } from '../../scripts/player-coverage/module-testbed.mjs';
import { preparePlayerHtml } from '../src/app/core/utils/player-html-compatibility';
import { clickInteractiveHotspot } from './synthetic-player-interactions';

const directory = resolve(__dirname, '../../test-fixtures/player-generations');
const pool = JSON.parse(readFileSync(resolve(directory, 'pool.json'), 'utf8')) as {
  units: { id: string; file: string; acceptance?: { kind: string; controls: string[] } }[];
};
let host: Awaited<ReturnType<typeof createModuleTestbed>>;
test.beforeAll(async () => {
  host = await createModuleTestbed(directory, 'http://127.0.0.1:3100', preparePlayerHtml);
});
test.afterAll(async () => {
  await host.close();
});

async function editAndExport(page: Page, content: unknown, alias: string) {
  const frame = await loadModule(page, host.url, 'players/aspect-editor-3.1.0.html', content, true);
  const field = frame
    .locator('aspect-element-properties')
    .getByRole('textbox', { name: 'ID', exact: true });
  await field.fill(alias);
  await field.press('Tab');
  await page.waitForFunction(() =>
    (window as unknown as { moduleMessages: { type: string }[] }).moduleMessages.some(
      (m) => m.type === 'voeDefinitionChangedNotification',
    ),
  );
  return page.evaluate(() => {
    const messages = (
      window as unknown as { moduleMessages: { type: string; unitDefinition: string }[] }
    ).moduleMessages;
    return JSON.parse(
      messages.filter((m) => m.type === 'voeDefinitionChangedNotification').at(-1)!.unitDefinition,
    );
  });
}

async function drag(page: Page, frame: FrameLocator) {
  const source = frame.locator('.drop-list-item').first();
  const text = await source.textContent();
  const target = frame.locator('.drop-list').last();
  await source.scrollIntoViewIfNeeded();
  const start = (await source.boundingBox())!,
    end = (await target.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2 + 10, {
    steps: 5,
  });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 20 });
  await page.mouse.up();
  await expect(target).toContainText(text!.trim());
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`functional acceptance at ${viewport.width}px`, () => {
    test.use({ viewport });
    for (const unit of pool.units.filter((u) => u.acceptance)) {
      test(`accepts ASPECT ${unit.acceptance!.kind} at ${viewport.width}px`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(90_000);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const original = JSON.parse(readFileSync(resolve(directory, unit.file), 'utf8')).definition;
        const saved = await editAndExport(page, original, 'ABNAHME_GESPEICHERT');
        const reopened = await editAndExport(page, saved, 'ABNAHME_REOPENED');
        expect(reopened.pages).toHaveLength(original.pages.length);
        await page.addInitScript(() =>
          window.addEventListener('message', (event) => {
            if (event.data?.type === 'tetfolioReady')
              document.documentElement.dataset['tetfolioReady'] = 'true';
          }),
        );
        const frame = await loadModule(
          page,
          host.url,
          'players/aspect-major-3.html',
          reopened,
          false,
          'vop',
          { directDownloadUrl: '/api/shared-assets' },
        );
        const kind = unit.acceptance!.kind;
        if (kind === 'input-limits') {
          const input = frame.getByRole('textbox', { name: 'Verkehrsmittel' });
          await input.focus();
          await input.press('Tab');
          await expect(frame.getByText('Eingabe erforderlich', { exact: true })).toBeVisible();
          await input.pressSequentially('Se');
          await input.press('Tab');
          await expect(frame.getByText('Eingabe zu kurz', { exact: true })).toBeVisible();
          await input.fill('');
          await input.pressSequentially('Fahrrad');
          await expect(input).toHaveValue('Fahrr');
          await input.fill('123');
          await input.press('Tab');
          await expect(
            frame.getByText('Eingabe entspricht nicht der Vorgabe', { exact: true }),
          ).toBeVisible();
          await input.fill('Boot');
          await input.press('Tab');
          await expect(frame.locator('mat-error')).toHaveCount(0);
        } else if (kind === 'read-only') {
          const input = frame.getByRole('textbox', { name: 'Vorgegebene Antwort' });
          await expect(input).not.toBeEditable();
          const clear = frame.getByRole('button', { name: 'Clear', exact: true });
          if ((await clear.count()) && (await clear.isEnabled())) await clear.click();
          await expect(input).toHaveValue('Fahrrad');
          await expect(
            frame.getByRole('checkbox', { name: 'Vorgegebenes Kontrollkästchen' }),
          ).toBeChecked();
          await expect(
            frame.getByRole('checkbox', { name: 'Vorgegebenes Kontrollkästchen' }),
          ).toBeDisabled();
          await expect(frame.getByRole('combobox')).toBeDisabled();
          await expect(frame.getByRole('combobox')).toContainText('See');
        } else if (kind === 'input-assistance') {
          const input = frame.getByRole('textbox', { name: 'Anzahl Flaschen' });
          await input.pressSequentially('1A2');
          await expect(input).toHaveValue('12');
          await expect(input).toHaveAttribute('inputmode', 'none');
          await frame
            .locator('aspect-keypad-key')
            .getByRole('button', { name: '7', exact: true })
            .click();
          await expect(input).toHaveValue('127');
        } else if (kind === 'textarea') {
          const input = frame.getByRole('textbox', { name: 'Begründung' });
          await expect(input).toHaveAttribute('rows', '4');
          await expect(input).toHaveCSS('resize', 'none');
          await input.fill('Wasser und Brot');
          await expect(frame.locator('.word-count')).toContainText('3');
        } else if (kind === 'selection') {
          const radios = frame.getByRole('radio');
          await radios.nth(1).check();
          await expect(radios.nth(1)).toBeChecked();
          await radios.first().check();
          await expect(radios.nth(1)).not.toBeChecked();
          await expect(frame.locator('.strike .mdc-form-field').first()).toHaveCSS(
            'text-decoration-line',
            'line-through',
          );
          const select = frame.getByRole('combobox');
          await select.click();
          await frame.getByRole('option', { name: 'See', exact: true }).click();
          await expect(select).toContainText('See');
          await select.click();
          await frame.getByRole('option').first().click();
          await expect(select).not.toContainText('See');
          await expect(frame.getByRole('listbox')).toBeHidden();
        } else if (kind === 'likert') {
          await frame.getByRole('radio').first().focus();
          await frame.getByRole('radio').first().press('ArrowRight');
          await expect(frame.getByRole('radio').first()).toBeChecked();
          await expect(frame.getByRole('radio').first()).toBeDisabled();
          const radio = frame.getByRole('radio').last();
          await radio.check();
          await expect(radio).toBeChecked();
        } else if (kind === 'table') {
          await expect(frame.locator('aspect-table .header-text')).toHaveText([
            'Gegenstand',
            'Anzahl',
          ]);
          await expect(frame.locator('aspect-table .sticky-header')).toHaveCount(2);
          await expect(frame.locator('aspect-table .header-cell').first()).toHaveCSS(
            'border-top-style',
            'solid',
          );
          const input = frame.locator('aspect-table input').first();
          await input.fill('Wasser');
          await expect(input).toHaveValue('Wasser');
          const header = frame.locator('aspect-table .header-cell').first();
          const before = (await header.boundingBox())!;
          await header.hover();
          await page.mouse.wheel(0, 220);
          await expect
            .poll(() =>
              frame
                .locator('body')
                .evaluate((body: HTMLElement) =>
                  Math.max(
                    ...Array.from(body.ownerDocument.querySelectorAll('*')).map((e) => e.scrollTop),
                  ),
                ),
            )
            .toBeGreaterThan(100);
          const after = (await header.boundingBox())!,
            bounds = (await page.locator('iframe').boundingBox())!;
          expect(after.y).toBeLessThanOrEqual(before.y + 2);
          expect(after.y).toBeGreaterThanOrEqual(bounds.y - 2);
        } else if (kind === 'cloze') {
          const input = frame.locator('aspect-cloze input').first();
          await input.fill('Fahrrad');
          await expect(input).toHaveValue('Fahrrad');
        } else if (kind === 'drag-drop') {
          await drag(page, frame);
        } else if (kind === 'math') {
          const input = frame.locator('math-field').first();
          await input.click();
          await input.pressSequentially('2+3');
          await expect
            .poll(() =>
              input.evaluate((e: HTMLElement) => (e as HTMLElement & { value: string }).value),
            )
            .toBe('2+3');
          await expect(frame.locator('aspect-math-input mat-button-toggle-group')).toHaveCount(0);
          await expect(frame.locator('.ML__keyboard')).toBeVisible();
          await frame.locator('.MLK__keycap').filter({ hasText: /^7$/ }).first().click();
          await expect
            .poll(() =>
              input.evaluate((e: HTMLElement) => (e as HTMLElement & { value: string }).value),
            )
            .toBe('2+37');
        } else if (kind === 'media') {
          const audio = frame.locator('audio');
          await audio.evaluate((element: HTMLElement) =>
            element.addEventListener(
              'playing',
              () => {
                element.dataset['played'] = 'true';
                element.dataset['playedVolume'] = String((element as HTMLMediaElement).volume);
              },
              { once: true },
            ),
          );
          await frame.locator('aspect-audio button').filter({ hasText: 'play_arrow' }).click();
          await expect(audio).toHaveAttribute('data-played', 'true');
          await expect
            .poll(async () => Number(await audio.getAttribute('data-played-volume')))
            .toBeCloseTo(0.6, 4);
          await frame.locator('aspect-audio button').filter({ hasText: 'pause' }).click();
          await expect.poll(() => audio.evaluate((e: HTMLMediaElement) => e.paused)).toBe(true);
          const volume = frame.getByRole('slider').last();
          await volume.focus();
          await volume.press('Home');
          await expect
            .poll(() => audio.evaluate((e: HTMLMediaElement) => e.volume))
            .toBeCloseTo(0.4, 4);
          await frame.locator('aspect-audio button').filter({ hasText: 'play_arrow' }).click();
          await expect(
            frame.locator('aspect-audio button').filter({ hasText: 'play_arrow' }),
          ).toBeDisabled({ timeout: 25_000 });
        } else if (kind === 'geometry') {
          await expect(frame.locator('aspect-geometry canvas').first()).toBeVisible({
            timeout: 30_000,
          });
          await expect(frame.locator('aspect-geometry .GeoGebraFrame')).toBeVisible();
          const geometry = frame.locator('aspect-geometry');
          await geometry.locator('canvas').first().scrollIntoViewIfNeeded();
          const id = (await geometry.locator('.geogebra-applet').getAttribute('id'))!;
          const before = await geometry.evaluate((element: HTMLElement, key: string) => {
            const api = (
              element.ownerDocument.defaultView as unknown as Record<
                string,
                { getXcoord(id: string): number; getYcoord(id: string): number; getXML(): string }
              >
            )[key];
            const coordinates = new DOMParser()
              .parseFromString(api.getXML(), 'application/xml')
              .querySelector('euclidianView coordSystem')!;
            return {
              x: api.getXcoord('A'),
              pixelX:
                Number(coordinates.getAttribute('xZero')) +
                api.getXcoord('A') * Number(coordinates.getAttribute('scale')),
              pixelY:
                Number(coordinates.getAttribute('yZero')) -
                api.getYcoord('A') * Number(coordinates.getAttribute('yscale')),
            };
          }, id);
          const position = await geometry
            .locator('canvas')
            .first()
            .evaluate(
              (canvas: HTMLCanvasElement, coordinates: { pixelX: number; pixelY: number }) => {
                const rect = canvas.getBoundingClientRect();
                return {
                  x: (coordinates.pixelX * rect.width) / canvas.clientWidth,
                  y: (coordinates.pixelY * rect.height) / canvas.clientHeight,
                };
              },
              before,
            );
          await geometry.locator('canvas').first().click({ position });
          await page.keyboard.press('ArrowRight');
          const x = () =>
            geometry.evaluate(
              (element: HTMLElement, key: string) =>
                (
                  element.ownerDocument.defaultView as unknown as Record<
                    string,
                    { getXcoord(id: string): number }
                  >
                )[key].getXcoord('A'),
              id,
            );
          await expect.poll(x).not.toBe(before.x);
          await geometry.locator('.reset-button').click();
          await expect.poll(x).toBe(before.x);
        } else if (kind === 'tetfolio') {
          await expect(frame.locator('html')).toHaveAttribute('data-tetfolio-ready', 'true');
          const embedded = frame.frameLocator('aspect-tetfolio iframe');
          await embedded.getByRole('button', { name: 'Flasche hinzufügen', exact: true }).click();
          await expect(embedded.locator('output')).toHaveText('1');
        } else if (kind === 'visibility') {
          const result = frame.getByText(/^Treffer:/),
            boxes = frame.getByRole('checkbox');
          await expect(result).toBeHidden();
          await boxes.first().check();
          await expect(result).toBeHidden();
          await boxes.nth(1).check();
          await expect(result).toBeVisible();
          await boxes.first().uncheck();
          await expect(result).toBeHidden();
        } else if (kind === 'hotspot') {
          const hotspot = frame.locator('.hotspot:not(.triangle-half-bottom-border)').first();
          await expect(hotspot).toHaveCSS('background-color', 'rgb(225, 156, 48)');
          await clickInteractiveHotspot(frame);
          await expect(hotspot).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        }
        await expect(frame.getByText('Unerwarteter Fehler', { exact: true })).toHaveCount(0);
        expect(errors).toEqual([]);
        await testInfo.attach(`${kind} ${viewport.width}px`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      });
    }
  });
}
