// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jsonLdDescription, priceValidUntil } from '../../app/utils/product-jsonld.ts'

const NOW = Date.parse('2026-11-12T12:00:00Z')

test('a fresh price is valid for a week from the last sync', () => {
  assert.equal(priceValidUntil('2026-11-12T03:00:00Z', NOW), '2026-11-19')
  assert.equal(priceValidUntil(new Date('2026-11-06T13:00:00Z'), NOW), '2026-11-13')
})

test('a week that has already passed gives no priceValidUntil at all', () => {
  // /product/strubcina-g-obraznaya-s-3-mya-zazhimami-63mm-2-5 said 2026-11-05 on 12.11.
  assert.equal(priceValidUntil('2026-10-29T08:00:00Z', NOW), undefined)
  assert.equal(priceValidUntil('2026-11-05T12:00:00Z', NOW), undefined)
  // Still ahead by the hour, but the day is today: a cached page would outlive it.
  assert.equal(priceValidUntil('2026-11-05T15:00:00Z', NOW), undefined)
})

test('no sync date, no field', () => {
  assert.equal(priceValidUntil(null, NOW), undefined)
  assert.equal(priceValidUntil(undefined, NOW), undefined)
  assert.equal(priceValidUntil('not a date', NOW), undefined)
})

test('a short description is kept whole, whitespace collapsed', () => {
  assert.equal(jsonLdDescription('  Ключ  рожковый.\n\nХром-ванадий. '), 'Ключ рожковый. Хром-ванадий.')
  assert.equal(jsonLdDescription(null), '')
})

test('a long one is cut at the last sentence before the limit', () => {
  const sentence = 'Бесконтактный автошампунь с пеной зеленого цвета. '
  const text = sentence.repeat(95).trim() // ~4 700 characters, as on the live card
  const out = jsonLdDescription(text)
  assert.ok(out.length <= 1000, `${out.length}`)
  assert.ok(out.length > 900, `${out.length}`)
  assert.ok(out.endsWith('цвета.'))
})

test('without a sentence end it is cut at a word, with «…»', () => {
  const text = 'слово '.repeat(300)
  const out = jsonLdDescription(text, 100)
  assert.ok(out.length <= 100)
  assert.ok(out.endsWith('слово…'), out)
})
