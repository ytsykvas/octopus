import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { anchorKey, type DiffComment } from '../../hooks/useDiffComments.js'

/**
 * The review notes riding along with the next message.
 *
 * Shown rather than merely counted: what goes out is written into the message
 * itself (§4), and a chip that names the file and the line is what makes that
 * checkable before it is sent rather than after.
 *
 * The strip disappears when there is nothing to say, the way the attic above it
 * does — an empty rule over the field would be chrome asserting that a review
 * exists.
 */
export function ComposerAttachments({
  comments,
  onRemove
}: {
  readonly comments: readonly DiffComment[]
  readonly onRemove: (comment: DiffComment) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (comments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1 px-1 pb-1">
      {comments.map((comment) => (
        <span
          key={anchorKey(comment)}
          className="border-line bg-muted text-ink-soft flex max-w-full items-center gap-1 rounded-[var(--radius-control)] border px-1.5 py-0.5"
        >
          <span className="text-ink-faint shrink-0 font-mono text-[11px]">
            {comment.path.slice(comment.path.lastIndexOf('/') + 1)}:{comment.line}
            {comment.endLine !== comment.line && `-${String(comment.endLine)}`}
          </span>
          <span className="min-w-0 truncate text-[11px]">{comment.text}</span>
          <button
            type="button"
            onClick={() => {
              onRemove(comment)
            }}
            aria-label={t('diff.commentRemove')}
            className="focus-ring text-ink-faint hover:text-danger shrink-0 rounded-[var(--radius-control)]"
          >
            <X aria-hidden size={11} />
          </button>
        </span>
      ))}
    </div>
  )
}
