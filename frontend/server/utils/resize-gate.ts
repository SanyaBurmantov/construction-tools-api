/**
 * The concurrency gate of `/_ipx` (server/middleware/ipx-guard.ts), kept
 * apart so its accounting is testable.
 *
 * At most `maxActive` resizes run; up to `maxWaiting` requests wait in line.
 * A request whose source does not answer can be *parked* after a while: its
 * slot goes to the next photo, but it still counts against `maxParked`,
 * because when the slow fetch finally returns, sharp does the full resize
 * anyway — the old gate simply released the slot, so hung fetches piled up
 * without bound and every one of them could land on sharp at once (audit
 * 2026-11-03). Work in flight is therefore never more than
 * `maxActive + maxParked`, and once the parking is full a slow request keeps
 * its slot. A waiter whose client hangs up leaves the line at once.
 */
export type GateTicket = {
  /** Resolves when the slot is ours; rejects when the client left first. */
  ready: Promise<void>
  /** The client left: drop out of the line, or free the slot. */
  cancel: () => void
  /** The request is slow: try to hand the slot over. True when parked. */
  park: () => boolean
  /** The request finished (or was abandoned) — free whatever it holds. */
  done: () => void
}

export class ResizeGate {
  private active = 0
  private parked = 0
  private readonly line: Array<{ start: () => void }> = []

  private readonly maxActive: number
  private readonly maxWaiting: number
  private readonly maxParked: number

  constructor(maxActive: number, maxWaiting: number, maxParked: number) {
    this.maxActive = maxActive
    this.maxWaiting = maxWaiting
    this.maxParked = maxParked
  }

  get stats() {
    return { active: this.active, parked: this.parked, waiting: this.line.length }
  }

  /** A ticket, or null when the line is full (answer 503). */
  enter(): GateTicket | null {
    let state: 'waiting' | 'running' | 'parked' | 'done' = 'waiting'
    let start!: () => void
    let leave!: (error: Error) => void // eslint-disable-line no-unused-vars
    const ready = new Promise<void>((resolve, reject) => {
      start = () => {
        state = 'running'
        resolve()
      }
      leave = reject
    })
    // Nobody may be left with an unhandled rejection when the client goes.
    ready.catch(() => {})
    const entry = { start }
    if (this.active < this.maxActive) {
      this.active++
      start()
    } else if (this.line.length >= this.maxWaiting) {
      return null
    } else {
      this.line.push(entry)
    }
    const free = () => {
      const next = this.line.shift()
      // The slot passes straight to the next one: `active` stays the same.
      if (next) next.start()
      else this.active--
    }
    return {
      ready,
      cancel: () => {
        if (state === 'waiting') {
          const at = this.line.indexOf(entry)
          if (at >= 0) this.line.splice(at, 1)
          state = 'done'
          leave(new Error('client left'))
        } else {
          this.finish(state, free)
          state = 'done'
        }
      },
      park: () => {
        if (state !== 'running' || this.parked >= this.maxParked) return false
        this.parked++
        state = 'parked'
        free()
        return true
      },
      done: () => {
        if (state === 'waiting') return
        this.finish(state, free)
        state = 'done'
      },
    }
  }

  private finish(state: string, free: () => void) {
    if (state === 'running') free()
    else if (state === 'parked') this.parked--
  }
}
