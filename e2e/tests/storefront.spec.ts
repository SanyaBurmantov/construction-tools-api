import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true }).first();
const productLink = (page: Page) => visible(page, 'article a[href^="/product/"]');

test('API is ready', async ({ request }) => {
  const res = await request.get('/api/health/ready');
  expect(res.status()).toBe(200);
});

test('home page shows the catalogue', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/gost\.by/i);
  await expect(visible(page, 'a[href^="/catalog/"]')).toBeVisible();
  await expect(visible(page, 'a[href^="/product/"]')).toBeVisible();
});

test('search finds products', async ({ page }) => {
  await page.goto('/catalog?search=перфоратор');
  await expect(productLink(page)).toBeVisible();
});

test('a category filters the catalogue', async ({ page }) => {
  await page.goto('/catalog');
  await expect(productLink(page)).toBeVisible();
  const category = visible(page, 'main a[href^="/catalog/"]');
  const href = (await category.getAttribute('href')) ?? '';
  await category.click();
  await expect(page).toHaveURL((url) => url.pathname === href.split('?')[0]);
  await expect(productLink(page)).toBeVisible();
});

test('product → cart → the way into checkout', async ({ page }) => {
  await page.goto('/catalog?inStock=true');
  await productLink(page).click();

  // Product page: a name, a price, a working buy button.
  const heading = page.locator('h1');
  await expect(heading).toBeVisible();
  const name = (await heading.innerText()).trim();
  await expect(page.getByText(/\d\s*(Br|BYN)/).first()).toBeVisible();
  await page
    .getByRole('button', { name: /^(в корзину|добавить ещё)$/i })
    .filter({ visible: true })
    .first()
    .click();

  // The cart holds it (client-side, localStorage) and re-prices it.
  await page.goto('/cart');
  await expect(page.getByText(name.slice(0, 30)).filter({ visible: true }).first()).toBeVisible();
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
