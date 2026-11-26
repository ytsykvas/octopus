import type { Dirent, Stats } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

import {
  descriptionOf,
  newCard,
  parseCard,
  setMeta,
  withComment,
  withDescription,
  withTitle
} from './boardCard.js'
import { type Column, columnKey, DEFAULT_COLUMNS, missingColumn } from './boardColumns.js'
import {
  boardFolderName,
  cardFileName,
  compareNames,
  isSkipped,
  sameName,
  stemOf
} from './boardNames.js'
import { columnCards, firstOrder, orderForDrop } from './boardOrder.js'
import {
  BoardError,
  CardMetaSchema,
  isCardRef,
  type BoardCard,
  type CardDetail,
  type ColumnId,
  type CardDraft,
  type CardMove,
  type CardPatch,
  type CardRewrite,
  type CreatedCards,
  type DescriptionSave
} from './boardSchema.js'
import { type Failure, failureOf } from './failure.js'
import { allOf } from './parallel.js'
import { unlinkedInside } from './paths.js'
import {
  describeError,
  isAlreadyThere,
  isNotDirectory,
  isNotFound,
  writeNewFile,
  writeTextFile
} from './persist.js'

export interface BoardLayout {
  /** The project's folder, absolute — whether or not it exists yet. */
  readonly dir: string
  /** False until the first write makes `dir`: reading never does. */
  readonly exists: boolean
  readonly columns: readonly Column[]
  /** Each column's id → the folder in `dir` that holds it: the one found, else the id itself. */
  readonly folders: ReadonlyMap<ColumnId, string>
}

const MARKDOWN = /\.md$/i

export function unreadable(path: string, reason: string): BoardError {
  return new BoardError(
    'boardFolderUnreadable',
    { path, reason },
    `The board folder ${path} cannot be used: ${reason}`
  )
}

async function entriesOf(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    throw unreadable(path, describeError(error))
  }
}

/** The first by `compareNames` of the names that match, or null. Pure: APFS cannot hold two `sameName` folders, so the choice is tested on strings. */
export function firstNamed(
  names: readonly string[],
  predicate: (name: string) => boolean
): string | null {
  return [...names].sort(compareNames).find(predicate) ?? null
}

// The board folder and the project's folder alike: a link could lead the writes anywhere.
async function folderAt(path: string): Promise<void> {
  let stats: Stats
  try {
    stats = await lstat(path)
  } catch (error) {
    throw unreadable(path, describeError(error))
  }
  if (stats.isSymbolicLink()) throw unreadable(path, 'symbolic link')
  if (!stats.isDirectory()) throw unreadable(path, 'not a folder')
}

export async function findLayout(
  root: string,
  project: string,
  columns: readonly Column[] = DEFAULT_COLUMNS
): Promise<BoardLayout> {
  if (root === '') throw new BoardError('boardFolderUnset', {}, 'No board folder is set')
  if (!isAbsolute(root)) throw unreadable(root, 'not an absolute path')
  await folderAt(root)

  const wanted = boardFolderName(project)
  // Not filtered by `isSkipped`: the only skipped name `wanted` can match is one ending in `.tmp`,
  // which `boardFolderName` gives a project called so — and that is the project's folder.
  const names = (await entriesOf(root)).map((entry) => entry.name)
  const found = firstNamed(names, (name) => sameName(name, wanted))
  const byColumn = (pick: (id: ColumnId) => string): ReadonlyMap<ColumnId, string> =>
    new Map(columns.map((column) => [column.id, pick(column.id)]))
  if (found === null)
    return { dir: join(root, wanted), exists: false, columns, folders: byColumn((id) => id) }

  const dir = join(root, found)
  await folderAt(dir)

  // A link `Dirent` is neither a file nor a folder, so a linked column folder is skipped here;
  // so is `_done`, which `columnKey` would read as "done" while the scan skips it.
  const folders = (await entriesOf(dir))
    .filter((entry) => entry.isDirectory() && !isSkipped(entry.name))
    .map((entry) => entry.name)
  return {
    dir,
    exists: true,
    columns,
    folders: byColumn(
      (id) => firstNamed(folders, (name) => columnKey(name) === columnKey(id)) ?? id
    )
  }
}

function folderOf(layout: BoardLayout, status: ColumnId): string {
  const folder = layout.folders.get(status)
  if (folder === undefined) throw missingColumn(status)
  return folder
}

export async function guardRef(layout: BoardLayout, ref: string): Promise<string> {
  if (!isCardRef(ref) || !(await unlinkedInside(layout.dir, ref))) {
    throw new BoardError(
      'cardOutside',
      { name: basename(ref) },
      `${basename(ref)} is not inside the board folder`
    )
  }
  return join(layout.dir, ref)
}

// Missing is a state the window shows; any other failure is a fault worth its own message.
export function missing(error: unknown, ref: string): unknown {
  if (!isNotFound(error) && !isNotDirectory(error)) return error
  return new BoardError(
    'cardMissing',
    { name: basename(ref) },
    `${basename(ref)} is no longer on disk`
  )
}

