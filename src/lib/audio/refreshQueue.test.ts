import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRefreshQueue } from './refreshQueue'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** A run fn that records calls and can be held open to simulate a slow render. */
function tracker() {
  const calls: string[] = []
  let release: (() => void) | null = null
  const run = async (key: string) => {
    calls.push(key)
    if (release) return
    await Promise.resolve()
  }
  return { calls, run, hold: () => release }
}

describe('createRefreshQueue', () => {
  it('coalesces a burst of edits into one run', async () => {
    const t = tracker()
    const q = createRefreshQueue(t.run, 200)
    for (let i = 0; i < 20; i++) q.schedule('drum-machine')

    expect(t.calls).toEqual([]) // nothing yet — still debouncing
    await vi.advanceTimersByTimeAsync(200)
    expect(t.calls).toEqual(['drum-machine'])
  })

  it('restarts the window while edits keep arriving', async () => {
    const t = tracker()
    const q = createRefreshQueue(t.run, 200)
    q.schedule('a')
    await vi.advanceTimersByTimeAsync(150)
    q.schedule('a') // still dragging
    await vi.advanceTimersByTimeAsync(150)
    expect(t.calls).toEqual([]) // the window restarted, so nothing has run
    await vi.advanceTimersByTimeAsync(60)
    expect(t.calls).toEqual(['a'])
  })

  it('runs each distinct key once per pass', async () => {
    const t = tracker()
    const q = createRefreshQueue(t.run, 100)
    q.schedule('drum-machine')
    q.schedule('bass-machine')
    q.schedule('drum-machine')
    await vi.advanceTimersByTimeAsync(100)
    expect([...t.calls].sort()).toEqual(['bass-machine', 'drum-machine'])
  })

  it('never runs two renders concurrently, and picks up work queued mid-run', async () => {
    const order: string[] = []
    let resolveFirst: (() => void) | null = null
    const q = createRefreshQueue(async (key) => {
      order.push(`start:${key}`)
      if (key === 'slow') await new Promise<void>((r) => (resolveFirst = r))
      order.push(`end:${key}`)
    }, 50)

    q.schedule('slow')
    await vi.advanceTimersByTimeAsync(50)
    expect(order).toEqual(['start:slow'])
    expect(q.isRunning()).toBe(true)

    // An edit arrives while the slow render is still going.
    q.schedule('next')
    await vi.advanceTimersByTimeAsync(50)
    // It must NOT have started a second concurrent render.
    expect(order).toEqual(['start:slow'])

    resolveFirst!()
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['start:slow', 'end:slow', 'start:next', 'end:next'])
  })

  it('a failing run does not strand the queue', async () => {
    const seen: string[] = []
    const q = createRefreshQueue(async (key) => {
      seen.push(key)
      if (key === 'boom') throw new Error('render failed')
    }, 10)
    q.schedule('boom')
    q.schedule('ok')
    await vi.advanceTimersByTimeAsync(10)
    expect([...seen].sort()).toEqual(['boom', 'ok'])
    expect(q.isRunning()).toBe(false)

    // And the queue still works afterwards.
    q.schedule('later')
    await vi.advanceTimersByTimeAsync(10)
    expect(seen).toContain('later')
  })

  it('flush runs pending work immediately', async () => {
    const t = tracker()
    const q = createRefreshQueue(t.run, 5000)
    q.schedule('a')
    await q.flush()
    expect(t.calls).toEqual(['a'])
  })

  it('cancel drops pending work so nothing fires after teardown', async () => {
    const t = tracker()
    const q = createRefreshQueue(t.run, 100)
    q.schedule('a')
    expect(q.pending()).toEqual(['a'])
    q.cancel()
    expect(q.pending()).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(t.calls).toEqual([])
  })
})
