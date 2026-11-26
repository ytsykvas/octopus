/**
 * One task file's text as a card and back.
 *
 * The header is read and written through `yaml`, so keys octopus does not know
 * and comments in it survive; a header that will not parse is refused rather
 * than rewritten. The body is never re-serialised. Pure — under Storage only
 * because `yaml` is not zod.
 */
import { type Document, isMap, isSeq, parseDocument, type YAMLMap } from 'yaml'

import {
  BoardError,
  CardMetaSchema,
  type CardComment,
  type CardDraft,
  type CardMeta
} from './boardSchema.js'
import { COMMENTS_MARKER, retitled, splitBody, threadOf, titleOf } from './boardText.js'

const BOM = '\uFEFF'

export interface CardParts {
  readonly head: string
  readonly front: string | null
  readonly body: string
}

/** The figures of one run; `undefined` leaves a field as the file has it. */
export interface RunFields {
  readonly device?: string | undefined
  readonly machine?: string | undefined
  readonly branch?: string | undefined
  readonly ended?: string | undefined
  readonly pr?: string | undefined
  readonly merged?: string | undefined
  readonly turns?: number | undefined
  readonly activeMs?: number | undefined
  readonly tokensIn?: number | undefined
  readonly tokensOut?: number | undefined
  readonly accounts?: readonly string[] | undefined
}

/** Text between a leading `---` line and the next one, and whether it is a header. */
interface Block {
  readonly bom: string
  readonly head: string
  readonly front: string
  readonly rest: string
  /** The parsed header, or null where the text between the rules is not one. */
  readonly doc: Document | null
  readonly data: unknown
}

function headerOf(front: string): { readonly doc: Document | null; readonly data: unknown } {
  const doc = parseDocument(front)
  if (doc.errors.length > 0 || !(doc.contents === null || isMap(doc.contents))) {
    return { doc: null, data: undefined }
  }
  try {
    // An unresolved alias throws here without appearing in `errors`.
    const data: unknown = doc.toJS()
    return { doc, data: data ?? {} }
  } catch {
    return { doc: null, data: undefined }
  }
}

function blockOf(raw: string): Block | null {
  const bom = raw.startsWith(BOM) ? BOM : ''
  const text = raw.slice(bom.length)
  const opening = /^---\r?\n/.exec(text)
  if (opening === null) return null
  const after = text.slice(opening[0].length)
  // `(?![\s\S])` is the end of the text; `$` under `m` would also stop before a lone `\r`.
  const closing = /^---(?:\r?\n|(?![\s\S]))/m.exec(after)
  if (closing === null) return null
  const front = after.slice(0, closing.index)
  return {
    bom,
    head: bom + opening[0] + front + closing[0],
    front,
    rest: after.slice(closing.index + closing[0].length),
    ...headerOf(front)
  }
}

/** A key line: a quoted key, or one starting with a letter or `_`, then a colon and a space or the end. */
const KEY_LINE = /^("[^"]*"|'[^']*'|[\p{L}_][^:]*?)\s*:(\s|$)/u

/** Whether text that failed to parse was meant as a header: its first line that is not blank or a comment is a key. */
function isKeyLike(front: string): boolean {
  return front
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .slice(0, 1)
    .some((line) => KEY_LINE.test(line.trimStart()))
}

function serialise(bom: string, doc: Document, body: string): string {
  // Every caller has set a key by now, so the contents are a map; an empty one means nothing is left.
  const empty = isMap(doc.contents) && doc.contents.items.length === 0
  return empty ? bom + body : `${bom}---\n${doc.toString({ lineWidth: 0 })}---\n${body}`
}

export function headerUnreadable(name: string): BoardError {
  return new BoardError(
    'cardFrontmatterUnreadable',
    { name },
    `The header of ${name} cannot be read.`
  )
}

/** The header to edit, refusing one that looks like a header and will not parse. */
function editable(raw: string, fileName: string): { bom: string; doc: Document; body: string } {
  const block = blockOf(raw)
  if (block !== null && block.doc === null && isKeyLike(block.front)) {
    throw headerUnreadable(fileName)
  }
  const { head, body } = splitCard(raw)
  return { bom: head.startsWith(BOM) ? BOM : '', doc: block?.doc ?? parseDocument(''), body }
}

export function splitCard(raw: string): CardParts {
  const block = blockOf(raw)
  if (block?.doc) return { head: block.head, front: block.front, body: block.rest }
  const bom = raw.startsWith(BOM) ? BOM : ''
  return { head: bom, front: null, body: raw.slice(bom.length) }
}

