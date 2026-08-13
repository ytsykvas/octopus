import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import { Modal } from '../Modal.js'
import { Markdown } from './Markdown.js'

interface PlanDialogProps {
  readonly plan: string
  readonly onExecute: () => void
  /** Sends the plan back with the user's note, which may be empty. */
  readonly onKeepPlanning: (feedback: string) => void
}

/**
 * The question a finished plan asks.
 *
 * A dialog rather than another row in the log, because a plan is not a tool
 * call that happens to need approving — it is the substance of the turn, and as
 * a strip with `Allow` and `Deny` on it the whole thing was read past on the way
 * to a button. The next thing the agent did was start editing files.
 *
 * One button, and a field. Writing in the field *is* carrying on planning, so a
 * button saying so was the same decision offered twice; the note travels to the
 * agent as the refusal's reason, and the plan it comes back with raises this
 * dialog again. Nor does the button name a mode any more: that is chosen in the
 * composer's footer, which is what the session actually runs under and is on
 * screen behind the backdrop.
 */
export function PlanDialog({
  plan,
  onExecute,
  onKeepPlanning
}: PlanDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState('')

  const keepPlanning = (): void => {
    onKeepPlanning(feedback.trim())
  }

  return (
    <Modal
      title={t('chat.planReady')}
      // Escape means "keep planning", carrying whatever has been typed. The
      // agent is blocked on this answer, so a dismissal that resolved nothing
      // would leave the conversation waiting on a question no longer on screen
      // — and this dialog would simply reopen on the next render.
      onClose={keepPlanning}
      footer={
        <Button variant="accent" onClick={onExecute}>
          {t('chat.planExecute')}
        </Button>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <Markdown text={plan} />
      </div>

      <div className="border-line shrink-0 border-t px-4 py-3">
        <label className="text-ink-soft block text-[11px]" htmlFor="plan-feedback">
          {t('chat.planFeedback')}
        </label>
        <textarea
          id="plan-feedback"
          value={feedback}
          placeholder={t('chat.planFeedbackPlaceholder')}
          onChange={(event) => {
            setFeedback(event.target.value)
          }}
          // The composer's keys, so there is one convention rather than two —
          // and with no second button, this is what sends the note at all.
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            keepPlanning()
          }}
          // Grows with the note, as the composer's own field does, so a
          // sentence gets one line and a list of corrections gets room.
          className="focus-ring border-line bg-surface field-sizing-content mt-1 max-h-40 min-h-[2.5rem] w-full resize-none rounded-[var(--radius-control)] border px-2.5 py-1.5 outline-none"
        />
      </div>
    </Modal>
  )
}
