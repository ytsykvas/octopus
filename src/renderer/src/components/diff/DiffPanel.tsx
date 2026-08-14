import { ChevronsDownUp, ChevronsUpDown, Columns2, RefreshCw, Rows3 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileDiff } from '@core/diff.js'
import { shortBranchName } from '@core/branches.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useWorkspaceDiff } from '../../hooks/useWorkspaceDiff.js'
import { DiffFile } from './DiffFile.js'
import type { DiffView } from './DiffHunk.js'
import { MIN_SPLIT_COLUMNS, splitThreshold } from './measure.js'

/**
 * A file this big starts collapsed.
 *
 * Chosen against what a reviewer scrolls past rather than what the machine can
 * draw: a generated file or a wholesale rewrite is not read line by line, and
 * putting it in the way of the files that are is what makes a review tedious.
 */
const AUTO_COLLAPSE_LINES = 500

interface DiffPanelProps {
  readonly workspace: WorkspaceView | null
  /** False while another tab is showing; the diff is not read behind one. */
  readonly visible: boolean
  /** How the reader asked for diffs to be laid out, across sessions. */
  readonly view: DiffView
  readonly onView: (view: DiffView) => void
  /** The pane's current width, which decides whether two columns fit. */
  readonly width: number
}

/**
 * What the workspace changed, one file after another.
 *
 * One scrolling column rather than a list beside a viewer: the pane is 360px by
 * default and a second column inside it leaves neither half readable. The file
 * headers are sticky, so the column doubles as the list — which is what the
 * navigation was for.
 */
