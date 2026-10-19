import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChangeContext } from '@core/events.js'

import { ColouredLine, useColouredText } from '../diff/colouredText.js'
import type { Change, ChangeLine } from './changeSummary.js'

/** How each kind of line is tinted. Tokens only, so both themes hold. */
const CHANGE_TONES: Record<ChangeLine['sign'], string> = {
  '+': 'bg-success-bg',
  '-': 'bg-danger-bg',
  ' ': '',
  gap: ''
}

/** The mark in front of a line, which says what it is without the colour. */
const SIGNS: Record<ChangeLine['sign'], string> = { '+': '+', '-': '-', ' ': ' ', gap: '' }

interface NumberedLine extends ChangeLine {
  readonly number: number | null
}

/**
 * The lines of a change, numbered where a number can be justified.
 *
 * A removed line belongs to the file as it was, and that is not something we
 * kept — so its gutter stays empty. Numbering it from the new file would be out
 * by every line the change added, and a line number is read as fact.
 *
 * Without context the numbers are left off entirely rather than started from
 * one: an edit does not begin at the top of its file, and saying so would be
 * the same lie more confidently told.
 */
function numbered(change: Change, context: ChangeContext | null): readonly NumberedLine[] {
  if (!context) return change.lines.map((line) => ({ ...line, number: null }))

  const lines: NumberedLine[] = context.before.map((text, offset) => ({
    sign: ' ' as const,
    text,
    number: context.startLine - context.before.length + offset
  }))

  // The unchanged and added lines are the file as it now stands, in order, so
  // they take the numbers in turn. A removed line takes none and holds none up.
  let number = context.startLine
  for (const line of change.lines) {
    lines.push({ ...line, number: line.sign === '-' ? null : number })
    if (line.sign !== '-') number++
  }

  for (const [offset, text] of context.after.entries()) {
    lines.push({ sign: ' ', text, number: number + offset })
  }

  return lines
}

/**
 * What a call did to a file, drawn under its row.
 *
 * The arguments carry it already — an `Edit` is handed the text it replaces and
 * the text it writes — so this needs nothing from disk and draws the same on a
 * conversation read back after a restart. The lines it landed among are the one
 * thing the arguments cannot carry, which is why `context` arrives separately.
 *
 * The first few lines show under the row as Claude Code shows them, and the
 * rest are a click away: the median change is two lines, and a file written
 * whole runs to hundreds that must not push the conversation off the screen.
 */
export function DiffPreview({
  change,
  context,
  limit
}: {
  readonly change: Change
  readonly context: ChangeContext | null
  /** How many lines to show before offering the rest; null for all of them. */
  readonly limit: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const [all, setAll] = useState(false)

  const lines = numbered(change, context)
  // In the file's colours, as the diff pane draws the same lines. One text for
  // the whole change, so a line continuing a string or a comment is coloured
  // as one.
  const { tokens } = useColouredText(change.path, lines.map((line) => line.text).join('\n'))
  const shown = all || limit === null ? lines : lines.slice(0, limit)
  const hidden = lines.length - shown.length

  return (
    <div className="border-line min-w-0 overflow-hidden rounded-[var(--radius-control)] border">
      <div className="diff-code max-h-96 overflow-auto py-1 font-mono text-[11px] leading-relaxed">
        {shown.map((line, index) =>
          line.sign === 'gap' ? (
            <div key={index} aria-hidden className="text-ink-faint px-2.5 select-none">
              ⋯
            </div>
          ) : (
            <div key={index} className={`flex gap-2 px-2.5 ${CHANGE_TONES[line.sign]}`}>
              <span className="text-ink-faint w-8 shrink-0 text-right tabular-nums select-none">
                {line.number}
              </span>
              <span className="text-ink-faint w-2 shrink-0 select-none">{SIGNS[line.sign]}</span>
              <span className="text-ink min-w-0 whitespace-pre-wrap">
                <ColouredLine text={line.text} tokens={tokens?.[index]} />
              </span>
            </div>
          )
        )}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => {
            setAll(true)
          }}
          className="border-line text-ink-faint hover:text-ink focus-ring w-full border-t px-2.5 py-1 text-left text-[11px]"
        >
          {t('chat.diffMoreLines', { count: hidden })}
        </button>
      )}
    </div>
  )
}
