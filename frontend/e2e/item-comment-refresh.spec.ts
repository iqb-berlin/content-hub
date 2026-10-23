import { expect, Page, test } from '@playwright/test';
import { createOidcAppToken, installOidcSession } from './oidc-test-session';

test.use({ viewport: { width: 1440, height: 1000 } });

test.afterEach(async ({ page }, testInfo) => {
  const panel = page.getByRole('region', { name: 'Kommentare zum ausgewählten Item' });
  if (await panel.isVisible()) {
    await testInfo.attach('comment-panel', {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });
  }
  await testInfo.attach('comment-ui', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

const ACP = '10000000-0000-4000-8000-000000000201';
const MANAGER = '10000000-0000-4000-8000-000000000002';
const VIEWER = '10000000-0000-4000-8000-000000000003';
const threadUrl = `**/api/acp/${ACP}/review/comments?*`;
const countsUrl = `**/api/acp/${ACP}/review/comments/counts`;
const snapshot = (comments: object[] = []) => ({
  revision: 'test',
  target: { unitId: 'MDB007', itemId: '01' },
  visibilityMode: 'PRIVATE',
  comments,
});
const ownComment = {
  id: '10000000-0000-4000-8000-000000000901',
  commentText: 'Privater Testkommentar',
  authorLabel: 'Testautor',
  isOwn: true,
  version: 1,
  createdAt: '2026-01-01T10:00:00Z',
  parentCommentId: null,
};

async function open(page: Page, selectItem = true) {
  await installOidcSession(page, MANAGER, 'e2e-manager');
  await page.goto(`/view/${ACP}/item-explorer`);
  const filter = page.getByLabel('Nach Kommentarstatus filtern');
  await expect
    .poll(
      async () =>
        (await filter.isEnabled()) ||
        (await page.getByText('Kommentaranzahlen konnten nicht geladen werden.').isVisible()),
    )
    .toBe(true);
  if (await filter.isEnabled()) await filter.selectOption('');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  if (selectItem) {
    await page.getByRole('cell', { name: 'MDB00701', exact: true }).click();
    await page.getByRole('button', { name: /Kommentare \(/ }).click();
  }
  return page.getByRole('region', { name: 'Kommentare zum ausgewählten Item' });
}

async function switchSession(page: Page) {
  // A second tab produces the same native storage event as a login elsewhere.
  const other = await page.context().newPage();
  await other.goto('/');
  await other.evaluate(
    (token) => localStorage.setItem('cp_token', token),
    createOidcAppToken(VIEWER, 'e2e-viewer'),
  );
  await other.close();
}

test('disables comment filtering on initial count failure and recovers automatically', async ({
  page,
}) => {
  let failing = true;
  let swapped = false;
  await page.route(countsUrl, (route) =>
    failing
      ? route.fulfill({ status: 503, json: { message: 'Count service unavailable' } })
      : route.fulfill({
          json: {
            revision: '2',
            counts: [
              { unitId: 'MDB007', itemId: '01', count: swapped ? 0 : 1 },
              { unitId: 'MDB007', itemId: 'G', count: swapped ? 1 : 0 },
            ],
          },
        }),
  );
  await open(page, false);
  const filter = page.getByLabel('Nach Kommentarstatus filtern');
  await expect(filter).toBeDisabled();
  await expect(page.getByText('Kommentaranzahlen konnten nicht geladen werden.')).toBeVisible();
  failing = false;
  await expect(filter).toBeEnabled();
  await expect(page.getByText('Kommentaranzahlen konnten nicht geladen werden.')).toHaveCount(0);
  await filter.selectOption('with');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('MDB00701');
  await filter.selectOption('without');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('MDB007G');
  await filter.selectOption('');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await filter.selectOption('with');
  swapped = true;
  await expect(page.locator('tbody tr')).toContainText('MDB007G');
  await filter.selectOption('');
  await expect(page.getByRole('button', { name: '↻ Kommentare', exact: true })).toHaveCount(0);
});

test('clears differing thread errors after automatic recovery and preserves the draft', async ({
  page,
}) => {
  let message = 'Erster Ladefehler';
  await page.route(threadUrl, (route) =>
    message
      ? route.fulfill({ status: 503, json: { message } })
      : route.fulfill({ json: snapshot() }),
  );
  const panel = await open(page);
  await expect(panel.getByText(message, { exact: true })).toBeVisible();
  await panel.getByPlaceholder('Kommentar zu diesem Item …').fill('Entwurf bleibt erhalten');
  message = 'Zweiter Ladefehler';
  await expect(panel.getByText(message, { exact: true })).toBeVisible();
  message = '';
  await expect(panel.locator('.alert-error')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Kommentare erneut laden' })).toHaveCount(0);
  await expect(panel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue(
    'Entwurf bleibt erhalten',
  );
});

test('keeps edit and reply forms when a poll removes their comment and preserves conflict feedback', async ({
  page,
}) => {
  let comments: object[] = [ownComment];
  let loads = 0;
  await page.route(threadUrl, (route) => {
    loads += 1;
    return route.fulfill({ json: snapshot(comments) });
  });
  await page.route(`**/api/acp/${ACP}/review/comments/${ownComment.id}`, (route) =>
    route.fulfill({ status: 409, json: { message: 'Versionskonflikt aus UI-Test' } }),
  );
  const panel = await open(page);
  await panel.getByRole('button', { name: 'Antworten', exact: true }).click();
  await panel.getByPlaceholder('Antwort schreiben …').fill('Antwortentwurf');
  await panel.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await panel.locator('.edit-form textarea').fill('Bearbeitungsentwurf');
  const previousLoads = loads;
  comments = [];
  await expect.poll(() => loads).toBeGreaterThan(previousLoads);
  await expect(page.getByRole('button', { name: /Kommentare \(0\)/ })).toBeVisible();
  await expect(panel.locator('.edit-form textarea')).toHaveValue('Bearbeitungsentwurf');
  await expect(panel.getByPlaceholder('Antwort schreiben …')).toHaveValue('Antwortentwurf');
  const patch = page.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith(ownComment.id),
  );
  await panel.locator('.edit-form').getByRole('button', { name: 'Speichern' }).click();
  expect((await patch).postDataJSON()).toMatchObject({ version: 1 });
  await expect(panel.getByText('Versionskonflikt aus UI-Test')).toBeVisible();
  const conflictLoads = loads;
  await expect.poll(() => loads).toBeGreaterThan(conflictLoads);
  await expect(panel.getByText('Versionskonflikt aus UI-Test')).toBeVisible();
  await expect(panel.locator('.edit-form textarea')).toHaveValue('Bearbeitungsentwurf');
});

test('invalidates a delayed old-session thread and clears private drafts on user switch', async ({
  page,
}) => {
  let delayNext = false;
  let delayed = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let switched = false;
  await page.route(threadUrl, async (route) => {
    const body = snapshot(switched ? [] : [ownComment]);
    if (delayNext) {
      delayNext = false;
      delayed = true;
      await gate;
    }
    await route.fulfill({ json: body }).catch(() => {});
  });
  const panel = await open(page);
  await panel.getByPlaceholder('Kommentar zu diesem Item …').fill('Alter privater Entwurf');
  await panel.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await panel.locator('.edit-form textarea').fill('Alte private Bearbeitung');
  delayNext = true;
  await expect.poll(() => delayed).toBe(true);
  switched = true;
  await switchSession(page);
  await expect(panel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue('');
  await expect(panel.locator('.edit-form')).toHaveCount(0);
  await expect(panel.getByText('Noch keine Kommentare zu diesem Item.')).toBeVisible();
  release();
  await expect(panel.getByText('Privater Testkommentar', { exact: true })).toHaveCount(0);
});

test('drops a delayed old-session save without clearing the new users draft', async ({ page }) => {
  await page.route(threadUrl, (route) => route.fulfill({ json: snapshot() }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/acp/${ACP}/review/comments`, async (route) => {
    await gate;
    await route.fulfill({ json: { id: ownComment.id } }).catch(() => {});
  });
  const panel = await open(page);
  await panel.getByPlaceholder('Kommentar zu diesem Item …').fill('Alter Entwurf');
  const saveStarted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/review/comments'),
  );
  await panel.getByRole('button', { name: 'Kommentieren', exact: true }).click();
  await saveStarted;
  await switchSession(page);
  await expect(panel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue('');
  await panel.getByPlaceholder('Kommentar zu diesem Item …').fill('Neuer Entwurf');
  await expect(panel.getByRole('button', { name: 'Kommentieren', exact: true })).toBeEnabled();
  release();
  await expect(panel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue('Neuer Entwurf');
});

test('retries manually without losing the draft and removes the retry button on success', async ({
  page,
}) => {
  let failing = true;
  await page.route(threadUrl, (route) =>
    failing
      ? route.fulfill({ status: 503, json: { message: 'Manuell erneut versuchen' } })
      : route.fulfill({ json: snapshot() }),
  );
  const panel = await open(page);
  await expect(panel.getByText('Manuell erneut versuchen', { exact: true })).toBeVisible();
  await panel.getByPlaceholder('Kommentar zu diesem Item …').fill('Manueller Wiederholungsentwurf');
  failing = false;
  await panel.getByRole('button', { name: 'Kommentare erneut laden' }).click();
  await expect(panel.locator('.alert-error')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Kommentare erneut laden' })).toHaveCount(0);
  await expect(panel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue(
    'Manueller Wiederholungsentwurf',
  );
});

test('times out a hanging thread request and recovers on the next automatic refresh', async ({
  page,
}) => {
  let first = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(threadUrl, async (route) => {
    if (first) {
      first = false;
      await gate;
    }
    await route.fulfill({ json: snapshot() }).catch(() => {});
  });
  const panel = await open(page);
  await expect(panel.getByText('Kommentare werden geladen …')).toBeVisible();
  await panel
    .getByPlaceholder('Kommentar zu diesem Item …')
    .fill('Entwurf trotz Zeitüberschreitung');
  await expect(
    panel.getByText('Kommentare konnten nicht geladen werden.', { exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  release();
  await expect(panel.locator('.alert-error')).toHaveCount(0);
  await expect(panel.getByText('Noch keine Kommentare zu diesem Item.')).toBeVisible();
  await expect(panel.getByPlaceholder('Kommentar zu diesem Item …')).toHaveValue(
    'Entwurf trotz Zeitüberschreitung',
  );
});

for (const height of [720, 600]) {
  test(`keeps item rows clickable with a count error at 1280x${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height });
    let failing = true;
    await page.route(countsUrl, (route) =>
      failing
        ? route.fulfill({ status: 503, json: { message: 'Count service unavailable' } })
        : route.continue(),
    );
    await open(page, false);
    await expect(page.getByText('Kommentaranzahlen konnten nicht geladen werden.')).toBeVisible();
    await expect(page.getByLabel('Nach Kommentarstatus filtern')).toBeDisabled();
    for (const itemId of ['MDB00701', 'MDB007G']) {
      await page.getByRole('cell', { name: itemId, exact: true }).click({ timeout: 5000 });
      await expect(page.locator('tbody tr[aria-selected="true"]')).toContainText(itemId);
    }
    const heightOfTable = await page
      .locator('.table-scroll')
      .evaluate((element) => element.clientHeight);
    expect(heightOfTable).toBeGreaterThanOrEqual(180);
    await testInfo.attach(`reachable-rows-1280x${height}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    failing = false;
    await page
      .locator('.table-panel')
      .getByRole('button', { name: 'Erneut versuchen', exact: true })
      .click();
    await expect(page.getByText('Kommentaranzahlen konnten nicht geladen werden.')).toHaveCount(0);
    await expect(page.getByLabel('Nach Kommentarstatus filtern')).toBeEnabled();
    await page.getByRole('cell', { name: 'MDB00701', exact: true }).click({ timeout: 5000 });
    await expect(page.locator('tbody tr[aria-selected="true"]')).toContainText('MDB00701');
  });
}
