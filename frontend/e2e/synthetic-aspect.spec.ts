import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  test,
  expect,
  pool,
  poolDirectory,
  frame,
  open,
  jump,
  show,
  hide,
  unitData,
  authenticatedGet,
  reviewUrl,
} from './synthetic-aspect-support';

test('loads the versioned pool and the original ASPECT player through the real API', async ({
  page,
}) => {
  const player = readFileSync(resolve(poolDirectory, pool.player.file));
  expect(createHash('sha256').update(player).digest('hex')).toBe(pool.player.sha256);
  for (const unit of pool.units) {
    const data = await unitData(page, unit.id);
    expect(data.name).toBe(unit.name);
    expect(data.dependencies.map((file) => file.type)).toContain('PLAYER');
    expect(data.dependencies.map((file) => file.type)).toContain('UNIT_DEFINITION');
    if (unit.id === 'u1') {
      const served = await authenticatedGet(
        page,
        data.dependencies.find((file) => file.type === 'PLAYER')!.downloadUrl,
      );
      expect(
        createHash('sha256')
          .update(await served.body())
          .digest('hex'),
      ).toBe(pool.player.sha256);
    }
  }
  await open(page);
  await expect(page.locator('.page-info')).toHaveText(
    `Seite 1 / ${pool.units[0].expected.pageCount}`,
  );
  const metadata = await frame(page).locator('#meta_data').textContent();
  expect(JSON.parse(metadata!).version).toBe(pool.player.version);
});

