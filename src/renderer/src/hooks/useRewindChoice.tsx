import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileRewind } from '@core/chats.js'
import type { RewindPreview, RewindScope } from '@core/rewind.js'

import { Button } from '../components/Button.js'
import { Modal } from '../components/Modal.js'

interface RewindChoice {
  /** Resolves with what was chosen, or null when the dialog was dismissed. */
  readonly choose: (preview: RewindPreview) => Promise<RewindScope | null>
  /** Render this somewhere in the tree; it is null while nothing is asked. */
  readonly dialog: React.JSX.Element | null
}

/** One choice: what it would do, or why it is not on offer. */
type Offer =
  | { readonly detail: string; readonly reason: null }
  | { readonly detail: null; readonly reason: string }

const offered = (detail: string): Offer => ({ detail, reason: null })
const refused = (reason: string): Offer => ({ detail: null, reason })

/**
 * Asks what to rewind to before a message: the conversation, the files, or
 * both — Claude Code's own three, for the same reason it offers them.
 *
 * Every choice is shown whether or not it can be had, with its reason in its
 * place when it cannot: a choice that vanishes reads as a feature that is not
 * there, and the reason ("the conversation was compacted since") is the one
 * thing the user can act on. Picking a row is the confirmation — the dialog is
 * already the second step, and the numbers of what it undoes are in the row.
 */
export function useRewindChoice(): RewindChoice {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<RewindPreview | null>(null)
  // Held in a ref because the promise outlives the render that created it.
  const settle = useRef<((scope: RewindScope | null) => void) | null>(null)

  const choose = useCallback((next: RewindPreview) => {
    setPreview(next)
    return new Promise<RewindScope | null>((resolve) => {
      settle.current = resolve
    })
  }, [])

  const close = (scope: RewindScope | null): void => {
    setPreview(null)
    settle.current?.(scope)
    settle.current = null
  }

  if (preview === null) return { choose, dialog: null }

  /** What the files' half would do, or why it cannot be had. */
  const filesOffer = (rewind: FileRewind | null): Offer => {
    if (rewind === null) return refused(t('chat.rewindFilesBusy'))

    if (!rewind.canRewind) {
      // The agent's own reason when it gave one: "no checkpoint for that
      // message" answers *why*, and the generic line does not.
      const reason = rewind.error ?? ''
      return refused(
        reason === '' ? t('chat.rewindFilesRefusedPlain') : t('chat.rewindFilesRefused', { reason })
      )
    }

    if (rewind.filesChanged.length === 0) return refused(t('chat.rewindNothing'))

    return offered(
      t('chat.rewindPutsFilesBack', {
        count: rewind.filesChanged.length,
        insertions: rewind.insertions,
        deletions: rewind.deletions
      })
    )
  }

  const conversation = preview.conversation
    ? offered(t('chat.rewindDropsMessages'))
    : refused(t('chat.rewindNoConversation'))
  const files = filesOffer(preview.files)

  const offers: readonly { scope: RewindScope; label: string; offer: Offer }[] = [
    {
      scope: 'both',
      label: t('chat.rewindBoth'),
      // The conversation's reason first, when both have one: it is the half
      // named first.
      offer:
        conversation.reason !== null
          ? conversation
          : files.reason !== null
            ? files
            : offered(`${conversation.detail} ${files.detail}`)
    },
    {
      scope: 'conversation',
      label: t('chat.rewindConversation'),
      offer:
        conversation.reason === null
          ? offered(`${conversation.detail} ${t('chat.rewindKeepsFiles')}`)
          : conversation
    },
    {
      scope: 'files',
      label: t('chat.rewindFiles'),
      offer:
        files.reason === null
          ? offered(`${files.detail} ${t('chat.rewindKeepsConversation')}`)
          : files
    }
  ]

  const dialog = (
    <Modal
      // Wide enough that each row's explanation reads as a line or two rather
      // than a column, which in the narrow size pushed the third row out of
      // view.
      size="md"
      title={t('chat.rewindTitle')}
      onClose={() => {
        close(null)
      }}
      footer={
        <Button
          variant="quiet"
          onClick={() => {
            close(null)
          }}
        >
          {t('chat.rewindCancel')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 p-5">
        {offers.map(({ scope, label, offer }) => (
          <button
            key={scope}
            type="button"
            disabled={offer.reason !== null}
            onClick={() => {
              close(scope)
            }}
            className="border-line hover:bg-muted focus-ring flex flex-col gap-0.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-60"
          >
            <span className="font-medium">{label}</span>
            <span className="text-ink-soft leading-relaxed">{offer.reason ?? offer.detail}</span>
          </button>
        ))}

        {/* Said once, under the rows, and only while the files are on offer:
            it is what a row's numbers cannot say. */}
        {files.reason === null && (
          <p className="text-ink-faint mt-1 leading-relaxed">{t('chat.rewindDetail')}</p>
        )}
      </div>
    </Modal>
  )

  return { choose, dialog }
}
