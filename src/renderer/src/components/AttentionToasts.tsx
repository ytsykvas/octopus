import { CircleAlert, CircleCheck, CircleHelp, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Notice, NoticeKind } from '../attention.js'
import { Button } from './Button.js'

interface AttentionToastsProps {
  /** Newest first, already capped. */
  readonly toasts: readonly Notice[]
  readonly projects: readonly Project[]
  readonly workspaces: readonly WorkspaceView[]
  readonly onShow: (notice: Notice) => void
  readonly onDismiss: (notice: Notice) => void
}

/** What happened, in the status colours the rest of the window uses. */
const ICONS: Record<NoticeKind, React.JSX.Element> = {
  done: <CircleCheck aria-hidden size={15} className="text-success shrink-0" />,
  error: <CircleAlert aria-hidden size={15} className="text-danger shrink-0" />,
  question: <CircleHelp aria-hidden size={15} className="text-warning shrink-0" />,
  plan: <CircleHelp aria-hidden size={15} className="text-warning shrink-0" />,
  permission: <CircleHelp aria-hidden size={15} className="text-warning shrink-0" />
}

/**
 * News from agents out of sight, in the bottom-right corner.
 *
 * Quiet on purpose: no timer takes a toast away, because news that vanishes
 * while somebody is reading something else was never delivered — it goes when
 * the workspace is opened or when it is dismissed. Drawn into the body, as the
 * menus are, so no stacking context in the window can bury it; and not a
 * `<dialog>`, which would switch off the window's own keys.
 */
export function AttentionToasts({
  toasts,
  projects,
  workspaces,
  onShow,
  onDismiss
}: AttentionToastsProps): React.JSX.Element {
  const { t } = useTranslation()

  const says = (notice: Notice): string => {
    switch (notice.kind) {
      case 'done':
        return t('notices.done')
      case 'error':
        return t('notices.error')
      case 'question':
        return t('notices.question')
      case 'plan':
        return t('notices.plan')
      case 'permission':
        return t('notices.permission', { tool: notice.toolName })
    }
  }

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-[calc(1rem+var(--status-bar-height,0px))] z-50 flex w-80 flex-col gap-2"
    >
      {toasts.map((notice) => {
        const project = projects.find((candidate) => candidate.id === notice.projectId)
        const workspace = workspaces.find((candidate) => candidate.id === notice.workspaceId)
        const where = [project?.name, workspace?.name]
          .filter((part) => part !== undefined)
          .join(' · ')

        return (
          <section
            key={notice.chatId}
            aria-label={says(notice)}
            className="notice-in border-line bg-canvas pointer-events-auto flex items-center gap-2.5 rounded-[var(--radius-panel)] border py-2 pr-2 pl-3 shadow-[var(--shadow-pop)]"
          >
            {ICONS[notice.kind]}

            <div className="min-w-0 flex-1">
              <p className="text-ink truncate font-medium">{says(notice)}</p>
              <p className="text-ink-faint truncate text-[12px]">{where}</p>
            </div>

            <Button
              size="sm"
              onClick={() => {
                onShow(notice)
              }}
            >
              {t('notices.show')}
            </Button>

            <button
              type="button"
              aria-label={t('notices.dismiss')}
              title={t('notices.dismiss')}
              onClick={() => {
                onDismiss(notice)
              }}
              className="text-ink-faint hover:text-ink hover:bg-muted focus-ring flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors"
            >
              <X aria-hidden size={13} />
            </button>
          </section>
        )
      })}
    </div>,
    document.body
  )
}
