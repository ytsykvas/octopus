import { Globe, LoaderCircle, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ServerControls as Controls } from '../hooks/useServerControls.js'

type ServerControlsProps = Pick<
  Controls,
  'runnable' | 'activeRun' | 'building' | 'servingAt' | 'runAll' | 'stopRun'
>

/*
 * One size for every state, so the group does not shift under the cursor when
 * Play turns into a spinner or into the pair that replaces it.
 */
const SQUARE =
  'focus-ring relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control transition-colors'

/**
 * Run and Stop for the selected workspace, in the title bar.
 *
 * The same sequence the Scripts tab drives, read from the same state — so a
 * press in either place moves both. Icons only: the title bar is one row for
 * the whole window, and the label each one would carry is its tooltip and its
 * accessible name instead.
 */
export function ServerControls({
  runnable,
  activeRun,
  building,
  servingAt,
  runAll,
  stopRun
}: ServerControlsProps): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!runnable) return null

  if (servingAt !== null) {
    const open = t('scripts.openInBrowser', { port: servingAt.port })

    return (
      <span className="flex items-center gap-1">
        <a
          href={`http://localhost:${String(servingAt.port)}`}
          target="_blank"
          rel="noreferrer"
          title={open}
          aria-label={open}
          className={`${SQUARE} text-ink-soft hover:bg-muted hover:text-ink`}
        >
          <Globe aria-hidden size={15} />
          {/* Says the server is up without a word: the one sign on the
              window that something of this workspace is listening. */}
          <span
            aria-hidden
            className="bg-success absolute top-1 right-1 h-1.5 w-1.5 rounded-full motion-safe:animate-pulse"
          />
        </a>
        <StopButton onStop={stopRun} />
      </span>
    )
  }

  if (building) {
    return (
      <span className="flex items-center gap-1">
        <button
          type="button"
          disabled
          title={t('scripts.running')}
          aria-label={t('scripts.running')}
          className={`${SQUARE} bg-success-bg text-success cursor-default`}
        >
          <LoaderCircle aria-hidden size={15} className="motion-safe:animate-spin" />
        </button>
        <StopButton onStop={stopRun} />
      </span>
    )
  }

  const failed = activeRun.stage === 'failed'
  // Disabled rather than hidden while the scripts wait to be read: there is
  // something to start, and the tooltip says what stands in the way.
  const label =
    runAll === undefined
      ? t('scripts.awaitingApproval')
      : failed
        ? t('scripts.buildFailed')
        : t('scripts.runAll')

  return (
    <button
      type="button"
      onClick={runAll}
      disabled={runAll === undefined}
      title={label}
      aria-label={t('scripts.runAll')}
      className={`${SQUARE} bg-success-bg text-success hover:ring-success/40 hover:ring-1 hover:ring-inset disabled:cursor-default disabled:opacity-50 disabled:hover:ring-0`}
    >
      <Play aria-hidden size={14} fill="currentColor" />
      {/* A failed build would otherwise look exactly like nothing having
          run — and with the pane folded, this is all there is to see. */}
      {failed && (
        <span aria-hidden className="bg-danger absolute top-1 right-1 h-1.5 w-1.5 rounded-full" />
      )}
    </button>
  )
}

/** The one Stop, for a build and a server alike. */
function StopButton({ onStop }: { readonly onStop: (() => void) | undefined }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={onStop}
      title={t('scripts.stop')}
      aria-label={t('scripts.stop')}
      className={`${SQUARE} bg-danger-bg text-danger hover:ring-danger/40 hover:ring-1 hover:ring-inset`}
    >
      <Square aria-hidden size={12} fill="currentColor" />
    </button>
  )
}
