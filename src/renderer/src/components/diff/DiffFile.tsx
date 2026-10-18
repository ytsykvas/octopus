import { CloudAlert, Copy, ExternalLink, MoreHorizontal, TriangleAlert, Undo2 } from 'lucide-react'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileDiff, FileStatus } from '@core/diff.js'
import type { PublishState } from '@core/publish.js'

import { DisclosureButton } from '../Disclosure.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { FILE_STATUS_MARKS } from '../statusMarks.js'
import { type DiffView, DiffHunk } from './DiffHunk.js'
import type { CommentSurface } from './CommentedRow.js'
import { fileHasInvisible } from './invisible.js'
import { shown } from './shown.js'
import type { Highlighting } from './useHighlighting.js'

/**
 * The badge, written the same way as the marks above and for the same reason.
 *
 * `reached` is how many of the three rungs are filled: written, committed,
 * pushed. A ladder rather than three unrelated icons, because the states are
 * ordered — a file only ever moves up it — and the picture says which way is
 * forward without anybody having to learn a legend.
 */
interface PublishMark {
  readonly word: 'diff.publishUncommitted' | 'diff.publishCommitted' | 'diff.publishPushed'
  readonly label:
    'diff.publishUncommittedLabel' | 'diff.publishCommittedLabel' | 'diff.publishPushedLabel'
  readonly tone: string
  readonly reached: number
}

const PUBLISH_KEYS: Record<PublishState, PublishMark> = {
  uncommitted: {
    word: 'diff.publishUncommitted',
    label: 'diff.publishUncommittedLabel',
    tone: 'text-warning',
    reached: 1
  },
  committed: {
    word: 'diff.publishCommitted',
    label: 'diff.publishCommittedLabel',
    tone: 'text-info',
    reached: 2
  },
  pushed: {
    word: 'diff.publishPushed',
    label: 'diff.publishPushedLabel',
    tone: 'text-ink-faint',
    reached: 3
  }
}

/**
 * What happened to a file, drawn on its name instead of as a letter.
 *
 * The letter column now holds the rung, so the kind of change moves onto the
 * name, the way an editor's file list draws it: a new file's name is green, a
 * deleted one is struck through in red, and everything else stays plain. A
 * rename says what it was renamed from under the header, and a change of mode
 * says so there too, so neither needs a colour of its own.
 *
 * Only two of the seven are coloured on purpose. The counts beside the name
 * already tell a new file (only `+`) and a deleted one (only `−`) from the
 * rest, and a colour per status is the confetti this pane is trying to stop
 * being. The words are in the tooltip and read out to a screen reader.
 */
const NAME_STYLES: Record<FileStatus, { readonly directory: string; readonly base: string }> = {
  added: { directory: 'text-ink-faint', base: 'text-success' },
  untracked: { directory: 'text-ink-faint', base: 'text-success' },
  deleted: { directory: 'text-danger line-through', base: 'text-danger line-through' },
  modified: { directory: 'text-ink-faint', base: 'text-ink' },
  renamed: { directory: 'text-ink-faint', base: 'text-ink' },
  copied: { directory: 'text-ink-faint', base: 'text-ink' },
  typeChanged: { directory: 'text-ink-faint', base: 'text-ink' }
}

/** The rungs, as a constant so the map below builds no array per render. */
const RUNGS = [1, 2, 3] as const

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
  /**
   * Which conversations wrote this file, named as the tab strip names them.
   *
   * Empty where nobody here did — a file the reader edited by hand, or one
   * written before this was recorded — and empty for a workspace holding one
   * conversation, where there is nothing to tell apart. A mark on every row
   * saying the same thing is noise, and the question only exists with several.
   */
  readonly writers: readonly string[]
  /**
   * Whether to draw where this file stands against the remote.
   *
   * False when every file in the pane is in the same place — the same rule the
   * writers mark keeps above: a mark on every row saying the same thing is
   * noise, and the strip at the top of the pane says it once instead.
   */
  readonly showPublish: boolean
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
/**
 * Where one file stands against the remote, as a filled ladder.
 *
 * On the strip at the top of the pane it carries a count and a word, which is
 * what makes the strip the legend. On a row it is the dots alone, in the place
 * a status letter used to take: the word on every row was a second line per
 * file saying the same thing twenty times down the column. The fuller sentence
 * is the tooltip either way.
 *
 * One component for both, so the two can never disagree about a colour.
 */
