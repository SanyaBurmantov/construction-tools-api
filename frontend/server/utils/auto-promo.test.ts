// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAutoPromo, type AutoPromoCandidate } from '../../app/utils/auto-promo.ts'

const code = (over: Partial<AutoPromoCandidate> = {}): AutoPromoCandidate => ({
  code: 'NEW',
  type: 'PERCENT',
  value: 5,
  minOrderTotal: null,
  ...over,
})

test('applies the one advertised code', () => {
  assert.equal(pickAutoPromo([code()], 120)?.code, 'NEW')
})

test('nothing advertised, nothing applied', () => {
  assert.equal(pickAutoPromo([], 120), null)
})

test('a code the customer took off is never put back', () => {
  assert.equal(pickAutoPromo([code()], 120, ['NEW']), null)
})

test('a code whose minimum the cart does not reach is skipped', () => {
  const offers = [code({ code: 'BIG', value: 10, minOrderTotal: 500 }), code()]
  assert.equal(pickAutoPromo(offers, 300)?.code, 'NEW')
  assert.equal(pickAutoPromo(offers, 500)?.code, 'BIG')
})

test('the code worth more on this cart wins', () => {
  const offers = [code({ code: 'PCT', value: 5 }), code({ code: 'FIX', type: 'FIXED', value: 20 })]
  assert.equal(pickAutoPromo(offers, 200)?.code, 'FIX') // 10 vs 20
  assert.equal(pickAutoPromo(offers, 1000)?.code, 'PCT') // 50 vs 20
})

test('an empty cart gets no code — there is nothing to discount', () => {
  assert.equal(pickAutoPromo([code(), code({ code: 'FIX', type: 'FIXED', value: 20 })], 0), null)
})
