import { defineConfig, devices } from '@playwright/test';

const backendPort = 3100;
const frontendPort = 4300;
const databaseName = process.env['DB_DATABASE'] || '';
const crossBrowserSpecs = [
  '**/item-explorer-sticky-visual.spec.ts',
  '**/item-comment-refresh.spec.ts',
  '**/item-explorer-interaction-regression.spec.ts',
  '**/review-navigation-metadata.spec.ts',
  '**/review-task-links.spec.ts',
  '**/critical-journeys-cross-browser.spec.ts',
  '**/item-explorer-reduced-view.spec.ts',
];

if (process.env['NODE_ENV'] !== 'test' || !databaseName.toLowerCase().includes('e2e')) {
  throw new Error('Run browser tests through `npm run e2e` to use the isolated E2E environment.');
}
if (
  process.env['PORT'] !== String(backendPort) ||
  process.env['BROWSER_E2E_BACKEND_PORT'] !== String(backendPort) ||
  process.env['BROWSER_E2E_FRONTEND_PORT'] !== String(frontendPort)
) {
  throw new Error('Browser E2E tests require the dedicated backend and frontend ports.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: crossBrowserSpecs,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: crossBrowserSpecs,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: 'npm run start',
      cwd: '../backend',
      url: `http://127.0.0.1:${backendPort}/api/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm start -- --host 127.0.0.1 --port ${frontendPort} --proxy-config e2e/proxy.conf.json`,
      cwd: '.',
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
