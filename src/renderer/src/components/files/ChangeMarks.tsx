import { memo } from 'react'

import type { LineChanges } from '@core/lineChanges.js'

import type { LineGeometry } from './codeSelection.js'

interface ChangeMarksProps {
  readonly changes: LineChanges
  readonly geometry: LineGeometry
  /**
   * Which of the two places this is drawn in. The code's own ground is
   * transparent, so a tint goes behind the whole row; the number column has a
   * ground of its own that a long line scrolled sideways must not show through,
   * so it carries a copy, with the strip that says what kind of change it was
   * and the deletions, which have no row to tint.
   */
  readonly layer: 'code' | 'gutter'
}

/**
 * The lines the branch changed, drawn behind the file's text.
 *
 * One element per range rather than per line: an untracked file of five
 * thousand lines is a single box. Placed by the geometry the selection toolbar
 * is placed by, so a mark lands on the line it is for.
 *
 * Memoised, as the lines are: the viewer reads the selection on every move of
 * the mouse and redraws itself each time, and nothing here changes with it.
 * `-z-10` puts it under the text inside the stacking context its parent opens,
 * and `pointer-events-none` leaves the text selectable.
 */
export const ChangeMarks = memo(function ChangeMarks({
  changes,
  geometry,
  layer
}: ChangeMarksProps): React.JSX.Element {
  const top = (line: number): number => geometry.padding + (line - 1) * geometry.height
  const gutter = layer === 'gutter'

  return (
    <div aria-hidden data-marks={layer} className="pointer-events-none absolute inset-0 -z-10">
      {changes.modified.map((range) => (
        <div
          key={`m${String(range.start)}`}
          data-change="modified"
          style={{ top: top(range.start), height: (range.end - range.start + 1) * geometry.height }}
          className={`bg-diff-added-bg absolute inset-x-0 ${gutter ? 'border-warning border-l-2' : ''}`}
        />
      ))}
      {changes.added.map((range) => (
        <div
          key={`a${String(range.start)}`}
          data-change="added"
          style={{ top: top(range.start), height: (range.end - range.start + 1) * geometry.height }}
          className={`bg-diff-added-bg absolute inset-x-0 ${gutter ? 'border-success border-l-2' : ''}`}
        />
      ))}
      {gutter &&
        changes.removedAfter.map((line) => (
          <div
            key={`r${String(line)}`}
            data-change="removed"
            // Straddles the edge between the two lines it fell between.
            style={{ top: top(line + 1) - 1, height: 2 }}
            className="bg-danger absolute inset-x-0"
          />
        ))}
    </div>
  )
})
