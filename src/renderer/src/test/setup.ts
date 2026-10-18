import '@testing-library/jest-dom/vitest'

import { cleanup, configure, getConfig } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Real translations, not a stub: the tests then assert what a user reads, and
// a missing key shows up as a raw key in an assertion rather than passing.
import '../i18n/index.js'
import { installOctopusStub } from './octopus.js'

/*
 * `waitFor` and every `findBy` end after the work React's scheduler had already
 * queued, not before it.
 *
 * The scheduler posts its work with `setImmediate`, and Testing Library ends a
 * wait with a `setTimeout(0)`, which Node does not order against it — so now
 * and then a wait came back between a commit and its effects. One more
 * `setImmediate` after the wait queues behind the scheduler's. It is the
 * function the scheduler captured, taken before any test can fake the timers.
 * `docs/testing.md` has the story and what this does not cover.
 *
 * Inside the library's own wrapper, so what that last task renders still runs
 * with act switched off, as the wait itself did.
 */
const schedulersSetImmediate = globalThis.setImmediate
// Held whole rather than read later: after `configure`, `getConfig()` answers
// with the wrapper below, which would then call itself.
const library = getConfig()
configure({
  asyncWrapper: (wait) =>
    library.asyncWrapper(async () => {
      const result: unknown = await wait()
      await new Promise<void>((resolve) => {
        schedulersSetImmediate(resolve)
      })
      return result
    })
})

// jsdom has no matchMedia, and xterm.js asks for it while measuring. Without
// it a terminal rendered in a test throws before it draws anything.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
})

// jsdom lays nothing out, so it has no `scrollIntoView` either, and the file
// tab strip brings the tab in front into view. A stub here rather than a `?.()`
// in the component, which would be a branch no real window ever takes.
Element.prototype.scrollIntoView = (): void => undefined

beforeEach(() => {
  installOctopusStub()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
