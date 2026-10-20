import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'

/** One line of a segment's list: where it is, what about it, and where it leads. */
export interface StatusRow {
  readonly key: string
  /** The project's colour name, drawn as a dot so a row is placed before it is read. */
  readonly color: string | null
  readonly label: string
  readonly detail: string
  /** Absent for a row with nowhere to go — the application itself. */
  readonly onOpen?: () => void
}

interface StatusSegmentProps {
  /** What the bar shows: a count in words, or a reading. */
  readonly label: string
  /** A mark before the label, in the status colour it stands for. */
  readonly mark?: React.ReactNode
  /** A count of nothing, drawn quieter so the segment holds its place. */
  readonly quiet?: boolean
  /** The list's heading, and its name for a screen reader. */
  readonly title: string
  readonly rows: readonly StatusRow[]
  /** Said in place of the list when it has nothing in it. */
  readonly empty: string
}

const PANEL_WIDTH = 320
const ROW_HEIGHT = 40
const PANEL_CHROME = 48

/**
 * One reading in the status bar, which opens on a click to the list behind it.
 *
 * Every segment is the same thing — a figure, and the workspaces it counts —
 * so it is one component with rows handed to it rather than four with a panel
 * each. A row leads to its workspace; the panel closes behind the jump, since
 * what was being looked for is now on screen.
 */
export function StatusSegment({
  label,
  mark,
  quiet = false,
  title,
  rows,
  empty
}: StatusSegmentProps): React.JSX.Element {
  const { open, position, container, toggle, close } = useAnchoredPanel()

  return (
    <div ref={container} className="contents">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          toggle(event.currentTarget, {
            width: PANEL_WIDTH,
            height: PANEL_CHROME + Math.max(1, rows.length) * ROW_HEIGHT
          })
        }}
        className={`hover:bg-muted hover:text-ink focus-ring flex h-full shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2 whitespace-nowrap tabular-nums transition-colors ${
          quiet ? 'text-ink-faint' : 'text-ink-soft'
        }`}
      >
        {mark}
        {label}
      </button>

      {open && position && (
        <div
          role="dialog"
          aria-label={title}
          className="border-line bg-canvas fixed z-50 flex max-h-[60vh] flex-col overflow-hidden rounded-[var(--radius-panel)] border shadow-[var(--shadow-pop)]"
          style={{ ...position, width: PANEL_WIDTH }}
        >
          <p className="section-label px-3 pt-2.5 pb-1.5">{title}</p>

          {rows.length === 0 ? (
            <p className="text-ink-faint px-3 pb-3">{empty}</p>
          ) : (
            <ul className="overflow-y-auto pb-1.5">
              {rows.map((row) => (
                <li key={row.key}>
                  <RowBody
                    row={row}
                    onOpen={
                      row.onOpen &&
                      (() => {
                        row.onOpen?.()
                        close()
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function RowBody({
  row,
  onOpen
}: {
  readonly row: StatusRow
  readonly onOpen: (() => void) | undefined
}): React.JSX.Element {
  const body = (
    <>
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{
          backgroundColor: row.color === null ? 'var(--ink-faint)' : `var(--project-${row.color})`
        }}
      />
      <span className="min-w-0 flex-1">
        <span className="text-ink block truncate">{row.label}</span>
        <span className="text-ink-faint block truncate text-[12px]">{row.detail}</span>
      </span>
    </>
  )

  const shape = 'flex w-full items-center gap-2.5 px-3 py-1 text-left'

  return onOpen === undefined ? (
    <div className={shape}>{body}</div>
  ) : (
    <button type="button" onClick={onOpen} className={`${shape} hover:bg-muted focus-ring`}>
      {body}
    </button>
  )
}
