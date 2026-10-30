import { type CodeNote, codeNoteKey } from '../../hooks/useCodeNotes.js'
import type { DiffComment } from '../../hooks/useDiffComments.js'
import { anchorKey } from '../../hooks/useDiffComments.js'
import { codeReference } from '../codeReference.js'
import type { PullRequestQuote } from '../../hooks/usePullRequestQuotes.js'

/**
 * Something riding out with the next message.
 *
 * Three kinds: a note written against the diff, one written on lines of a
 * file in the viewer, and a remark carried in from a review on GitHub. A union rather than one record with nullable extras,
 * because the two are identified differently — a note by where it is, a remark
 * by the id GitHub gave it — and a single shape would have to answer for a note
 * with an id and no line.
 *
 * Deliberately not the shape the diff pane holds. That one narrows a
 * `DiffComment` by its anchor on every row it draws, and a union with a member
 * it can never hold would put an unreachable guard in each of those places.
 */
export type ChatNote =
  | ({ readonly kind: 'diff' } & DiffComment)
  | ({ readonly kind: 'code' } & CodeNote)
  | ({ readonly kind: 'pullRequest' } & PullRequestQuote)

/** What makes it the same note, across every kind and namespace. */
export function noteKey(note: ChatNote): string {
  switch (note.kind) {
    case 'diff':
      return `diff:${anchorKey(note)}`
    case 'code':
      return `code:${codeNoteKey(note)}`
    case 'pullRequest':
      return `pr:${note.key}`
  }
}

/**
 * The queues as one list, in the order they go out.
 *
 * Diff notes first, because they are about the change being made and the review
 * is about the change as somebody else read it — and a message that answers a
 * reviewer usually ends with the code it is about, not the other way round.
 * Notes from the viewer sit between: remarks on the code, like the diff's, but
 * not necessarily on what changed.
 */
export function mergeNotes(
  comments: readonly DiffComment[],
  quotes: readonly PullRequestQuote[],
  code: readonly CodeNote[] = []
): ChatNote[] {
  return [
    ...comments.map((comment) => ({ kind: 'diff' as const, ...comment })),
    ...code.map((note) => ({ kind: 'code' as const, ...note })),
    ...quotes.map((quote) => ({ kind: 'pullRequest' as const, ...quote }))
  ]
}

/** What each kind is introduced by, so the agent knows where it came from. */
export interface NoteIntros {
  readonly diff: string
  readonly pullRequest: string
  /**
   * What marks a note about the file as it was, appended to its heading.
   *
   * Passed in rather than written here for the reason the two above are: this
   * is text the user reads back in their own message, so it belongs in the
   * locales.
   */
  readonly oldSide: string
}

/**
 * Puts the notes into the message that carries them.
 *
 * They become text rather than anything hidden. §4 is explicit that nothing
 * implicit reaches the agent, and the message the user can read back in the log
 * is the whole of what was sent — the same reasoning that has `/clear` go out
 * as the characters the user typed rather than as a command this app dispatches.
 *
 * The quoted code is what the note was written against, kept from the moment it
 * was written: by the time the agent reads it the file may have moved on, and a
 * line number on its own would point at whatever now sits there. The same is
 * true of a review comment, which is why GitHub's own hunk travels with it.
 */
/**
 * Writes the paths of files pointed at into a draft, at the caret.
 *
 * The whole of an attachment is its path, written where the reader is typing —
 * "compare `a.png` with" is a sentence, a list under a heading is not. Nothing
 * is copied anywhere: the agent is told where a file is and reads it, which is
 * §4's rule in its plainest form, and the message read back in the log is the
 * whole of what was sent.
 *
 * A path with a space in it goes in backticks. Inside a sentence nothing else
 * says where `Screenshot 2026-09-06 at 14.02.11.png` ends, and a path the agent
 * cuts short at the first space is a file that does not exist.
 */
