import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  journeyBookletId,
  journeyUnitId,
  journeyUnitName,
} from '../../test-fixtures/browser-journey-package';
import { persistentMediaVisibilityDefinition } from './fixtures/conditional-visibility';
import { installOidcSession } from './oidc-test-session';

const apId = '10000000-0000-4000-8000-000000000307';
const baseUrl = `/view/${apId}/sequence/${journeyBookletId}?kind=booklet`;

async function expectPosition(page: Page, position: number, total = 3) {
  await expect(page.locator('.nav-info strong')).toHaveText(`${position} von ${total}`);
  await expect(
    page.frameLocator('app-unit-view iframe').getByText(journeyUnitName, { exact: true }),
  ).toBeVisible();
}

function measurePlayer(iframe: Locator) {
  return iframe.evaluate((frame: HTMLIFrameElement) => {
    const { width, height } = frame.getBoundingClientRect();
    return {
      width,
      height,
      innerWidth: frame.contentWindow!.innerWidth,
      innerHeight: frame.contentWindow!.innerHeight,
    };
  });
}

test.beforeEach(async ({ context }) => {
  await installOidcSession(context, '10000000-0000-4000-8000-000000000002', 'e2e-manager');
});

test('keeps the comment placeholder readable against its surface', async ({ page }) => {
  await page.goto(baseUrl);
  await expectPosition(page, 1);
  const input = page.locator('.new-comment-form textarea');
  await expect(input).toBeVisible();
  const contrast = await input.evaluate((element) => {
    const luminance = (cssColor: string) => {
      // Canvas resolves browser-specific computed formats, including color(srgb ...).
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = cssColor;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      if (alpha !== 255) throw new Error('Expected opaque placeholder and surface colors');
      const linear = [red, green, blue].map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const placeholder = getComputedStyle(element, '::placeholder');
    if (Number(placeholder.opacity) !== 1) throw new Error('Expected opaque placeholder text');
    const text = luminance(placeholder.color);
    const background = luminance(getComputedStyle(element).backgroundColor);
    return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test('scales the review player without changing its viewport or answers', async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 900 });
  await page.goto(baseUrl);
  await expectPosition(page, 1);

  const iframe = page.locator('app-unit-view iframe');
  const player = iframe.contentFrame();
  const hidePanel = page.getByRole('button', { name: 'Reviewbereich ausblenden' });
  const showPanel = page.getByRole('button', { name: 'Reviewbereich einblenden' });
  const notice = page.getByText('Abweichende Darstellung', { exact: true });
  const frameDocument = await iframe.evaluateHandle(
    (frame: HTMLIFrameElement) => frame.contentDocument,
  );
  const measure = () => measurePlayer(iframe);
  const answer = player.getByRole('radio', { name: 'zum See', exact: true });
  const alternateAnswer = player.getByRole('radio', { name: 'zur Schule', exact: true });

  await hidePanel.click();
  await expect.poll(async () => (await measure()).width).toBeGreaterThan(1000);
  const fullSize = await measure();
  await answer.check();
  await showPanel.click();
  await expect.poll(async () => (await measure()).width).toBeLessThan(700);
  const scaled = await measure();
  expect(scaled.innerWidth).toBe(fullSize.innerWidth);
  expect(scaled.innerHeight).toBe(fullSize.innerHeight);
  expect(scaled.height / fullSize.height).toBeCloseTo(scaled.width / fullSize.width, 3);
  await expect(notice).toBeHidden();
  await expect(answer).toBeChecked();
  await alternateAnswer.check();

  const resizeHandle = page.getByRole('button', { name: 'Breite des Reviewbereichs ändern' });
  for (let step = 0; step < 3; step += 1) await resizeHandle.press('ArrowLeft');
  await expect(notice).toBeVisible();
  for (let step = 0; step < 3; step += 1) await resizeHandle.press('ArrowRight');
  await expect(notice).toBeHidden();
  await expect(alternateAnswer).toBeChecked();

  await page.setViewportSize({ width: 801, height: 900 });
  await expect(notice).toBeVisible();
  await expect(iframe).toBeHidden();
  await hidePanel.click();
  await expect(notice).toBeHidden();
  await expect(alternateAnswer).toBeChecked();
  expect(
    await iframe.evaluate(
      (frame: HTMLIFrameElement, original) => frame.contentDocument === original,
      frameDocument,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 800, height: 900 });
  const container = page.locator('.player-container');
  await expect
    .poll(
      async () =>
        (await measure()).innerWidth === (await container.evaluate((card) => card.clientWidth)),
    )
    .toBe(true);
  const narrow = await measure();
  await showPanel.click();
  await expect(page.locator('#unit-additional-data')).toBeVisible();
  await expect(iframe).toBeVisible();
  await expect(notice).toBeHidden();
  await expect.poll(async () => (await measure()).innerWidth).toBe(narrow.innerWidth);
});

for (const mode of ['view-all', 'print-ids']) {
  test(`scales the ${mode} review preview and keeps the print viewport`, async ({ page }) => {
    await page.setViewportSize({ width: 1150, height: 900 });
    await page.goto(baseUrl);
    await expectPosition(page, 1);
    const iframe = page.locator('app-unit-view iframe');
    const hidePanel = page.getByRole('button', { name: 'Reviewbereich ausblenden' });
    const showPanel = page.getByRole('button', { name: 'Reviewbereich einblenden' });
    const notice = page.getByText('Abweichende Darstellung', { exact: true });

    await hidePanel.click();
    await page.getByRole('combobox', { name: 'Seitendarstellung der Aufgabe' }).selectOption(mode);
    await expectPosition(page, 1);
    await expect.poll(async () => (await measurePlayer(iframe)).width).toBeGreaterThan(1000);
    const full = await measurePlayer(iframe);

    await showPanel.click();
    await expect.poll(async () => (await measurePlayer(iframe)).width).toBeLessThan(700);
    const scaled = await measurePlayer(iframe);
    expect(scaled.innerWidth).toBe(full.innerWidth);
    expect(scaled.innerHeight).toBe(full.innerHeight);
    expect(scaled.height / full.height).toBeCloseTo(scaled.width / full.width, 3);

    await page.setViewportSize({ width: 801, height: 900 });
    await expect(notice).toBeVisible();
    await expect(iframe).toBeHidden();
    await hidePanel.click();
    await expect(notice).toBeHidden();
    await expectPosition(page, 1);
  });
}

test('pauses single-play audio while the review preview is too small', async ({ page }) => {
  const definition = persistentMediaVisibilityDefinition({ durationSeconds: 8, maxRuns: 1 });
  const definitionUrl = '/review-test-media.voud';
  await page.route(`**/api/view/ap/${apId}/units/${journeyUnitId}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const dependency = data.dependencies.find(
      ({ type }: { type: string }) => type === 'UNIT_DEFINITION',
    );
    dependency.downloadUrl = definitionUrl;
    await route.fulfill({ response, json: data });
  });
  await page.route(`**${definitionUrl}*`, (route) => route.fulfill({ json: definition }));

  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(baseUrl);
  const hidePanel = page.getByRole('button', { name: 'Reviewbereich ausblenden' });
  const showPanel = page.getByRole('button', { name: 'Reviewbereich einblenden' });
  const notice = page.getByText('Abweichende Darstellung', { exact: true });
  const iframe = page.locator('app-unit-view iframe');
  const player = iframe.contentFrame();
  const play = player.locator('button').filter({ hasText: 'play_arrow' });
  const audio = player.locator('audio');
  const playingTime = () => audio.evaluate((media: HTMLAudioElement) => media.currentTime);

  await hidePanel.click();
  await play.click();
  await expect.poll(playingTime).toBeGreaterThan(0);
  await showPanel.click();
  await expect(notice).toBeVisible();
  await expect(iframe).toBeHidden();
  await expect(audio).toHaveJSProperty('paused', true);
  const pausedAt = await playingTime();
  expect(pausedAt).toBeGreaterThan(0);

  await hidePanel.click();
  await expect(iframe).toBeVisible();
  await expect(audio).toHaveJSProperty('paused', true);
  expect(await playingTime()).toBeCloseTo(pausedAt, 2);
  await play.click();
  await expect.poll(playingTime).toBeGreaterThan(pausedAt + 0.05);
});

test('keeps the review panel resizable and the workspace usable on narrow screens', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(baseUrl);
  await expectPosition(page, 1);
  await expect(page.locator('.workspace-heading h2')).toHaveText(journeyBookletId);
  const panel = page.locator('.unit-layout.review-mode .meta-panel.split');
  const handle = page.getByRole('button', {
    name: 'Breite des Reviewbereichs ändern',
    exact: true,
  });
  await expect(handle).toBeVisible();
  const initialWidth = (await panel.boundingBox())!.width;
  await handle.focus();
  for (let step = 0; step < 6; step += 1) await handle.press('ArrowLeft');
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(Math.round(initialWidth + 144));
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 60, grip.y + grip.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(Math.round(initialWidth + 204));
  await page.screenshot({
    path: testInfo.outputPath('review-workspace-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const player = (await page.locator('.player-container').boundingBox())!;
  expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(player.y + player.height);
  await expect(
    page.getByRole('link', { name: 'Direktlink zur Aufgabe kopieren', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('review-workspace-mobile.png'),
    fullPage: true,
  });
});

test('keeps all workspace tools inside narrow screens when downloads are enabled', async ({
  page,
}) => {
  await page.route(`**/api/view/ap/${apId}`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: {
        ...data,
        featureConfig: { ...data.featureConfig, allowUnitDownload: true },
      },
    });
  });
  await page.goto(baseUrl);
  await expectPosition(page, 1);
  const tools = page.locator('.workspace-actions > .btn');
  await expect(tools).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Download Testheft' })).toBeVisible();
  for (const width of [440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() =>
        tools.evaluateAll((elements) =>
          elements.every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
          }),
        ),
      )
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('copies the current task link on click without navigating and confirms success', async ({
  page,
}) => {
  // Stub only the permission-dependent clipboard boundary, keeping routing and API real.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset['copiedTaskLink'] = text;
        },
      },
    });
  });
  await page.goto(baseUrl);
  await expectPosition(page, 1);
  const link = page.getByRole('link', { name: 'Direktlink zur Aufgabe kopieren', exact: true });
  const href = (await link.getAttribute('href'))!;
  const originalUrl = page.url();
  await link.click();
  await expect(page.getByRole('status')).toHaveText('Link kopiert.');
  expect(await page.locator('html').getAttribute('data-copied-task-link')).toBe(
    new URL(href, originalUrl).href,
  );
  await expect(page).toHaveURL(originalUrl);
  await expectPosition(page, 1);
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 2);
  await expect(page.getByText('Link kopiert.', { exact: true })).toHaveCount(0);
});

test('offers a selectable task link when clipboard permission is denied', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new DOMException('Clipboard access denied', 'NotAllowedError');
        },
      },
    });
  });
  await page.goto(`${baseUrl}&position=2`);
  await expectPosition(page, 2);
  const link = page.getByRole('link', { name: 'Direktlink zur Aufgabe kopieren', exact: true });
  const href = (await link.getAttribute('href'))!;
  await link.click();
  await expect(page.getByRole('status')).toHaveText(
    'Der Link konnte nicht automatisch kopiert werden.',
  );
  const input = page.getByRole('textbox', { name: 'Direktlink zum manuellen Kopieren' });
  await expect(input).toHaveValue(new URL(href, page.url()).href);
  await input.focus();
  expect(
    await input.evaluate(
      (element: HTMLInputElement) =>
        element.selectionStart === 0 && element.selectionEnd === element.value.length,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('copies an exact repeated occurrence into a new tab and survives reload', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // All content, manifest parsing and permissions come from the isolated backend.
  const sequenceResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/view/ap/${apId}/sequences/${journeyBookletId}?`),
  );
  await page.goto(baseUrl);
  const booklet = await (await sequenceResponse).json();
  await expectPosition(page, 1);
  await page.getByRole('button', { name: 'Aufgabenliste', exact: true }).click();
  const links = page.locator('.unit-direct-link');
  await expect(links).toHaveCount(3);
  const hrefs = await links.evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')!));
  expect(new Set(hrefs).size).toBe(3);
  const secondHref = hrefs[1];
  expect(new URL(secondHref, page.url()).searchParams.get('occurrence')).toMatch(
    /^[A-Za-z0-9_-]{16}$/,
  );
  await links.nth(1).click();
  await expectPosition(page, 2);
  await expect(page).toHaveURL(secondHref);
  await expect(
    page.getByRole('link', { name: 'Direktlink zur Aufgabe kopieren', exact: true }),
  ).toHaveAttribute('href', secondHref);
  await page.reload();
  await expectPosition(page, 2);
  await page.getByRole('button', { name: 'Aufgabenliste', exact: true }).click();
  await expect(page.locator('.unit-list-item[aria-current="step"]')).toContainText('Alias: second');
  const copied = await context.newPage();
  try {
    await copied.goto(secondHref);
    await expectPosition(copied, 2);
    await copied.reload();
    await expectPosition(copied, 2);
    await copied.goto(`${baseUrl}&occurrence=${encodeURIComponent(booklet.units[1].occurrenceId)}`);
    await expectPosition(copied, 2);
    await expect(
      copied.getByRole('link', { name: 'Direktlink zur Aufgabe kopieren', exact: true }),
    ).toHaveAttribute('href', secondHref);
    await copied.setViewportSize({ width: 390, height: 844 });
    await expect(
      copied.getByRole('link', { name: 'Direktlink zur Aufgabe kopieren', exact: true }),
    ).toBeVisible();
    expect(await copied.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await copied.screenshot({ path: testInfo.outputPath('task-link-mobile.png'), fullPage: true });
  } finally {
    await copied.close();
  }
  expect(errors).toEqual([]);
});

test('synchronizes next, previous, task list and browser history without refetching', async ({
  page,
}) => {
  let sequenceRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/api/view/ap/${apId}/sequences/${journeyBookletId}?`)) {
      sequenceRequests += 1;
    }
  });
  await page.goto(baseUrl);
  await expectPosition(page, 1);
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 2);
  const secondUrl = page.url();
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 3);
  await page.goBack();
  await expectPosition(page, 2);
  await expect(page).toHaveURL(secondUrl);
  await page.goBack();
  await expectPosition(page, 1);
  await page.goForward();
  await expectPosition(page, 2);
  await page.getByRole('button', { name: '← Zurück', exact: true }).click();
  await expectPosition(page, 1);
  await page.getByRole('button', { name: 'Aufgabenliste', exact: true }).click();
  await page.locator('.unit-list-row').nth(2).getByRole('button').click();
  await expectPosition(page, 3);
  await page.goBack();
  await expectPosition(page, 1);
  expect(sequenceRequests).toBe(1);
});

test('clears the task selection on booklet switch and restores it through browser history', async ({
  page,
}) => {
  await page.goto(`${baseUrl}&position=3`);
  await expectPosition(page, 3);
  await page.getByRole('button', { name: /^Testheft wechseln, aktuell/ }).click();
  await page.locator('.booklet-list-item').filter({ hasText: 'review-other' }).click();
  await expectPosition(page, 1, 1);
  await expect(page).toHaveURL(`/view/${apId}/sequence/review-other?kind=booklet`);
  await page.goBack();
  await expectPosition(page, 3);
  await page.reload();
  await expectPosition(page, 3);
});

test('reports a stale link and lets navigation recover to a valid target', async ({ page }) => {
  await page.goto(`${baseUrl}&occurrence=not-in-this-booklet`);
  await expectPosition(page, 1);
  await expect(page.getByRole('status')).toContainText(
    'Die verlinkte Aufgabe wurde in diesem Testheft nicht gefunden.',
  );
  await expect(page.getByRole('status')).toContainText('ungültig oder veraltet');
  await page.getByRole('button', { name: 'Weiter →', exact: true }).click();
  await expectPosition(page, 2);
  await expect(
    page.getByText('Die verlinkte Aufgabe wurde in diesem Testheft nicht gefunden.'),
  ).toHaveCount(0);
  await page.reload();
  await expectPosition(page, 2);
});
