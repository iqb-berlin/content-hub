import { test, expect, frame, open, jump, show, hide } from './synthetic-aspect-support';

test.use({
  viewport: { width: 1440, height: 1000 },
  video: { mode: 'on', size: { width: 1440, height: 1000 } },
});
test('records a verified walkthrough with personal, solution and manual states', async ({
  page,
}, testInfo) => {
  const capture = async (name: string) => {
    await page.evaluate(() => document.fonts.ready);
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };
  await open(page);
  await page.getByRole('button', { name: 'Kodierung', exact: true }).click();
  await capture('01-einstieg');
  await page.getByRole('button', { name: 'Nächste Seite →', exact: true }).click();
  await frame(page).getByRole('textbox').fill('zu Fuß');
  await capture('02-eigene-antwort');
  await show(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue('Fahrrad');
  await capture('03-musterloesung');
  await hide(page);
  await expect(frame(page).getByRole('textbox')).toHaveValue('zu Fuß');
  await capture('04-wiederhergestellt');
  await jump(page, 'u2');
  await show(page);
  await expect(page.locator('.solution-info')).toContainText('1 von 2');
  await expect(frame(page).getByRole('textbox').first()).toHaveValue('Fahrrad');
  await capture('05-teilmusterloesung');
  await jump(page, 'u3');
  await show(page);
  await expect(page.locator('.coding-content')).toContainText('2 Punkte:');
  await expect(frame(page).getByRole('textbox')).toBeVisible();
  await capture('06-manuelle-kodierung');
  await jump(page, 'u4');
  await show(page);
  await expect(page.locator('.solution-info')).toContainText('Keine eindeutige Musterlösung');
  await expect(frame(page).getByRole('textbox')).toBeVisible();
  await capture('07-alternativen');
});
