import { test, expect, playerPool, playerFrame } from './synthetic-players-support';

test.use({
  video: { mode: 'on', size: { width: 1440, height: 1000 } },
  viewport: { width: 1440, height: 1000 },
});

for (const family of playerPool.players) {
  test(`keeps readable coding and navigation in review for ${family.id}`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/view/${playerPool.acpId}/sequence/${playerPool.bookletId}?kind=booklet`);
    const unit = playerPool.units.find((entry) => entry.player === family.id)!;
    await page.getByRole('button', { name: 'Aufgabenliste', exact: false }).click();
    await page.locator('.unit-list-item').filter({ hasText: unit.name }).click();
    await expect(page.locator('app-unit-view h1')).toContainText(unit.name);
    const button = page.getByRole('button', { name: 'Musterlösung anzeigen', exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator('.solution-info')).toContainText('Keine eindeutige Musterlösung');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.coding-content')).toContainText('Synthetisch');
    await expect(playerFrame(page).locator('body')).toBeVisible();
    const path = testInfo.outputPath(`${family.id}-review.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(`${family.id}: Review`, { path, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Aufgabenliste', exact: false }).click();
    await page.locator('.unit-list-item').filter({ hasText: playerPool.units[0].name }).click();
    await expect(playerFrame(page).getByRole('radio').first()).toBeVisible();
  });
}