export function readMeta(raw: string): { readonly meta: CardMeta; readonly malformed: boolean } {
  const block = blockOf(raw)
  if (block?.doc) return { meta: CardMetaSchema.parse(block.data), malformed: false }
  return { meta: CardMetaSchema.parse({}), malformed: block !== null && isKeyLike(block.front) }
}

export function setMeta(
  raw: string,
  changes: Readonly<Record<string, unknown>>,
  fileName: string
): string {
  const { bom, doc, body } = editable(raw, fileName)
  let applied = 0
  for (const [key, value] of Object.entries(changes)) {
    if (value !== undefined) {
      doc.setIn([key], value)
      applied += 1
    } else if (isMap(doc.contents) && doc.hasIn([key])) {
      doc.deleteIn([key])
      applied += 1
    }
  }
  // Nothing set or removed: the file stays byte for byte, header form included.
  return applied === 0 ? raw : serialise(bom, doc, body)
}

const isRunAt =
  (started: string) =>
  (item: unknown): item is YAMLMap =>
    isMap(item) && item.get('started') === started

export function upsertRun(
  raw: string,
  started: string,
  fields: RunFields,
  fileName: string
): string {
  const { bom, doc, body } = editable(raw, fileName)
  const { accounts = [], ...figures } = fields
  const known = Object.entries(figures).filter(([, value]) => value !== undefined)
  const found = doc.get('runs')
  const runs = isSeq(found) ? found : doc.createNode([])
  if (runs !== found) doc.set('runs', runs)
  const entry = runs.items.find(isRunAt(started))
  if (entry === undefined) {
    const fresh = accounts.length > 0 ? { accounts: [...new Set(accounts)] } : {}
    runs.add(doc.createNode({ started, ...Object.fromEntries(known), ...fresh }))
  } else {
    for (const [key, value] of known) entry.set(key, value)
    if (accounts.length > 0) {
      const had = entry.get('accounts')
      const old = isSeq(had) ? had.toJSON().filter((item) => typeof item === 'string') : []
      entry.set('accounts', doc.createNode([...new Set([...old, ...accounts])]))
    }
  }
  return serialise(bom, doc, body)
}

export function withTitle(raw: string, title: string): string {
  const { head, body } = splitCard(raw)
  const { description, tail } = splitBody(body)
  return head + retitled(description, title) + tail
}

export function withDescription(raw: string, text: string): string {
  const { head, body } = splitCard(raw)
  const { tail } = splitBody(body)
  const blank = text.trim() === ''
  if (tail !== '') return head + (blank ? tail : `${text.trimEnd()}\n\n${tail}`)
  return head + (blank ? '' : `${text.trimEnd()}\n`)
}

export function withComment(raw: string, at: string, text: string): string {
  const { head, body } = splitCard(raw)
  const { description, tail } = splitBody(body)
  const entry = `### ${at}\n\n${text.trim()}\n`
  if (tail !== '') return `${head}${description}${tail.trimEnd()}\n\n${entry}`
  const prefix = description.trimEnd()
  return `${head}${prefix === '' ? '' : `${prefix}\n\n`}${COMMENTS_MARKER}\n\n${entry}`
}

export function descriptionOf(raw: string): string {
  return splitBody(splitCard(raw).body).description
}

export function parseCard(
  raw: string,
  fileName: string
): {
  readonly title: string
  readonly meta: CardMeta
  readonly malformed: boolean
  readonly description: string
  readonly thread: CardComment[]
} {
  const { meta, malformed } = readMeta(raw)
  const { description, tail } = splitBody(splitCard(raw).body)
  return {
    title: titleOf(description, fileName),
    meta,
    malformed,
    description,
    thread: threadOf(tail)
  }
}

/** Every field in the one write that makes the file, so no Mac ever syncs a card half made. */
export function newCard(card: Omit<CardDraft, 'status'>, order: number): string {
  const header = [
    `order: ${String(order)}`,
    ...(card.priority === undefined ? [] : [`priority: ${card.priority}`]),
    ...(card.tag === undefined ? [] : [`tag: ${card.tag}`])
  ]
  return `---\n${header.join('\n')}\n---\n${titledBody(card.title, card.description ?? '')}`
}

export function titledBody(title: string, description: string): string {
  const body = description.trim()
  return `# ${title}\n${body === '' ? '' : `\n${body}\n`}`
}
