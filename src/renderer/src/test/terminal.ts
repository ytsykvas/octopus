import { waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'

import { octopus } from './octopus.js'

/**
 * Prepares the environment for a component that mounts a `Terminal`.
 *
 * xterm.js asks for `matchMedia` and a `ResizeObserver` the moment it opens,
 * and jsdom provides neither — without them the terminal throws before it ever
 * requests a session, so nothing above it can be exercised at all.
 *
 * It also gives each session its own id. The bare stub answers every `create`
 * with the same string, which leaves a test unable to say *which* of several
 * terminals was the one disposed.
 *
 * Call it from `beforeEach`; the octopus stub is already installed by then.
 */
export function stubTerminalHost(): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  )

  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly observe = vi.fn()
      readonly unobserve = vi.fn()
      readonly disconnect = vi.fn()
    }
  )

  let created = 0
  vi.mocked(octopus().terminal.create).mockImplementation(() => {
    created += 1
    return Promise.resolve({ ok: true, value: sessionId(created) })
  })
}

/** Id the stubbed bridge hands out for the n-th session opened in a test. */
export function sessionId(n: number): string {
  return `session-${String(n)}`
}

/** Working directories the UI has asked for a session in, in order. */
export function openedDirectories(): string[] {
  return vi.mocked(octopus().terminal.create).mock.calls.map(([spec]) => spec.cwd)
}

/** Sessions are requested asynchronously; waits until the count settles. */
export async function sessionsOpened(count: number): Promise<void> {
  await waitFor(() => {
    expect(octopus().terminal.create).toHaveBeenCalledTimes(count)
  })
}
