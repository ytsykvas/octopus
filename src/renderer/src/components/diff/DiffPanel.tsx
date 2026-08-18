import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  MessageSquarePlus,
  RefreshCw,
  Rows3
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileDiff } from '@core/diff.js'
import { shortBranchName } from '@core/branches.js'
import type { WorkspaceView } from '@core/workspaces.js'

import {
  anchorKey,
  type CommentAnchor,
  type DiffCommentController
} from '../../hooks/useDiffComments.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { useWorkspaceDiff } from '../../hooks/useWorkspaceDiff.js'
import { DiffFile } from './DiffFile.js'
import type { DiffView } from './DiffHunk.js'
import { MIN_SPLIT_COLUMNS, splitThreshold } from './measure.js'
import { lineAddress, selectionAnchor } from './selectionAnchor.js'
import { NO_TOKENS, useHighlighting } from './useHighlighting.js'

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
  /** Review notes waiting to go out with the next message. */
  readonly comments: DiffCommentController
  /** Says what went wrong where the window already says such things. */
  readonly onError: (message: string) => void
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
  width,
  comments,
  onError
}: DiffPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const { diff, loading, error, refresh } = useWorkspaceDiff(workspace?.id ?? null, visible)
  // Measured only once there is a diff on screen: the sample lives in that
  // tree, and an element in a hidden subtree measures zero.
  const tokens = useHighlighting(diff)
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
  /** Where the open note sits; one at a time across the whole pane. */
  const [editing, setEditing] = useState<CommentAnchor | null>(null)
  const [selected, setSelected] = useState<Passage | null>(null)
  const [shownId, setShownId] = useState(workspace?.id ?? null)

  /** The only scroll container in the pane, and what a selection is read from. */
  const scroller = useRef<HTMLDivElement>(null)

  /*
   * Every line by where it is, so a note can quote the passage it covers.
   *
   * Read out of the model rather than off the screen. `shown` replaces
   * invisible characters with visible `U+202E` badges, so the text in the DOM
   * is deliberately not the text in the file — quoting that would send the
   * agent a line the file does not contain.
   *
   * A context line is in here twice, once per side: it belongs to both files
   * and carries a different number in each.
   */
  const lines = useMemo(() => {
    const byAddress = new Map<string, string>()

    for (const file of diff?.files ?? [])
      for (const hunk of file.hunks)
        for (const line of hunk.lines) {
          if (line.oldNumber !== null)
            byAddress.set(lineAddress(file.path, 'old', line.oldNumber), line.text)
          if (line.newNumber !== null)
            byAddress.set(lineAddress(file.path, 'new', line.newNumber), line.text)
        }

    return byAddress
  }, [diff])

  /*
   * What the reader has selected, watched rather than asked for.
   *
   * `selectionchange` on the document is the only event that fires for every
   * way a selection can be made — dragged, double-clicked, extended with the
   * keyboard — and the scroll listener beside it re-reads the rectangle rather
   * than closing, because the range lives in the document and moves with it.
   */
  useEffect(() => {
    const node = scroller.current
    if (!node) return

    const read = (): void => {
      setSelected(passageIn(node, window.getSelection()))
    }

    document.addEventListener('selectionchange', read)
    node.addEventListener('scroll', read)

    return () => {
      document.removeEventListener('selectionchange', read)
      node.removeEventListener('scroll', read)
    }
  }, [diff])

  /*
   * The three things a file row is handed that are not plain data.
   *
   * Built here, above the guards, and held steady across renders. `DiffFile` is
   * memoised — see the comment on it — and memoisation compares props by
   * identity, so a handler rebuilt each render would defeat it entirely and put
   * the whole pane back to redrawing on every colour and every pointer move of
   * a drag.
   *
   * That is also why they are no longer written below the guards, where a
   * workspace and a diff are known to exist. A hook cannot go there.
   */
  const toggleFile = useCallback((path: string, collapsed: boolean) => {
    setChoices((current) => new Map(current).set(path, collapsed))
  }, [])

  /*
   * Which workspace the rows belong to, kept where a steady handler can read it.
   *
   * `openFile` must not close over the workspace: it would then change with it,
   * which is right, and with everything else that renders this pane, which is
   * not. The guards below are what decide whether any row is drawn, so by the
   * time a click arrives this has been set.
   */
  const openIn = useRef('')
  useEffect(() => {
    openIn.current = workspace?.id ?? ''
  }, [workspace])

  const openFile = useCallback(
    (path: string) => {
      void (async () => {
        const result = await window.octopus.files.open(openIn.current, path)
        // The main process goes to the trouble of reporting what the system
        // said; throwing that away leaves a click that opened nothing looking
        // like one that worked (§13).
        if (!result.ok) onError(describeFailure(result))
      })()
    },
    [onError, describeFailure]
  )

  /*
   * The note being typed, and the place it belongs to.
   *
   * A ref rather than state, and that is the whole reason it is written this
   * way: the surface below is memoised so a memoised file row can tell nothing
   * about it moved, and a draft kept in state would rebuild it on every
   * keystroke — redrawing every file in the diff per character typed.
   *
   * The anchor rides along so a draft is never handed to a different note. It
   * is cleared when the editor closes, whichever way it closes.
   */
  const draft = useRef<{ anchor: CommentAnchor; text: string } | null>(null)

  const readDraft = useCallback(
    (anchor: CommentAnchor) =>
      draft.current !== null && anchorKey(draft.current.anchor) === anchorKey(anchor)
        ? draft.current.text
        : null,
    []
  )

  const onDraft = useCallback((anchor: CommentAnchor, text: string) => {
    draft.current = { anchor, text }
  }, [])

  const { add, remove, pending } = comments
  const surface = useMemo(
    () => ({
      pending,
      editing,
      readDraft,
      onDraft,
      onEdit: (anchor: CommentAnchor | null) => {
        // Closing or moving the editor ends the draft. Kept, it would be
        // offered to whichever note was opened next.
        draft.current = null
        setEditing(anchor)
      },
      // The quote is put together here rather than in the row: a note may cover
      // more lines than the row it is shown against, and this is what holds them.
      onSave: (anchor: CommentAnchor, text: string) => {
        draft.current = null
        add({ ...anchor, code: quote(lines, anchor), text })
      },
      onRemove: remove
    }),
    [pending, editing, add, remove, lines, readDraft, onDraft]
  )

  if ((workspace?.id ?? null) !== shownId) {
    setShownId(workspace?.id ?? null)
    setChoices(new Map())
    setEditing(null)
    setSelected(null)
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        {diff.files.map((file) => (
          <DiffFile
            key={file.path}
            file={file}
            collapsed={isCollapsed(file)}
            onToggle={toggleFile}
            view={effectiveView}
            tokens={tokens.get(file.path) ?? NO_TOKENS}
            comments={surface}
            onOpen={openFile}
          />
        ))}
      </div>

      {/* Floating at the selection rather than waiting in the gutter, because
          what it acts on is the selection: a control somewhere else would leave
          the reader to check that it means the passage they just dragged over.
          It goes as soon as the selection does. */}
      {selected && (
        <button
          type="button"
          onClick={() => {
            setEditing(selected.anchor)
            setSelected(null)
          }}
          aria-label={t('diff.askSelection')}
          style={{ top: selected.top - SELECTION_BUTTON_GAP, left: selected.left }}
          className="focus-ring bg-surface border-line text-ink-soft hover:text-accent fixed z-40 -translate-x-1/2 rounded-[var(--radius-control)] border p-1 shadow-[var(--shadow-pop)]"
        >
          <MessageSquarePlus aria-hidden size={13} />
        </button>
      )}
    </div>
  )
}

