/**
 * Which links the system may be asked to open.
 *
 * `shell.openExternal` hands a URL to LaunchServices, which starts whatever is
 * registered for its scheme: a `file:` link to a `.command` in a cloned
 * repository runs it, and git sets no quarantine flag. A web page is the only
 * thing the window means to open, and a browser treats it as a page.
 *
 * No `node:` import: the renderer may take a value from here.
 */

/**
 * Plain `http:` as well, for any host: a CI server on an intranet links over it,
 * and a browser opens it no more dangerously than `https:`. What is refused is
 * every scheme that starts a program. A new scheme is added here, and nowhere else.
 */
const WEB_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/** Whether a link may be handed to the system to open: a web page, nothing else. */
export function isExternalUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  // `https://github.com@evil.example/` shows one host and goes to another.
  return WEB_SCHEMES.has(parsed.protocol) && parsed.username === '' && parsed.password === ''
}
