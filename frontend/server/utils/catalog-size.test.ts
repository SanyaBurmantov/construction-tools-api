// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { catalogFigure, catalogTotal } from '../../app/utils/catalog-size.ts'

const NBSP = '\u00A0'

test('the total is the sum of the roots', () => {
  assert.equal(catalogTotal([{ productCount: 52_000 }, { productCount: 43_812 }, { productCount: 0 }]), 95_812)
  assert.equal(catalogTotal([]), 0)
  assert.equal(catalogTotal(null), 0)
  assert.equal(catalogTotal([{ productCount: null }, {}]), 0)
})

test('rounds down to thousands and marks the rest with a plus', () => {
  assert.deepEqual(catalogFigure(95_812), { text: `95${NBSP}000+`, count: 95_000 })
  assert.deepEqual(catalogFigure(95_000), { text: `95${NBSP}000`, count: 95_000 })
  assert.deepEqual(catalogFigure(1_000_001), { text: `1${NBSP}000${NBSP}000+`, count: 1_000_000 })
  assert.deepEqual(catalogFigure(1_999), { text: `1${NBSP}000+`, count: 1_000 })
})

test('small catalogues are exact', () => {
  assert.deepEqual(catalogFigure(523), { text: '523', count: 523 })
  assert.deepEqual(catalogFigure(21), { text: '21', count: 21 })
})

test('unknown or empty size gives no figure', () => {
  assert.equal(catalogFigure(0), null)
  assert.equal(catalogFigure(-5), null)
  assert.equal(catalogFigure(Number.NaN), null)
})
