import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, type Mock, vi } from 'vitest'

import type { BoardCard, ColumnId } from '@core/boardSchema.js'

import { type BoardColumns, CARD_MIME } from '../components/board/boardDrop.js'
import { boardCard } from '../test/board.js'
import { useBoardDrag } from './useBoardDrag.js'

const card = (ref: string, status: ColumnId, order?: number): BoardCard =>
  boardCard({
    ref,
    status,
    title: ref,
    meta: { links: [], runs: [], ...(order === undefined ? {} : { order }) }
  })
const COLUMNS: BoardColumns = new Map([
  [
    'backlog',
    [card('a', 'backlog', 1), card('b', 'backlog', 2), card('u', 'backlog'), card('v', 'backlog')]
  ],
  ['in progress', [card('p', 'in progress', 1)]],
  ['testing', []],
  ['staging', [card('s', 'staging')]],
  ['done', []],
  ['blocked', []]
])

interface Transfer {
  readonly types: string[]
  readonly setData: Mock
  effectAllowed: string
  dropEffect: string
}

function dragEvent({
  clientY = 0,
  top = 0,
  height = 40,
  types = [CARD_MIME],
  related = null,
  inside = false
}: {
  clientY?: number
  top?: number
  height?: number
  types?: string[]
  related?: Node | null
  inside?: boolean
} = {}): {
  readonly event: React.DragEvent
  readonly transfer: Transfer
  readonly preventDefault: Mock
  readonly stopPropagation: Mock
} {
  const transfer: Transfer = { types, setData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' }
  const preventDefault = vi.fn()
  const stopPropagation = vi.fn()
  const event = {
    clientY,
    preventDefault,
    stopPropagation,
    dataTransfer: transfer,
    relatedTarget: related,
    currentTarget: { getBoundingClientRect: () => ({ top, height }), contains: () => inside }
  } as unknown as React.DragEvent
  return { event, transfer, preventDefault, stopPropagation }
}

function setUp(enabled = true): {
  readonly result: { readonly current: ReturnType<typeof useBoardDrag> }
  readonly onMove: Mock
  readonly renders: () => number
} {
  let renders = 0
  const onMove = vi.fn()
  const { result } = renderHook(() => {
    renders += 1
    return useBoardDrag(COLUMNS, onMove, enabled)
  })
  return { result, onMove, renders: () => renders }
}

function start(
  result: { readonly current: ReturnType<typeof useBoardDrag> },
  ref: string,
  status: ColumnId
): void {
  act(() => {
    result.current.cardProps(ref, status).onDragStart(dragEvent().event)
  })
}

describe('useBoardDrag', () => {
  it('marks the dragged card and names it on the transfer', () => {
    const { result } = setUp()
    const { event, transfer } = dragEvent()

    act(() => {
      result.current.cardProps('a', 'backlog').onDragStart(event)
    })

    expect(result.current.draggingRef).toBe('a')
    expect(transfer.setData).toHaveBeenCalledWith(CARD_MIME, 'a')
    expect(transfer.effectAllowed).toBe('move')
    expect(result.current.dropEdge('a')).toBeNull()
    expect(result.current.overColumn).toBeNull()
  })

  it('moves a card below the card it is dropped on in another column', () => {
    const { result, onMove } = setUp()
    start(result, 'a', 'backlog')

    act(() => {
      result.current.cardProps('p', 'in progress').onDragOver(dragEvent({ clientY: 30 }).event)
    })
    expect(result.current.dropEdge('p')).toBe('below')
    expect(result.current.dropEdge('a')).toBeNull()
    expect(result.current.overColumn).toBeNull()

    act(() => {
      result.current.cardProps('p', 'in progress').onDrop(dragEvent({ clientY: 30 }).event)
    })
    expect(onMove).toHaveBeenCalledWith('a', { status: 'in progress', index: 1 })
    expect(result.current.draggingRef).toBeNull()
    expect(result.current.dropEdge('p')).toBeNull()
  })

  it('moves a card above the card it is dropped on', () => {
    const { result, onMove } = setUp()
    start(result, 'p', 'in progress')

    act(() => {
      result.current.cardProps('a', 'backlog').onDragOver(dragEvent({ clientY: 5 }).event)
    })
    act(() => {
      result.current.cardProps('a', 'backlog').onDrop(dragEvent({ clientY: 5 }).event)
    })

    expect(onMove).toHaveBeenCalledWith('p', { status: 'backlog', index: 0 })
  })

  it('moves a card into an empty column', () => {
    const { result, onMove } = setUp()
    start(result, 'a', 'backlog')

    act(() => {
      result.current.columnProps('testing').onDragOver(dragEvent().event)
    })
    expect(result.current.overColumn).toBe('testing')
    expect(result.current.dropEdge('p')).toBeNull()

    act(() => {
      result.current.columnProps('testing').onDrop(dragEvent().event)
    })
    expect(onMove).toHaveBeenCalledWith('a', { status: 'testing', index: 0 })
  })

  it('puts a card dropped under the last one at the end of the ordered cards', () => {
    const { result, onMove } = setUp()
    start(result, 'p', 'in progress')

    act(() => {
      result.current.columnProps('backlog').onDrop(dragEvent().event)
    })

    expect(onMove).toHaveBeenCalledWith('p', { status: 'backlog', index: 2 })
  })

  it('orders an unordered card dropped in its own column', () => {
    const { result, onMove } = setUp()
    start(result, 'u', 'backlog')

    act(() => {
      result.current.columnProps('backlog').onDrop(dragEvent().event)
    })

    expect(onMove).toHaveBeenCalledWith('u', { status: 'backlog', index: 2 })
  })

  it('does nothing when a card is dropped on its own place', () => {
    const { result, onMove } = setUp()
    start(result, 'a', 'backlog')

    act(() => {
      result.current.cardProps('b', 'backlog').onDragOver(dragEvent({ clientY: 5 }).event)
    })
    expect(result.current.dropEdge('b')).toBeNull()
    expect(result.current.dropEdge('a')).toBeNull()

    act(() => {
      result.current.cardProps('b', 'backlog').onDrop(dragEvent({ clientY: 5 }).event)
    })
    expect(onMove).not.toHaveBeenCalled()
    expect(result.current.draggingRef).toBeNull()
  })

  it('refuses a drag that is not a card', () => {
    const { result } = setUp()
    const overCard = dragEvent({ types: ['Files'] })
    const overColumn = dragEvent({ types: ['Files'] })

    act(() => {
      result.current.cardProps('a', 'backlog').onDragOver(overCard.event)
      result.current.columnProps('testing').onDragOver(overColumn.event)
    })

    expect(overCard.preventDefault).not.toHaveBeenCalled()
    expect(overColumn.preventDefault).not.toHaveBeenCalled()
    expect(result.current.overColumn).toBeNull()
  })

  it('refuses a drag that carries no card type even while a card is dragged', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    const { event, preventDefault } = dragEvent({ types: ['text/plain'] })

    act(() => {
      result.current.cardProps('b', 'backlog').onDragOver(event)
    })

    expect(preventDefault).not.toHaveBeenCalled()
    expect(result.current.dropEdge('b')).toBeNull()
  })

  it('drops a foreign drag on a card without moving anything', () => {
    const { result, onMove } = setUp()
    start(result, 'a', 'backlog')

    act(() => {
      result.current.cardProps('p', 'in progress').onDrop(dragEvent({ types: ['Files'] }).event)
    })

    expect(onMove).not.toHaveBeenCalled()
    expect(result.current.draggingRef).toBeNull()
  })

  it('drops a foreign drag on a column without moving anything', () => {
    const { result, onMove } = setUp()
    start(result, 'a', 'backlog')

    act(() => {
      result.current.columnProps('done').onDrop(dragEvent({ types: ['Files'] }).event)
    })

    expect(onMove).not.toHaveBeenCalled()
    expect(result.current.draggingRef).toBeNull()
  })

  it('keeps the column from overriding the card under the pointer', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    const { event, transfer, stopPropagation } = dragEvent()

    act(() => {
      result.current.cardProps('p', 'in progress').onDragOver(event)
    })

    expect(stopPropagation).toHaveBeenCalled()
    expect(transfer.dropEffect).toBe('move')
  })

  it('redraws only when the landing place changes', () => {
    const { result, renders } = setUp()
    start(result, 'a', 'backlog')
    const overP = (clientY: number): void => {
      act(() => {
        result.current.cardProps('p', 'in progress').onDragOver(dragEvent({ clientY }).event)
      })
    }

    overP(30)
    const placed = renders()
    overP(30)
    overP(30)
    overP(30)
    // React may render once more before it bails out of a state it was handed back.
    expect(renders()).toBeLessThanOrEqual(placed + 1)

    const still = renders()
    overP(5)
    expect(renders()).toBeGreaterThan(still)
    expect(result.current.dropEdge('p')).toBe('above')

    const above = renders()
    act(() => {
      result.current.columnProps('testing').onDragOver(dragEvent().event)
    })
    expect(renders()).toBeGreaterThan(above)
    expect(result.current.overColumn).toBe('testing')
  })

  it('clears the drag wherever it ends', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    act(() => {
      result.current.cardProps('p', 'in progress').onDragOver(dragEvent({ clientY: 30 }).event)
    })

    act(() => {
      result.current.cardProps('a', 'backlog').onDragEnd()
    })

    expect(result.current.draggingRef).toBeNull()
    expect(result.current.dropEdge('p')).toBeNull()
    expect(result.current.overColumn).toBeNull()
  })

  it('leaves a card let go over its own tile where it is', () => {
    const { result, onMove } = setUp()
    start(result, 'a', 'backlog')
    act(() => {
      result.current.cardProps('p', 'in progress').onDragOver(dragEvent({ clientY: 30 }).event)
    })

    act(() => {
      result.current.cardProps('a', 'backlog').onDragOver(dragEvent({ clientY: 30 }).event)
    })
    expect(result.current.dropEdge('p')).toBeNull()
    expect(result.current.dropEdge('b')).toBeNull()
    expect(result.current.dropEdge('v')).toBeNull()

    act(() => {
      result.current.cardProps('a', 'backlog').onDrop(dragEvent({ clientY: 30 }).event)
    })
    expect(onMove).not.toHaveBeenCalled()
    expect(result.current.draggingRef).toBeNull()
  })

  it('leaves an unordered card let go over its own tile unordered', () => {
    const { result, onMove } = setUp()
    start(result, 'u', 'backlog')

    act(() => {
      result.current.cardProps('u', 'backlog').onDrop(dragEvent({ clientY: 5 }).event)
    })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('takes the line away when the pointer leaves the column', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    act(() => {
      result.current.columnProps('testing').onDragOver(dragEvent().event)
    })

    act(() => {
      result.current
        .columnProps('testing')
        .onDragLeave(dragEvent({ related: document.body, inside: false }).event)
    })

    expect(result.current.overColumn).toBeNull()
    expect(result.current.draggingRef).toBe('a')
  })

  it('takes the line away when the pointer leaves the window', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    act(() => {
      result.current.cardProps('p', 'in progress').onDragOver(dragEvent({ clientY: 30 }).event)
    })

    act(() => {
      result.current.columnProps('in progress').onDragLeave(dragEvent({ related: null }).event)
    })

    expect(result.current.dropEdge('p')).toBeNull()
  })

  it('keeps the line while the pointer moves within the column', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    act(() => {
      result.current.cardProps('p', 'in progress').onDragOver(dragEvent({ clientY: 30 }).event)
    })

    act(() => {
      result.current
        .columnProps('in progress')
        .onDragLeave(dragEvent({ related: document.body, inside: true }).event)
    })

    expect(result.current.dropEdge('p')).toBe('below')
  })

  it('keeps the line of the column the pointer went on to', () => {
    const { result } = setUp()
    start(result, 'a', 'backlog')
    act(() => {
      result.current.columnProps('testing').onDragOver(dragEvent().event)
    })

    act(() => {
      result.current
        .columnProps('done')
        .onDragLeave(dragEvent({ related: document.body, inside: false }).event)
    })

    expect(result.current.overColumn).toBe('testing')
  })

  it('does not start a drag while dragging is switched off', () => {
    const { result } = setUp(false)
    const { event, transfer } = dragEvent()

    expect(result.current.cardProps('a', 'backlog').draggable).toBe(false)
    act(() => {
      result.current.cardProps('a', 'backlog').onDragStart(event)
    })

    expect(result.current.draggingRef).toBeNull()
    expect(transfer.setData).not.toHaveBeenCalled()
  })
})
