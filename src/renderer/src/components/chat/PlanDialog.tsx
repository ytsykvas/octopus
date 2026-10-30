import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkingMode } from '@core/chats.js'

import { Button } from '../Button.js'
import { Modal } from '../Modal.js'
import { SendButton } from './SendButton.js'
import { isSubmitEnter } from './submitKey.js'
import { Markdown } from './Markdown.js'
import { insertAtCaret } from './attachments.js'
import { PromptFan } from './PromptFan.js'

interface PlanDialogProps {
  /**
   * The project whose saved prompts the field offers, beside the installation's.
   * Only the ones marked for the plan: this is where a plan is decided about,
   * and a prompt for something else is a distraction at the moment the agent is
   * blocked on the answer.
   */
  readonly projectId: string
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
   * The note in the field, held by the pane for the same reason as `text`:
   * minimising unmounts the dialog, and a half-written correction must be there
   * when it comes back.
   */
  readonly feedback: string
  readonly onFeedback: (feedback: string) => void
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
  /**
   * Carries the plan out in a fork of the conversation instead, leaving this
   * one in planning. `editedPlan` as for `onExecute`. Settles once the fork has
   * either started or failed.
   */
  readonly onFork: (editedPlan: string | null) => Promise<void>
  /** Sends the plan back with the user's note, which may be empty. */
  readonly onKeepPlanning: (feedback: string) => void
  /**
   * Sets the dialog aside without answering, to look something up before
   * replying. The agent stays waiting; the pane keeps a way back on screen.
   */
  readonly onMinimize: () => void
}

/**
 * The question a finished plan asks.
 *
 * A dialog rather than another row in the log, because a plan is not a tool
 * call that happens to need approving — it is the substance of the turn, and as
 * a strip with `Allow` and `Deny` on it the whole thing was read past on the way
 * to a button. The next thing the agent did was start editing files.
 *
 * Two ways to carry it out, and a field. Writing in the field *is* carrying on
 * planning, so a button saying so was the same decision offered twice; the note
 * travels to the agent as the refusal's reason, and the plan it comes back with
 * raises this dialog again. Forking carries the plan out in a new conversation
 * that is given the plan and nothing else, while this one stays in planning —
 * for a plan worth keeping the planning context clean of the work, and the
 * work free of the planning.
 *
 * Executing out of planning goes on in `acceptEdits`, whatever the
 * conversation was asking before — the composer's one mode control has no
 * second half left to say otherwise — or back in `auto` for a conversation
 * that was there. Either widens what the agent may do, so the line beside the
 * button says it before the click rather than the footer after it.
 *
 * Minimising is the one way out that answers nothing. A plan often sends the
 * reader to a file or the diff before they know what to say back, and the
 * dialog took the whole window to do it. The pane draws a strip above the
 * composer while it is set aside, so the question the agent is blocked on stays
 * on screen.
 */
export function PlanDialog({
  projectId,
  plan,
  text,
  onText,
  feedback,
  onFeedback,
  goesOnIn,
  onExecute,
  onFork,
  onKeepPlanning,
  onMinimize
}: PlanDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  // One fork at a time, and no approval behind one: a second click while the
  // first is out would open a second tab, and approving here would start the
  // same work twice.
  const [forking, setForking] = useState(false)

  // Null for an untouched plan, and for one edited back to what it was: only a
  // real difference is worth telling the agent about.
  const changed = text.trim() !== plan.trim() && text.trim() !== ''

  const keepPlanning = (): void => {
    onKeepPlanning(feedback.trim())
  }

  const feedbackField = useRef<HTMLTextAreaElement>(null)
  /** Where the caret was last seen in the field, for a prompt written in from the fan. */
  const caret = useRef(feedback.length)
  /** Where the caret goes once the next value has been written, or null. */
  const caretAfterWrite = useRef<number | null>(null)

  // After the value has been drawn: a caret set before it would be set in the
  // text as it was, and moved again by the new value.
  useEffect(() => {
    if (caretAfterWrite.current === null) return

    feedbackField.current?.setSelectionRange(caretAfterWrite.current, caretAfterWrite.current)
    caretAfterWrite.current = null
  }, [feedback])

  // A saved prompt is written where the caret is, as the composer's is — text
  // the reader can still change before the note goes, and sent as the reason the
  // plan was sent back.
  const insertPrompt = (promptText: string): void => {
    const next = insertAtCaret(feedback, caret.current, promptText)
    caret.current = next.caret
    caretAfterWrite.current = next.caret
    onFeedback(next.draft)
    feedbackField.current?.focus()
  }

  const edited = changed ? text.trim() : null
  // An emptied editor is not a plan. Carrying out the original under it would
  // do something the field plainly says it is not doing.
  const unusable = text.trim() === '' || forking

  return (
    <Modal
      title={t('chat.planReady')}
      // Escape means "keep planning", carrying whatever has been typed. The
      // agent is blocked on this answer, so a dismissal that resolved nothing
      // would leave the conversation waiting on a question no longer on screen
      // — and this dialog would simply reopen on the next render.
      onClose={keepPlanning}
      onMinimize={onMinimize}
      footer={
        <>
          {goesOnIn !== null && (
            <span className="text-ink-soft mr-auto min-w-0 flex-1 text-[11px]">
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
          {/* Outlined, so executing is the one filled action: two coloured
              buttons side by side asked the eye to choose before the reader had. */}
          <Button
            disabled={unusable}
            onClick={() => {
              setForking(true)
              void onFork(edited).finally(() => {
                setForking(false)
              })
            }}
          >
            {t('chat.planFork')}
          </Button>
          <Button
            variant="success"
            disabled={unusable}
            onClick={() => {
              onExecute(edited)
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
            ref={feedbackField}
            value={feedback}
            placeholder={t('chat.planFeedbackPlaceholder')}
            onChange={(event) => {
              caret.current = event.target.selectionStart
              onFeedback(event.target.value)
            }}
            // The caret also moves without the text changing — arrows, a click —
            // and a prompt chosen from the fan is written at it.
            onSelect={(event) => {
              caret.current = event.currentTarget.selectionStart
            }}
            // The composer's keys, so there is one convention rather than two —
            // and with no second button, this is what sends the note at all.
            onKeyDown={(event) => {
              if (!isSubmitEnter(event)) return
              event.preventDefault()
              keepPlanning()
            }}
            // Grows with the note, as the composer's own field does, so a
            // sentence gets one line and a list of corrections gets room.
            // `block`: an inline textarea leaves a descender gap under it, which
            // makes the wrapper taller than the field and drops the button,
            // positioned from the wrapper's bottom, below the text's line.
            className="focus-ring border-line bg-surface field-sizing-content block max-h-40 min-h-[2.5rem] w-full resize-none rounded-[var(--radius-control)] border py-1.5 pr-16 pl-2.5 outline-none"
          />
          {/* Beside the field it answers, as in the composer: the key is not
              the only way to send the note. Never disabled — a plan sent back
              with nothing written is a valid answer. */}
          <span className="absolute right-2 bottom-2 flex items-center gap-1">
            <PromptFan projectId={projectId} planOnly onPick={insertPrompt} />
            <SendButton label={t('chat.planSendFeedback')} onClick={keepPlanning} />
          </span>
        </div>
      </div>
    </Modal>
  )
}
