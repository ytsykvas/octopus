/**
 * Where a `target="_blank"` link or `window.open` goes: to the system browser
 * when it is a web page, and nowhere otherwise. Never to a window inside the
 * application — one would get the preload and the whole of `window.octopus`.
 *
 * `open` arrives as a parameter, as the contents do in `navigation.ts`, so the
 * decision is testable without Electron.
 */
import { isExternalUrl } from '../core/externalUrls.js'

/** The part of Electron's window-open details this reads. */
export interface WindowOpenRequest {
  readonly url: string
}

/** The one answer given: no window opens inside the application. */
export interface WindowOpenRefusal {
  readonly action: 'deny'
}

/** A window-open handler that sends web pages to `open` and refuses every window. */
export function openInBrowser(
  open: (url: string) => Promise<void>
): (request: WindowOpenRequest) => WindowOpenRefusal {
  return ({ url }) => {
    // `openExternal` rejects when no application takes the link; nothing waits
    // on it, so left alone that is an unhandled rejection in main.
    if (isExternalUrl(url)) void open(url).catch(() => undefined)
    return { action: 'deny' }
  }
}
