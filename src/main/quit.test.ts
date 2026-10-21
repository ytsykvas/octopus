import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type QuittingApp, quitAfter } from './quit.js'

/** An `app` that records what was asked of it and lets a test raise `will-quit`. */
function fakeApp(): QuittingApp & {
  willQuit: () => { prevented: boolean }
  quit: Mock<() => void>
} {
  let listener: ((event: { preventDefault: () => void }) => void) | undefined

  return {
    on: (_event, next) => {
      listener = next
    },
    quit: vi.fn<() => void>(),
    willQuit: () => {
      const result = { prevented: false }
      listener?.({
        preventDefault: () => {
          result.prevented = true
        }
      })
      return result
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('quitAfter', () => {
  it('holds the first quit, runs what must go first, and quits once the work settles', async () => {
    const app = fakeApp()
    const order: string[] = []
    quitAfter(
      app,
      () => {
        order.push('terminals')
        return Promise.resolve()
      },
      () => {
        order.push('chats')
        return Promise.resolve()
      }
    )

    expect(app.willQuit().prevented).toBe(true)
    expect(order).toEqual(['terminals', 'chats'])

    await vi.runAllTimersAsync()
    expect(app.quit).toHaveBeenCalledOnce()
  })

  /*
   * The bug: with nothing to close the work settles at once, and a quit asked
   * for inside the refused `will-quit` is one Electron ignores — the window
   * went, the process stayed for minutes. So no quit until the loop has turned,
   * however fast the work was.
   */
  it('does not quit again until the loop has turned', async () => {
    const app = fakeApp()
    quitAfter(
      app,
      () => Promise.resolve(),
      () => Promise.resolve()
    )

    app.willQuit()
    // Every microtask flushed — where the old callback ran.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(app.quit).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it('quits even when the work fails', async () => {
    const app = fakeApp()
    quitAfter(
      app,
      () => Promise.resolve(),
      () => Promise.reject(new Error('a write failed'))
    )

    app.willQuit()
    await vi.runAllTimersAsync()

    expect(app.quit).toHaveBeenCalledOnce()
  })

  /*
   * The terminals are signalled first and synchronously, and then waited for:
   * a run's child that ignores SIGTERM is killed only once the grace is over,
   * and a quit that went before then left it holding its port.
   */
  it('waits for what went first as well as for the work', async () => {
    const app = fakeApp()
    let release = (): void => undefined
    quitAfter(
      app,
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
      () => Promise.resolve()
    )

    app.willQuit()
    await vi.runAllTimersAsync()
    expect(app.quit).not.toHaveBeenCalled()

    release()
    await vi.runAllTimersAsync()
    expect(app.quit).toHaveBeenCalledOnce()
  })

  // The second pass is the quit this function asked for, and goes through.
  it('lets the second pass through', async () => {
    const app = fakeApp()
    const work = vi.fn(() => Promise.resolve())
    quitAfter(app, () => Promise.resolve(), work)

    app.willQuit()
    await vi.runAllTimersAsync()

    expect(app.willQuit().prevented).toBe(false)
    expect(work).toHaveBeenCalledOnce()
  })
})
