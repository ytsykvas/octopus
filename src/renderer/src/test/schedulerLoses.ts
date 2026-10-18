/*
 * Makes React's scheduler lose the race `setup.ts` waits out.
 *
 * Loaded before `setup.ts`, and only by `npm run test:race`: the scheduler
 * captures `setImmediate` when it loads, so this has to replace it first. Each
 * immediate is held back behind a real timer, which is the order Node produces
 * now and then on its own — so every test that reads a component before its
 * effects have run fails here every time instead of once in a while.
 */
const immediate = globalThis.setImmediate
const timeout = globalThis.setTimeout

/** Long enough that Testing Library's `setTimeout(0)` always fires first. */
const HELD_BACK_MS = 5

globalThis.setImmediate = ((callback: (...args: unknown[]) => void, ...args: unknown[]) =>
  timeout(() => immediate(callback, ...args), HELD_BACK_MS)) as unknown as typeof setImmediate
