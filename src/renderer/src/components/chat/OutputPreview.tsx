import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { shown } from '../diff/shown.js'
import type { ToolResult } from './logBlocks.js'
import { cleanOutput } from './toolViews.js'

/** Lines drawn at a time: enough to read, short of a whole file in the DOM. */
export const OUTPUT_PAGE = 200

/**
 * What a tool said, in full, inside an opened row.
 *
 * Paged rather than drawn whole: a live `Read` of three thousand lines is all
 * here, and putting it in the document at once would cost every opened row
 * that much layout for lines nobody scrolled to. Capped in height as well, so
 * an opened row never pushes the conversation away.
 *
 * A conversation read back after a restart kept only the head of each output,
 * and says so rather than letting the head pass for the whole.
 */
export function OutputPreview({ result }: { readonly result: ToolResult }): React.JSX.Element {
  const { t } = useTranslation()
  const [pages, setPages] = useState(1)

  const lines = cleanOutput(result.content).split('\n')
  const drawn = lines.slice(0, pages * OUTPUT_PAGE)
  const more = lines.length - drawn.length

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* `wrap-anywhere` rather than `break-all`, which chops ordinary words
          mid-character; pre-*wrap* because the log scrolls and an unbroken
          line would take it sideways. */}
      <pre
        className={`bg-surface border-line max-h-80 overflow-auto rounded-[var(--radius-control)] border px-2.5 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-anywhere ${
          result.ok ? 'text-ink-soft' : 'text-danger'
        }`}
      >
        {shown(drawn.join('\n'))}
      </pre>

      {more > 0 && (
        <button
          type="button"
          onClick={() => {
            setPages((count) => count + 1)
          }}
          className="text-ink-faint hover:text-ink focus-ring self-start text-[11px]"
        >
          {t('chat.outputMoreLines', { count: Math.min(more, OUTPUT_PAGE) })}
        </button>
      )}

      {result.truncated === true && (
        <p className="text-ink-faint text-[11px]">
          {result.lineCount === undefined
            ? t('chat.outputSavedHead')
            : t('chat.outputSavedHeadOf', { count: result.lineCount })}
        </p>
      )}
    </div>
  )
}