export function PublishBadge({
  state,
  count
}: {
  readonly state: PublishState
  /** How many files are here, for the strip at the top; absent on a row. */
  readonly count?: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const mark = PUBLISH_KEYS[state]

  return (
    <span
      className={`flex shrink-0 items-center gap-1.5 text-[11px] ${mark.tone}`}
      title={t(mark.label)}
    >
      <span aria-hidden className="flex items-center gap-[2px]">
        {RUNGS.map((rung) => (
          <span
            key={rung}
            /* `bg-current` and `border-current`, so the tone is set once on the
               wrapper and the two kinds of dot cannot drift apart. */
            className={`size-[5px] rounded-full ${
              rung <= mark.reached ? 'bg-current' : 'border-current border opacity-50'
            }`}
          />
        ))}
      </span>
      {count !== undefined && t('diff.publishCount', { count, state: t(mark.word) })}
    </span>
  )
}

/**
 * What a change of mode says in words.
 *
 * The executable bit is named rather than spelled, because it is the one that
 * matters here: `scripts.ts` and `repoConfig.ts` chmod to 0755 precisely so
 * octopus can execute those files, and a script without the bit fails outright.
 * Anything else — a file becoming a symlink, a gitlink — is rare enough that
 * the two octal modes are the clearest thing to show, and it also makes a `T`
 * row say what it changed into.
 */
function modeKey(mode: {
  readonly from: string
  readonly to: string
}): 'diff.modeExecutable' | 'diff.modeNotExecutable' | 'diff.modeChanged' {
  if (mode.from === '100644' && mode.to === '100755') return 'diff.modeExecutable'
  if (mode.from === '100755' && mode.to === '100644') return 'diff.modeNotExecutable'

  return 'diff.modeChanged'
}

export const DiffFile = memo(function DiffFile({
  file,
  collapsed,
  view,
  tokens,
  comments,
  onToggle,
  onRevert,
  onOpen,
  writers,
  showPublish
}: DiffFileProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<Copied>('idle')

  const status = FILE_STATUS_MARKS[file.status]
  const nameStyle = NAME_STYLES[file.status]

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
      <div className="bg-surface border-line sticky top-0 z-10 border-b px-2 py-1.5">
        <div className="flex items-center gap-2">
          <DisclosureButton
            open={!collapsed}
            onOpenChange={(open) => {
              onToggle(file.path, !open)
            }}
            // The path rather than the whole header: what is drawn inside is
            // dots and two counts that read as noise when spoken one after
            // another, and the path is what identifies the row.
            label={file.path}
            className="focus-ring row flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-left"
          >
            {/* Where the status letter used to be. The letter is gone from this
                tab: what happened to the file is on its name below, and the
                Ukrainian `З` for "changed" read as the digit 3 in front of a
                path. False when every file is in the same place — the strip
                at the top says it once instead. */}
            {showPublish && <PublishBadge state={file.publish} />}
            {/* The directory is what gives way. Truncating the whole path cut the
              filename off the end — the one part that identifies the row — so
              the two are separate boxes and only the leading one shrinks. */}
            {/* The path goes through `shown` for the same reason the lines do:
              it is drawn from the same bytes and reorders the same way, and a
              name that reads as an image while ending in `.js` is the version
              of this that costs a reviewer a click rather than a line. */}
            <span
              className="flex min-w-0 font-mono text-[11px]"
              title={t('diff.pathWithStatus', { status: t(status.label), path: file.path })}
            >
              <span className={`truncate ${nameStyle.directory}`}>
                {shown(directoryOf(file.path))}
              </span>
              <span className={`shrink-0 ${nameStyle.base}`}>{shown(basenameOf(file.path))}</span>
            </span>
            <span className="ml-auto shrink-0 font-mono text-[11px]">
              {file.added > 0 && <span className="text-success">+{file.added}</span>}
              {file.added > 0 && file.removed > 0 && ' '}
              {file.removed > 0 && <span className="text-danger">−{file.removed}</span>}
            </span>
          </DisclosureButton>

          {/* Who wrote it, when more than one conversation could have.
            Outside the button for the reason the warning below it is: the
            button's accessible name is the path, and a label nested in one is
            a label nobody hears. */}
          {writers.length > 0 && (
            <span
              /* Bounded: the pane is 360px by default and three named
               conversations would otherwise take the row from the path, which
               is what identifies it. The whole list is in the tooltip. */
              className="text-ink-faint max-w-24 shrink-0 truncate text-[11px]"
              title={t('diff.writtenBy', { names: writers.join(', ') })}
            >
              {writers.join(', ')}
            </span>
          )}

          {/* Outside the button rather than inside it: the button already
            carries the path as its whole accessible name, and a label nested
            in one is a label nobody hears. Said on the header as well as in
            the line because every file starts collapsed, and a line nobody
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

          {/* Marked up like the invisible-characters warning above, and
              outside the button for the same reason. Kept to the rows that
              draw their rung: both are claims about GitHub. */}
          {showPublish && file.staleOnRemote && (
            <span
              role="img"
              aria-label={t('diff.publishStale')}
              title={t('diff.publishStale')}
              className="text-danger shrink-0"
            >
              <CloudAlert aria-hidden size={12} />
            </span>
          )}

          {/* What the dots and the colour of the name say, in words, for a
              screen reader. Outside the button, whose accessible name is the
              path alone, because a label nested in it is not heard. */}
          <span className="sr-only">
            {showPublish
              ? t('diff.fileState', {
                  status: t(status.label),
                  stage: t(PUBLISH_KEYS[file.publish].word)
                })
              : t(status.label)}
          </span>

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
      </div>

      {file.oldPath !== null && !collapsed && (
        <p className="text-ink-faint px-3 py-1 font-mono text-[11px]">
          {t('diff.renamedFrom', { path: file.oldPath })}
        </p>
      )}

      {/* Beside the rename line and for the same reason: a permission change
          has no lines by construction, so without this the row was a chevron,
          an `M`, a path and a revert control — a live file that changed
          nothing. It is drawn for a file with hunks too, where the counts and
          the body otherwise made the row look completely explained. */}
      {file.mode !== null && !collapsed && (
        <p className="text-ink-faint px-3 py-1 font-mono text-[11px]">
          {t(modeKey(file.mode), { from: file.mode.from, to: file.mode.to })}
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
