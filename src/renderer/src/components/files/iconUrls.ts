/**
 * Every icon of the Catppuccin theme, by file name, as a URL the window may
 * load — once per flavour: Latte for a light ground, Mocha for a dark one.
 *
 * `?no-inline` is the whole point of this file. The CSP is `default-src 'self'`,
 * and Vite turns any asset under 4 KB into a `data:` URI unless told otherwise —
 * which that policy refuses. Nearly every icon is that small, so without the
 * flag the tree would draw its icons in development, where they are served,
 * and lose them in the built app, where nothing would say why.
 *
 * Eager, so a build writes one table of strings per flavour rather than a
 * chunk per icon. Reached only through the dynamic import in `fileIcons.ts`, so
 * the tables are their own chunk and development pays for their requests only
 * once the Files tab is first opened.
 */
export const LIGHT_ICON_URLS: Readonly<Record<string, string>> = import.meta.glob<string>(
  '../../../../../vendor/catppuccin-icons/latte/*.svg',
  { eager: true, query: '?no-inline', import: 'default' }
)

export const DARK_ICON_URLS: Readonly<Record<string, string>> = import.meta.glob<string>(
  '../../../../../vendor/catppuccin-icons/mocha/*.svg',
  { eager: true, query: '?no-inline', import: 'default' }
)
