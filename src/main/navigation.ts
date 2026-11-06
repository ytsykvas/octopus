/**
 * Keeps a WebContents on the application's own document.
 *
 * The contents arrive as a parameter, as in `windows.ts`, so the decision is
 * testable without Electron.
 */
import type { WebContents } from 'electron'

import { isAppDocument } from '../core/appNavigation.js'

/** The part of Electron's navigation event this reads: `details.url`, not the deprecated positional one. */
export interface NavigationEvent {
  readonly url: string
  preventDefault: () => void
}

/**
 * The slice of a WebContents this needs. Electron's own type rather than a copy:
 * `on` is one overload per event there, which a hand-written union would not
 * match, and the import is a type that is gone by the time anything runs.
 */
export type NavigableContents = Pick<WebContents, 'on'>

/**
 * Refuses every navigation away from the application's own document.
 *
 * A script setting `location`, a link without `target="_blank"`, a form and a
 * server redirect all arrive here. A drop does not: `navigateOnDragDrop` is off,
 * so it starts no navigation. `window.open` and `target="_blank"` are a
 * different path, `setWindowOpenHandler`, and are left to it.
 */
export function guardNavigation(contents: NavigableContents, appUrl: string): void {
  const refuseForeign = (event: NavigationEvent): void => {
    if (!isAppDocument(event.url, appUrl)) event.preventDefault()
  }
  contents.on('will-navigate', refuseForeign)
  contents.on('will-redirect', refuseForeign)
}
