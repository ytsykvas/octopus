import { describe, expect, it, vi } from 'vitest'

import type { Column } from '@core/boardColumns.js'

import type { ColumnEditing } from '../../hooks/useColumnEditing.js'
import i18n from '../../i18n/index.js'
import { columnMenu } from './columnMenu.js'

const IDEAS: Column = { kind: 'custom', id: 'Ideas', name: 'Ideas' }
const BACKLOG: Column = { kind: 'system', id: 'backlog' }

function editing(): ColumnEditing {
  return {
    reorder: {
      draggingId: null,
      dropEdge: () => null,
      itemProps: vi.fn(),
      moveBy: vi.fn()
    },
    add: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    dialogs: <></>
  }
}

const t = i18n.t.bind(i18n)

describe('columnMenu', () => {
  it('only moves a built-in column', () => {
    expect(
      columnMenu(BACKLOG, { index: 1, count: 3, cardCount: 0 }, editing(), t).map((item) => item.id)
    ).toEqual(['left', 'right'])
  })

  it('cannot move the first column left or the last one right', () => {
    const [firstLeft] = columnMenu(BACKLOG, { index: 0, count: 2, cardCount: 0 }, editing(), t)
    const [, lastRight] = columnMenu(BACKLOG, { index: 1, count: 2, cardCount: 0 }, editing(), t)

    expect(firstLeft?.disabled).toBe(true)
    expect(lastRight?.disabled).toBe(true)
  })

  it('moves the column one step each way', () => {
    const edits = editing()
    const [left, right] = columnMenu(BACKLOG, { index: 1, count: 3, cardCount: 0 }, edits, t)

    left?.onSelect()
    right?.onSelect()

    expect(left?.disabled).toBe(false)
    expect(right?.disabled).toBe(false)
    expect(edits.reorder.moveBy).toHaveBeenNthCalledWith(1, 'backlog', -1)
    expect(edits.reorder.moveBy).toHaveBeenNthCalledWith(2, 'backlog', 1)
  })

  it('renames and removes an added column', () => {
    const edits = editing()
    const [, , rename, remove] = columnMenu(IDEAS, { index: 0, count: 1, cardCount: 0 }, edits, t)

    rename?.onSelect()
    remove?.onSelect()

    expect(rename?.label).toBe('Rename…')
    expect(remove).toMatchObject({ label: 'Remove…', destructive: true, disabled: false })
    expect(remove?.description).toBeUndefined()
    expect(edits.rename).toHaveBeenCalledWith(IDEAS)
    expect(edits.remove).toHaveBeenCalledWith(IDEAS)
  })

  it('will not remove a column that holds tasks, and says why', () => {
    const [, , , remove] = columnMenu(IDEAS, { index: 0, count: 1, cardCount: 2 }, editing(), t)

    expect(remove).toMatchObject({ disabled: true, description: 'Move its tasks out first.' })
  })
})