export function DiffPanel({
  workspace,
  visible,
  view,
  onView,
  width
}: DiffPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const { diff, loading, error, refresh } = useWorkspaceDiff(workspace?.id ?? null, visible)
  // Measured only once there is a diff on screen: the sample lives in that
  // tree, and an element in a hidden subtree measures zero.
  const { threshold, sample } = useSplitThreshold(visible && (diff?.files.length ?? 0) > 0)

  /*
   * What is drawn, as against what was asked for.
   *
   * The stored preference is never overwritten by the pane being too narrow:
   * dragging it wide again should bring back the two columns rather than
   * having silently forgotten them.
   */
  const roomForSplit = width >= threshold
  const effectiveView: DiffView = view === 'split' && roomForSplit ? 'split' : 'unified'

  /*
   * Only the files the reader has had an opinion about.
   *
   * Everything else falls back to the size rule below, so a refresh after the
   * agent's turn keeps the choices already made without having to reconcile a
   * set of paths against a diff that has moved on.
   */
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [shownId, setShownId] = useState(workspace?.id ?? null)

  if ((workspace?.id ?? null) !== shownId) {
    setShownId(workspace?.id ?? null)
    setChoices(new Map())
  }

  if (!workspace) return <Notice>{t('diff.noWorkspace')}</Notice>
  if (error !== null) return <Notice tone="danger">{error}</Notice>
  if (loading) return <Notice>{t('diff.loading')}</Notice>
  if (!diff || diff.files.length === 0) return <Notice>{t('diff.clean')}</Notice>

  // Below the guards, so neither of these needs a fallback for a workspace or a
  // diff that the rows calling them could not have been drawn without.
  const isCollapsed = (file: FileDiff): boolean =>
    choices.get(file.path) ?? file.added + file.removed > AUTO_COLLAPSE_LINES

  const setAll = (collapsed: boolean): void => {
    setChoices(new Map(diff.files.map((file) => [file.path, collapsed])))
  }

  const openFile = (path: string): void => {
    void window.octopus.files.open(workspace.id, path)
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {sample}
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <span className="text-ink text-[11px] font-medium">
          {t('diff.fileCount', { count: diff.files.length })}
        </span>
        <span className="font-mono text-[11px]">
          {diff.added > 0 && <span className="text-success">+{diff.added}</span>}
          {diff.added > 0 && diff.removed > 0 && ' '}
          {diff.removed > 0 && <span className="text-danger">−{diff.removed}</span>}
        </span>
        <span
          className="text-ink-faint min-w-0 truncate font-mono text-[11px]"
          title={diff.baseCommit}
        >
          {t('diff.against', { branch: shortBranchName(diff.baseBranch) })}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t('diff.expandAll')}
            onClick={() => {
              setAll(false)
            }}
          >
            <ChevronsUpDown aria-hidden size={13} />
          </IconButton>
          <IconButton
            label={t('diff.collapseAll')}
            onClick={() => {
              setAll(true)
            }}
          >
            <ChevronsDownUp aria-hidden size={13} />
          </IconButton>
          <IconButton
            label={
              roomForSplit
                ? t(view === 'split' ? 'diff.unified' : 'diff.split')
                : t('diff.splitTooNarrow')
            }
            disabled={!roomForSplit}
            onClick={() => {
              onView(view === 'split' ? 'unified' : 'split')
            }}
          >
            {effectiveView === 'split' ? (
              <Rows3 aria-hidden size={13} />
            ) : (
              <Columns2 aria-hidden size={13} />
            )}
          </IconButton>
          <IconButton label={t('diff.refresh')} onClick={() => void refresh()}>
            <RefreshCw aria-hidden size={13} />
          </IconButton>
        </div>
      </div>

      {diff.omittedFiles > 0 && (
        <p className="text-ink-faint border-line shrink-0 border-b px-3 py-1 text-[11px]">
          {t('diff.omittedFiles', { count: diff.omittedFiles })}
        </p>
      )}

      {/* The only scroll container in here: sticky headers stop working the
          moment an ancestor between them and the scroller hides its overflow. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {diff.files.map((file) => (
          <DiffFile
            key={file.path}
            file={file}
            collapsed={isCollapsed(file)}
            onToggle={() => {
              setChoices(new Map(choices).set(file.path, !isCollapsed(file)))
            }}
            view={effectiveView}
            onOpen={openFile}
          />
        ))}
      </div>
    </div>
  )
}

function Notice({
  children,
  tone = 'soft'
}: {
  readonly children: React.ReactNode
  readonly tone?: 'soft' | 'danger'
}): React.JSX.Element {
  return (
    <div className="flex-1 overflow-auto p-4">
      <p className={`leading-relaxed ${tone === 'danger' ? 'text-danger' : 'text-ink-faint'}`}>
        {children}
      </p>
    </div>
  )
}

function IconButton({
  label,
  onClick,
  disabled = false,
  children
}: {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="focus-ring text-ink-faint hover:text-ink hover:bg-muted rounded-[var(--radius-control)] p-1 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/**
 * How wide the pane must be before two columns are worth offering.
 *
 * Measured from a sample of the real face rather than chosen, the way
 * `RightPanel.measureTabs` measures its own floor. Read once the pane is on
 * screen: an element in a hidden subtree measures zero, and a threshold of
 * zero would offer two columns at any width.
 */
function useSplitThreshold(ready: boolean): {
  readonly threshold: number
  readonly sample: React.JSX.Element
} {
  const element = useRef<HTMLSpanElement>(null)
  const [threshold, setThreshold] = useState(Number.POSITIVE_INFINITY)

  useEffect(() => {
    const node = element.current
    if (!ready || !node) return

    const cell = node.getBoundingClientRect().width / MIN_SPLIT_COLUMNS
    // jsdom measures every box as zero, and so would a face that has not
    // loaded. A cell of zero would put the threshold at zero and offer two
    // columns in a pane with room for none.
    if (cell > 0) setThreshold(splitThreshold(cell, GUTTER_AND_SIGN_PX))
  }, [ready])

  return {
    threshold,
    sample: (
      <span
        ref={element}
        aria-hidden
        className="pointer-events-none absolute -z-10 font-mono text-[11px] opacity-0"
      >
        {'0'.repeat(MIN_SPLIT_COLUMNS)}
      </span>
    )
  }
}

/** The line-number gutter plus the sign column, from the classes that draw them. */
const GUTTER_AND_SIGN_PX = 56
