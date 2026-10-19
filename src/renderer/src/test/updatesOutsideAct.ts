import { afterEach, beforeEach, expect, vi } from 'vitest'

/** How React begins its warning about a state update made outside `act`. */
const ACT_WARNING = 'not wrapped in act'

/**
 * Fails a test in which React warns of a state update outside `act` — the
 * warning an answer still on its way when the test ends sets off.
 * `docs/testing.md` has the story.
 *
 * A spy that calls through, read afterwards: a test that silences
 * `console.error` replaces the implementation, and the calls are still there.
 * Cleared before each test, since `vi.spyOn` hands back the spy already on
 * the method, with every earlier test's calls in it.
 *
 * Called at the top of a test file rather than installed in `setup.ts`, because
 * other files still make updates outside `act`. Once none do, it belongs there.
 */
export function failOnUpdatesOutsideAct(): void {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockClear()
  })

  afterEach(() => {
    const warnings = vi
      .mocked(console.error)
      .mock.calls.filter(
        ([message]: unknown[]) => typeof message === 'string' && message.includes(ACT_WARNING)
      )
    expect(warnings, 'a state update landed outside act').toEqual([])
  })
}
