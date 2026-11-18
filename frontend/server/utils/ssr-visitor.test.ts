// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isApiRequest, ssrVisitorHeaders } from './ssr-visitor.ts'

test('the visitor is the first X-Forwarded-For address', () => {
  assert.deepEqual(
    ssrVisitorHeaders({ forwardedFor: '203.0.113.7, 172.18.0.2', remoteAddress: '172.18.0.2', userAgent: 'Mozilla/5.0 (compatible; YandexBot/3.0)' }),
    { 'x-ssr-visitor-ip': '203.0.113.7', 'x-ssr-visitor-ua': 'Mozilla/5.0 (compatible; YandexBot/3.0)' },
  )
})

test('without a proxy the socket peer is the visitor', () => {
  assert.deepEqual(ssrVisitorHeaders({ remoteAddress: '::1' }), { 'x-ssr-visitor-ip': '::1' })
})

test('nothing usable, nothing sent', () => {
  assert.deepEqual(ssrVisitorHeaders({}), {})
  assert.deepEqual(ssrVisitorHeaders({ forwardedFor: 'evil\r\nx: y' }), {})
})

test('the user agent stays a printable, bounded header value', () => {
  const headers = ssrVisitorHeaders({ remoteAddress: '198.51.100.1', userAgent: `Яндекс\r\n${'x'.repeat(500)}` })
  assert.equal(headers['x-ssr-visitor-ua']?.length, 300)
  assert.match(headers['x-ssr-visitor-ua'] ?? '', /^x+$/)
})

test('only our API gets the visitor', () => {
  const base = 'http://backend:3000/api'
  assert.equal(isApiRequest('http://backend:3000/api/products/x', base), true)
  assert.equal(isApiRequest('http://backend:3000/api', `${base}/`), true)
  assert.equal(isApiRequest('http://backend:3000/apix/products', base), false)
  assert.equal(isApiRequest('https://th-tool.by/photo.jpg', base), false)
  assert.equal(isApiRequest('/api/products', ''), false)
})
