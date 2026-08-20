import type { DiffComment } from '../../hooks/useDiffComments.js'
import { anchorKey } from '../../hooks/useDiffComments.js'
import type { PullRequestQuote } from '../../hooks/usePullRequestQuotes.js'

/**
 * Something riding out with the next message.
 *
 * Two kinds now: a note written against the diff, and a remark carried in from
 * a review on GitHub. A union rather than one record with nullable extras,
 * because the two are identified differently — a note by where it is, a remark
 * by the id GitHub gave it — and a single shape would have to answer for a note
 * with an id and no line.
 *
 * Deliberately not the shape the diff pane holds. That one narrows a
 * `DiffComment` by its anchor on every row it draws, and a union with a member
 * it can never hold would put an unreachable guard in each of those places.
 */
export type ChatNote =
  ({ readonly kind: 'diff' } & DiffComment) | ({ readonly kind: 'pullRequest' } & PullRequestQuote)

/** What makes it the same note, across both kinds and both namespaces. */
export function noteKey(note: ChatNote): string {
  return note.kind === 'diff' ? `diff:${anchorKey(note)}` : `pr:${note.key}`
}

/**
 * The two queues as one list, in the order they go out.
 *
 * Diff notes first, because they are about the change being made and the review
 * is about the change as somebody else read it — and a message that answers a
 * reviewer usually ends with the code it is about, not the other way round.
 */
export function mergeNotes(
  comments: readonly DiffComment[],
  quotes: readonly PullRequestQuote[]
): ChatNote[] {
  return [
    ...comments.map((comment) => ({ kind: 'diff' as const, ...comment })),
    ...quotes.map((quote) => ({ kind: 'pullRequest' as const, ...quote }))
  ]
}

/** What each kind is introduced by, so the agent knows where it came from. */
export interface NoteIntros {
  readonly diff: string
  readonly pullRequest: string
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
export function withNotes(text: string, notes: readonly ChatNote[], intros: NoteIntros): string {
  if (notes.length === 0) return text

  const diff = notes.filter((note) => note.kind === 'diff')
  const review = notes.filter((note) => note.kind === 'pullRequest')

  // One introduction per kind that is present, rather than one per note: two
  // headings over a list of six is a shape, six is noise.
  const parts = [
    ...(diff.length === 0 ? [] : [intros.diff, ...diff.map(fromDiff)]),
    ...(review.length === 0 ? [] : [intros.pullRequest, ...review.map(fromReview)]),
    // The typed message last, so the agent reads the notes and then what to do
    // with them — and an empty one leaves no trailing blank lines behind.
    text
  ]

  return parts.filter((part) => part !== '').join('\n\n')
}

function fromDiff(note: { readonly kind: 'diff' } & DiffComment): string {
  return `${note.path}:${lineRange(note)}\n${blockQuote(note.code)}\n${note.text}`
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

/** `42` for a note on one line, `42-47` for one covering a passage. */
function lineRange(comment: DiffComment): string {
  return comment.line === comment.endLine
    ? String(comment.line)
    : `${String(comment.line)}-${String(comment.endLine)}`
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
