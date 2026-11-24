import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'

import { livePreview } from './livePreview.js'

describe('livePreview', () => {
  const preview = livePreview('Done')
  const state = EditorState.create({ doc: '**a**\n\n**b**', extensions: [preview] })

  it('keeps its decorations through a transaction that moves nothing', () => {
    expect(state.update({}).state.field(preview)).toBe(state.field(preview))
  })

  it('draws again when the text changes', () => {
    const typed = state.update({ changes: { from: 0, insert: 'x' } }).state

    expect(typed.field(preview)).not.toBe(state.field(preview))
  })

  it('draws again when the selection moves', () => {
    const moved = state.update({ selection: { anchor: 9 } }).state

    expect(moved.field(preview)).not.toBe(state.field(preview))
  })
})
