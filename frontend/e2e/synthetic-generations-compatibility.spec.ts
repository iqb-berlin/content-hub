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
    await expect(frame.getByText(/Scriptfehler/)).toHaveCount(0);
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
  await page.goto(base + 'aspect-m3-integrated-molecule');
  const player = page.frameLocator('app-unit-view iframe');
  const open = player.locator('.widget-container button');
  await open.click();
  const widget = page.frameLocator('app-verona-widget-host iframe');
  const canvas = widget.locator('app-editor-canvas svg');
  await expect(canvas).toBeVisible();
  await testInfo.attach('Real molecule editor runtime', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  await widget
    .getByRole('button', { name: /Kohlenstoff|Carbon|^C$/ })
    .first()
    .click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await page.getByRole('button', { name: 'Übernehmen', exact: true }).click();
  await expect(player.locator('.state-container')).toBeVisible();
  await open.click();
  await expect(widget.locator('app-editor-canvas svg')).toBeVisible();
  await expect
    .poll(() =>
      widget.locator('body').evaluate(() => {
        const messages = (
          window as unknown as { compatibilityMessages: { type: string; state?: string }[] }
        ).compatibilityMessages;
        return messages.filter((m) => m.type === 'vowStartCommand').at(-1)?.state?.length ?? 0;
      }),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await testInfo.attach('Real molecule editor state', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
