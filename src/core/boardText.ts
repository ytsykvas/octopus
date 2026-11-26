/**
 * A task file's body without its header: the title line, the description, and
 * the comments under their marker.
 *
 * Pure and without `yaml`, so the window shows a description without its title
 * line by the same rule the core reads it with. Every rule reads past fenced
 * code, so a marker or a heading quoted in an example never cuts a card.
 */
import type { CardComment } from './boardSchema.js'
import { stemOf } from './boardNames.js'

export const COMMENTS_MARKER = '<!-- octopus:comments -->'

interface Line {
  /** Offset of the line's first character. */
  readonly start: number
  /** The line without its break and without a trailing `\r`. */
  readonly text: string
  /** Outside every fenced block and not a fence line itself. */
  readonly prose: boolean
  readonly open: string | null
}

/** The fence character a line opens or closes a block with, or null. Up to three spaces before it. */
function fenceOf(text: string): string | null {
  return /^ {0,3}(?:```|~~~)/.test(text) ? text.trimStart().charAt(0) : null
}

/**
 * Every line with its offset and whether it is prose. A fence closes only on
 * the character that opened it; a longer closing fence or an info string after
 * it is not told apart, which no task file has needed.
 */
function linesOf(text: string): Line[] {
  const lines: Line[] = []
  let fence: string | null = null
  let open: string | null = null
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline + 1
    const line = text.slice(start, end).replace(/\r?\n?$/, '')
    const marker = fenceOf(line)
    const prose = fence === null && marker === null
    if (marker !== null && fence === null) {
      fence = marker
      open = line.trimStart().replace(/[^`~][\s\S]*$/, '')
    } else if (marker !== null && marker === fence) {
      fence = null
      open = null
    }
    lines.push({ start, text: line, prose, open })
    start = end
  }
  return lines
}

// Before a marker: a block left open would carry the marker, and every comment after it, inside.
export function withFenceClosed(text: string): string {
  const open = linesOf(text).at(-1)?.open ?? null
  return open === null ? text : `${text.trimEnd()}\n${open}\n`
}

const isTitleLine = (line: Line): boolean => line.prose && /^#[ \t]+\S/.test(line.text)

const COMMENT_HEADING = /^### \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\s*$/

/** The description before the first comments marker, and the marker with everything after it. */
export function splitBody(body: string): { readonly description: string; readonly tail: string } {
  const marker = linesOf(body).find((line) => line.prose && line.text.trimEnd() === COMMENTS_MARKER)
  return marker === undefined
    ? { description: body, tail: '' }
    : { description: body.slice(0, marker.start), tail: body.slice(marker.start) }
}

/** The first `# ` line's text, or the file name without `.md`. */
export function titleOf(description: string, fileName: string): string {
  const title = linesOf(description).find(isTitleLine)
  return title === undefined ? stemOf(fileName) : title.text.replace(/^#[ \t]+/, '').trim()
}

/** The description with its title line rewritten, or a title line put in front of it. */
export function retitled(description: string, title: string): string {
  const line = linesOf(description).find(isTitleLine)
  if (line === undefined) return `# ${title}\n\n${description}`
  return `${description.slice(0, line.start)}# ${title}${description.slice(line.start + line.text.length)}`
}

/** The description without its title line and the blank lines straight after it. */
export function withoutTitle(description: string): string {
  const lines = linesOf(description)
  const title = lines.find(isTitleLine)
  if (title === undefined) return description
  const kept = lines.find((line) => line.start > title.start && line.text.trim() !== '')
  return description.slice(0, title.start) + description.slice(kept?.start ?? description.length)
}

/** The comments under the marker, oldest first; lines before the first heading are not a comment. */
export function threadOf(tail: string): CardComment[] {
  const comments: { at: string; lines: string[] }[] = []
  for (const line of linesOf(tail).slice(1)) {
    if (line.prose && COMMENT_HEADING.test(line.text)) {
      comments.push({ at: line.text.slice(4).trimEnd(), lines: [] })
    } else {
      comments.at(-1)?.lines.push(line.text)
    }
  }
  return comments.map((comment) => ({ at: comment.at, text: comment.lines.join('\n').trim() }))
}

export interface TitleHead {
  readonly text: string
  /** What goes between the head and a body the description did not have when it was read. */
  readonly gap: string
}

export function titleHead(description: string): TitleHead {
  const lines = linesOf(description)
  const first = lines.find((line) => line.text.trim() !== '')
  if (first === undefined || !isTitleLine(first)) return { text: '', gap: '' }
  const kept = lines.find((line) => line.start > first.start && line.text.trim() !== '')
  if (kept !== undefined) return { text: description.slice(0, kept.start), gap: '' }
  return { text: description, gap: gapAfter(description) }
}

function gapAfter(head: string): string {
  if (/\n[ \t]*\r?\n$/.test(head)) return ''
  return head.endsWith('\n') ? '\n' : '\n\n'
}

export function withBody(head: TitleHead, body: string): string {
  return body === '' ? head.text : head.text + head.gap + body
}
