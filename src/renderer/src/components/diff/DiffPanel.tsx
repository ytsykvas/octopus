import {
  ChevronsDownUp,
  ChevronsUpDown,
  Columns2,
  MessageSquarePlus,
  RefreshCw,
  Rows3,
  Upload
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileDiff } from '@core/diff.js'
import { shortBranchName } from '@core/branches.js'
import { AGENT_NAMES } from '@core/chats.js'
import type { PublishState } from '@core/publish.js'
import type { WorkspaceView } from '@core/workspaces.js'

import {
  anchorKey,
  type CommentAnchor,
  type DiffCommentController
} from '../../hooks/useDiffComments.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import type { FileRevertController } from '../../hooks/useFileRevert.js'
import { useWorkspaceDiff } from '../../hooks/useWorkspaceDiff.js'
import { Button } from '../Button.js'
import { DiffFile, PublishBadge } from './DiffFile.js'
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

/**
 * The order the pane lists files in: least left to do first.
 *
 * Settled work at the top and the work still in hand at the bottom, so the
 * bottom of the column is where the reader's own attention belongs. A
 * presentation decision, so it lives here rather than in `publish.ts` — and a
 * **stable** sort by it, which keeps git's own order inside each rung and means
 * a file only ever moves when its state actually changes.
 */
