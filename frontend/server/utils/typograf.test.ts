// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { typograf } from '../../app/utils/typograf.ts'

const NB = ' '

test('quotes become «ёлочки» only when they pair; inches stay', () => {
  assert.equal(typograf('Серия "Профи" для дома'), `Серия «Профи» для${NB}дома`)
  assert.equal(typograf('Ключ 1/2" и 3/4"'), `Ключ 1/2" и${NB}3/4"`)
  assert.equal(typograf('Один " без пары'), `Один " без${NB}пары`)
})

test('dash, ellipsis, spaces', () => {
  assert.equal(typograf('Дрель - надёжный помощник...'), `Дрель${NB}— надёжный помощник…`)
  assert.equal(typograf('Мощно  и   тихо'), `Мощно и${NB}тихо`)
})

test('short words and units hold to the next word', () => {
  assert.equal(
    typograf('Для сверления в бетоне на 1 200 об/мин, диск 125 мм'),
    `Для${NB}сверления в${NB}бетоне на${NB}1${NB}200${NB}об/мин, диск 125${NB}мм`
  )
  assert.equal(typograf('в и на'), `в${NB}и${NB}на`)
  // A unit-looking start of a longer word is not a unit.
  assert.equal(typograf('5 мест'), '5 мест')
})

test('lines, empties and articles are left alone', () => {
  assert.equal(typograf('Строка один\nСтрока два'), 'Строка один\nСтрока два')
  assert.equal(typograf(null), '')
  assert.equal(typograf('M10x40 DIN 912'), 'M10x40 DIN 912')
})
