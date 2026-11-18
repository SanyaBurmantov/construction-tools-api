// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { outageCause } from '../../app/utils/outage-cause.ts'

test('an HTTP answer is named by its status', () => {
  assert.equal(outageCause({ statusCode: 429, message: 'Too Many Requests' }), 'HTTP 429')
  assert.equal(outageCause({ status: 502 }), 'HTTP 502')
  assert.equal(outageCause({ response: { status: 503 } }), 'HTTP 503')
})

test('no answer at all keeps the network error, without the query string', () => {
  const failure = {
    name: 'FetchError',
    message: '[GET] "/api/products/x?token=secret": <no response> Failed to fetch',
    cause: { name: 'TypeError', message: 'Failed to fetch' },
  }
  assert.equal(outageCause(failure), 'нет ответа: TypeError: Failed to fetch')
  assert.equal(
    outageCause({ name: 'FetchError', message: '[GET] "/api/x?token=secret": <no response>' }),
    'нет ответа: FetchError: [GET] "/api/x": <no response>',
  )
})

test('a status of 0 is not an answer', () => {
  assert.equal(outageCause({ status: 0, name: 'AbortError', message: 'aborted' }), 'нет ответа: AbortError: aborted')
})

test('nothing to go on', () => {
  assert.equal(outageCause(undefined), 'нет ответа')
  assert.equal(outageCause('x'), 'нет ответа')
  assert.equal(outageCause({}), 'нет ответа')
})

test('the cause is bounded', () => {
  assert.equal(outageCause({ message: 'x'.repeat(500) }).length, 200)
})
