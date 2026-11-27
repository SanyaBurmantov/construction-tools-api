// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStoredVariant, mediaLargest, mediaSrc, mediaSrcset } from '../../app/utils/media-variants.ts'

const SET = `https://storage-1339.s3hoster.by/gost-by-media/v/ab/${'c'.repeat(40)}/`

test('a photo stored at 320 and 640: each box gets the smallest that covers it', () => {
  const url = `${SET}640.webp`
  assert.equal(mediaSrc(url, 44, 2), `${SET}320.webp`)
  assert.equal(mediaSrc(url, 300), `${SET}320.webp`)
  assert.equal(mediaSrc(url, 300, 2), `${SET}640.webp`)
  assert.equal(mediaSrc(url, 480, 2), `${SET}640.webp`)
  assert.equal(mediaSrcset(url, 300), `${SET}320.webp 1x, ${SET}640.webp 2x`)
  assert.equal(mediaSrcset(url, 60), `${SET}320.webp`)
})

test('an old URL naming 1200 never asks for a deleted 160 or 1200', () => {
  const url = `${SET}1200.webp`
  assert.ok(isStoredVariant(url))
  assert.equal(mediaSrc(url, 60), `${SET}320.webp`)
  assert.equal(mediaSrc(url, 480, 2), `${SET}640.webp`)
  assert.equal(mediaLargest(url), `${SET}640.webp`)
})

test('a small original keeps its one file', () => {
  assert.equal(mediaSrc(`${SET}320.webp`, 480, 2), `${SET}320.webp`)
  assert.equal(mediaLargest(`${SET}160.webp`), `${SET}160.webp`)
})

test('anything else is returned as it is', () => {
  assert.equal(mediaLargest('https://dukon.by/a.jpg'), 'https://dukon.by/a.jpg')
  assert.equal(mediaLargest(null), null)
  assert.equal(mediaSrc(`${SET}800.webp`, 300), `${SET}800.webp`)
})
