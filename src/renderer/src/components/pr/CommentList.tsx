import { MessageSquarePlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { commentKey, type PullRequestComment, type ReviewVerdict } from '@core/pullRequestShapes.js'

import { Markdown } from '../chat/Markdown.js'
import { Button } from '../Button.js'
import { moment } from './time.js'

const VERDICTS: Record<
  ReviewVerdict,
  | 'pullRequest.verdictApproved'
  | 'pullRequest.verdictChangesRequested'
  | 'pullRequest.verdictCommented'
  | 'pullRequest.verdictDismissed'
> = {
  approved: 'pullRequest.verdictApproved',
  changesRequested: 'pullRequest.verdictChangesRequested',
  commented: 'pullRequest.verdictCommented',
  dismissed: 'pullRequest.verdictDismissed'
}

/** An approval carries a verdict and nothing else; the tone is what says which. */
const VERDICT_TONES: Record<ReviewVerdict, string> = {
  approved: 'text-success',
  changesRequested: 'text-warning',
  commented: 'text-ink-faint',
  dismissed: 'text-ink-faint'
}

/**
 * Everything anybody said on the request, oldest first.
 *
 * Rendered as markdown, because that is what GitHub stores and what reviewers
 * write — a bot's review arrives with a table in it, and shown raw it is a wall
 * of pipes.
 *
 * The three kinds are drawn as one list rather than in sections. They are one
 * conversation: a review says "see the notes", the notes answer it, and an
 * ordinary comment follows up on both. Split by kind, reading them in order
 * would mean reading three lists at once.
 */
export function CommentList({
  comments,
  onAddToChat,
  attached,
  onReply,
  onSetResolved
}: {
  readonly comments: readonly PullRequestComment[]
  /** Puts the remark in the composer, where a question can be typed under it. */
  readonly onAddToChat: (comment: PullRequestComment) => void
  /** Which are already waiting there, so the button does not offer them twice. */
  readonly attached: ReadonlySet<string>
  /** Answers a thread. False leaves what was typed where it is, to try again. */
  readonly onReply: (threadId: string, body: string) => Promise<boolean>
  /** Settles a thread or puts it back. */
  readonly onSetResolved: (threadId: string, resolved: boolean) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()

  /** Which thread's reply box is open, by the key of the note it hangs under. */
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  /** The thread with a write in flight — one at a time, and it says which. */
  const [busy, setBusy] = useState<string | null>(null)

  /*
   * The last note of each thread.
   *
   * The three kinds are drawn as one list in time order, so a thread's notes
   * are scattered through it. The controls belong on one of them and the end is
   * the only one that reads right: `Resolve` repeated down a thread looks like
   * three separate things to settle, and a reply box in the middle of one looks
   * like it would land there.
   *
   * Last write wins because the list is already oldest-first.
   */
  const threadEnds = useMemo(() => {
    const ends = new Map<string, string>()
    for (const comment of comments) {
      if (comment.kind === 'inline') ends.set(comment.threadId, commentKey(comment))
    }
    return new Set(ends.values())
  }, [comments])

  if (comments.length === 0) {
    return <p className="text-ink-faint leading-relaxed">{t('pullRequest.reviewNone')}</p>
  }

  return (
    <ul className="space-y-2">
      {comments.map((comment) => {
        const key = commentKey(comment)
        const at = moment(comment.createdAt)

        return (
          <li key={key} className="border-line group border-b pb-2 last:border-0 last:pb-0">
            <div className="flex items-baseline gap-2">
              <span className="text-ink min-w-0 truncate font-medium">
                {comment.author ?? t('pullRequest.unknownAuthor')}
              </span>

              {comment.kind === 'review' && (
                <span className={`shrink-0 ${VERDICT_TONES[comment.verdict]}`}>
                  {t(VERDICTS[comment.verdict])}
                </span>
              )}

              {comment.kind === 'inline' && (
                <span
                  className="text-ink-faint min-w-0 flex-1 truncate font-mono text-[11px]"
                  title={comment.path}
                >
                  {comment.path.slice(comment.path.lastIndexOf('/') + 1)}
                  {comment.line !== null && `:${String(comment.line)}`}
                </span>
              )}

              {comment.kind === 'inline' && comment.resolved && (
                <span className="text-ink-faint shrink-0">{t('pullRequest.resolved')}</span>
              )}

              {at !== null && (
                <span className="text-ink-faint ml-auto shrink-0 font-mono text-[11px]">{at}</span>
              )}

              {/* Attaches rather than sends. The reader has a question about
                  this remark, and the question is the point — so it goes to the
                  composer and travels with whatever is typed under it. */}
              <button
                type="button"
                onClick={() => {
                  onAddToChat(comment)
                }}
                disabled={attached.has(key)}
                title={t('pullRequest.addToChat')}
                aria-label={t('pullRequest.addToChat')}
                className="focus-ring text-ink-faint hover:text-accent shrink-0 rounded-[var(--radius-control)] transition-opacity disabled:opacity-30"
              >
                <MessageSquarePlus aria-hidden size={12} />
              </button>
            </div>

            {/* The lines the note was written against, as GitHub kept them. A
                line number alone would point at whatever now sits there. */}
            {comment.kind === 'inline' && (
              <pre className="text-ink-faint border-line mt-1 max-h-24 overflow-auto border-l pl-2 font-mono text-[11px] leading-relaxed">
                {comment.quote}
              </pre>
            )}

            {comment.body.trim() !== '' && (
              <div className="text-ink-soft mt-1">
                <Markdown text={comment.body} />
              </div>
            )}

            {/* Only under the last note of a thread — see `threadEnds`. */}
            {comment.kind === 'inline' && threadEnds.has(key) && (
              <div className="mt-1.5 flex items-center gap-2">
                {replyingTo === key ? (
                  <ReplyBox
                    busy={busy === comment.threadId}
                    value={draft}
                    onChange={setDraft}
                    onCancel={() => {
                      setReplyingTo(null)
                      setDraft('')
                    }}
                    onSend={() => {
                      setBusy(comment.threadId)
                      void (async () => {
                        const sent = await onReply(comment.threadId, draft.trim())
                        setBusy(null)
                        // Left as typed when it failed: the sentence took
                        // thought, and clearing it makes the reader write it
                        // twice to find out the second attempt fails too.
                        if (sent) {
                          setReplyingTo(null)
                          setDraft('')
                        }
                      })()
                    }}
                  />
                ) : (
                  <>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        setReplyingTo(key)
                        setDraft('')
                      }}
                    >
                      {t('pullRequest.reply')}
                    </Button>

                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={busy === comment.threadId}
                      onClick={() => {
                        setBusy(comment.threadId)
                        void (async () => {
                          await onSetResolved(comment.threadId, !comment.resolved)
                          setBusy(null)
                        })()
                      }}
                    >
                      {comment.resolved
                        ? t('pullRequest.unresolveThread')
                        : t('pullRequest.resolveThread')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The field one thread is answered in.
 *
 * A textarea rather than an input: a review answer is a sentence or three, and
 * a single line hides its own beginning while it is being written.
 */
function ReplyBox({
  value,
  onChange,
  onSend,
  onCancel,
  busy
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSend: () => void
  readonly onCancel: () => void
  readonly busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <textarea
        autoFocus
        rows={3}
        value={value}
        disabled={busy}
        placeholder={t('pullRequest.replyPlaceholder')}
        aria-label={t('pullRequest.reply')}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="input focus-ring resize-y"
      />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onSend} disabled={busy || value.trim() === ''}>
          {busy ? t('pullRequest.replying') : t('pullRequest.replySend')}
        </Button>

        <Button variant="quiet" size="sm" onClick={onCancel} disabled={busy}>
          {t('pullRequest.replyCancel')}
        </Button>
      </div>
    </div>
  )
}
