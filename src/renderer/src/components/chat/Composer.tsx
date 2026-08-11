import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ComposerProps {
  readonly busy: boolean
  readonly onSend: (text: string) => void
  readonly onStop: () => void
}

/**
 * The input field.
 *
 * Enter sends and shift+enter breaks the line, which is what every chat does —
 * and prompts are usually one line. The field grows with the text up to a
 * point, past which it scrolls: a prompt long enough to fill the pane would
 * push the conversation it refers to off the screen.
 */
export function Composer({ busy, onSend, onStop }: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const trimmed = draft.trim()

  const submit = (): void => {
    if (trimmed === '') return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="border-line bg-canvas border-t px-6 py-3">
      <div className="border-line bg-surface focus-within:border-line-strong mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[var(--radius-panel)] border px-2.5 py-2 transition-colors">
        <textarea
          value={draft}
          rows={1}
          placeholder={t('chat.placeholder')}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            submit()
          }}
          className="focus-ring max-h-48 min-h-[1.4rem] flex-1 resize-none bg-transparent outline-none"
        />

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            title={t('chat.stop')}
            aria-label={t('chat.stop')}
            // Filled danger, the same treatment `Button`'s destructive variant
            // uses: it sits where send sits, and the two have to be told apart
            // at a glance by someone already reaching for that corner.
            className="focus-ring bg-danger grid size-6 shrink-0 place-items-center rounded-full text-white transition-[filter] hover:brightness-110"
          >
            {/* A plain square rather than the icon of one. At this size a
                stroked glyph is mostly stroke: two units of it on a nine-pixel
                shape, rounded at the joins, spill past the geometry and land
                the mark off centre. A span has no viewBox, no stroke and no
                baseline, so the grid centres it exactly. */}
            <span aria-hidden className="size-2 rounded-[2px] bg-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={trimmed === ''}
            title={t('chat.send')}
            aria-label={t('chat.send')}
            className="focus-ring bg-accent text-on-accent hover:bg-accent-hover grid size-6 shrink-0 place-items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            <ArrowUp aria-hidden size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
