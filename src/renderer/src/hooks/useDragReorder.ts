import { useState } from 'react'

import { movedTo } from '@core/lists.js'

export type DropEdge = 'above' | 'below'

/** What a draggable item spreads onto its element. */
export interface DragItemProps {
  readonly draggable: true
  readonly onDragStart: () => void
  readonly onDragOver: (event: React.DragEvent) => void
  readonly onDrop: (event: React.DragEvent) => void
  readonly onDragEnd: () => void
}

export interface DragReorder {
  readonly draggingId: string | null
  /** The edge the dragged item would land against, when it is over `id`. */
  readonly dropEdge: (id: string) => DropEdge | null
  readonly itemProps: (id: string) => DragItemProps
  /** The keyboard's way to the same order: one step up or down. */
  readonly moveBy: (id: string, step: -1 | 1) => void
}

/**
 * A list put in order by dragging its items onto one another.
 *
 * The project strip and the saved prompts each wrote this out, and the copies
 * only ever differed in which list they changed. What the caller keeps is the
 * order; this keeps only where the drag is.
 */
export function useDragReorder(
  ids: readonly string[],
  onReorder: (orderedIds: string[]) => void
): DragReorder {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const indexOf = (id: string | null): number => ids.indexOf(id ?? '')

  const end = (): void => {
    setDraggingId(null)
    setOverId(null)
  }

  // Dropped on an item, the dragged one takes its place, so moving down lands
  // below it and moving up lands above it.
  const drop = (targetId: string): void => {
    const from = indexOf(draggingId)
    const to = indexOf(targetId)
    if (from !== -1 && to !== -1 && from !== to) onReorder(movedTo(ids, from, to))
    end()
  }

  return {
    draggingId,
    // Which edge the line sits on follows the direction of the move.
    dropEdge: (id) =>
      id === overId && id !== draggingId
        ? indexOf(id) > indexOf(draggingId)
          ? 'below'
          : 'above'
        : null,
    itemProps: (id) => ({
      draggable: true,
      onDragStart: () => {
        setDraggingId(id)
      },
      onDragOver: (event) => {
        // Without this the browser refuses the drop — and a refused drop of a
        // file from the Finder is one it handles itself, by opening the file
        // in place of the window. So a drag from elsewhere is accepted too, and
        // comes to nothing in `drop`.
        event.preventDefault()
        // Not marked, though: its end never reaches us, and the line drawn for
        // it would stay until the next drag of our own.
        if (draggingId !== null) setOverId(id)
      },
      onDrop: (event) => {
        event.preventDefault()
        drop(id)
      },
      onDragEnd: end
    }),
    moveBy: (id, step) => {
      const index = indexOf(id)
      if (index === -1 || index + step < 0 || index + step >= ids.length) return
      onReorder(movedTo(ids, index, index + step))
    }
  }
}
