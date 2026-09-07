/**
 * A markdown document with YAML frontmatter, read the way the agent reads one.
 *
 * The shape every file octopus keeps for a session is written in: a skill's
 * `SKILL.md`, a subagent, a command that declares anything about itself. Split
 * out of `skills.ts` when commands and subagents arrived, because reading one
 * of these is not a fact about skills.
 *
 * The load-bearing decision is in `field` below: frontmatter that will not
 * parse is **not** a refusal.
 */

import { type Document, parseDocument, stringify } from 'yaml'

export interface ParsedDocument {
  /** The frontmatter, kept so an edit can be written back onto it. */
  readonly front: string
  readonly body: string
  readonly raw: string
  /** One frontmatter scalar, or the empty string where there is not one. */
  field(key: string): string
}

/**
 * Frontmatter and prose, or null where there is no frontmatter at all.
 *
 * Written with `indexOf` rather than one regular expression on purpose: a
 * capture group reads back as `string | undefined` under
 * `noUncheckedIndexedAccess`, and the branch handling an `undefined` that
 * cannot happen is a line no test can reach — which the coverage threshold
 * then fails the build over.
 */
export function parseFrontmatter(raw: string): ParsedDocument | null {
  const normalised = raw.replace(/\r\n/g, '\n')
  if (!normalised.startsWith('---\n')) return null

  const close = normalised.indexOf('\n---', 3)
  if (close === -1) return null

  const front = normalised.slice(4, close)
  const document = parseDocument(front)
  const parsed = document.errors.length === 0

  return {
    front,
    // Every blank line between the delimiter and the prose goes, rather than
    // just the one that ends the delimiter's own line. A composer always writes
    // exactly one, so keeping them would make the body a line taller on every
    // save — read, write, read, and the file grows without anybody typing.
    body: normalised.slice(close + 4).replace(/^\n+/, ''),
    raw,
    field: (key) => (parsed ? readField(document, key) : scanField(front, key))
  }
}

/** One frontmatter scalar, or the empty string for anything that is not one. */
function readField(document: Document, key: string): string {
  const value: unknown = document.get(key)

  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The same, read off the line rather than out of the document.
 *
 * Because real frontmatter is often not valid YAML and the agent reads it
 * anyway. A `description` is one long unquoted sentence, and a sentence has
 * colons in it — `Triggers on: access_denied` makes YAML see a nested mapping
 * and refuse the whole block. Two skills shipped in a repository this app was
 * opened on did exactly that, and the panel called them "no skills yet" while
 * the agent was using both.
 *
 * So this is the fallback, not the reader: everything after the first colon on
 * the line that starts with the key, unwrapped from quotes if it has them. It
 * cannot see a block scalar and does not have to — that is what the parser is
 * for, and this only runs where the parser has already given up.
 */
function scanField(front: string, key: string): string {
  for (const line of front.split('\n')) {
    if (!line.startsWith(`${key}:`)) continue

    const value = line.slice(key.length + 1).trim()

    return value.replace(/^(['"])(.*)\1$/, '$2')
  }

  return ''
}

/**
 * Frontmatter with some fields set, for a document about to be written.
 *
 * An imported file may carry `allowed-tools`, `model` or a comment somebody
 * wrote, and a form edits one or two fields. So where there is a block to keep,
 * the fields are set **on** it and everything else survives; only where there
 * is nothing to keep is one written from scratch.
 */
export function setFields(
  previous: string | null,
  fields: Readonly<Record<string, string>>
): string {
  if (previous === null) return stringify(fields)

  const document = parseDocument(previous)
  if (document.errors.length === 0) {
    for (const [key, value] of Object.entries(fields)) document.set(key, value)

    return String(document)
  }

  // Frontmatter the parser will not take, edited the way it was read: the named
  // lines are replaced and every other line is copied through untouched.
  // Rewriting it as YAML would tidy away the `allowed-tools` beside them, and
  // writing back what the parser made of a block it could not read would be
  // worse than either.
  return replaceLines(previous, fields)
}

/** Sets keys in frontmatter no parser will take, line by line. */
function replaceLines(front: string, fields: Readonly<Record<string, string>>): string {
  const written = new Set<string>()

  const lines = front.split('\n').map((line) => {
    for (const [key, value] of Object.entries(fields)) {
      if (line.startsWith(`${key}:`)) {
        written.add(key)

        return `${key}: ${value}`
      }
    }

    return line
  })

  const missing = Object.entries(fields)
    .filter(([key]) => !written.has(key))
    .map(([key, value]) => `${key}: ${value}`)

  return [...missing, ...lines].join('\n')
}
