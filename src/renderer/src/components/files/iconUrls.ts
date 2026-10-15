/**
 * Every icon of the material icon theme, by file name, as a URL the window may
 * load.
 *
 * `?no-inline` is the whole point of this file. The CSP is `default-src 'self'`,
 * and Vite turns any asset under 4 KB into a `data:` URI unless told otherwise —
 * which that policy refuses. Nearly every icon is that small, so without the
 * flag the tree would draw its icons in development, where they are served,
 * and lose them in the built app, where nothing would say why.
 *
 * Eager, so a build writes one table of 1 279 strings rather than 1 279 chunks.
 * Reached only through the dynamic import in `fileIcons.ts`, so the table is
 * its own chunk and development pays for its requests only once the Files tab
 * is first opened.
 */
export const ICON_URLS: Readonly<Record<string, string>> = import.meta.glob<string>(
  '../../../../../node_modules/material-icon-theme/icons/*.svg',
  { eager: true, query: '?no-inline', import: 'default' }
)
