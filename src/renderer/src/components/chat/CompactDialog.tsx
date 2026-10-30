import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import { Modal } from '../Modal.js'
import { isSubmitEnter } from './submitKey.js'

interface CompactDialogProps {
  /** Trimmed and never empty. */
  readonly onCompact: (instructions: string) => void
  readonly onClose: () => void
}

/**
 * What to leave out of the conversation when it is compacted, asked first.
 *
 * No API removes a single message from the middle of a conversation; the text
 * after `/compact` is what the CLI's summary keeps and drops, and it is the one
 * supported way to say what survives. So this asks for that text and sends it
 * exactly as written — §4 of `docs/PROJECT.md`, nothing of ours added to it.
 * The agent writes the summary, which makes it a request and not a guarantee,
 * and the hint under the field says so.
 */
export function CompactDialog({ onCompact, onClose }: CompactDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState('')

  // A bare `/compact` is the other button's; this one is for saying something.
  const submit = (): void => {
    const instructions = text.trim()
    if (instructions === '') return
    onCompact(instructions)
  }

  return (
    <Modal
      size="sm"
      title={t('chat.compactExplainTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t('chat.compactExplainCancel')}
          </Button>
          <Button variant="accent" disabled={text.trim() === ''} onClick={submit}>
            {t('chat.compactExplainSend')}
          </Button>
        </>
      }
    >
      <div className="space-y-2 px-4 py-3">
        <label htmlFor="compact-instructions" className="text-ink-soft block text-[11px]">
          {t('chat.compactExplainLabel')}
        </label>
        <textarea
          id="compact-instructions"
          autoFocus
          value={text}
          placeholder={t('chat.compactExplainPlaceholder')}
          onChange={(event) => {
            setText(event.target.value)
          }}
          // The composer's keys, so there is one convention and not two.
          onKeyDown={(event) => {
            if (!isSubmitEnter(event)) return
            event.preventDefault()
            submit()
          }}
          className="focus-ring border-line bg-surface field-sizing-content block max-h-40 min-h-[4.5rem] w-full resize-none rounded-[var(--radius-control)] border px-2.5 py-1.5 outline-none"
        />
        <p className="text-ink-faint text-[11px]">{t('chat.compactExplainHint')}</p>
      </div>
    </Modal>
  )
}
