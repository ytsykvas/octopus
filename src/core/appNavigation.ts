/**
 * Which document the window may show.
 *
 * Any page in the window gets the preload and the whole of `window.octopus`, so
 * the answer is the one document the application itself loaded and nothing
 * else — not another file beside it, not another port on the same host.
 */

/** Whether `url` is the application's own document, which `appUrl` loaded. */
export function isAppDocument(url: string, appUrl: string): boolean {
  const target = parsed(url)
  const app = parsed(appUrl)
  if (!target || !app) return false

  if (app.protocol === 'file:') {
    // Compared decoded: Node's `pathToFileURL`, which made `appUrl`, escapes
    // `[`, `]` and `|` where Chromium leaves them, so one folder could read as
    // two. Query and hash are the document's own state, not another document.
    const appPath = decodedPath(app)
    return target.protocol === 'file:' && appPath !== null && decodedPath(target) === appPath
  }
  // The scheme as well as the origin: a `blob:` URL reports the origin it was
  // made in, and is not the page.
  if (app.protocol === 'http:' || app.protocol === 'https:') {
    return target.protocol === app.protocol && target.origin === app.origin
  }
  return false
}

function parsed(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function decodedPath(url: URL): string | null {
  try {
    return decodeURIComponent(url.pathname)
  } catch {
    return null
  }
}
