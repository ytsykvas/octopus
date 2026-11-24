import { constants, type Dirent } from 'node:fs'
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'

import { type BoardLayout, cardOnDisk, guardRef, missing } from './boardFiles.js'
import { compareNames, isSkipped, sameName, stemOf } from './boardNames.js'
import { ATTACHMENTS_DIR, BoardError } from './boardSchema.js'
import { unlinkedInside } from './paths.js'
import { isNotDirectory, isNotFound } from './persist.js'

const NAME_MAX = 255

// `includes`, not a regular expression: ESLint's no-control-regex refuses the NUL in one.
export function isAttachmentName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= NAME_MAX &&
    !isSkipped(name) &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\u0000')
  )
}

function filesOf(ref: string): string {
  return join(ATTACHMENTS_DIR, stemOf(basename(ref)))
}

function outside(name: string): BoardError {
  return new BoardError('cardOutside', { name }, `${name} is not inside the board folder`)
}

export async function listAttachments(layout: BoardLayout, ref: string): Promise<string[]> {
  await guardRef(layout, ref)
  // Never read through a link: a folder linked out of the board would list someone else's files.
  if (!(await unlinkedInside(layout.dir, filesOf(ref)))) return []
  let entries: Dirent[]
  try {
    entries = await readdir(join(layout.dir, filesOf(ref)), { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error) || isNotDirectory(error)) return []
    throw error
  }
  return entries
    .filter((entry) => entry.isFile() && isAttachmentName(entry.name))
    .map((entry) => entry.name)
    .sort(compareNames)
}

function freeName(name: string, taken: readonly string[]): string {
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  const isTaken = (candidate: string): boolean => taken.some((other) => sameName(other, candidate))
  let candidate = name
  for (let n = 2; isTaken(candidate); n += 1) candidate = `${base}-${String(n)}${ext}`
  return candidate
}

export async function addAttachments(
  layout: BoardLayout,
  ref: string,
  sources: readonly string[]
): Promise<number> {
  await cardOnDisk(layout, ref)
  if (!(await unlinkedInside(layout.dir, filesOf(ref)))) throw outside(basename(ref))
  const dir = join(layout.dir, filesOf(ref))
  let taken: string[] | null = null
  let copied = 0
  for (const source of sources) {
    if (!isAbsolute(source)) continue
    const name = basename(source).normalize('NFC')
    if (!isAttachmentName(name)) continue
    const stats = await lstat(source).catch((error: unknown) => {
      if (isNotFound(error) || isNotDirectory(error)) return null
      throw error
    })
    if (stats?.isFile() !== true) continue
    if (taken === null) {
      await mkdir(dir, { recursive: true })
      taken = await readdir(dir)
    }
    const target = freeName(name, taken)
    // EXCL: a file that appeared since the readdir is refused, never replaced.
    await copyFile(source, join(dir, target), constants.COPYFILE_EXCL)
    taken.push(target)
    copied += 1
  }
  return copied
}

export async function attachmentPath(
  layout: BoardLayout,
  ref: string,
  name: string
): Promise<string> {
  await guardRef(layout, ref)
  const relative = join(filesOf(ref), name)
  if (!isAttachmentName(name) || !(await unlinkedInside(layout.dir, relative))) throw outside(name)
  const path = join(layout.dir, relative)
  await lstat(path).catch((error: unknown) => {
    throw missing(error, relative)
  })
  return path
}
