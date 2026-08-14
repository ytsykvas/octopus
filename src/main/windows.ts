/**
 * What a second launch does to the window already open.
 *
 * The window arrives as a parameter rather than being fetched from
 * `BrowserWindow` here, so the decision is testable without Electron — the same
 * split `theme.ts` makes, for the same reason.
 */

/** The slice of a window this needs, which is all a test has to provide. */
export interface FocusableWindow {
  isMinimized: () => boolean
  restore: () => void
  focus: () => void
}

/**
 * Brings the running application forward.
 *
 * `restore` first, because a minimised window ignores `focus` — and being
 * minimised is the likeliest reason somebody reached for the launcher rather
 * than the window they already had.
 *
 * Deliberately no `show`: the main window is created hidden and shows itself on
 * `ready-to-show`, so a second launch racing startup would otherwise put an
 * unpainted window on screen. A window nobody has shown yet is one that is
 * about to appear on its own.
 */
export function focusExisting(windows: readonly FocusableWindow[]): void {
  // Nothing to raise. On macOS the application outlives its last window, so a
  // second launch while none is open is an ordinary thing to have happen.
  const [window] = windows
  if (!window) return

  if (window.isMinimized()) window.restore()
  window.focus()
}
