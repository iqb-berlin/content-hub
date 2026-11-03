import { expect, test } from '@playwright/test';
import { installOidcSession } from './oidc-test-session';

const acpId = '10000000-0000-4000-8000-000000000201';
const managerId = '10000000-0000-4000-8000-000000000002';

test('aligns roles and supports inline changes, errors, adding and removing people', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installOidcSession(page, managerId, 'e2e-manager');
  const users = [
    { id: managerId, displayName: 'Alex' },
    { id: 'second', displayName: 'Person mit einem deutlich längeren Anzeigenamen' },
    { id: 'third', displayName: 'Neue Person' },
  ];
  const roles = users.slice(0, 2).map((user) => ({
    id: user.id,
    userId: user.id,
    role: 'ACP_MANAGER',
    capabilities: ['review:participate'],
    user,
  }));
  let failSave = true;
  const writes: object[] = [];
  await page.route(`**/api/acp/${acpId}/roles`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: roles });
    const data = route.request().postDataJSON();
    writes.push(data);
    return failSave
      ? route.fulfill({
          status: 400,
          json: { message: 'At least one ACP_MANAGER must remain assigned' },
        })
      : route.fulfill({ json: { id: data.userId, ...data } });
  });
  await page.route(`**/api/acp/${acpId}/assignable-users`, (route) =>
    route.fulfill({ json: users }),
  );
  await page.route(`**/api/acp/${acpId}/roles/third`, (route) => route.fulfill({ status: 204 }));
  await page.goto(`/manage/${acpId}`);
  const section = page.getByRole('region', { name: 'Personen & Rollen' });
  const rows = section.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  const bounds = await section
    .locator('tbody select')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().left));
  expect(Math.abs(bounds[0] - bounds[1])).toBeLessThan(1);
  const row = rows.filter({ hasText: users[1].displayName });
  const saveButton = row.getByRole('button', { name: 'Änderungen speichern' });
  await expect(saveButton).toBeDisabled();
  await row.getByRole('combobox').selectOption('READ_ONLY');
  await row.getByLabel('Review: verwalten').check();
  expect(writes).toHaveLength(0);
  await saveButton.click();
  await expect(section.getByRole('alert')).toContainText('Mindestens ein AP-Manager');
  await expect(row.getByRole('combobox')).toHaveValue('READ_ONLY');
  await expect(row.getByLabel('Review: verwalten')).toBeChecked();
  await expect(saveButton).toBeEnabled();
  failSave = false;
  await saveButton.click();
  await expect(section.getByRole('status')).toHaveText('Zuordnung gespeichert.');
  await expect(saveButton).toBeDisabled();
  expect(writes.at(-1)).toEqual({
    userId: 'second',
    role: 'READ_ONLY',
    capabilities: ['review:participate', 'review:manage'],
  });
  const add = section.locator('.add-person');
  await expect(add).not.toHaveAttribute('open', '');
  await add.locator('summary').click();
  await expect(add.getByLabel('Person', { exact: true }).locator('option')).toHaveCount(2);
  await add.getByLabel('Person', { exact: true }).selectOption('third');
  await add.getByRole('button', { name: 'Person hinzufügen' }).click();
  await expect(rows).toHaveCount(3);
  await expect(add).toContainText('Alle verfügbaren Personen sind bereits zugewiesen.');
  await rows.filter({ hasText: 'Neue Person' }).getByRole('button', { name: 'Entfernen' }).click();
  await expect(rows).toHaveCount(2);
  await expect(
    add.getByLabel('Person', { exact: true }).locator('option[value="third"]'),
  ).toHaveCount(1);
  await testInfo.attach('role-management', {
    body: await section.screenshot(),
    contentType: 'image/png',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row.getByRole('combobox')).toBeVisible();
  const nameWidth = await row
    .getByRole('rowheader')
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(nameWidth).toBeGreaterThan(250);
  await testInfo.attach('role-management-narrow', {
    body: await section.screenshot(),
    contentType: 'image/png',
  });
});

test('lets a non-admin manager save capabilities using the real authorization checks', async ({
  page,
}) => {
  await installOidcSession(page, managerId, 'e2e-manager');
  await page.goto(`/manage/${acpId}`);
  const row = page
    .getByRole('region', { name: 'Personen & Rollen' })
    .locator('tbody tr')
    .filter({ has: page.getByRole('combobox', { name: 'Rolle für E2E Manager', exact: true }) });
  const checkbox = row.getByLabel('Item Explorer: bearbeiten');
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  const response = page.waitForResponse(
    (r) => r.url().endsWith(`/roles/${managerId}/capabilities`) && r.request().method() === 'PATCH',
  );
  await row.getByRole('button', { name: 'Änderungen speichern' }).click();
  expect((await response).status()).toBe(200);
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  await expect(row.getByRole('combobox')).toHaveValue('ACP_MANAGER');
  await checkbox.check();
  await row.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(row.getByRole('button', { name: 'Änderungen speichern' })).toBeDisabled();
});
