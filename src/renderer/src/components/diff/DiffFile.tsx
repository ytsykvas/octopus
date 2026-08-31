import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  MoreHorizontal,
  TriangleAlert,
  Undo2
} from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileDiff, FileStatus } from '@core/diff.js'

import { DropdownMenu } from '../DropdownMenu.js'
import { type DiffView, DiffHunk } from './DiffHunk.js'
import type { CommentSurface } from './CommentedRow.js'
import { fileHasInvisible } from './invisible.js'
import { shown } from './shown.js'
import type { Highlighting } from './useHighlighting.js'

/**
 * The letter in a file's header, and the word it stands for.
 *
 * Both keys are written out rather than built from the status: `t` is typed
 * against the locale, and a key assembled at runtime is a string it cannot
 * check — which is the whole point of typing the locales against each other.
 */
interface StatusMark {
  readonly letter:
    | 'diff.statusAdded'
    | 'diff.statusModified'
    | 'diff.statusDeleted'
    | 'diff.statusRenamed'
    | 'diff.statusCopied'
    | 'diff.statusTypeChanged'
    | 'diff.statusUntracked'
  readonly label:
    | 'diff.statusAddedLabel'
    | 'diff.statusModifiedLabel'
    | 'diff.statusDeletedLabel'
    | 'diff.statusRenamedLabel'
    | 'diff.statusCopiedLabel'
    | 'diff.statusTypeChangedLabel'
    | 'diff.statusUntrackedLabel'
  readonly tone: string
}

const STATUS_KEYS: Record<FileStatus, StatusMark> = {
  added: { letter: 'diff.statusAdded', label: 'diff.statusAddedLabel', tone: 'text-success' },
  modified: { letter: 'diff.statusModified', label: 'diff.statusModifiedLabel', tone: 'text-info' },
  deleted: { letter: 'diff.statusDeleted', label: 'diff.statusDeletedLabel', tone: 'text-danger' },
  renamed: { letter: 'diff.statusRenamed', label: 'diff.statusRenamedLabel', tone: 'text-info' },
  copied: { letter: 'diff.statusCopied', label: 'diff.statusCopiedLabel', tone: 'text-info' },
  typeChanged: {
    letter: 'diff.statusTypeChanged',
    label: 'diff.statusTypeChangedLabel',
    tone: 'text-warning'
  },
  untracked: {
    letter: 'diff.statusUntracked',
    label: 'diff.statusUntrackedLabel',
    tone: 'text-success'
  }
}

/** How long the menu reports what copying did before offering it again. */
const SETTLE_MS = 2000

/** What the last attempt did, which is all the row has to say about it. */
type Copied = 'idle' | 'done' | 'failed'

const COPY_LABELS: Record<Copied, 'diff.copyPath' | 'diff.copied' | 'diff.copyFailed'> = {
  idle: 'diff.copyPath',
  done: 'diff.copied',
  failed: 'diff.copyFailed'
}

interface DiffFileProps {
  readonly file: FileDiff
  readonly collapsed: boolean
  readonly view: DiffView
  readonly tokens: Highlighting
  readonly comments: CommentSurface
  /**
   * Folds this file away, or opens it.
   *
   * Takes the path and the state to move to rather than closing over them, so
   * one function serves every row: a handler built per file would change
   * identity on every render and leave `memo` below nothing to compare.
   */
  readonly onToggle: (path: string, collapsed: boolean) => void
  /**
   * Puts this file back to the state the workspace branched from.
   *
   * Given the file rather than its path alone: a rename is one row here and
   * two paths on disk, and reverting only the one the row is filed under would
   * leave the file present twice.
   */
  readonly onRevert: (file: FileDiff) => void
  readonly onOpen: (path: string) => void
}

/**
 * One changed file: a header that stays in view, and the lines under it.
 *
 * The header is sticky rather than fixed, so several of them stack as the pane
 * scrolls and the file being read always names itself — the behaviour a long
 * review depends on, and one the browser gives for nothing as long as no
 * ancestor between here and the scroller hides its overflow.
 *
 * Memoised, which is the one thing standing between this pane and being
 * pleasant on a large change. Colours arrive a file at a time and the pane's
 * width changes on every pointer move of a drag; without this, each of those
 * redrew every file, every hunk and every row. That was waste while the diff
 * was only read — and it misbehaves now that a note covers a selection, because
 * a redraw drops the passage the reader was dragging over and takes the button
 * that acts on it with them.
 *
 * It only works while every prop keeps its identity between renders, which is
 * what `DiffPanel` goes to some trouble over. A handler rebuilt per render
 * would quietly turn this back into what it was.
 */
