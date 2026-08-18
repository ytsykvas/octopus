import { useMemo } from 'react'

import type { DiffLine, Hunk } from '@core/diff.js'

import { type CommentSurface, CommentedRow } from './CommentedRow.js'
import type { Token } from './highlight.js'
import { lineAddress } from './selectionAnchor.js'
import { shown } from './shown.js'
import { type SplitRow, splitRows } from './splitRows.js'
import type { Highlighting } from './useHighlighting.js'

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
  added: 'bg-diff-added-bg',
  removed: 'bg-diff-removed-bg',
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
// `diff-code` is what lets the stylesheet colour the spans shiki produces, and
// what keeps those custom properties from reaching anything else.
const CODE = 'diff-code min-w-0 flex-1 pr-2 break-words whitespace-pre-wrap text-ink'

interface DiffHunkProps {
  readonly hunk: Hunk
  readonly view: DiffView
  /** Syntax colours, as far as they have arrived. */
  readonly tokens: Highlighting
  readonly path: string
  readonly comments: CommentSurface
}

/**
 * One hunk: where it sits in the file, and the lines it holds.
 *
 * Unified keeps two gutters, which is what a single column needs and one
 * gutter cannot give: a removed line has no number in the file as it now
 * stands, and an added line had none in the file as it was.
 */
/**
 * Where a line sits, which is what tells one row from another.
 *
 * The pair of numbers, because neither alone is enough: a removed line carries
 * only the old one, an added line only the new, and a context line both. No two
 * lines of a file share the pair.
 */
function lineKey(line: DiffLine): string {
  return `${line.kind}:${String(line.oldNumber)}:${String(line.newNumber)}`
}

export function DiffHunk({ hunk, view, tokens, path, comments }: DiffHunkProps): React.JSX.Element {
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

      {/* Keyed by where the line sits rather than by its place in the list.
          The diff re-reads itself when a turn ends, which is exactly when
          someone is writing a note — and by index, a line that had moved was
          drawn by the component that held a different one, so the open editor
          and the sentence in it went with it. */}
      {view === 'unified'
        ? hunk.lines.map((line) => (
            <CommentedRow key={lineKey(line)} path={path} line={line} comments={comments}>
              <UnifiedRow line={line} path={path} tokens={tokens.get(line)} />
            </CommentedRow>
          ))
        : rows.map((row) => (
            <SplitRowView
              key={`${row.left ? lineKey(row.left) : ''}|${row.right ? lineKey(row.right) : ''}`}
              row={row}
              path={path}
              comments={comments}
              tokens={tokens}
            />
          ))}
    </div>
  )
}

/**
 * A paired row, and the one line a note about it belongs to.
 *
 * The right-hand side where there is one: a remark on a replaced line is about
 * what the code has become, and anchoring it to the version being replaced
 * would send the agent to a line that is already gone.
 */
function SplitRowView({
  row,
  path,
  comments,
  tokens
}: {
  readonly row: SplitRow
  readonly path: string
  readonly comments: CommentSurface
  readonly tokens: Highlighting
}): React.JSX.Element {
  const pair = (
    <div className="flex font-mono text-[11px] leading-relaxed">
      <SplitHalf side="old" path={path} line={row.left} tokens={row.left && tokens.get(row.left)} />
      <div className="border-line w-px shrink-0 border-l" />
      <SplitHalf
        side="new"
        path={path}
        line={row.right}
        tokens={row.right && tokens.get(row.right)}
      />
    </div>
  )

  const anchor = row.right ?? row.left
  // `splitRows` pads one side or the other and never both, so a row with
  // nothing on either side is not something it produces — the guard is what
  // the type asks for rather than a state to test for.
  /* v8 ignore next */
  if (!anchor) return pair

  return (
    <CommentedRow path={path} line={anchor} comments={comments}>
      {pair}
    </CommentedRow>
  )
}

