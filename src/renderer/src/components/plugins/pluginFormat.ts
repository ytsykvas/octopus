/**
 * The few judgements the plugin rows and cards share about text that came from
 * a marketplace.
 */

/**
 * A homepage worth linking to, or null.
 *
 * Third-party data, and a link opens through `shell.openExternal`, which will
 * start any scheme the system knows — `file:`, a custom app's handler. Only
 * `https:` is a page.
 */
export function safeHomepage(url: string | null): string | null {
  if (url === null) return null

  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** An install count the way a store prints one: `12K`, `1.2M`, in the reader's language. */
export function compactCount(count: number, language: string): string {
  return new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(
    count
  )
}

/** Whether a plugin answers a search, by its name, description or keywords. */
export function matches(
  plugin: {
    readonly name: string
    readonly description: string | null
    readonly keywords?: readonly string[]
  },
  query: string
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true

  return [plugin.name, plugin.description ?? '', ...(plugin.keywords ?? [])].some((text) =>
    text.toLowerCase().includes(needle)
  )
}