export const DiffFile = memo(function DiffFile({
  file,
  collapsed,
  view,
  tokens,
  comments,
  onToggle,
  onRevert,
  onOpen
}: DiffFileProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<Copied>('idle')

  const status = STATUS_KEYS[file.status]
  const Chevron = collapsed ? ChevronRight : ChevronDown

  // Back to offering the action on its own, and cleared on the way out: a row
  // still claiming a copy happened is describing a clipboard that has moved on,
  // and a timer outliving the row it belongs to is one nobody can cancel.
  useEffect(() => {
    if (copied === 'idle') return

    const timer = setTimeout(() => {
      setCopied('idle')
    }, SETTLE_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [copied])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(file.path)
      setCopied('done')
    } catch {
      // A refused clipboard is real — an unfocused document is enough — and an
      // action that quietly did nothing is worse than one that says so.
      setCopied('failed')
    }
  }

  return (
    <div className="border-line border-b">
      <div className="bg-surface border-line sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={() => {
            onToggle(file.path, !collapsed)
          }}
          aria-expanded={!collapsed}
          // The path rather than the whole header: what is drawn inside is a
          // status letter and two counts that read as noise when spoken one
          // after another, and the path is what identifies the row.
          aria-label={file.path}
          className="focus-ring row flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-left"
        >
          <Chevron aria-hidden className="text-ink-faint shrink-0" size={12} />
          <span className={`shrink-0 font-mono text-[11px] ${status.tone}`} title={t(status.label)}>
            {t(status.letter)}
          </span>
          {/* The directory is what gives way. Truncating the whole path cut the
              filename off the end — the one part that identifies the row — so
              the two are separate boxes and only the leading one shrinks. */}
          {/* The path goes through `shown` for the same reason the lines do:
              it is drawn from the same bytes and reorders the same way, and a
              name that reads as an image while ending in `.js` is the version
              of this that costs a reviewer a click rather than a line. */}
          <span className="flex min-w-0 font-mono text-[11px]" title={file.path}>
            <span className="text-ink-faint truncate">{shown(directoryOf(file.path))}</span>
            <span className="text-ink shrink-0">{shown(basenameOf(file.path))}</span>
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px]">
            {file.added > 0 && <span className="text-success">+{file.added}</span>}
            {file.added > 0 && file.removed > 0 && ' '}
            {file.removed > 0 && <span className="text-danger">−{file.removed}</span>}
          </span>
        </button>

        {/* Outside the button rather than inside it: the button already
            carries the path as its whole accessible name, and a label nested
            in one is a label nobody hears. Said on the header as well as in
            the line because a large file starts collapsed, and a line nobody
            has looked at is the one most likely to be approved unread. */}
        {fileHasInvisible(file) && (
          <span
            role="img"
            aria-label={t('diff.invisibleCharacters')}
            title={t('diff.invisibleCharacters')}
            className="text-warning shrink-0"
          >
            <TriangleAlert aria-hidden size={12} />
          </span>
        )}

        {/* Named after the file rather than "Revert": twenty buttons sharing
            one name identify nothing, and this is the row's only destructive
            control. Outside the collapse button for the same reason the mark
            above is — that button already owns the whole row as its name. */}
        <button
          type="button"
          onClick={() => {
            onRevert(file)
          }}
          aria-label={t('diff.revertFile', { path: file.path })}
          title={t('diff.revert')}
          className="focus-ring text-ink-faint hover:text-danger shrink-0 rounded-[var(--radius-control)] p-0.5 transition-colors"
        >
          <Undo2 aria-hidden size={12} />
        </button>

        <DropdownMenu
          align="right"
          actions={[
            {
              id: 'copy',
              label: t(COPY_LABELS[copied]),
              icon: <Copy aria-hidden size={14} />,
              onSelect: () => void copy()
            },
            {
              id: 'open',
              label: t('diff.openFile'),
              icon: <ExternalLink aria-hidden size={14} />,
              onSelect: () => {
                onOpen(file.path)
              }
            }
          ]}
          trigger={({ onClick }) => (
            <button
              type="button"
              onClick={onClick}
              aria-label={t('diff.fileActions', { path: file.path })}
              className="focus-ring text-ink-faint hover:text-ink hover:bg-muted shrink-0 rounded-[var(--radius-control)] p-1"
            >
              <MoreHorizontal aria-hidden size={14} />
            </button>
          )}
        />
      </div>

      {file.oldPath !== null && !collapsed && (
        <p className="text-ink-faint px-3 py-1 font-mono text-[11px]">
          {t('diff.renamedFrom', { path: file.oldPath })}
        </p>
      )}

      {!collapsed && <DiffBody file={file} view={view} tokens={tokens} comments={comments} />}
    </div>
  )
})

function DiffBody({
  file,
  view,
  tokens,
  comments
}: {
  readonly file: FileDiff
  readonly view: DiffView
  readonly tokens: Highlighting
  readonly comments: CommentSurface
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (file.omitted === 'binary') {
    return <p className="text-ink-soft px-3 py-2">{t('diff.binary')}</p>
  }

  if (file.omitted === 'tooLarge') {
    return <p className="text-ink-soft px-3 py-2">{t('diff.tooLarge')}</p>
  }

  // A rename with nothing else changed has no lines by construction; the
  // header above has already said everything there is to say about it.
  if (file.hunks.length === 0) return null

  return (
    <div>
      {file.hunks.map((hunk, index) => (
        <DiffHunk
          key={index}
          hunk={hunk}
          view={view}
          tokens={tokens}
          path={file.path}
          comments={comments}
        />
      ))}
    </div>
  )
}

/** Everything up to and including the last separator, or nothing. */
function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut + 1)
}

function basenameOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}
