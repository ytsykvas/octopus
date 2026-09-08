/*
 * That every colour class in the window resolves to a token that exists.
 *
 * A Tailwind colour class is checked by nothing. `bg-accent-bg` was written in
 * `EffortPicker` against a `--color-accent-bg` that did not exist; Tailwind
 * emits no rule for a colour it cannot resolve and no error either, so the
 * chosen job tab was marked by its border alone for as long as anybody looked
 * at it. TypeScript cannot see inside a class string, the linter has no opinion
 * about one, and the only thing that found it was copying the class somewhere
 * the missing fill was obvious.
 *
 * The check is narrow on purpose. It says nothing about Tailwind's own palette —
 * `bg-black`, `text-white`, `border-transparent` are its business — and looks
 * only at classes reaching for one of **our** token families. That is where the
 * mistake actually happens: a name is invented next to a real one, and the two
 * read alike. Nothing here needs maintaining as Tailwind changes, and the
 * families come from `styles.css` itself rather than from a list beside it.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = join(import.meta.dirname, '.')
const STYLES = join(SOURCE, 'styles.css')

/** The utilities that take a colour, and are used here. */
const PREFIXES = ['bg', 'text', 'border', 'ring', 'divide', 'fill', 'stroke'] as const

/** Every `--color-*` token the stylesheet maps, which is what Tailwind reads. */
function tokens(): Set<string> {
  const css = readFileSync(STYLES, 'utf8')

  return new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1] ?? ''))
}

/**
 * The first segment of each token name — `accent`, `ink`, `line`, `diff`…
 *
 * A class is ours to check when it starts with one of these. `bg-accent-bg`
 * qualifies because `accent` is a family of ours; `bg-black` does not, because
 * nothing here defines a `black`.
 */
function families(defined: ReadonlySet<string>): Set<string> {
  return new Set([...defined].map((name) => name.split('-')[0] ?? ''))
}

function sources(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sources(path))
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) found.push(path)
  }

  return found
}

interface Usage {
  readonly file: string
  readonly className: string
  readonly token: string
}

/** Every colour class in the window that reaches for a family of ours. */
function used(defined: ReadonlySet<string>): Usage[] {
  const ours = families(defined)
  const pattern = new RegExp(`\\b(${PREFIXES.join('|')})-([a-z][a-z0-9-]*)(?:/\\d+)?\\b`, 'g')
  const found: Usage[] = []

  for (const file of sources(SOURCE)) {
    for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
      const token = match[2] ?? ''
      const family = token.split('-')[0] ?? ''
      if (!ours.has(family)) continue

      found.push({ file: file.slice(SOURCE.length + 1), className: match[0], token })
    }
  }

  return found
}

describe('a colour class in the window', () => {
  const defined = tokens()

  it('is checked against something, which is the whole point', () => {
    // The guard guarding itself: a stylesheet nobody could read, or a source
    // tree with no classes in it, would pass every assertion below silently.
    expect(defined.size).toBeGreaterThan(20)
    expect(used(defined).length).toBeGreaterThan(100)
  })

  it('resolves to a token that exists', () => {
    const missing = used(defined)
      .filter((usage) => !defined.has(usage.token))
      // One line per distinct mistake, named by the class rather than by every
      // place it was written: the fix is one token or one rename either way.
      .map((usage) => `${usage.className} (${usage.file})`)

    expect([...new Set(missing)]).toEqual([])
  })
})
