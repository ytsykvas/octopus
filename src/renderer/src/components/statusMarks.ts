import type { FileStatus } from '@core/diff.js'
import type { TreeStatus } from '@core/fileTree.js'

/**
 * The letter a changed file is marked with, the word it stands for, and its
 * colour — shared by the Changes tab and the Files tab so a file reads the same
 * in both.
 *
 * Both keys are written out rather than built from the status: `t` is typed
 * against the locale, and a key assembled at runtime is a string it cannot
 * check — which is the whole point of typing the locales against each other.
 */
export interface StatusMark {
  readonly letter:
    | 'diff.statusAdded'
    | 'diff.statusModified'
    | 'diff.statusDeleted'
    | 'diff.statusRenamed'
    | 'diff.statusCopied'
    | 'diff.statusTypeChanged'
    | 'diff.statusUntracked'
    | 'files.statusConflicted'
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

/**
 * The tree's marks: the diff's, and a conflict — which a diff against a merge
 * base never sees, and the tree reading the index does.
 */
export const TREE_STATUS_MARKS: Record<TreeStatus, StatusMark> = {
  ...FILE_STATUS_MARKS,
  conflicted: {
    letter: 'files.statusConflicted',
    label: 'files.statusConflictedLabel',
    tone: 'text-danger'
  }
}