function locate(
  layout: BoardLayout,
  ref: string
): { readonly status: ColumnId; readonly loose: boolean } {
  const slash = ref.indexOf('/')
  const key = slash === -1 ? null : columnKey(ref.slice(0, slash))
  const column = layout.columns.find(({ id }) => columnKey(id) === key)
  return column === undefined
    ? { status: 'backlog', loose: true }
    : { status: column.id, loose: false }
}

// Read as bytes: text that is not UTF-8 decodes with U+FFFD in place of what it held, and
// writing that back would lose it — so such a file is listed by its name and never written.
function decoded(bytes: Buffer): string | null {
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null
}

type CardText = Omit<CardDetail, 'attachments'>

function cardOf(layout: BoardLayout, ref: string, bytes: Buffer): CardText {
  const fileName = basename(ref)
  const raw = decoded(bytes)
  if (raw === null) {
    const meta = CardMetaSchema.parse({})
    return {
      ref,
      ...locate(layout, ref),
      title: stemOf(fileName),
      meta,
      malformed: false,
      notText: true,
      comments: 0,
      description: '',
      thread: []
    }
  }
  const { title, meta, malformed, description, thread } = parseCard(raw, fileName)
  return {
    ref,
    ...locate(layout, ref),
    title,
    meta,
    malformed,
    notText: false,
    comments: thread.length,
    description,
    thread
  }
}

function listed({
  ref,
  status,
  loose,
  title,
  meta,
  malformed,
  notText,
  comments
}: CardText): BoardCard {
  return { ref, status, loose, title, meta, malformed, notText, comments }
}

export async function listBoard(layout: BoardLayout): Promise<BoardCard[]> {
  if (!layout.exists) return []

  const refs: string[] = []
  for (const entry of await entriesOf(layout.dir)) {
    if (isSkipped(entry.name)) continue
    if (entry.isFile() && MARKDOWN.test(entry.name)) refs.push(entry.name)
    if (entry.isDirectory()) {
      const inner = await readdir(join(layout.dir, entry.name), { withFileTypes: true }).catch(
        () => []
      )
      for (const file of inner) {
        if (file.isFile() && !isSkipped(file.name) && MARKDOWN.test(file.name))
          refs.push(`${entry.name}/${file.name}`)
      }
    }
  }

  // Each read catches its own failure, so `allOf` never rejects; order is `readdir`'s, the window sorts.
  const cards = await allOf(
    refs.map((ref) =>
      readFile(join(layout.dir, ref)).then(
        (bytes) => listed(cardOf(layout, ref, bytes)),
        () => null
      )
    )
  )
  return cards.filter((card) => card !== null)
}

export async function readCard(
  layout: BoardLayout,
  ref: string
): Promise<Omit<CardDetail, 'attachments'>> {
  const path = await guardRef(layout, ref)
  const bytes = await readFile(path).catch((error: unknown) => {
    throw missing(error, ref)
  })
  return cardOf(layout, ref, bytes)
}

// What `editCard` compares before reading and before writing: a file that changed in between
// was written by someone else — Finder, an editor, another Mac.
async function stamp(path: string, ref: string): Promise<string> {
  try {
    const { mtimeMs, size } = await lstat(path)
    return `${String(mtimeMs)}:${String(size)}`
  } catch (error) {
    throw missing(error, ref)
  }
}

export async function editCard(
  layout: BoardLayout,
  ref: string,
  change: (raw: string, fileName: string) => string
): Promise<void> {
  const path = await guardRef(layout, ref)
  const before = await stamp(path, ref)
  const bytes = await readFile(path).catch((error: unknown) => {
    throw missing(error, ref)
  })
  const raw = decoded(bytes)
  const name = basename(ref)
  if (raw === null) throw new BoardError('cardNotText', { name }, `${name} is not UTF-8 text`)
  const next = change(raw, name)
  if (next === raw) return
  if ((await stamp(path, ref)) !== before)
    throw new BoardError('cardChanged', { name }, `${name} changed on disk`)
  await writeTextFile(path, next)
}

export async function createCard(layout: BoardLayout, draft: CardDraft): Promise<string> {
  const folder = folderOf(layout, draft.status)
  const cards = await listBoard(layout)
  const name = cardFileName(
    draft.title,
    cards.map((card) => basename(card.ref))
  )
  const ref = `${folder}/${name}`
  // Made first, then guarded: a status folder that is a link is refused before anything is written.
  await mkdir(join(layout.dir, folder), { recursive: true })
  const path = await guardRef(layout, ref)
  try {
    await writeNewFile(path, newCard(draft, firstOrder(columnCards(cards, draft.status))))
  } catch (error) {
    if (isAlreadyThere(error))
      throw new BoardError('cardNameTaken', { name }, `${name} is already there`)
    throw error
  }
  return ref
}

/**
 * Every draft written, the last first: each new card goes to the top of its column, so they
 * stand in the order asked. A refused one is passed over and the rest are still written; the
 * refusal kept is the earliest draft's.
 */
