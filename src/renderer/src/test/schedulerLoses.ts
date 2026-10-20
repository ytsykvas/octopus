/*
 * Makes React's scheduler lose the race `setup.ts` waits out.
 *
 * Loaded before `setup.ts`, and only by `npm run test:race`: the scheduler
 * captures `setImmediate` when it loads, so this has to replace it first. Each
 * immediate is held back behind a real timer, which is the order Node produces
 * now and then on its own — so every test that reads a component before its
 * effects have run fails here every time instead of once in a while.
 */
import { afterAll } from 'vitest'

const immediate = globalThis.setImmediate
const timeout = globalThis.setTimeout

/** Long enough that Testing Library's `setTimeout(0)` always fires first. */
const HELD_BACK_MS = 5

/** Immediates held back and not yet handed to the real one. */
let held = 0

globalThis.setImmediate = ((callback: (...args: unknown[]) => void, ...args: unknown[]) => {
  held += 1
  return timeout(() => {
    held -= 1
    immediate(callback, ...args)
  }, HELD_BACK_MS)
}) as unknown as typeof setImmediate

/*
 * Lets every held-back immediate run before the file's DOM is taken down.
 *
 * The hold outlives the last test by up to `HELD_BACK_MS`, and work React
 * queued in that window then ran against a torn-down jsdom — `window is not
 * defined`, an unhandled error charged to whichever file was ending, failing
 * a run whose tests had all passed. Drained until nothing is left, since the
 * scheduler queues its next slice from the one before.
 */
afterAll(async () => {
  while (held > 0) {
    await new Promise<void>((resolve) => {
      timeout(() => {
        immediate(resolve)
      }, HELD_BACK_MS)
    })
  }
})
