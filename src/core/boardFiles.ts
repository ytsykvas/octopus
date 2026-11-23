import type { Dirent, Stats } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'

import { parseCard } from './boardCard.js'
import {
  boardFolderName,
  compareNames,
  isSkipped,
  sameName,
  statusOfFolder,
  stemOf
} from './boardNames.js'
import {
  BoardError,
  CardMetaSchema,
  isCardRef,
  type BoardCard,
  type BoardStatus,
  type CardDetail
} from './boardSchema.js'
import { allOf } from './parallel.js'
import { unlinkedInside } from './paths.js'
import { describeError, isNotDirectory, isNotFound } from './persist.js'

export interface BoardLayout {
  /** The project's folder, absolute — whether or not it exists yet. */
  readonly dir: string
  /** False until the first write makes `dir`: reading never does. */
  readonly exists: boolean
  /** Each status → the folder in `dir` that holds it: the one found, else the status's own name. */
  readonly folders: Readonly<Record<BoardStatus, string>>
}

const MARKDOWN = /\.md$/i

function unreadable(path: string, reason: string): BoardError {
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

function byStatus(pick: (status: BoardStatus) => string): Readonly<Record<BoardStatus, string>> {
  return {
    backlog: pick('backlog'),
    'in progress': pick('in progress'),
    testing: pick('testing'),
    staging: pick('staging'),
    done: pick('done'),
    blocked: pick('blocked')
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

export async function findLayout(root: string, project: string): Promise<BoardLayout> {
  if (root === '') throw new BoardError('boardFolderUnset', {}, 'No board folder is set')
  if (!isAbsolute(root)) throw unreadable(root, 'not an absolute path')
  await folderAt(root)

  const wanted = boardFolderName(project)
  const names = (await entriesOf(root))
    .map((entry) => entry.name)
    .filter((name) => !isSkipped(name))
  const found = firstNamed(names, (name) => sameName(name, wanted))
  if (found === null)
    return { dir: join(root, wanted), exists: false, folders: byStatus((status) => status) }

  const dir = join(root, found)
  await folderAt(dir)

  // A link `Dirent` is neither a file nor a folder, so a linked status folder is skipped here;
  // so is `_done`, which `statusOfFolder` would read as "done" while the scan skips it.
  const folders = (await entriesOf(dir))
    .filter((entry) => entry.isDirectory() && !isSkipped(entry.name))
    .map((entry) => entry.name)
  return {
    dir,
    exists: true,
    folders: byStatus(
      (status) => firstNamed(folders, (name) => statusOfFolder(name) === status) ?? status
    )
  }
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
function missing(error: unknown, ref: string): unknown {
  if (!isNotFound(error) && !isNotDirectory(error)) return error
  return new BoardError(
    'cardMissing',
    { name: basename(ref) },
    `${basename(ref)} is no longer on disk`
  )
}

function locate(ref: string): { readonly status: BoardStatus; readonly loose: boolean } {
  const slash = ref.indexOf('/')
  if (slash === -1) return { status: 'backlog', loose: true }
  const status = statusOfFolder(ref.slice(0, slash))
  return status === null ? { status: 'backlog', loose: true } : { status, loose: false }
}

// Read as bytes: text that is not UTF-8 decodes with U+FFFD in place of what it held, and
// writing that back would lose it — so such a file is listed by its name and never written.
function decoded(bytes: Buffer): string | null {
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null
}

type CardText = Omit<CardDetail, 'attachments'>

function cardOf(ref: string, bytes: Buffer): CardText {
  const fileName = basename(ref)
  const raw = decoded(bytes)
  if (raw === null) {
    const meta = CardMetaSchema.parse({})
    return {
      ref,
      ...locate(ref),
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
    ...locate(ref),
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
        (bytes) => listed(cardOf(ref, bytes)),
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
  return cardOf(ref, bytes)
}
