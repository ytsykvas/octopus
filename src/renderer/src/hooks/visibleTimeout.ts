/**
 * `setTimeout` for a read nobody needs while the window is hidden.
 *
 * Every read the window starts on its own — after a turn ends, on a poll — is
 * for somebody looking at it, and agents are left to work exactly when nobody
 * is. So a timeout that falls due while the window is hidden or minimised waits
 * for it to be shown, and then runs once: however long it was away, one read
 * brings the pane up to date.
 *
 * A drop-in for the `setTimeout` it replaces, cancel included, so a debounce
 * built on it (cancel, then set again) still collapses a burst into one call —
 * a burst that ends while the window is hidden included.
 *
 * A plain function rather than a hook, like `onChatEvent`, so it can be set
 * from inside an effect or from a callback one registered.
 */
export function setVisibleTimeout(run: () => void, ms: number): () => void {
  const shown = (): void => {
    if (document.hidden) return
    cancel()
    run()
  }

  // Removing a listener that was never added is a no-op, so one cancel serves
  // both stages: still counting down, or already waiting for the window.
  const cancel = (): void => {
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', shown)
  }

  const timer = setTimeout(() => {
    if (document.hidden) document.addEventListener('visibilitychange', shown)
    else run()
  }, ms)

  return cancel
}
