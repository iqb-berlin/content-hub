import { expect, Page, test } from '@playwright/test';
import { installOidcSession } from './oidc-test-session';

const AP_ID = '10000000-0000-4000-8000-000000000201';
const MANAGER_ID = '10000000-0000-4000-8000-000000000002';
const MANAGER_USERNAME = 'e2e-manager';

async function openExplorer(page: Page): Promise<void> {
  await installOidcSession(page, MANAGER_ID, MANAGER_USERNAME);
  await page.goto(`/view/${AP_ID}/item-explorer`);
  await expect(page.getByRole('heading', { name: 'Item-Explorer' })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
}

test('keeps sticky cells opaque and paints complete row states while scrolling', async ({
  page,
}, testInfo) => {
  await openExplorer(page);

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const columnDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  const resetButton = columnDialog.getByRole('button', { name: /Standard/ });
  if (await resetButton.isEnabled()) {
    await resetButton.click();
  }
  await columnDialog.getByRole('button', { name: /Speichern/ }).click();
  await expect(columnDialog).toHaveCount(0);
  await expect(page.locator('.status-pill')).not.toHaveText('Speichern läuft');

  const firstRow = page.locator('tbody tr').first();
  const scroller = page.locator('.table-scroll');
  await scroller.focus();
  await scroller.press('ArrowDown');
  await expect(firstRow).toHaveAttribute('aria-selected', 'true');
  await firstRow.scrollIntoViewIfNeeded();

  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const readVisualEvidence = () =>
    firstRow.evaluate((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      const backgrounds = cells.map((cell) => getComputedStyle(cell).backgroundColor);
      const selection = row.querySelector<HTMLElement>('td.collection-select-col');
      const position = row.querySelector<HTMLElement>('td.number-col');
      const sticky = row.querySelector<HTMLElement>(
        'td.sticky-col:not(.number-col):not(.reference-number-col)',
      );
      if (!selection || !position || !sticky) throw new Error('Sticky leading columns are missing');
      const scroller = row.closest<HTMLElement>('.table-scroll');
      const selectionBounds = selection.getBoundingClientRect();
      const positionBounds = position.getBoundingClientRect();
      const bounds = sticky.getBoundingClientRect();
      const hit = Array.from({ length: Math.max(0, Math.floor(bounds.height)) }, (_, offset) =>
        document.elementFromPoint(bounds.left + bounds.width / 2, bounds.bottom - offset - 1),
      ).find((candidate) => candidate?.closest('td.sticky-col') === sticky);
      return {
        backgrounds,
        stickyBackground: getComputedStyle(sticky).backgroundColor,
        stickyHit: Boolean(hit?.closest('td.sticky-col')),
        selectionPosition: getComputedStyle(selection).position,
        selectionLeft: selectionBounds.left,
        selectionRight: selectionBounds.right,
        positionLeft: positionBounds.left,
        positionRight: positionBounds.right,
        itemIdLeft: bounds.left,
        scrollerLeft: scroller?.getBoundingClientRect().left || 0,
        scrollLeft: scroller?.scrollLeft || 0,
      };
    });

  let visualEvidence = await readVisualEvidence();
  await expect
    .poll(async () => {
      visualEvidence = await readVisualEvidence();
      return visualEvidence.stickyHit;
    })
    .toBe(true);

  expect(visualEvidence.scrollLeft).toBeGreaterThan(0);
  expect(visualEvidence.stickyHit).toBe(true);
  expect(visualEvidence.selectionPosition).toBe('sticky');
  expect(Math.abs(visualEvidence.selectionLeft - visualEvidence.scrollerLeft)).toBeLessThanOrEqual(
    1,
  );
  expect(visualEvidence.selectionRight).toBeLessThanOrEqual(visualEvidence.positionLeft + 1);
  expect(visualEvidence.positionRight).toBeLessThanOrEqual(visualEvidence.itemIdLeft + 1);
  expect(new Set(visualEvidence.backgrounds).size).toBe(1);
  expect(visualEvidence.stickyBackground).not.toBe('rgba(0, 0, 0, 0)');
  await expect(firstRow.locator('td.tags-cell')).toHaveCSS('display', 'table-cell');

  const noPreviewBackgrounds = await page
    .locator('tbody tr.no-preview')
    .evaluate((row) =>
      Array.from(row.querySelectorAll('td')).map((cell) => getComputedStyle(cell).backgroundColor),
    );
  expect(new Set(noPreviewBackgrounds).size).toBe(1);
  expect(noPreviewBackgrounds[0]).not.toBe('rgba(0, 0, 0, 0)');

  await testInfo.attach(`sticky-selected-row-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('keeps the reference-number column pinned before Item-ID while scrolling', async ({
  page,
}) => {
  await openExplorer(page);

  await page.getByRole('button', { name: /Spalten verwalten/ }).click();
  const columnDialog = page
    .getByRole('heading', { name: 'Spalten verwalten' })
    .locator('xpath=ancestor::div[contains(@class, "column-manager-dialog")]');
  const resetButton = columnDialog.getByRole('button', { name: /Standard/ });
  if (await resetButton.isEnabled()) await resetButton.click();
  await columnDialog.getByRole('checkbox', { name: 'Referenz-Nr.' }).check();
  const referenceTile = columnDialog.locator('.column-tile', { hasText: 'ID: referenceNumber' });
  await expect(referenceTile.getByTitle('Nach unten')).toBeDisabled();
  await columnDialog.getByRole('button', { name: /Speichern/ }).click();
  await expect(columnDialog).toHaveCount(0);

  const itemHeader = page.getByRole('columnheader', { name: /^Item-ID(?:\s|$)/ });
  const referenceHeader = page.getByRole('columnheader', { name: /^Referenz-Nr\.(?:\s|$)/ });
  expect(
    await referenceHeader.evaluate((header) => (header as HTMLTableCellElement).cellIndex),
  ).toBeLessThan(await itemHeader.evaluate((header) => (header as HTMLTableCellElement).cellIndex));
  const scroller = page.locator('.table-scroll');
  await scroller.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });

  const alignment = await page.locator('table.explorer-table').evaluate((table) => {
    const header = table.querySelector<HTMLElement>('thead th.reference-number-col');
    const cell = table.querySelector<HTMLElement>('tbody td.reference-number-col');
    if (!header || !cell) throw new Error('Reference-number cells are missing');
    return {
      headerX: header.getBoundingClientRect().x,
      cellX: cell.getBoundingClientRect().x,
      headerPosition: getComputedStyle(header).position,
    };
  });
  expect(alignment.headerPosition).toBe('sticky');
  expect(Math.abs(alignment.headerX - alignment.cellX)).toBeLessThanOrEqual(1);
});
