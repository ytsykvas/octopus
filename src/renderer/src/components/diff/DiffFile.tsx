import { ChevronDown, ChevronRight, Copy, ExternalLink, MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { FileDiff, FileStatus } from '@core/diff.js'

import { DropdownMenu } from '../DropdownMenu.js'
import { DiffHunk } from './DiffHunk.js'

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

interface DiffFileProps {
  readonly file: FileDiff
  readonly collapsed: boolean
  readonly onToggle: () => void
  readonly onOpen: (path: string) => void
}

/**
 * One changed file: a header that stays in view, and the lines under it.
 *
 * The header is sticky rather than fixed, so several of them stack as the pane
 * scrolls and the file being read always names itself — the behaviour a long
 * review depends on, and one the browser gives for nothing as long as no
 * ancestor between here and the scroller hides its overflow.
 */
export function DiffFile({ file, collapsed, onToggle, onOpen }: DiffFileProps): React.JSX.Element {
  const { t } = useTranslation()
  const [copyFailed, setCopyFailed] = useState(false)

  const status = STATUS_KEYS[file.status]
  const Chevron = collapsed ? ChevronRight : ChevronDown

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(file.path)
      setCopyFailed(false)
    } catch {
      // A refused clipboard is real — an unfocused document is enough — and an
      // action that quietly did nothing is worse than one that says so.
      setCopyFailed(true)
      setTimeout(() => {
        setCopyFailed(false)
      }, SETTLE_MS)
    }
  }

  return (
    <div className="border-line border-b">
      <div className="bg-surface border-line sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-1.5">
        <button
          type="button"
          onClick={onToggle}
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
          {/* The directory recedes and the filename does not: a column this
              narrow truncates, and what has to survive truncation is the name. */}
          <span className="min-w-0 truncate font-mono text-[11px]" title={file.path}>
            <span className="text-ink-faint">{directoryOf(file.path)}</span>
            <span className="text-ink">{basenameOf(file.path)}</span>
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px]">
            {file.added > 0 && <span className="text-success">+{file.added}</span>}
            {file.added > 0 && file.removed > 0 && ' '}
            {file.removed > 0 && <span className="text-danger">−{file.removed}</span>}
          </span>
        </button>

        <DropdownMenu
          align="right"
          actions={[
            {
              id: 'copy',
              label: copyFailed ? t('diff.copyFailed') : t('diff.copyPath'),
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

      {!collapsed && <DiffBody file={file} />}
    </div>
  )
}

function DiffBody({ file }: { readonly file: FileDiff }): React.JSX.Element | null {
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
        <DiffHunk key={index} hunk={hunk} />
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
