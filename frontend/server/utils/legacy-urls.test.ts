// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legacyRedirect } from './legacy-urls.ts'

test('old sections and their products go to our closest category', () => {
  assert.equal(legacyRedirect('/siz/'), '/catalog/sredstva-individualnoi-zashchity-i-specodezhda')
  assert.equal(legacyRedirect('/siz/', '?page=3'), '/catalog/sredstva-individualnoi-zashchity-i-specodezhda')
  assert.equal(
    legacyRedirect('/siz/zaschita-ruk/kragi-vachegi/kragi-spilkovie-037276'),
    '/catalog/rukavicy-kragi',
  )
  assert.equal(legacyRedirect('/siz/zaschita-ruk/rabochie-perchatki/'), '/catalog/sredstva-individualnoi-zashchity-i-specodezhda-perchatki')
  assert.equal(legacyRedirect('/spetsobuv/zimnyaya-obuv/sapogi-dutie-muzhskie-001303'), '/catalog/sapogi-i-polusapogi-rabochie')
  assert.equal(legacyRedirect('/spetsodezhda/letnya/rabochie-kostumy/kostjum-legion-045369'), '/catalog/kostyumy-rabochie')
  assert.equal(legacyRedirect('/spetsodezhda/medicinskaya-odezhda/'), '/catalog/specodezhda')
  assert.equal(legacyRedirect('/SPETSODEZHDA/'), '/catalog/specodezhda')
})

test('old shop pages', () => {
  assert.equal(legacyRedirect('/about_us'), '/about')
  assert.equal(legacyRedirect('/contact-us/'), '/contacts')
  assert.equal(legacyRedirect('/contact.html'), '/contacts')
  assert.equal(legacyRedirect('/index.html'), '/')
  assert.equal(legacyRedirect('/index.php', '?route=product/product&product_id=181'), '/catalog')
  assert.equal(legacyRedirect('/index.php', '?route=pavblog/blog&blog_id=12'), '/')
  assert.equal(legacyRedirect('/specials/'), '/sales')
})

test('our own addresses are never touched', () => {
  for (const path of [
    '/', '/catalog', '/catalog/specodezhda', '/product/kragi-spilkovye', '/about', '/contacts',
    '/sales', '/account', '/login', '/brand/bull', '/sitemap.xml', '/sitemap-products-1.xml',
    '/api/products', '/_nuxt/app.js', '/sizy', '/contacts-extra',
  ]) {
    assert.equal(legacyRedirect(path), null, path)
  }
})
