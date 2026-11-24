/**
 * Every name rule on the board, decided on strings.
 *
 * Pure: the window sorts and matches with the same rules the core does.
 */
import { BOARD_STATUSES, type BoardStatus } from './boardSchema.js'

/** Root collation with digits read as numbers: the same order whatever the system language. */
const NAME_COLLATOR = new Intl.Collator('und', { numeric: true })

/** Characters Finder, git or a shell treat as something other than a letter in a name. */
const FORBIDDEN = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])

/** A control character: below a space, or DEL. Compared as strings so no regex holds a control escape. */
const isControl = (ch: string): boolean => ch < ' ' || ch === '\u007f'

/** NFC, lower case, every run of `-` or `_` a space, whitespace collapsed, trimmed. */
export function normaliseFolder(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The status a folder name stands for, or null. */
export function statusOfFolder(name: string): BoardStatus | null {
  const normalised = normaliseFolder(name)
  return BOARD_STATUSES.find((status) => status === normalised) ?? null
}

/** A name the board never reads: a leading `_` or `.`, or a `.tmp` ending (any case). */
export function isSkipped(name: string): boolean {
  return name.startsWith('_') || name.startsWith('.') || /\.tmp$/i.test(name)
}

/** A name as a case-insensitive, normalisation-insensitive volume tells it apart. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/** One name to a case-insensitive, normalisation-insensitive volume. */
export function sameName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b)
}

/** The order names are listed in: root collation, digits as numbers, NFC first. */
export function compareNames(a: string, b: string): number {
  return NAME_COLLATOR.compare(a.normalize('NFC'), b.normalize('NFC'))
}

/** A title as a name Finder shows as written, or `fallback`. */
export function safeStem(value: string, fallback: string): string {
  const spaced = Array.from(value.normalize('NFC'), (ch) =>
    isControl(ch) || FORBIDDEN.has(ch) ? ' ' : ch
  ).join('')
  const trimmed = spaced
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[._ ]+/, '')
    .replace(/[. ]+$/, '')
  // Code points, not UTF-16 units; the cut can end on a dot or a space, so they go again.
  const stem = Array.from(trimmed)
    .slice(0, 80)
    .join('')
    .replace(/[. ]+$/, '')
  return stem === '' ? fallback : stem
}

/** A file name without its `.md` (any case). */
export function stemOf(fileName: string): string {
  return fileName.replace(/\.md$/i, '')
}

/** The file a new card is written to, clear of every name in `taken`. */
export function cardFileName(title: string, taken: readonly string[]): string {
  const stem = safeStem(title, 'Untitled')
  const free = (name: string): boolean => !taken.some((other) => sameName(other, name))
  let name = `${stem}.md`
  for (let n = 2; !free(name); n += 1) name = `${stem}-${String(n)}.md`
  return name
}

/** The folder a project's board lives in. */
export function boardFolderName(projectName: string): string {
  return safeStem(projectName, 'project')
}

/** A workspace name taken from a card's title, or null to keep the pool's name. */
export function cardWorkspaceName(title: string): string | null {
  const spaced = Array.from(title.normalize('NFC'), (ch) =>
    isControl(ch) || ch === '/' ? ' ' : ch
  ).join('')
  const name = Array.from(spaced.replace(/\s+/g, ' ').trim()).slice(0, 48).join('').trimEnd()
  return (name.match(/[a-z0-9]/gi) ?? []).length < 3 ? null : name
}

/** A host name as a person reads it — a label only; whose run it is, `device` decides. */
export function machineLabel(hostname: string): string {
  const label = hostname.trim().replace(/\.local$/i, '')
  return label === '' ? 'unknown' : label
}
