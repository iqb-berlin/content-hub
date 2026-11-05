import { test, expect } from './synthetic-players-support';
import type { Page, Locator } from '@playwright/test';

async function clickSelectedElement(page: Page, target: Locator) {
  // Material's selected items use disabledInteractive: a native pointer can deselect them.
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

const base = '/view/30000000-0000-4000-8000-000000000003/unit/';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { compatibilityMessages: unknown[] }).compatibilityMessages = [];
    window.addEventListener('message', (event) => {
      (window as unknown as { compatibilityMessages: unknown[] }).compatibilityMessages.push(
        event.data,
      );
    });
  });
});

for (const major of [1, 2]) {
  test(`runs ABI ${major} through the real application compatibility host`, async ({
    page,
  }, testInfo) => {
    await page.goto(base + `abi-m${major}-inputs`);
    const frame = page.frameLocator('app-unit-view iframe');
    const input = frame.locator('input[type=text]:visible,input:not([type]):visible').first();
    await input.pressSequentially('Fahrrad');
    await expect(input).toHaveValue('Fahrrad');
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.stringify(
            (window as unknown as { compatibilityMessages: unknown[] }).compatibilityMessages,
          ),
        ),
      )
      .toContain('Fahrrad');
    await expect(frame.getByText('Testscript Title', { exact: true })).toHaveCount(0);
    await expect(frame.getByText(/Scriptfehler|player-component alive!/)).toHaveCount(0);
    if (major === 2) {
      await page.goto(base + 'abi-m2-dynamic');
      const additional = frame.getByText('Zusatzantwort', { exact: true });
      await expect(additional).toBeHidden();
      await frame.locator('mat-checkbox .mat-checkbox-inner-container').first().click();
      await expect(frame.getByRole('checkbox').first()).toBeChecked();
      await expect(additional).toBeVisible();
      await frame.locator('input:not([type]),input[type=text]').first().fill('Wasser');
      await frame.locator('input[type=number]').fill('2');
      await frame.getByRole('button', { name: 'Anwenden', exact: true }).click();
      await frame.getByRole('button', { name: 'Haltepunkt 2', exact: true }).click();
      const place = frame
        .locator('player-repeat input:not([type]),player-repeat input[type=text]')
        .last();
      await place.fill('See');
      await expect(place).toHaveValue('See');
      await frame.locator('mat-checkbox .mat-checkbox-inner-container').first().click();
      await expect(frame.getByRole('checkbox').first()).not.toBeChecked();
      await expect(additional).toBeHidden();
      await expect(frame.getByText(/Scriptfehler|player-component alive!/)).toHaveCount(0);
    }
    await testInfo.attach(`ABI ${major} in Content Hub`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}

test('uses the real periodic table and restores selections after returning to ASPECT', async ({
  page,
}, testInfo) => {
  await page.goto(base + 'aspect-m3-integrated-periodic');
  const player = page.frameLocator('app-unit-view iframe');
  const open = player.locator('.widget-container button');
  await open.click();
  const widget = page.frameLocator('app-verona-widget-host iframe');
  await widget.getByRole('region', { name: 'H', exact: true }).getByRole('button').click();
  await widget.getByRole('region', { name: 'O', exact: true }).getByRole('button').click();
  const nitrogen = widget.getByRole('region', { name: 'N', exact: true }).getByRole('button');
  if (await nitrogen.isEnabled()) await nitrogen.click();
  else await expect(nitrogen).toBeDisabled();
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(page.locator('app-verona-widget-host dialog')).toHaveCount(0);
  await expect
    .poll(() =>
      player.locator('body').evaluate(() => {
        const messages = (
          window as unknown as { compatibilityMessages: { type: string; state?: string }[] }
        ).compatibilityMessages;
        return messages.filter((m) => m.type === 'vopWidgetReturn').at(-1)?.state;
      }),
    )
    .toBe('H O');
  await expect(player.locator('.elements-container')).toContainText('H');
  await open.click();
  await expect(
    widget.getByRole('region', { name: 'H', exact: true }).getByRole('button'),
  ).toBeDisabled();
  await clickSelectedElement(
    page,
    widget.getByRole('region', { name: 'H', exact: true }).getByRole('button'),
  );
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(player.locator('.element-square')).toHaveText(['H', 'O']);
  await testInfo.attach('Real periodic table returned to ASPECT', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await open.click();
  await clickSelectedElement(
    page,
    widget.getByRole('region', { name: 'H', exact: true }).getByRole('button'),
  );
  await clickSelectedElement(
    page,
    widget.getByRole('region', { name: 'O', exact: true }).getByRole('button'),
  );
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(player.locator('.elements-container')).toHaveCount(0);
});

test('closes the real periodic table on selection when configured', async ({ page }) => {
  await page.goto(base + 'aspect-m3-integrated-periodic-auto');
  const player = page.frameLocator('app-unit-view iframe');
  await player.locator('.widget-container button').click();
  const widget = page.frameLocator('app-verona-widget-host iframe');
  await widget.getByRole('region', { name: 'H', exact: true }).getByRole('button').click();
  await expect(page.locator('app-verona-widget-host dialog')).toHaveCount(0);
  await expect(player.locator('.elements-container')).toContainText('H');
});

test('opens the real periodic table as view-only without creating an answer', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + 'aspect-m3-integrated-periodic-view');
  const player = page.frameLocator('app-unit-view iframe');
  await player.locator('.widget-container button').click();
  const widget = page.frameLocator('app-verona-widget-host iframe');
  await widget.getByRole('region', { name: 'H', exact: true }).getByRole('button').click();
  await expect(
    widget.getByRole('region', { name: 'H', exact: true }).getByRole('button'),
  ).not.toBeDisabled();
  const answers = await page.evaluate(() => {
    const messages = (
      window as unknown as { compatibilityMessages: { type: string; state?: string }[] }
    ).compatibilityMessages;
    return messages.filter((m) => m.type === 'vowStateChangedNotification' && m.state);
  });
  expect(answers).toEqual([]);
  await testInfo.attach('View-only periodic table on narrow screen', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(player.locator('.elements-container')).toHaveCount(0);
});

test('edits in the real molecule editor and returns its state to ASPECT', async ({
  page,
}, testInfo) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(base + 'aspect-m3-integrated-molecule');
    const player = page.frameLocator('app-unit-view iframe');
    const open = player.locator('.widget-container button');
    await open.click();
    const widget = page.frameLocator('app-verona-widget-host iframe');
    const canvas = widget.locator('app-editor-canvas svg');
    await expect(canvas).toBeVisible();
    await expect
      .poll(() =>
        widget.locator('.toolbar.top button').evaluateAll(
          (buttons) =>
            buttons.length > 0 &&
            buttons.every((button) => {
              const bounds = button.getBoundingClientRect();
              const view = button.ownerDocument.defaultView!;
              return (
                bounds.left >= -1 &&
                bounds.top >= -1 &&
                bounds.right <= view.innerWidth + 1 &&
                bounds.bottom <= view.innerHeight + 1 &&
                ((button as HTMLButtonElement).disabled ||
                  button.contains(
                    button.ownerDocument.elementFromPoint(
                      bounds.left + bounds.width / 2,
                      bounds.top + bounds.height / 2,
                    ),
                  ))
              );
            }),
        ),
      )
      .toBe(true);
    await widget
      .getByRole('button', { name: /Kohlenstoff|Carbon|^C$/ })
      .first()
      .click();
    const position = { x: 140, y: 500 };
    await canvas.hover({ position });
    await expect(widget.getByRole('tooltip')).toBeHidden();
    await canvas.click({ position });
    await expect(page.getByRole('button', { name: 'Übernehmen', exact: true })).toHaveCount(0);
    await expect(widget.getByRole('button', { name: 'Speichern', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await widget.getByRole('button', { name: 'Speichern', exact: true }).click();
    const preview = player.getByRole('img', { name: 'Molekül', exact: true });
    await expect(preview).toBeVisible();
    await expect
      .poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    const returned = await player.locator('body').evaluate(() => {
      const messages = (
        window as unknown as { compatibilityMessages: { type: string; state?: string }[] }
      ).compatibilityMessages;
      return JSON.parse(messages.filter((m) => m.type === 'vopWidgetReturn').at(-1)!.state!);
    });
    expect(Object.values(returned.atoms)).toHaveLength(1);
    expect(returned.asImage).toMatch(/^data:image\/png;base64,/);
    await open.click();
    await expect(widget.locator('app-editor-canvas svg')).toBeVisible();
    await expect
      .poll(() =>
        widget.locator('body').evaluate(() => {
          const messages = (
            window as unknown as { compatibilityMessages: { type: string; state?: string }[] }
          ).compatibilityMessages;
          const state = messages.filter((m) => m.type === 'vowStartCommand').at(-1)?.state;
          return state ? Object.values(JSON.parse(state).atoms ?? {}).length : 0;
        }),
      )
      .toBe(1);
    await expect(widget.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
    await testInfo.attach(`Real molecule editor runtime ${width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
    await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
    await testInfo.attach(`Real molecule editor state ${width}px`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
});
