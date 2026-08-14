import { useMemo } from 'react'

import type { DiffLine, Hunk } from '@core/diff.js'

import { splitRows } from './splitRows.js'

/** How a diff is laid out. `split` needs room the pane may not have. */
export type DiffView = 'unified' | 'split'

/**
 * The background carries the change; the text is left to the code.
 *
 * The chat's change block colours both (`CHANGE_TONES` in `ChatLog`), and it is
 * right to: three lines with no highlighting need the colour to say what they
 * are. Here the same green over a whole file would drown what the code says, so
 * the row is tinted and the sign in the gutter carries the hue instead. Either
 * way a status colour is only ever a background through its paired `*-bg`
 * token (§10.7).
 */
const ROW_TONES: Record<DiffLine['kind'], string> = {
  added: 'bg-success-bg',
  removed: 'bg-danger-bg',
  context: ''
}

const SIGN_TONES: Record<DiffLine['kind'], string> = {
  added: 'text-success',
  removed: 'text-danger',
  context: 'text-ink-faint'
}

const SIGNS: Record<DiffLine['kind'], string> = {
  added: '+',
  removed: '−',
  context: ' '
}

const GUTTER = 'w-10 shrink-0 pr-2 text-right tabular-nums select-none text-ink-faint'
const SIGN = 'w-4 shrink-0 text-center select-none'
const CODE = 'min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap text-ink'

interface DiffHunkProps {
  readonly hunk: Hunk
  readonly view: DiffView
}

/**
 * One hunk: where it sits in the file, and the lines it holds.
 *
 * Unified keeps two gutters, which is what a single column needs and one
 * gutter cannot give: a removed line has no number in the file as it now
 * stands, and an added line had none in the file as it was.
 */
export function DiffHunk({ hunk, view }: DiffHunkProps): React.JSX.Element {
  // Computed here rather than in the row, so a re-render for any other reason
  // — a comment typed, a file collapsed — does not pair the lines again.
  const rows = useMemo(() => (view === 'split' ? splitRows(hunk.lines) : []), [hunk.lines, view])

  return (
    <div>
      <div className="bg-muted text-ink-faint flex gap-3 px-2 py-0.5 font-mono text-[11px]">
        <span>
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>
        {hunk.heading !== '' && <span className="truncate">{hunk.heading}</span>}
      </div>

      {view === 'unified'
        ? hunk.lines.map((line, index) => <UnifiedRow key={index} line={line} />)
        : rows.map((row, index) => (
            <div key={index} className="flex font-mono text-[11px] leading-relaxed">
              <SplitHalf line={row.left} />
              <div className="border-line w-px shrink-0 border-l" />
              <SplitHalf line={row.right} />
            </div>
          ))}
    </div>
  )
}

function UnifiedRow({ line }: { readonly line: DiffLine }): React.JSX.Element {
  return (
    <div className={`flex font-mono text-[11px] leading-relaxed ${ROW_TONES[line.kind]}`}>
      {/* A null renders as nothing, which is exactly what a line with no
          number on this side should leave behind. */}
      <span className={GUTTER}>{line.oldNumber}</span>
      <span className={GUTTER}>{line.newNumber}</span>
      <span className={`${SIGN} ${SIGN_TONES[line.kind]}`}>{SIGNS[line.kind]}</span>
      {/* Wrapped rather than scrolled sideways: a long line hidden behind an
          edge the reader has to drag is a line they will not read. */}
      <span className={CODE}>{line.text}</span>
    </div>
  )
}

/**
 * One side of a paired row, or the blank left where the other side has a line
 * this one does not — which is what shows an addition as an addition rather
 * than as a line that merely happens to sit opposite something.
 */
function SplitHalf({ line }: { readonly line: DiffLine | null }): React.JSX.Element {
  if (!line) return <div className="bg-muted/40 min-w-0 flex-1" />

  return (
    <div className={`flex min-w-0 flex-1 ${ROW_TONES[line.kind]}`}>
      {/* Each column shows its own file's numbering: a removal is only ever
          drawn on the left and an addition only ever on the right. */}
      <span className={GUTTER}>{line.kind === 'added' ? line.newNumber : line.oldNumber}</span>
      <span className={`${SIGN} ${SIGN_TONES[line.kind]}`}>{SIGNS[line.kind]}</span>
      <span className={CODE}>{line.text}</span>
    </div>
  )
}
