import { test as base, expect } from '@playwright/test';

/**
 * Every check runs with analytics and the search journal blocked: an hourly
 * robot must not show up as visitors in Metrika or as searches in
 * /admin/search. Browser JS errors are collected and fail the test — a page
 * that renders but throws is exactly what these checks exist to catch.
 */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(
        /mc\.yandex\.|yandex\.ru\/metrika|\/api\/search\/events|\/api\/client-errors/,
        (route) => route.fulfill({ status: 204, body: '' }),
      );
      await use();
      expect(errors, 'JavaScript errors on the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
