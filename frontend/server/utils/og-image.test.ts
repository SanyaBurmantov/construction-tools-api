// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { absoluteImageUrl, defaultOgImageUrl, gtinFromBarcode, ogImageUrl } from '../../app/utils/og-image.ts'

const SITE = 'https://gost.by'

test('the default preview is an absolute URL', () => {
  assert.equal(defaultOgImageUrl(SITE), 'https://gost.by/og-image.png')
  assert.equal(defaultOgImageUrl('https://gost.by/'), 'https://gost.by/og-image.png')
})

test('a path of ours becomes absolute, an absolute URL is kept', () => {
  assert.equal(absoluteImageUrl(SITE, '/og-image.png'), 'https://gost.by/og-image.png')
  assert.equal(absoluteImageUrl(SITE, 'og-image.png'), 'https://gost.by/og-image.png')
  assert.equal(absoluteImageUrl(`${SITE}/`, '/a/b.png'), 'https://gost.by/a/b.png')
  assert.equal(absoluteImageUrl(SITE, 'https://cdn.example/x.png'), 'https://cdn.example/x.png')
  assert.equal(absoluteImageUrl(SITE, '//cdn.example/x.png'), 'https://cdn.example/x.png')
})

test('a photo is served through our IPX at 1200×630', () => {
  const src = 'https://storage-1339.s3hoster.by/gost-by-media/v/58/1200.webp'
  assert.equal(
    ogImageUrl(SITE, src),
    `https://gost.by/_ipx/f_jpeg&q_85&fit_contain&b_ffffff&s_1200x630/${src}`,
  )
  assert.equal(ogImageUrl(SITE, '/og-image.png'), 'https://gost.by/og-image.png')
  assert.equal(ogImageUrl(SITE, null), undefined)
  assert.equal(ogImageUrl(SITE, ''), undefined)
})

test('no relative URL ever comes out', () => {
  for (const src of ['/og-image.png', 'og-image.png', 'https://th-tool.by/a.jpg', '//x.by/a.jpg']) {
    assert.match(ogImageUrl(SITE, src)!, /^https:\/\//)
  }
})

test('barcode → GTIN', () => {
  assert.deepEqual(gtinFromBarcode('4810992031625 (4811207007213)'), { key: 'gtin13', value: '4810992031625' })
  assert.equal(gtinFromBarcode('12345'), null)
  assert.equal(gtinFromBarcode(null), null)
})
