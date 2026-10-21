/**
 * The quit that waits for what the sessions were writing, and then goes.
 *
 * The application arrives as a parameter, as the window does in `windows.ts`,
 * so the ordering is testable without Electron.
 */

/** The slice of Electron's `app` this needs. */
export interface QuittingApp {
  on: (event: 'will-quit', listener: (event: { preventDefault: () => void }) => void) => void
  quit: () => void
}

/**
 * Holds the first quit until `before` and `work` have settled, then quits again.
 *
 * `will-quit` is synchronous, so waiting means the usual dance: refuse the first
 * pass, quit again once the promise settles, and a flag so the second pass falls
 * through. Thrown away with `void`, as it once was, the process exited with a
 * transcript append wherever it had got to — and a transcript is append-only
 * JSONL, so a line cut in half is a conversation that will not reopen.
 *
 * **The second quit waits for the next turn of the loop.** With nothing to
 * close, `work` settles at once, and its callback ran as a microtask inside the
 * `will-quit` that was being refused — while Electron still counted itself as
 * quitting. It ignores a quit asked for in that state, and then clears the
 * state because the first pass was refused: the quit was lost, the window was
 * gone and the process stayed, for minutes, until something else ended it.
 * A launcher restarted onto it lost the single-instance lock to the old build.
 *
 * `before` runs first and synchronously, for what must go whatever happens
 * after this line — the terminals, each of which holds a pseudo-terminal. What
 * it returns is waited for beside `work`: signalling the terminals is not the
 * same as their having gone, and a run's child that ignored SIGTERM outlived a
 * quit that left before its kill was due.
 */
export function quitAfter(
  app: QuittingApp,
  before: () => Promise<unknown>,
  work: () => Promise<unknown>
): void {
  let leaving = false

  app.on('will-quit', (event) => {
    if (leaving) return

    leaving = true
    event.preventDefault()
    const first = before()

    // Settled rather than fulfilled, either way: a write that failed is no
    // reason to stay open, and `finally` would hand its rejection on to nobody.
    void Promise.allSettled([first, work()]).then(() => {
      setTimeout(() => {
        app.quit()
      }, 0)
    })
  })
}