test('restores answers and the current page after a complete solution with aliases', async ({
  page,
}) => {
  await open(page);
  await frame(page).getByRole('radio', { name: 'zum Bahnhof', exact: true }).check();
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await frame(page).getByRole('textbox').fill('Letzte schnelle Antwort');
  await show(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue(
    String(pool.units[0].expected.solution['FAHRT']),
  );
  await expect(page.locator('.page-info')).toHaveText('Seite 2 / 2');
  await page.getByRole('button', { name: '← Vorherige Seite', exact: true }).click();
  await expect(frame(page).getByRole('radio', { name: 'zum See', exact: true })).toBeChecked();
  await hide(page);
  await expect(frame(page).getByRole('radio', { name: 'zum Bahnhof', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await expect(frame(page).getByRole('textbox')).toHaveValue('Letzte schnelle Antwort');
});

test('retains the last immediate input over three solution switches', async ({ page }) => {
  await open(page, 'u2');
  const answer = frame(page).getByRole('textbox').first();
  for (let index = 1; index <= 3; index++) {
    await answer.fill(`Sofortige Eingabe ${index}`);
    await show(page);
    await expect(answer).toHaveValue('Fahrrad');
    await answer.fill('Änderung im Lösungsmodus');
    await hide(page);
    await expect(answer).toHaveValue(`Sofortige Eingabe ${index}`);
  }
});

test('filters readable coding by rule text and explains an empty search', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Kodiervariablen filtern' });
  await search.fill('Fahrrad');
  await expect(page.locator('.coding-variable')).toHaveCount(1);
  await expect(page.locator('.coding-variable')).toContainText('FAHRT');
  await search.fill('Nichtvorhanden');
  await expect(
    page.getByText('Keine passende Kodiervariable gefunden.', { exact: true }),
  ).toBeVisible();
  await search.fill('');
  await expect(page.locator('.coding-variable')).toHaveCount(2);
});

test('supports interactive display modes and protects personal answers in print modes', async ({
  page,
}, testInfo) => {
  await open(page);
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await frame(page).getByRole('textbox').fill('Eigene Antwort vor Druck');
  await show(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue('Fahrrad');
  const display = page.getByRole('combobox', { name: 'Seitendarstellung der Aufgabe' });
  for (const mode of ['separate', 'concat-scroll', 'concat-scroll-snap', 'buttons']) {
    await display.selectOption(mode);
    await expect(
      page.getByRole('button', { name: 'Musterlösung ausblenden', exact: true }),
    ).toBeEnabled();
    if (
      (mode === 'buttons' || mode === 'separate') &&
      (await frame(page).getByRole('textbox').count()) === 0
    ) {
      await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
    }
    await expect(frame(page).getByRole('textbox')).toHaveValue('Fahrrad');
  }
  for (const mode of ['view-all', 'print-ids']) {
    await display.selectOption(mode);
    await expect(
      page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('.solution-info')).toContainText('interaktive Seitendarstellung');
    if (mode === 'print-ids') {
      const path = testInfo.outputPath('druckansicht.png');
      await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
      await testInfo.attach('Druckansicht', { path, contentType: 'image/png' });
    }
  }
  await display.selectOption('buttons');
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toBeEnabled();
  if ((await frame(page).getByRole('textbox').count()) === 0)
    await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await expect(frame(page).getByRole('textbox')).toHaveValue('Eigene Antwort vor Druck');
});

test('labels a partial solution and restores both personal answers', async ({ page }) => {
  await open(page, 'u2');
  const answers = frame(page).getByRole('textbox');
  await answers.nth(0).fill('Bus');
  await answers.nth(1).fill('Meine eigene Begründung');
  await show(page);
  await expect(answers.nth(0)).toHaveValue('Fahrrad');
  await expect(answers.nth(1)).toHaveValue('');
  await expect(page.locator('.solution-info')).toContainText('1 von 2');
  for (const id of pool.units[1].expected.unsupported)
    await expect(page.locator('.solution-info')).toContainText(id);
  await answers.nth(1).fill('Synthetische Änderung');
  await hide(page);
  await expect(answers.nth(0)).toHaveValue('Bus');
  await expect(answers.nth(1)).toHaveValue('Meine eigene Begründung');
});

test('shows manual instructions without restarting the player', async ({ page }) => {
  await open(page, 'u3');
  await frame(page).getByRole('textbox').fill('Mein eigener Grund');
  const originalFrame = await page.locator('app-unit-view iframe').elementHandle();
  await show(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue('Mein eigener Grund');
  for (const points of ['2 Punkte:', '1 Punkt:', '0 Punkte:'])
    await expect(page.locator('.coding-content')).toContainText(points);
  await expect(page.locator('.solution-info')).toContainText('Keine eindeutige Musterlösung');
  expect(
    await originalFrame!.evaluate(
      (element) => element === document.querySelector('app-unit-view iframe'),
    ),
  ).toBe(true);
});

test('does not guess between alternative correct answers', async ({ page }) => {
  await open(page, 'u4');
  await frame(page).getByRole('textbox').fill('Bus');
  await show(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue('Bus');
  await expect(page.locator('.coding-content')).toContainText('Fahrrad');
  await expect(page.locator('.coding-content')).toContainText('Bus');
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('explains missing coding without changing the answer', async ({ page }) => {
  await open(page, 'u5');
  await frame(page).getByRole('textbox').fill('Freie eigene Antwort');
  await show(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue('Freie eigene Antwort');
  await expect(page.locator('.coding-content')).toContainText('Keine Kodierung verfügbar.');
});

test('restores the last dropdown choice and names the unsupported variable', async ({ page }) => {
  await open(page, 'u6');
  await frame(page).getByRole('combobox').click();
  await frame(page).getByRole('option', { name: 'Bahnhof', exact: true }).click();
  await show(page);
  await expect(frame(page).getByRole('combobox')).toContainText('See');
  await expect(page.locator('.solution-info')).toContainText(pool.units[5].expected.unsupported[0]);
  await hide(page);
  await expect(frame(page).getByRole('combobox')).toContainText('Bahnhof');
});

test('preserves an unacknowledged toggle choice and offers a retry', async ({ page }) => {
  await open(page, 'u6');
  await frame(page).getByRole('radio', { name: 'Schule', exact: true }).click();
  await show(page);
  await expect(page.locator('.solution-info [role=alert]')).toContainText(
    'noch nicht vom Player gemeldet',
  );
  await expect(frame(page).getByRole('radio', { name: 'Schule', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('clears solution mode and personal buffers when changing units', async ({ page }) => {
  await open(page, 'u2');
  await show(page);
  await expect(frame(page).getByRole('textbox').first()).toHaveValue('Fahrrad');
  await jump(page, 'u1');
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await expect(frame(page).getByRole('textbox')).toHaveValue('');
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
]) {
  test(`shows partial solutions without horizontal overflow at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await open(page, 'u2');
    await show(page);
    await expect(frame(page).getByRole('textbox').first()).toHaveValue('Fahrrad');
    await page.getByRole('searchbox', { name: 'Kodiervariablen filtern' }).fill('BEGRUENDUNG');
    await expect(page.locator('.coding-content')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const path = testInfo.outputPath(`viewport-${viewport.width}.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(`Ansicht ${viewport.width}px`, { path, contentType: 'image/png' });
  });
}

test('keeps the ordinary unit view and its additional data available', async ({ page }) => {
  await page.goto(`/view/${pool.acpId}/unit/u2`);
  await expect(frame(page).getByRole('textbox').first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Zusatzdaten anzeigen', exact: true }).click();
  await page.getByRole('button', { name: 'RichText', exact: true }).click();
  await expect(page.locator('.richtext-content')).toContainText('Synthetischer Zusatztext');
});

test('explains a malformed coding file without a browser crash', async ({ page }) => {
  const data = await unitData(page, 'u1');
  const codingUrl = data.dependencies.find((file) => file.type === 'CODING_SCHEME')!.downloadUrl;
  await page.route(
    (url) => url.pathname === codingUrl,
    (route) => route.fulfill({ contentType: 'application/json', body: '{"variableCodings":[' }),
  );
  await open(page);
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await expect(page.locator('.coding-content')).toContainText(
    'Kodierung konnte nicht gelesen werden.',
  );
});

test('cancels a delayed coding download when changing units', async ({ page }) => {
  const data = await unitData(page, 'u1');
  const codingUrl = data.dependencies.find((file) => file.type === 'CODING_SCHEME')!.downloadUrl;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === codingUrl,
    async (route) => {
      await delayed;
      await route.continue();
    },
  );
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === codingUrl);
  const canceled = page.waitForEvent(
    'requestfailed',
    (request) => new URL(request.url()).pathname === codingUrl,
  );
  try {
    await page.goto(reviewUrl);
    await requested;
    await jump(page, 'u3');
    release();
    expect((await canceled).failure()).not.toBeNull();
    await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
    await expect(page.locator('.coding-variable')).toHaveCount(1);
    await expect(page.locator('.coding-variable h4')).toContainText('BEGRUENDUNG');
  } finally {
    release();
  }
});
