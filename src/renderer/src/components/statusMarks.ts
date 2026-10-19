import type { FileStatus } from '@core/diff.js'
import type { TreeStatus } from '@core/fileTree.js'

/**
 * The letter a changed file is marked with, the word it stands for, and its
 * colour. The Files tab draws all three; the Changes tab reads only the word.
 *
 * The letters are the ones editors draw — git's `M A D R C T`, `U` for
 * untracked, `!` for a conflict — and are the same in every language. They were
 * the initial of the translated word at first, and in Ukrainian "changed" is
 * `З`, which before a path reads as the digit 3. The word is what is
 * translated, and what a reader hears.
 *
 * The key is written out rather than built from the status: `t` is typed
 * against the locale, and a key assembled at runtime is a string it cannot
 * check — which is the whole point of typing the locales against each other.
 */
export interface StatusMark {
  readonly letter: string
  readonly label:
    | 'diff.statusAddedLabel'
    | 'diff.statusModifiedLabel'
    | 'diff.statusDeletedLabel'
    | 'diff.statusRenamedLabel'
    | 'diff.statusCopiedLabel'
    | 'diff.statusTypeChangedLabel'
    | 'diff.statusUntrackedLabel'
    | 'files.statusConflictedLabel'
  readonly tone: string
}

export const FILE_STATUS_MARKS: Record<FileStatus, StatusMark> = {
  added: { letter: 'A', label: 'diff.statusAddedLabel', tone: 'text-success' },
  modified: { letter: 'M', label: 'diff.statusModifiedLabel', tone: 'text-info' },
  deleted: { letter: 'D', label: 'diff.statusDeletedLabel', tone: 'text-danger' },
  renamed: { letter: 'R', label: 'diff.statusRenamedLabel', tone: 'text-info' },
  copied: { letter: 'C', label: 'diff.statusCopiedLabel', tone: 'text-info' },
  typeChanged: { letter: 'T', label: 'diff.statusTypeChangedLabel', tone: 'text-warning' },
  untracked: { letter: 'U', label: 'diff.statusUntrackedLabel', tone: 'text-success' }
}

/**
 * The tree's marks: the diff's, and a conflict — which a diff against a merge
 * base never sees, and the tree reading the index does.
 */
export const TREE_STATUS_MARKS: Record<TreeStatus, StatusMark> = {
  ...FILE_STATUS_MARKS,
  conflicted: {
    letter: '!',
    label: 'files.statusConflictedLabel',
    tone: 'text-danger'
  }
}