const PUBLISH_ORDER: readonly PublishState[] = ['pushed', 'committed', 'uncommitted']

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
  /** Puts one file back to the state the workspace branched from. */
  readonly revert: FileRevertController
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
  revert,
  onError
}: DiffPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const { diff, sides, loading, error, refresh } = useWorkspaceDiff(workspace?.id ?? null, visible)
  // Measured only once there is a diff on screen: the sample lives in that
  // tree, and an element in a hidden subtree measures zero.
  const tokens = useHighlighting(diff, sides)
  const { threshold, sample } = useSplitThreshold(visible && (diff?.files.length ?? 0) > 0)

  /*
   * What is drawn, as against what was asked for.
   *
   * The stored preference is never overwritten by the pane being too narrow:
   * dragging it wide again should bring back the two columns rather than
   * having silently forgotten them.
   */
  /*
   * The one conversation whose work the reader has narrowed the list to.
   *
   * A workspace holds up to three conversations working at once in one
   * worktree, and this pane shows their work merged into a single diff. "The
   * agent changed this" was unambiguous while there was one agent per worktree;
   * reviewing needs to know who did what, and the record is on the workspace
   * because only the service sees the edits as they land.
   *
   * Not stored: it is a way of reading the list now, not a preference, and one
   * kept across a restart would draw a short list with no memory of why.
   */
  const [chosenWriter, setChosenWriter] = useState<string | null>(null)

  /**
   * The workspace a push is in flight for, rather than a bare boolean.
   *
   * This pane is never remounted when the workspace changes — `RightPanel`
   * renders it without a `key` — so a boolean stayed true across the switch and
   * the next workspace drew a disabled "Pushing…" for a push that was not
   * happening in it. Carrying the id makes the state answer for itself instead
   * of relying on a reset staying in step with it.
   */
  const [pushingIn, setPushingIn] = useState<string | null>(null)

  /*
   * Who wrote what, worked out once per workspace rather than once per render.
   *
   * `DiffFile` is memoised on its props, so handing it a fresh array of names
   * every render redraws every file on every render — which is the thing the
   * memo exists to prevent, and it caught this.
   */
  const chats = workspace?.chats ?? NO_CHATS
  const writers = workspace?.writers ?? NO_RECORD

  const attribution = useMemo(() => {
    // Named exactly as the tab strip names them, so a mark here and a tab there
    // are recognisably the same conversation.
    const named = chats.map((chat, index) => ({
      id: chat.id,
      name: chat.title ?? t('chat.tab', { agent: AGENT_NAMES[chat.agent], number: index + 1 })
    }))

    /*
     * Nothing at all for a workspace holding one conversation: a mark on every
     * row saying the same name is noise, and the question does not exist until
     * there are two. Names are in tab order and only of conversations still
     * open — a closed one leaves its id behind in the record, and an id is not
     * a name.
     */
    const marks = new Map<string, readonly string[]>()
    if (named.length > 1) {
      for (const [path, ids] of Object.entries(writers)) {
        const wrote = new Set(ids)
        const names = named.filter((chat) => wrote.has(chat.id)).map((chat) => chat.name)
        if (names.length > 0) marks.set(path, names)
      }
    }

    return { named, marks }
  }, [chats, writers, t])

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
  /**
   * Steady, because `DiffFile` is memoised and every prop it is handed has to
   * be — an arrow written inline here is a new function on every render, which
   * redraws every file and every row on each pointer move of a width drag, and
   * a redraw drops a live text selection. That is the bug `DiffFileMemo.test`
   * was written about.
   *
   * `revert.revert` and `refresh` are both `useCallback`s, so this holds still
   * for as long as they do.
   */
  const revertFile = useCallback(
    (file: FileDiff) => {
      void (async () => {
        // Only re-read when something moved: a reader who said no has changed
        // nothing, and a refusal has already been reported.
        if (await revert.revert(file.path, file.oldPath)) await refresh()
      })()
    },
    [revert, refresh]
  )

  /*
   * Sends what is committed, and reads the pane again either way.
   *
   * Committed work only: pushing does nothing about a file that has not been
   * committed, and a button here that quietly committed on the reader's behalf
   * would be choosing a commit message for them. The pull request pane is where
   * that decision is made, and it has a field for it.
   */
  const push = useCallback(() => {
    const workspaceId = openIn.current
    setPushingIn(workspaceId)

    void (async () => {
      const result = await window.octopus.workspaces.push(workspaceId)
      // Reported whichever workspace is on screen by now: the banner it goes to
      // belongs to the window, and a push that failed is worth saying wherever
      // the reader has got to.
      if (!result.ok) onError(describeFailure(result))

      /* But the reading is not. `refresh` is bound to the workspace that was
         open when the button was pressed, and it claims the hook's generation —
         so calling it after the reader has moved on replaces the workspace they
         are looking at with the file list of the one they left. */
      if (openIn.current !== workspaceId) return

      setPushingIn(null)
      // Re-read either way: a refusal leaves the branch where it was, and the
      // pane saying so from a fresh reading beats it saying so from memory.
      await refresh()
    })()
  }, [onError, describeFailure, refresh])

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

  const { named, marks } = attribution

  /* No strip where there is nothing to tell apart. The record can also name
     files this diff no longer has — one reverted, one whose change has landed
     on the base branch — and a strip offered over those is a control that
     empties the pane whichever chip is pressed. */
  const canFilter = diff.files.some((file) => marks.has(file.path))

  /* A filter belongs to the conversation it names and to the strip that offers
     it, so it ends with either. Switching workspace or closing a tab would
     otherwise leave the list narrowed to an id nothing here has: an empty pane
     with no chip pressed to explain it, and nothing to press to get out. */
  const only = canFilter && named.some((chat) => chat.id === chosenWriter) ? chosenWriter : null

  /* Sorted before the filter rather than after it, which is what keeps the
     promise below: the order is a fact about the files, pressing a chip is a
     way of reading them, and a chip that also reshuffled the list would leave
     the reader hunting for a row that had not changed. */
  const ordered = [...diff.files].sort(
    (left, right) => PUBLISH_ORDER.indexOf(left.publish) - PUBLISH_ORDER.indexOf(right.publish)
  )

  /* The filter narrows what is drawn and nothing else — in particular it does
     not reorder, so a file keeps the place the reader last saw it in. */
  const shownFiles =
    only === null
      ? ordered
      : ordered.filter((file) => (workspace.writers[file.path] ?? []).includes(only))

  /* How many files sit on each rung, for the strip below the header. Counted
     over the whole diff rather than over what a chip left on screen: the strip
     answers "where does this branch stand", which a filter does not change. */
  const counts: Record<PublishState, number> = { pushed: 0, committed: 0, uncommitted: 0 }
  for (const file of diff.files) counts[file.publish] += 1
  const stale = diff.files.filter((file) => file.staleOnRemote).length

  /* Nothing left to send: the one state where the strip alone says everything,
     and a mark on every row would repeat it. Every other state has something to
     act on, and the marks say which files.

     Read off the branch rather than counted from the rows. A change that nets
     out against the merge base — reverting a pushed file is one — leaves this
     list entirely while still being work the remote has not got, and counting
     `pushed` rows called that "everything is on GitHub" with the revert
     unsent. `publish.ts` answers it from the reads that can see it. */
  const allPushed = diff.nothingToSend

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

      {/* Where this branch stands against GitHub, and the one control that
          changes it. Below the header rather than in it: the header is already
          four buttons and a branch name at the pane's 280px floor, and this
          wraps to a second line rather than squeezing them. */}
      <div className="border-line flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-[11px]">
        {/* Nothing below this line is measured against the branch the workspace
            names while HEAD is standing somewhere else, so the strip says that
            instead of saying something else. Reusing "not on GitHub yet" would
            trade one false statement for another about a branch that may well
            be there. */}
        {!diff.headOnBranch && (
          <span className="text-warning">
            {t('diff.publishHeadElsewhere', { branch: shortBranchName(workspace.branch) })}
          </span>
        )}

        {diff.headOnBranch && allPushed && (
          <span className="text-ink-faint">{t('diff.publishAllSent')}</span>
        )}

        {diff.headOnBranch && !allPushed && (
          <>
            {/* The same three badges the rows carry, with a count each — which
                is what makes this strip the legend for them. */}
            {PUBLISH_ORDER.filter((state) => counts[state] > 0).map((state) => (
              <PublishBadge key={state} state={state} count={counts[state]} />
            ))}

            {stale > 0 && (
              <span className="text-danger">{t('diff.publishStaleCount', { count: stale })}</span>
            )}

            {/* Everything from here down is about GitHub, and a project is
                allowed to have no remote at all — a repository, a commit and a
                base branch is all `projects.ts` asks for. A permanent band
                about a service such a project has nothing to do with is one
                that can never come true and cannot be dismissed. */}
            {diff.hasRemote && (
              <>
                {diff.remoteCommit === null && (
                  <span className="text-ink-faint">{t('diff.publishNoRemote')}</span>
                )}

                {/* Three states, not two. `unpushedCommits` means different
                    things either side of a remote copy — commits ahead of the
                    base where there is none, commits ahead of the copy where
                    there is — so one sentence for zero told a pushed branch
                    that nothing was committed yet, beside its own "2 pushed". */}
                <span className="text-ink-faint ml-auto">
                  {diff.unpushedCommits > 0
                    ? t('diff.publishUnpushed', { count: diff.unpushedCommits })
                    : t(
                        diff.remoteCommit === null
                          ? 'diff.publishNothingToPush'
                          : 'diff.publishAllCommitsSent'
                      )}
                </span>

                {/* Offered only where it would do something. A disabled button
                    is one more thing to read past on a pane that is mostly
                    reading. */}
                {diff.unpushedCommits > 0 && (
                  <Button size="sm" onClick={push} disabled={pushingIn === workspace.id}>
                    <Upload aria-hidden size={12} />
                    {t(pushingIn === workspace.id ? 'diff.pushing' : 'diff.push')}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* A chip per conversation, and only where there are two to tell apart.
          It narrows the list rather than marking it: the marks on the headers
          already say who wrote what, and this answers the other question —
          "show me only what mine did". */}
      {canFilter && (
        <div
          role="group"
          aria-label={t('diff.writtenByAll')}
          className="border-line flex shrink-0 flex-wrap gap-1 border-b px-3 py-1.5"
        >
          <FilterChip
            label={t('diff.writtenByAll')}
            selected={only === null}
            onSelect={() => {
              setChosenWriter(null)
            }}
          />

          {named.map((chat) => (
            <FilterChip
              key={chat.id}
              label={chat.name}
              title={t('diff.writtenByFilter', { name: chat.name })}
              selected={only === chat.id}
              onSelect={() => {
                setChosenWriter(only === chat.id ? null : chat.id)
              }}
            />
          ))}
        </div>
      )}

      {diff.omittedFiles > 0 && (
        <p className="text-ink-faint border-line shrink-0 border-b px-3 py-1 text-[11px]">
          {t('diff.omittedFiles', { count: diff.omittedFiles })}
        </p>
      )}

      {/* The only scroll container in here: sticky headers stop working the
          moment an ancestor between them and the scroller hides its overflow. */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        {shownFiles.map((file) => (
          <DiffFile
            key={file.path}
            file={file}
            collapsed={isCollapsed(file)}
            onToggle={toggleFile}
            view={effectiveView}
            tokens={tokens.get(file.path) ?? NO_TOKENS}
            comments={surface}
            onOpen={openFile}
            onRevert={revertFile}
            writers={marks.get(file.path) ?? NO_WRITERS}
            showPublish={diff.headOnBranch && !allPushed}
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

/**
 * One conversation on the filter strip.
 *
 * A button rather than a tab: the strip does not switch between panels, it
 * narrows one list, and pressing the chosen one again clears it.
 */
function FilterChip({
  label,
  title,
  selected,
  onSelect
}: {
  readonly label: string
  readonly title?: string
  readonly selected: boolean
  readonly onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={title}
      onClick={onSelect}
      // The shape the usage card's spans already have, which is what a chosen
      // one of several looks like in this app.
      className={`focus-ring max-w-40 truncate rounded-[var(--radius-control)] px-2 py-0.5 text-[11px] transition-colors ${
        selected ? 'bg-muted text-ink' : 'text-ink-faint hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

/**
 * One shared empty list for the files nobody here wrote.
 *
 * `DiffFile` is memoised on its props, and `[]` is a new array every time.
 */
const NO_WRITERS: readonly string[] = []

/**
 * What a pane with no workspace reads instead.
 *
 * Shared constants rather than fresh literals, so the memo below them is keyed
 * on something that holds still while there is nothing to key on.
 */
const NO_CHATS: WorkspaceView['chats'] = []
const NO_RECORD: WorkspaceView['writers'] = {}