export function insertPaths(
  draft: string,
  caret: number,
  paths: readonly string[]
): { readonly draft: string; readonly caret: number } {
  const at = Math.min(caret, draft.length)
  const before = draft.slice(0, at)
  const after = draft.slice(at)

  // Set apart from the words on either side, and no further: a space is added
  // only where there is not one already, and the caret lands after the one that
  // follows, so the next word typed is a word of its own.
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = /^\s/.test(after) ? '' : ' '
  const written = `${lead}${paths.map((path) => (/\s/.test(path) ? `\`${path}\`` : path)).join(' ')}${trail}`

  return { draft: `${before}${written}${after}`, caret: at + written.length }
}

/** What `/compact` is written as, with the space the text to keep goes after. */
export const COMPACT_PREFIX = '/compact '

/**
 * Writes `/compact ` before a draft, so the draft says what the summary keeps.
 *
 * Whatever follows the command is what the CLI is told to keep when it
 * summarises, and it is the one supported way to choose what survives: no API
 * removes a single message from the middle. So a half-written message becomes
 * that text rather than being overwritten, and the command is not written twice
 * over a draft that already starts with it.
 *
 * The caret lands after the command in every case, where the focus is typed.
 */
export function withCompact(draft: string): { readonly draft: string; readonly caret: number } {
  const rest = draft.trimStart()
  // `/compactor` only begins with the command; the word must end there.
  const written = /^\/compact(\s|$)/.test(rest)

  return {
    draft: written
      ? `${COMPACT_PREFIX}${rest.slice('/compact'.length).trimStart()}`
      : `${COMPACT_PREFIX}${rest}`,
    caret: COMPACT_PREFIX.length
  }
}

export function withNotes(text: string, notes: readonly ChatNote[], intros: NoteIntros): string {
  if (notes.length === 0) return text

  const diff = notes.filter((note) => note.kind === 'diff')
  const code = notes.filter((note) => note.kind === 'code')
  const review = notes.filter((note) => note.kind === 'pullRequest')

  // One introduction per kind that is present, rather than one per note: two
  // headings over a list of six is a shape, six is noise. Notes from the viewer
  // have none: a path, its lines and the code quoted under them say what they
  // are, and a heading over lines sent without a word only got in their way.
  const parts = [
    ...(diff.length === 0
      ? []
      : [intros.diff, ...diff.map((note) => fromDiff(note, intros.oldSide))]),
    ...code.map(fromCode),
    ...(review.length === 0 ? [] : [intros.pullRequest, ...review.map(fromReview)]),
    // The typed message last, so the agent reads the notes and then what to do
    // with them — and an empty one leaves no trailing blank lines behind.
    text
  ]

  return parts.filter((part) => part !== '').join('\n\n')
}

/**
 * A note as it reads in the message.
 *
 * The side is named, and a bare number would be wrong without it. The pane
 * knows which file a note is about everywhere — `anchorOf` records it,
 * `anchorKey` spells it, the aria-label says it — and this is the one place it
 * reaches the agent. Dropped here, a remark on a removed line went out as
 * `path:812` where 812 numbers the file **before** the change: an address that
 * does not contain the code the remark is about.
 *
 * The quoted passage rescues a distinctive line. For `}`, `return null` or a
 * closing tag the number is the only thing telling two apart, and after a large
 * deletion the two numberings have drifted by everything added above.
 *
 * The old number is not translated into a new one, and cannot be: a removed
 * line has no line in the file as it now stands, which is why the side is
 * recorded rather than resolved.
 */
function fromDiff(note: { readonly kind: 'diff' } & DiffComment, oldSide: string): string {
  const where = `${codeReference(note.path, note.line, note.endLine)}${note.side === 'old' ? ` ${oldSide}` : ''}`

  return `${where}\n${blockQuote(note.code)}\n${note.text}`
}

/**
 * A note from the viewer, in the diff note's shape without a side: the viewer
 * shows the file as it stands. A note with no words is the reference and the
 * lines alone, with no empty line left after them.
 */
function fromCode(note: { readonly kind: 'code' } & CodeNote): string {
  const head = `${codeReference(note.path, note.line, note.endLine)}\n${blockQuote(note.code)}`

  return note.text === '' ? head : `${head}\n${note.text}`
}

/**
 * A remark as it reads in the message.
 *
 * The heading names who said it and where, because a review comment without its
 * author is an anonymous instruction — and the reader is about to ask a
 * question about it, not carry it out.
 */
function fromReview(note: { readonly kind: 'pullRequest' } & PullRequestQuote): string {
  const heading = [note.reference, note.author === null ? null : `@${note.author}`, note.place]
    .filter((part) => part !== null)
    .join(' — ')

  return [heading, note.quote === null ? null : blockQuote(note.quote), note.body]
    .filter((part) => part !== null && part !== '')
    .join('\n')
}

/**
 * Every line marked, not just the first.
 *
 * A passage quoted with one `>` and then bare lines reads as a quote that ended
 * and a message that began — which is exactly the confusion the marker exists
 * to prevent.
 */
function blockQuote(code: string): string {
  return code
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}
