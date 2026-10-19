import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkingMode } from '@core/chats.js'

import { Button } from '../Button.js'
import { Modal } from '../Modal.js'
import { SendButton } from './SendButton.js'
import { Markdown } from './Markdown.js'

interface PlanDialogProps {
  /** The plan as the agent wrote it. */
  readonly plan: string
  /**
   * The plan as it stands in the editor: the user's own words, or the agent's
   * until they change them.
   *
   * Held by the pane rather than here, and keyed by the request it belongs to:
   * the dialog is only mounted while its conversation is showing, so state kept
   * in it was lost on every switch of tab — and a state seeded once would have
   * gone on describing a plan the agent had since replaced.
   */
  readonly text: string
  readonly onText: (text: string) => void
  /**
   * The mode executing moves the conversation to, when it moves at all — only
   * out of planning, since a plan the agent offered unasked changes no mode.
   * `acceptEdits` or `auto`, whichever the settings name, and `auto` for a
   * conversation already in it.
   */
  readonly goesOnIn: WorkingMode | null
  /**
   * Approves the plan. `editedPlan` is the user's own version when they changed
   * it, and null when they did not — so the agent is only ever told a plan is
   * different when it is.
   */
  readonly onExecute: (editedPlan: string | null) => void
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
 * dialog again.
 *
 * Executing out of planning goes on in `acceptEdits`, whatever the
 * conversation was asking before — the composer's one mode control has no
 * second half left to say otherwise — or back in `auto` for a conversation
 * that was there. Either widens what the agent may do, so the line beside the
 * button says it before the click rather than the footer after it.
 */
export function PlanDialog({
  plan,
  text,
  onText,
  goesOnIn,
  onExecute,
  onKeepPlanning
}: PlanDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [feedback, setFeedback] = useState('')
  const [editing, setEditing] = useState(false)

  // Null for an untouched plan, and for one edited back to what it was: only a
  // real difference is worth telling the agent about.
  const changed = text.trim() !== plan.trim() && text.trim() !== ''

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
        <>
          {goesOnIn !== null && (
            <span className="text-ink-soft mr-auto text-[11px]">
              {t(goesOnIn === 'auto' ? 'chat.planExecuteHintAuto' : 'chat.planExecuteHint')}
            </span>
          )}
          <Button
            onClick={() => {
              setEditing((current) => !current)
            }}
          >
            {editing ? t('chat.planEditDone') : t('chat.planEdit')}
          </Button>
          <Button
            variant="accent"
            // An emptied editor is not a plan. Approving the original under it
            // would do something the field plainly says it is not doing.
            disabled={text.trim() === ''}
            onClick={() => {
              onExecute(changed ? text.trim() : null)
            }}
          >
            {t('chat.planExecute')}
          </Button>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {editing ? (
          <textarea
            aria-label={t('chat.planEditLabel')}
            value={text}
            onChange={(event) => {
              onText(event.target.value)
            }}
            // Monospace, because what is being edited is markdown: the markers
            // are the thing being worked on, and a proportional face hides them.
            className="focus-ring border-line bg-surface field-sizing-content min-h-[12rem] w-full resize-none rounded-[var(--radius-control)] border px-2.5 py-1.5 font-mono text-[12px] outline-none"
          />
        ) : (
          <Markdown text={text} />
        )}
      </div>

      <div className="border-line shrink-0 border-t px-4 py-3">
        <label className="text-ink-soft block text-[11px]" htmlFor="plan-feedback">
          {t('chat.planFeedback')}
        </label>
        <div className="relative mt-1">
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
              // `isComposing` for the reason the composer gives: the Enter that
              // confirms an IME candidate is not the one that sends.
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              event.preventDefault()
              keepPlanning()
            }}
            // Grows with the note, as the composer's own field does, so a
            // sentence gets one line and a list of corrections gets room.
            className="focus-ring border-line bg-surface field-sizing-content max-h-40 min-h-[2.5rem] w-full resize-none rounded-[var(--radius-control)] border py-1.5 pr-10 pl-2.5 outline-none"
          />
          {/* Beside the field it answers, as in the composer: the key is not
              the only way to send the note. Never disabled — a plan sent back
              with nothing written is a valid answer. */}
          <span className="absolute right-2 bottom-2">
            <SendButton label={t('chat.planSendFeedback')} onClick={keepPlanning} />
          </span>
        </div>
      </div>
    </Modal>
  )
}
