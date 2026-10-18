import '@testing-library/jest-dom/vitest'

import { cleanup, configure, getConfig } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

// Real translations, not a stub: the tests then assert what a user reads, and
// a missing key shows up as a raw key in an assertion rather than passing.
import '../i18n/index.js'
import { installOctopusStub } from './octopus.js'

/*
 * `waitFor` and every `findBy` return only once React's queued work has run.
 *
 * React's scheduler posts its work with `setImmediate`, and Testing Library
 * ends a wait with a `setTimeout(0)`. Node does not order the two, so now and
 * then the wait came back after a render had committed but before its effects
 * ran — a listener not yet attached, a read not yet started — and the next line
 * of the test acted on a component that was not ready. That was the "now and
 * then" red in this suite: forced to lose the race, 126 tests failed, the
 * viewer's selection toolbar and ⌘T among them.
 *
 * One more `setImmediate` after the wait queues behind the scheduler's. It is
 * the same function the scheduler captured, taken here before any test can
 * fake the timers.
 */
const afterScheduled = globalThis.setImmediate
// The config object as it is now: `configure` replaces it rather than mutating
// it, so this keeps Testing Library's own wrapper, act environment and all.
const library = getConfig()
configure({
  asyncWrapper: (wait) =>
    library.asyncWrapper(async () => {
      const result: unknown = await wait()
      await new Promise<void>((resolve) => {
        afterScheduled(resolve)
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
