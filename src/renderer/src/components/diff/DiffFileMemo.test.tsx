/*
 * That a file is not redrawn when nothing about it moved.
 *
 * Its own file because it needs `DiffHunk` mocked to count renders, and the
 * other diff tests want the real one.
 *
 * The claim is not a micro-optimisation. Colours arrive one file at a time and
 * the pane's width changes on every pointer move of a drag, and each of those
 * used to redraw every file, every hunk and every row — which drops a live text
 * selection, and the selection is what the note button acts on.
 */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { fileDiff, hunk } from '../../test/diff.js'
import { DiffFile } from './DiffFile.js'
import { NO_TOKENS } from './useHighlighting.js'

let bodyRenders = 0

vi.mock('./DiffHunk.js', () => ({
  DiffHunk: (): React.JSX.Element => {
    bodyRenders++
    return <div />
  }
}))

const file = fileDiff('src/a.ts', { hunks: [hunk()] })
const comments = {
  pending: [],
  editing: null,
  onEdit: vi.fn(),
  onSave: vi.fn(),
  onRemove: vi.fn(),
  readDraft: vi.fn(() => null),
  onDraft: vi.fn()
}

/** The props as `DiffPanel` hands them over: every one of them steady. */
const props = {
  file,
  collapsed: false,
  view: 'unified' as const,
  tokens: NO_TOKENS,
  comments,
  onToggle: vi.fn(),
  onRevert: vi.fn(),
  onOpen: vi.fn()
}

describe('a file that has not changed', () => {
  it('is not redrawn when its parent renders again', () => {
    bodyRenders = 0
    const { rerender } = render(<DiffFile {...props} />)
    expect(bodyRenders).toBe(1)

    rerender(<DiffFile {...props} />)

    expect(bodyRenders).toBe(1)
  })

  // The colours of another file arriving hand this one the same map it had.
  // Without the memo that was a full redraw of every file per file coloured.
  it('is not redrawn when another file gets its colours', () => {
    bodyRenders = 0
    const { rerender } = render(<DiffFile {...props} />)

    rerender(<DiffFile {...props} tokens={NO_TOKENS} />)

    expect(bodyRenders).toBe(1)
  })

  it('is redrawn when its own colours arrive', () => {
    bodyRenders = 0
    const { rerender } = render(<DiffFile {...props} />)

    rerender(<DiffFile {...props} tokens={new Map()} />)

    expect(bodyRenders).toBe(2)
  })
})