function UnifiedRow({
  line,
  path,
  tokens
}: {
  readonly line: DiffLine
  readonly path: string
  readonly tokens: readonly Token[] | undefined
}): React.JSX.Element {
  const side = line.kind === 'removed' ? 'old' : 'new'
  const number = line.kind === 'removed' ? line.oldNumber : line.newNumber

  return (
    <div className={`flex font-mono text-[11px] leading-relaxed ${ROW_TONES[line.kind]}`}>
      {/* A null renders as nothing, which is exactly what a line with no
          number on this side should leave behind. */}
      <span className={GUTTER}>{line.oldNumber}</span>
      <span className={GUTTER}>{line.newNumber}</span>
      <span className={`${SIGN} ${SIGN_TONES[line.kind]}`}>{SIGNS[line.kind]}</span>
      {/* Wrapped rather than scrolled sideways: a long line hidden behind an
          edge the reader has to drag is a line they will not read. */}
      <Code
        text={line.text}
        tokens={tokens}
        address={number === null ? null : lineAddress(path, side, number)}
      />
    </div>
  )
}

/**
 * One side of a paired row, or the blank left where the other side has a line
 * this one does not — which is what shows an addition as an addition rather
 * than as a line that merely happens to sit opposite something.
 */
function SplitHalf({
  side,
  path,
  line,
  tokens
}: {
  readonly side: 'old' | 'new'
  readonly path: string
  readonly line: DiffLine | null
  readonly tokens: readonly Token[] | undefined | null
}): React.JSX.Element {
  if (!line) return <div className="bg-muted/40 min-w-0 flex-1" />

  const number = side === 'old' ? line.oldNumber : line.newNumber

  return (
    <div className={`flex min-w-0 flex-1 ${ROW_TONES[line.kind]}`}>
      {/* Each column numbers its own file, which it can only do by knowing
          which one it is. Reading the number off the line's kind instead gets
          every context line wrong on the right: it belongs to both files, and
          the two have drifted apart by everything added above it. */}
      <span className={GUTTER}>{side === 'old' ? line.oldNumber : line.newNumber}</span>
      <span className={`${SIGN} ${SIGN_TONES[line.kind]}`}>{SIGNS[line.kind]}</span>
      <Code
        text={line.text}
        tokens={tokens ?? undefined}
        // The column's own side, not the line's. A context line belongs to both
        // files at once and carries a different number in each, so reading the
        // side off its kind would address the left column by the right's line.
        //
        // `splitRows` only ever puts a removed or context line on the left and
        // an added or context one on the right, and each of those carries a
        // number on the side it is drawn in. The guard is what the type asks
        // for rather than a state to test for, like the one above it.
        /* v8 ignore next */
        address={number === null ? null : lineAddress(path, side, number)}
      />
    </div>
  )
}

/**
 * The code itself, coloured where the highlighter has got to it.
 *
 * Falls back to the plain text rather than waiting: the diff is readable the
 * moment it arrives, and the colours land a moment later without the lines
 * moving. `--shiki-light` and `--shiki-dark` are set on each span so one
 * tokenising serves both themes and the stylesheet picks between them.
 *
 * `shown` goes inside the token's span rather than around it, so a syntax
 * colour still covers the code either side of anything it has to name.
 */
function Code({
  text,
  tokens,
  address
}: {
  readonly text: string
  readonly tokens: readonly Token[] | undefined
  /** Where this line is, for a selection to be read back into a note. */
  readonly address: string | null
}): React.JSX.Element {
  // On the code rather than the row: the gutters are `select-none`, so a
  // selection is always inside one of these, and split view draws two of them
  // per row addressing different files.
  const marked = address === null ? {} : { 'data-line': address }

  if (!tokens)
    return (
      <span className={CODE} {...marked}>
        {shown(text)}
      </span>
    )

  return (
    <span className={CODE} {...marked}>
      {tokens.map((token, index) => (
        <span
          key={index}
          style={
            { '--shiki-light': token.light, '--shiki-dark': token.dark } as React.CSSProperties
          }
        >
          {shown(token.text)}
        </span>
      ))}
    </span>
  )
}
