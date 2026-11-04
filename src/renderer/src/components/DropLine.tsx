import type { DropEdge } from '../hooks/useDragReorder.js'

/**
 * Where a dragged item would land: an accent line on that edge.
 *
 * Set just outside the item's edge rather than on it, so the line reads as
 * between two items, which is where the dragged one will go.
 */
export function DropLine({ edge }: { readonly edge: DropEdge }): React.JSX.Element {
  return (
    <span
      data-testid="drop-line"
      aria-hidden
      className={`bg-accent pointer-events-none absolute right-0 left-0 h-0.5 rounded-full ${
        edge === 'above' ? '-top-[3px]' : '-bottom-[3px]'
      }`}
    />
  )
}
