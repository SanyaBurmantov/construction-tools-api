import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true }).first();
const productLink = (page: Page) => visible(page, 'article a[href^="/product/"]');
// The HTML is what we check; waiting for `load` waits for every supplier
// photo not yet copied to our S3 — their speed is measured elsewhere.
const open = (page: Page, url: string) => page.goto(url, { waitUntil: 'domcontentloaded' });

test('API is ready', async ({ request }) => {
  const res = await request.get('/api/health/ready');
  expect(res.status()).toBe(200);
});

test('home page shows the catalogue', async ({ page }) => {
  await open(page, '/');
  await expect(page).toHaveTitle(/gost\.by/i);
  await expect(visible(page, 'a[href^="/catalog/"]')).toBeVisible();
  await expect(visible(page, 'a[href^="/product/"]')).toBeVisible();
});

test('search finds products', async ({ page }) => {
  await open(page, '/catalog?search=перфоратор');
  await expect(productLink(page)).toBeVisible();
});

test('a category filters the catalogue', async ({ page }) => {
  await open(page, '/catalog');
  await expect(productLink(page)).toBeVisible();
  const category = visible(page, 'main a[href^="/catalog/"]');
  const href = (await category.getAttribute('href')) ?? '';
  await category.click();
  await expect(page).toHaveURL((url) => url.pathname === href.split('?')[0]);
  await expect(productLink(page)).toBeVisible();
});

test('product → cart → the way into checkout', async ({ page }) => {
  await open(page, '/catalog?inStock=true');
  await productLink(page).click();

  // Product page: a name, a price, a working buy button.
  await expect(page.locator('h1')).toBeVisible();
  // Compared by address, not by name: names are rewritten (AI, admins).
  const productPath = new URL(page.url()).pathname;
  await expect(page.getByText(/\d\s*(Br|BYN)/).first()).toBeVisible();
  // The button is in the server HTML before Vue has hydrated it; a click that
  // early does nothing. Retry until the page says the item is in the cart.
  const buy = page.getByRole('button', { name: /^в корзину$/i }).filter({ visible: true }).first();
  await expect(async () => {
    await buy.click({ timeout: 2_000 });
    await expect(page.getByRole('button', { name: /^добавить ещё$/i }).filter({ visible: true }).first()).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });

  // The cart holds it (client-side, localStorage) and re-prices it.
  await open(page, '/cart');
  await expect(visible(page, `a[href="${productPath}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Оформить заказ' }).click();

  // A guest is asked to sign in first and comes back to checkout. Nothing is
  // ever submitted — this is the furthest a robot goes.
  await expect(page).toHaveURL((url) => url.pathname === '/login' && url.searchParams.get('redirect') === '/checkout');
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test('sitemap is served', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('<sitemapindex');
});
