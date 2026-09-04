import type { FileDiff, Hunk, WorkspaceDiff } from '@core/diff.js'

/**
 * A file the pane can draw, with the awkward parts filled in.
 *
 * Written as one helper rather than a literal per test: a `FileDiff` carries
 * eight fields and only two of them are ever what a test is about, so spelling
 * out the rest each time buries the assertion in scaffolding.
 */
export function fileDiff(path: string, overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    path,
    oldPath: null,
    mode: null,
    status: 'modified',
    added: 1,
    removed: 1,
    omitted: 'none',
    hunks: [hunk()],
    ...overrides
  }
}

/** One line replaced, which is the shape most of the assertions want. */
export function hunk(overrides: Partial<Hunk> = {}): Hunk {
  return {
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 2,
    heading: '',
    lines: [
      { kind: 'context', text: 'kept', oldNumber: 1, newNumber: 1, noNewline: false },
      { kind: 'removed', text: 'was here', oldNumber: 2, newNumber: null, noNewline: false },
      { kind: 'added', text: 'is here now', oldNumber: null, newNumber: 2, noNewline: false }
    ],
    ...overrides
  }
}

export function workspaceDiff(
  files: readonly FileDiff[],
  overrides: Partial<WorkspaceDiff> = {}
): WorkspaceDiff {
  return {
    baseCommit: 'abc1234',
    baseBranch: 'main',
    files,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
    omittedFiles: 0,
    ...overrides
  }
}
