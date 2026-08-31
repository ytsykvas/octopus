/*
 * That the pane hands `DiffFile` the same props twice when nothing has moved.
 *
 * `DiffFileMemo.test` asserts the other half — that a memoised file ignores a
 * parent's render — but it builds the props by hand, every one of them steady,
 * so it holds whatever the pane actually passes. This is the half that checks
 * the pane keeps its side of that bargain.
 *
 * It is not a micro-optimisation. The pane's width changes on every pointer
 * move of a drag, and a file redrawn mid-drag drops a live text selection —
 * which is what the note button acts on. An arrow function written inline in
 * the file list is enough to cause it, and nothing else here would notice.
 */

import { render, screen } from '@testing-library/react'
import { memo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { commentController, revertController } from '../../test/comments.js'
import { fileDiff, hunk, workspaceDiff } from '../../test/diff.js'
import { octopus } from '../../test/octopus.js'
import { workspaceView } from '../../test/workspaces.js'
import { DiffPanel } from './DiffPanel.js'

let fileRenders = 0

vi.mock('./DiffFile.js', () => ({
  // Memoised exactly as the real one is, so it re-renders only when the pane
  // hands it something new.
  DiffFile: memo(function DiffFile(): React.JSX.Element {
    fileRenders++
    return <div data-testid="file" />
  })
}))

const anna = workspaceView('anna')

// Held still across renders, as `App` holds them: both are built once up there
// and handed down, so a test rebuilding them would be measuring itself.
const comments = commentController()
const revert = revertController()
const onError = vi.fn()
const onView = vi.fn()

beforeEach(() => {
  octopus()
  fileRenders = 0
  vi.mocked(octopus().workspaces.diff).mockResolvedValue({
    ok: true,
    value: workspaceDiff([fileDiff('src/a.ts', { hunks: [hunk()] })])
  })
})

function panel(width: number): React.JSX.Element {
  return (
    <DiffPanel
      workspace={anna}
      visible
      view="unified"
      onView={onView}
      width={width}
      comments={comments}
      revert={revert}
      onError={onError}
    />
  )
}

describe('a pane whose width changed', () => {
  it('does not redraw the files it had already drawn', async () => {
    const { rerender } = render(panel(900))
    await screen.findByTestId('file')
    const drawn = fileRenders

    rerender(panel(901))
    rerender(panel(902))

    expect(fileRenders).toBe(drawn)
  })
})
