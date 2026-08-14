import type { HighlighterCore } from 'shiki/core'

/** What `loadLanguage` accepts, named once rather than at every entry. */
type Grammar = Parameters<HighlighterCore['loadLanguage']>[0]

type Loader = () => Promise<{ default: Grammar }>

/**
 * Every grammar the diff can reach for, each behind its own import.
 *
 * Written out rather than assembled from the language id. A bundler can only
 * follow an import it can read, and `import(\`…/${language}\`)` is a string it
 * works out at runtime — Vite says as much and then ships nothing, so every
 * file would arrive unhighlighted in a build while looking right in dev.
 * Spelled out, each grammar is its own chunk and only the ones actually opened
 * are ever fetched.
 *
 * Precompiled, because the highlighter runs on the JavaScript engine rather
 * than the oniguruma WASM one.
 */
export const GRAMMARS = {
  typescript: () => import('@shikijs/langs-precompiled/typescript'),
  tsx: () => import('@shikijs/langs-precompiled/tsx'),
  javascript: () => import('@shikijs/langs-precompiled/javascript'),
  jsx: () => import('@shikijs/langs-precompiled/jsx'),
  json: () => import('@shikijs/langs-precompiled/json'),
  jsonc: () => import('@shikijs/langs-precompiled/jsonc'),
  css: () => import('@shikijs/langs-precompiled/css'),
  scss: () => import('@shikijs/langs-precompiled/scss'),
  html: () => import('@shikijs/langs-precompiled/html'),
  markdown: () => import('@shikijs/langs-precompiled/markdown'),
  shellscript: () => import('@shikijs/langs-precompiled/shellscript'),
  yaml: () => import('@shikijs/langs-precompiled/yaml'),
  toml: () => import('@shikijs/langs-precompiled/toml'),
  python: () => import('@shikijs/langs-precompiled/python'),
  ruby: () => import('@shikijs/langs-precompiled/ruby'),
  go: () => import('@shikijs/langs-precompiled/go'),
  rust: () => import('@shikijs/langs-precompiled/rust'),
  sql: () => import('@shikijs/langs-precompiled/sql'),
  xml: () => import('@shikijs/langs-precompiled/xml'),
  swift: () => import('@shikijs/langs-precompiled/swift'),
  kotlin: () => import('@shikijs/langs-precompiled/kotlin'),
  java: () => import('@shikijs/langs-precompiled/java'),
  php: () => import('@shikijs/langs-precompiled/php'),
  c: () => import('@shikijs/langs-precompiled/c'),
  cpp: () => import('@shikijs/langs-precompiled/cpp'),
  docker: () => import('@shikijs/langs-precompiled/docker'),
  make: () => import('@shikijs/langs-precompiled/make'),
  ini: () => import('@shikijs/langs-precompiled/ini')
} as const satisfies Record<string, Loader>

/** A language the diff knows how to colour. */
export type Language = keyof typeof GRAMMARS
