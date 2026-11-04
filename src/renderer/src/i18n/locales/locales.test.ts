import { describe, expect, it } from 'vitest'

import { WORKSPACE_KINDS } from '@core/workspaceKinds.js'

import { de } from './de.js'
import { en } from './en.js'
import { uk } from './uk.js'

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g
const PLURAL = /_(zero|one|two|few|many|other)$/

function isTree(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/** Every string in a locale, keyed by its dotted path. */
function leaves(tree: Readonly<Record<string, unknown>>, prefix = ''): Map<string, string> {
  const found = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') found.set(path, value)
    else if (isTree(value)) {
      for (const [inner, text] of leaves(value, path)) found.set(inner, text)
    }
  }
  return found
}

/**
 * `count` is exempt on a plural key: i18next always passes it there, and a
 * language is free to say "ein Agent" where English says "1 agent".
 */
function placeholders(path: string, text: string): string[] {
  const names = [...text.matchAll(PLACEHOLDER)].flatMap(([, name]) => name ?? [])
  const plural = PLURAL.test(path)
  return [...new Set(names)].filter((name) => !(plural && name === 'count')).sort()
}

/*
 * The type check sees keys, not what is inside the strings. A placeholder
 * translated or dropped renders as raw `{{name}}`, or loses the value it was
 * there to show, and nothing else in the suite would notice.
 */
describe.each([
  ['uk', uk],
  ['de', de]
])('the %s locale', (_, locale) => {
  it('asks for the same values as English in every string', () => {
    const translated = leaves(locale)
    const mismatches: string[] = []

    for (const [path, text] of leaves(en)) {
      const expected = placeholders(path, text)
      const actual = placeholders(path, translated.get(path) ?? '')
      if (expected.join() !== actual.join()) {
        mismatches.push(`${path}: expected {${expected.join()}}, got {${actual.join()}}`)
      }
    }

    expect(mismatches).toEqual([])
  })
})

/*
 * The strip on a workspace card is 14px wide and as tall as the card, and the
 * kind is written along it: about seven letters fit. A longer word is cut
 * off with nothing said, so the limit is held here rather than found on screen.
 */
describe.each([
  ['en', en],
  ['uk', uk],
  ['de', de]
])('the kinds in %s', (_, locale) => {
  it.each(WORKSPACE_KINDS)('name %s in a word that fits the strip', (kind) => {
    const { label, short } = locale.workspaces.kinds[kind]

    expect(label).not.toBe('')
    expect(short).not.toBe('')
    expect(short.length).toBeLessThanOrEqual(7)
  })
})
