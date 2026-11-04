import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDragReorder } from './useDragReorder.js'

const IDS = ['a', 'b', 'c']

function setUp(): {
  readonly result: { readonly current: ReturnType<typeof useDragReorder> }
  readonly onReorder: ReturnType<typeof vi.fn>
} {
  const onReorder = vi.fn()
  const { result } = renderHook(() => useDragReorder(IDS, onReorder))
  return { result, onReorder }
}

/** A drag event as far as the hook reads one. */
function dragEvent(preventDefault = vi.fn()): React.DragEvent {
  return { preventDefault } as unknown as React.DragEvent
}

describe('useDragReorder', () => {
  it('moves an item down onto the one it is dropped on', () => {
    const { result, onReorder } = setUp()

    act(() => {
      result.current.itemProps('a').onDragStart()
    })
    act(() => {
      result.current.itemProps('c').onDragOver(dragEvent())
    })
    act(() => {
      result.current.itemProps('c').onDrop(dragEvent())
    })

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a'])
    expect(result.current.draggingId).toBeNull()
  })

  it('moves an item up onto the one it is dropped on', () => {
    const { result, onReorder } = setUp()

    act(() => {
      result.current.itemProps('c').onDragStart()
    })
    act(() => {
      result.current.itemProps('a').onDrop(dragEvent())
    })

    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('does nothing when an item is dropped on itself', () => {
    const { result, onReorder } = setUp()

    act(() => {
      result.current.itemProps('b').onDragStart()
    })
    expect(result.current.draggingId).toBe('b')

    act(() => {
      result.current.itemProps('b').onDrop(dragEvent())
    })

    expect(onReorder).not.toHaveBeenCalled()
    expect(result.current.draggingId).toBeNull()
  })

  it('does nothing for a drop with no drag behind it', () => {
    const { result, onReorder } = setUp()

    act(() => {
      result.current.itemProps('b').onDrop(dragEvent())
    })

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('accepts the drop, which the browser refuses otherwise', () => {
    const { result } = setUp()
    const overPrevented = vi.fn()
    const dropPrevented = vi.fn()

    act(() => {
      result.current.itemProps('a').onDragStart()
    })
    act(() => {
      result.current.itemProps('b').onDragOver(dragEvent(overPrevented))
    })
    act(() => {
      result.current.itemProps('b').onDrop(dragEvent(dropPrevented))
    })

    expect(overPrevented).toHaveBeenCalled()
    expect(dropPrevented).toHaveBeenCalled()
  })

  it('puts the line on the edge the item would land against', () => {
    const { result } = setUp()

    act(() => {
      result.current.itemProps('a').onDragStart()
    })
    act(() => {
      result.current.itemProps('c').onDragOver(dragEvent())
    })
    expect(result.current.dropEdge('c')).toBe('below')
    expect(result.current.dropEdge('b')).toBeNull()

    act(() => {
      result.current.itemProps('c').onDragEnd()
    })
    act(() => {
      result.current.itemProps('c').onDragStart()
    })
    act(() => {
      result.current.itemProps('a').onDragOver(dragEvent())
    })
    expect(result.current.dropEdge('a')).toBe('above')
  })

  it('draws no line over the item being dragged, and none once it ends', () => {
    const { result } = setUp()

    act(() => {
      result.current.itemProps('b').onDragStart()
    })
    act(() => {
      result.current.itemProps('b').onDragOver(dragEvent())
    })
    expect(result.current.dropEdge('b')).toBeNull()

    act(() => {
      result.current.itemProps('c').onDragOver(dragEvent())
    })
    expect(result.current.dropEdge('c')).toBe('below')

    act(() => {
      result.current.itemProps('b').onDragEnd()
    })
    expect(result.current.draggingId).toBeNull()
    for (const id of IDS) expect(result.current.dropEdge(id)).toBeNull()
  })

  it('makes every item draggable', () => {
    const { result } = setUp()

    expect(result.current.itemProps('a').draggable).toBe(true)
  })

  describe('moveBy', () => {
    it('moves an item one step up or down', () => {
      const { result, onReorder } = setUp()

      result.current.moveBy('b', -1)
      expect(onReorder).toHaveBeenLastCalledWith(['b', 'a', 'c'])

      result.current.moveBy('b', 1)
      expect(onReorder).toHaveBeenLastCalledWith(['a', 'c', 'b'])
    })

    it('does nothing past either end, or for an item it does not hold', () => {
      const { result, onReorder } = setUp()

      result.current.moveBy('a', -1)
      result.current.moveBy('c', 1)
      result.current.moveBy('gone', 1)

      expect(onReorder).not.toHaveBeenCalled()
    })
  })
})