export async function createCards(
  layout: BoardLayout,
  drafts: readonly CardDraft[]
): Promise<CreatedCards> {
  const refs: (string | null)[] = drafts.map(() => null)
  let failure: Failure | null = null
  // `exists` is read once: still false after the first card made the folder, the next listing
  // would come back empty and give a second card of the same title the same name.
  let current = layout
  for (const [index, draft] of [...drafts.entries()].reverse()) {
    try {
      refs[index] = await createCard(current, draft)
      current = { ...current, exists: true }
    } catch (error) {
      // Written last first, so the last one kept is the earliest draft refused.
      failure = failureOf(error)
    }
  }
  return { refs, failure }
}

// Only the keys the patch carries; null and an empty list remove a key (`undefined` to `setMeta`).
function changesOf(patch: CardPatch): Record<string, unknown> {
  const changes: Record<string, unknown> = {}
  if (patch.priority !== undefined) changes.priority = patch.priority ?? undefined
  if (patch.tag !== undefined) changes.tag = patch.tag ?? undefined
  if (patch.links !== undefined) changes.links = patch.links.length === 0 ? undefined : patch.links
  return changes
}

export function updateCard(layout: BoardLayout, ref: string, patch: CardPatch): Promise<void> {
  return editCard(layout, ref, (raw, name) => setMeta(raw, changesOf(patch), name))
}

/** The `# ` line only: the file keeps its name, which is what other Macs and links know it by. */
export function renameCard(layout: BoardLayout, ref: string, title: string): Promise<void> {
  return editCard(layout, ref, (raw) => withTitle(raw, title))
}

// Blank lines at the end aside: the first comment adds one before its marker.
function assertDescribed(raw: string, base: string, name: string): void {
  if (descriptionOf(raw).trimEnd() !== base.trimEnd())
    throw new BoardError('cardChanged', { name }, `${name} changed on disk`)
}

/** The token is the description alone: a header or a comment changed meanwhile is no conflict. */
export function saveDescription(
  layout: BoardLayout,
  ref: string,
  save: DescriptionSave
): Promise<void> {
  return editCard(layout, ref, (raw, name) => {
    if (save.base !== null) assertDescribed(raw, save.base, name)
    return withDescription(raw, save.text)
  })
}

/** Title, description, priority and tag in one write; the file keeps its name and its comments. */
export function rewriteCard(layout: BoardLayout, ref: string, rewrite: CardRewrite): Promise<void> {
  return editCard(layout, ref, (raw, name) => {
    assertDescribed(raw, rewrite.base, name)
    // The header first: a malformed one is refused there, before the description is rewritten —
    // `withDescription` reads an unparsed header as text and would write over it.
    const fields = setMeta(
      raw,
      { priority: rewrite.priority ?? undefined, tag: rewrite.tag ?? undefined },
      name
    )
    const body = rewrite.description.trim()
    return withDescription(fields, `# ${rewrite.title}\n${body === '' ? '' : `\n${body}\n`}`)
  })
}

export function addComment(
  layout: BoardLayout,
  ref: string,
  text: string,
  at: string
): Promise<void> {
  return editCard(layout, ref, (raw) => withComment(raw, at, text))
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

// Moved already: a file octopus may not write keeps its bytes and sorts by name in its new column.
function keepsItsOrder(error: unknown): boolean {
  return (
    error instanceof BoardError &&
    (error.code === 'cardFrontmatterUnreadable' || error.code === 'cardNotText')
  )
}

export async function moveCard(layout: BoardLayout, ref: string, move: CardMove): Promise<string> {
  const folder = folderOf(layout, move.status)
  const path = await guardRef(layout, ref)
  await stamp(path, ref)
  const column = columnCards(await listBoard(layout), move.status).filter(
    (card) => card.ref !== ref
  )
  const order = orderForDrop(column, move.index)
  const placed = (raw: string, fileName: string): string => setMeta(raw, { order }, fileName)
  const name = basename(ref)
  const next = `${folder}/${name}`
  if (next === ref) {
    await editCard(layout, ref, placed)
    return ref
  }
  await mkdir(join(layout.dir, folder), { recursive: true })
  const target = await guardRef(layout, next)
  if (await exists(target))
    throw new BoardError('cardNameTaken', { name }, `${name} is already there`)
  await rename(path, target)
  try {
    await editCard(layout, next, placed)
  } catch (error) {
    if (!keepsItsOrder(error)) throw error
  }
  return next
}

/** Handed to the caller: core cannot reach the Trash, and deletes nothing itself. */
export async function removeCard(
  layout: BoardLayout,
  ref: string,
  discard: (path: string) => Promise<void>
): Promise<void> {
  await discard(await cardOnDisk(layout, ref))
}

export async function cardOnDisk(layout: BoardLayout, ref: string): Promise<string> {
  const path = await guardRef(layout, ref)
  await stamp(path, ref)
  return path
}

/** Of two cards with one id (a copy made in Finder), the first by path is the real one. */
export async function findCard(layout: BoardLayout, id: string): Promise<string | null> {
  const named = (await listBoard(layout))
    .filter((card) => card.meta.id === id)
    .sort((a, b) => compareNames(a.ref, b.ref))
  return named[0]?.ref ?? null
}
