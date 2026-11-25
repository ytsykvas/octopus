import type { DropEdge } from '../hooks/useDragReorder.js'

/**
 * Where a dragged item would land: an accent line on that edge.
 *
 * Set just outside the item's edge rather than on it, so the line reads as
 * between two items, which is where the dragged one will go.
 */
export function DropLine({
  edge,
  across = false
}: {
  readonly edge: DropEdge
  // A row of items laid out sideways, as the board's columns: `above` is then the left edge.
  readonly across?: boolean
}): React.JSX.Element {
  const place = across
    ? `top-0 bottom-0 w-0.5 ${edge === 'above' ? '-left-[2px]' : '-right-[2px]'}`
    : `right-0 left-0 h-0.5 ${edge === 'above' ? '-top-[3px]' : '-bottom-[3px]'}`
  return (
    <span
      data-testid="drop-line"
      // The edge in a form a test can read without knowing how it is drawn.
      data-edge={edge}
      aria-hidden
      className={`bg-accent pointer-events-none absolute rounded-full ${place}`}
    />
  )
}
