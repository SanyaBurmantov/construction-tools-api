import { defineConfig, devices } from '@playwright/test';

/**
 * Synthetic checks: a robot walks the live storefront the way a buyer does —
 * home, catalogue, a product, the cart, the way into checkout — without ever
 * submitting anything. The uptime check says the site answers; this says it
 * works. Runs hourly and after a deploy (.github/workflows/synthetic.yml).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // A blip on a single request is the uptime check's business; one retry
  // keeps a slow cold page from paging anyone.
  retries: 1,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }]],
  use: {
    baseURL: process.env.SITE_URL || 'https://gost.by',
    locale: 'ru-RU',
    userAgent: `${devices['Desktop Chrome'].userAgent} gost-synthetic`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
