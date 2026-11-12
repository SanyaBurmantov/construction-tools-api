// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginationItems, paginationPages } from '../../app/utils/pagination.ts'

/** Clicks from page 1 to the farthest page, following only the pager's links. */
function maxClicksFromFirst(pages: number): number {
  const depth = new Array<number>(pages + 1).fill(-1)
  depth[1] = 0
  const queue = [1]
  while (queue.length) {
    const page = queue.shift()!
    for (const next of paginationPages(page, pages)) {
      if (depth[next] === -1) {
        depth[next] = depth[page]! + 1
        queue.push(next)
      }
    }
  }
  assert.ok(depth.slice(1).every(d => d >= 0), `every page of ${pages} is reachable`)
  return Math.max(...depth.slice(1))
}

test('a short listing shows every page', () => {
  assert.deepEqual(paginationPages(1, 1), [1])
  assert.deepEqual(paginationPages(3, 7), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(paginationPages(1, 0), [])
  assert.deepEqual(paginationPages(1, Number.NaN), [])
})

test('the window, first and last, and anchors at ±4^k', () => {
  assert.deepEqual(paginationPages(1, 178), [1, 2, 5, 17, 65, 178])
  assert.deepEqual(paginationPages(90, 178), [1, 26, 74, 86, 89, 90, 91, 94, 106, 154, 178])
  assert.deepEqual(paginationPages(178, 178), [1, 114, 162, 174, 177, 178])
  assert.deepEqual(paginationPages(5, 8), [1, 4, 5, 6, 8])
})

test('an out-of-range page is clamped', () => {
  assert.deepEqual(paginationPages(500, 178), paginationPages(178, 178))
  assert.deepEqual(paginationPages(0, 178), paginationPages(1, 178))
})

test('«…» marks only skipped numbers', () => {
  assert.deepEqual(
    paginationItems(90, 178).filter(item => item.gapBefore).map(item => item.page),
    [26, 74, 86, 89, 94, 106, 154, 178],
  )
  assert.equal(paginationItems(3, 7).some(item => item.gapBefore), false)
  assert.equal(paginationItems(1, 178)[1]!.gapBefore, false)
})

test('every page of «Торцевые головки» (178) is at most 6 clicks from page 1', () => {
  // It was 89 with the «1 … p-1 p p+1 … last» window.
  assert.ok(maxClicksFromFirst(178) <= 6, `${maxClicksFromFirst(178)} clicks`)
})

test('the depth grows as log N, not N', () => {
  for (const pages of [8, 20, 50, 100, 178, 300, 1000, 4000]) {
    const bound = Math.ceil(Math.log2(pages)) + 1
    const clicks = maxClicksFromFirst(pages)
    assert.ok(clicks <= bound, `${pages} pages: ${clicks} clicks > ${bound}`)
  }
})

test('the pager stays short', () => {
  for (const pages of [178, 4000]) {
    for (let page = 1; page <= pages; page += 1) {
      const count = paginationPages(page, pages).length
      assert.ok(count <= 2 * Math.ceil(Math.log(pages) / Math.log(4)) + 3, `${page}/${pages}: ${count}`)
    }
  }
})

test('a pager of buttons (admin, no hrefFor) keeps the compact window', () => {
  const window = { anchors: false }
  assert.deepEqual(paginationPages(1, 178, window), [1, 2, 178])
  assert.deepEqual(paginationPages(2, 178, window), [1, 2, 3, 178])
  assert.deepEqual(paginationPages(90, 178, window), [1, 89, 90, 91, 178])
  assert.deepEqual(paginationPages(178, 178, window), [1, 177, 178])
  assert.deepEqual(paginationPages(3, 7, window), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(
    paginationItems(90, 178, window).filter(item => item.gapBefore).map(item => item.page),
    [89, 178],
  )
})
