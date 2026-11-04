// node --experimental-strip-types --test server/utils/*.test.ts (npm test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ResizeGate } from './resize-gate.ts'

test('never more than active + parked in flight', async () => {
  const gate = new ResizeGate(3, 40, 3)
  const t = Array.from({ length: 10 }, () => gate.enter()!)
  assert.deepEqual(gate.stats, { active: 3, parked: 0, waiting: 7 })
  // Three slow ones park: three waiters start.
  for (const k of t.slice(0, 3)) assert.equal(k.park(), true)
  assert.deepEqual(gate.stats, { active: 3, parked: 3, waiting: 4 })
  // Parking is full: the next slow one keeps its slot.
  assert.equal(t[3]!.park(), false)
  assert.deepEqual(gate.stats, { active: 3, parked: 3, waiting: 4 })
  // A parked one finishing frees parking, not a slot.
  t[0]!.done()
  assert.deepEqual(gate.stats, { active: 3, parked: 2, waiting: 4 })
})

test('a client leaving the line drops out and is never started', async () => {
  const gate = new ResizeGate(1, 5, 1)
  const first = gate.enter()!
  const gone = gate.enter()!
  const next = gate.enter()!
  gone.cancel()
  await assert.rejects(gone.ready)
  assert.equal(gate.stats.waiting, 1)
  first.done()
  await next.ready
  assert.deepEqual(gate.stats, { active: 1, parked: 0, waiting: 0 })
  next.done()
  assert.deepEqual(gate.stats, { active: 0, parked: 0, waiting: 0 })
})

test('a full line answers null; done twice frees once', () => {
  const gate = new ResizeGate(1, 1, 0)
  const a = gate.enter()!
  gate.enter()!
  assert.equal(gate.enter(), null)
  a.done(); a.done()
  assert.deepEqual(gate.stats, { active: 1, parked: 0, waiting: 0 })
})