/** A selection, reduced to the note it would make and where to offer it. */
interface Passage {
  readonly anchor: CommentAnchor
  /** Window coordinates of the top of the selection, and its middle. */
  readonly top: number
  readonly left: number
}

/** Clear of the text, so the button does not sit on what was selected. */
const SELECTION_BUTTON_GAP = 30

/**
 * What is selected inside the pane, or null when that is nothing it can use.
 *
 * The rows carry their own address, so the work is finding which of them the
 * range touches — `intersectsNode` rather than arithmetic on offsets, since the
 * text is split into however many spans the highlighter produced and a
 * selection may begin and end inside different ones.
 */
function passageIn(container: HTMLElement, selection: Selection | null): Passage | null {
  // Collapsed covers a cleared selection as well as a plain click: with no
  // ranges left there is nothing to be at either end of.
  if (selection === null || selection.isCollapsed) return null

  const range = selection.getRangeAt(0)

  const anchor = selectionAnchor(
    [...container.querySelectorAll('[data-line]')]
      .filter((span) => range.intersectsNode(span))
      .map((span) => span.getAttribute('data-line'))
      .filter((address) => address !== null)
  )

  if (anchor === null) return null

  const rect = range.getBoundingClientRect()
  return { anchor, top: rect.top, left: rect.left + rect.width / 2 }
}

/**
 * The lines a note covers, as they read when it was written.
 *
 * Lines the diff does not show are skipped rather than left as gaps: a range
 * can span the space between two hunks, and quoting a blank for code nobody
 * changed would tell the agent the file has one.
 */
function quote(lines: ReadonlyMap<string, string>, anchor: CommentAnchor): string {
  const covered: string[] = []

  for (let line = anchor.line; line <= anchor.endLine; line++) {
    const text = lines.get(lineAddress(anchor.path, anchor.side, line))
    if (text !== undefined) covered.push(text)
  }

  return covered.join('\n')
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
        className="pointer-events-none absolute -z-10 font-mono text-[11px] opacity-0 select-none"
      >
        {'0'.repeat(MIN_SPLIT_COLUMNS)}
      </span>
    )
  }
}

/** The line-number gutter plus the sign column, from the classes that draw them. */
const GUTTER_AND_SIGN_PX = 56
