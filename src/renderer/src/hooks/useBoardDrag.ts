import { useState } from 'react'

import type { BoardStatus, CardMove } from '@core/boardSchema.js'

import {
  type BoardColumns,
  CARD_MIME,
  dropMark,
  edgeAt,
  isOwnPlace,
  landingSlot
} from '../components/board/boardDrop.js'
import type { DropEdge } from './useDragReorder.js'

/** Unlike `DragItemProps`, dragstart receives the event: the drag's type is set on it. */
export interface CardDragProps {
  readonly draggable: boolean
  readonly onDragStart: (event: React.DragEvent) => void
  readonly onDragOver: (event: React.DragEvent) => void
  readonly onDrop: (event: React.DragEvent) => void
  readonly onDragEnd: () => void
}

export interface ColumnDropProps {
  readonly onDragOver: (event: React.DragEvent) => void
  readonly onDragLeave: (event: React.DragEvent) => void
  readonly onDrop: (event: React.DragEvent) => void
}

export interface BoardDrag {
  readonly draggingRef: string | null
  readonly cardProps: (ref: string, status: BoardStatus) => CardDragProps
  readonly columnProps: (status: BoardStatus) => ColumnDropProps
  readonly dropEdge: (ref: string) => DropEdge | null
  /** The empty column the card would fall into. */
  readonly overColumn: BoardStatus | null
}

export function useBoardDrag(
  columns: BoardColumns,
  onMove: (ref: string, move: CardMove) => void,
  enabled: boolean
): BoardDrag {
  const [draggingRef, setDraggingRef] = useState<string | null>(null)
  const [hover, setHover] = useState<{
    readonly ref: string
    readonly status: BoardStatus
    readonly slot: number
  } | null>(null)
  const mark = hover === null ? null : dropMark(columns, hover.ref, hover.status, hover.slot)

  const dragged = (event: React.DragEvent): string | null =>
    draggingRef !== null && event.dataTransfer.types.includes(CARD_MIME) ? draggingRef : null
  const end = (): void => {
    setDraggingRef(null)
    setHover(null)
  }
  // dragover fires every ~50 ms; keeping the same object for the same place spares a redraw.
  const point = (ref: string, status: BoardStatus, slot: number): void => {
    setHover((current) =>
      current !== null && current.ref === ref && current.status === status && current.slot === slot
        ? current
        : { ref, status, slot }
    )
  }
  const finish = (ref: string, status: BoardStatus, slot: number): void => {
    if (!isOwnPlace(columns, ref, status, slot)) onMove(ref, { status, index: slot })
    end()
  }
  const onCard = (
    ref: string,
    event: React.DragEvent
  ): { readonly ref: string; readonly edge: DropEdge } => ({
    ref,
    edge: edgeAt(event.clientY, event.currentTarget.getBoundingClientRect())
  })

  return {
    draggingRef,
    cardProps: (ref, status) => ({
      draggable: enabled,
      onDragStart: (event) => {
        if (!enabled) return
        event.dataTransfer.setData(CARD_MIME, ref)
        event.dataTransfer.effectAllowed = 'move'
        setDraggingRef(ref)
      },
      onDragOver: (event) => {
        // Without preventDefault the browser shows a foreign drag cannot be dropped here.
        const carried = dragged(event)
        if (carried === null) return
        event.preventDefault()
        // The column under the card would otherwise overwrite this hover.
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        // Over its own tile the card has not left its place, whichever half the pointer is in.
        if (carried === ref) setHover(null)
        else point(carried, status, landingSlot(columns, carried, status, onCard(ref, event)))
      },
      onDrop: (event) => {
        event.preventDefault()
        event.stopPropagation()
        const carried = dragged(event)
        if (carried === null || carried === ref) {
          end()
          return
        }
        // From the drop itself, not from `hover`: the pointer may have moved since.
        finish(carried, status, landingSlot(columns, carried, status, onCard(ref, event)))
      },
      onDragEnd: end
    }),
    columnProps: (status) => ({
      onDragOver: (event) => {
        const carried = dragged(event)
        if (carried === null) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        point(carried, status, landingSlot(columns, carried, status, null))
      },
      onDragLeave: (event) => {
        // Fires for every child the pointer crosses; only this column's own line is taken away.
        const to = event.relatedTarget
        if (to instanceof Node && event.currentTarget.contains(to)) return
        setHover((current) => (current?.status === status ? null : current))
      },
      onDrop: (event) => {
        event.preventDefault()
        const carried = dragged(event)
        if (carried === null) {
          end()
          return
        }
        finish(carried, status, landingSlot(columns, carried, status, null))
      }
    }),
    dropEdge: (ref) => (mark?.kind === 'card' && mark.ref === ref ? mark.edge : null),
    overColumn: mark?.kind === 'column' ? mark.status : null
  }
}
