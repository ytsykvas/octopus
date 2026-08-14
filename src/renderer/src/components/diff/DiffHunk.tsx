import type { DiffLine, Hunk } from '@core/diff.js'

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

/** Width of a line-number gutter, in characters of the monospace face. */
const GUTTER = 'w-10'

/**
 * One hunk: where it sits in the file, and the lines it holds.
 *
 * The two gutters are what a unified diff needs and a single one cannot give:
 * a removed line has no number in the file as it now stands, and an added line
 * had none in the file as it was. Numbering both from one column would put a
 * number on a line that never had it.
 */
export function DiffHunk({ hunk }: { readonly hunk: Hunk }): React.JSX.Element {
  return (
    <div>
      <div className="bg-muted text-ink-faint flex gap-3 px-2 py-0.5 font-mono text-[11px]">
        <span>
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>
        {hunk.heading !== '' && <span className="truncate">{hunk.heading}</span>}
      </div>

      {hunk.lines.map((line, index) => (
        <DiffRow key={index} line={line} />
      ))}
    </div>
  )
}

function DiffRow({ line }: { readonly line: DiffLine }): React.JSX.Element {
  return (
    <div className={`flex font-mono text-[11px] leading-relaxed ${ROW_TONES[line.kind]}`}>
      <span
        className={`${GUTTER} text-ink-faint shrink-0 pr-2 text-right tabular-nums select-none`}
      >
        {line.oldNumber ?? ''}
      </span>
      <span
        className={`${GUTTER} text-ink-faint shrink-0 pr-2 text-right tabular-nums select-none`}
      >
        {line.newNumber ?? ''}
      </span>
      <span className={`w-4 shrink-0 text-center select-none ${SIGN_TONES[line.kind]}`}>
        {SIGNS[line.kind]}
      </span>
      {/* `pre-wrap` rather than a scrolling row: a long line wraps inside the
          pane instead of hiding behind an edge the reader has to drag. */}
      <span className="text-ink min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap">
        {line.text}
      </span>
    </div>
  )
}
