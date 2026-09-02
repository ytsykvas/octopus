import { MessageCircleQuestion } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { QuestionAnswer, UserQuestion, UserQuestions } from '@core/questions.js'

import { Button } from '../Button.js'
import { shown } from '../diff/shown.js'
import { Markdown } from './Markdown.js'

interface QuestionCardProps {
  readonly questions: UserQuestions
  /** False once the turn has moved on: the card becomes a record of itself. */
  readonly answerable: boolean
  /** What was chosen, when this is being read back rather than answered. */
  readonly answered: readonly QuestionAnswer[] | null
  readonly onAnswer: (answers: readonly QuestionAnswer[]) => void
  /** Runs the tool with no answers, which the agent reads as "ask me again". */
  readonly onSkip: () => void
}

/**
 * One question's answer as it is being written.
 *
 * `other` is null when that choice is not ticked and a string — empty
 * included — when it is. Emptiness cannot stand for "not ticked": someone who
 * ticks it and deletes what they typed has not untied it, and the field
 * disappearing under them would be the field fighting back.
 */
interface Choice {
  readonly selected: readonly string[]
  readonly other: string | null
}

const NOTHING_CHOSEN: Choice = { selected: [], other: null }

/** Answers so far, keyed by the question's own text — what the tool keys on. */
type Draft = Record<string, Choice>

/**
 * The agent's own question, with its options, in the log.
 *
 * A card rather than a dialog. The plan gets a dialog because it is the
 * substance of a turn and was read past as a strip; a question is the opposite
 * case — the answer belongs to the conversation and stays worth reading a month
 * later, and a modal would cover the very context the choice is made from.
 *
 * Native radios and checkboxes rather than styled buttons: they bring keyboard
 * movement, grouping and screen-reader semantics that a div would have to
 * reimplement, and the design system has no control of its own for this.
 */
export function QuestionCard({
  questions,
  answerable,
  answered,
  onAnswer,
  onSkip
}: QuestionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>({})
  /**
   * Which option's preview is on screen.
   *
   * Follows the pointer and the focus, because that is what a preview is for:
   * comparing options while choosing between them, rather than confirming one
   * already chosen.
   */
  const [showing, setShowing] = useState<string | null>(null)

  const choiceFor = (question: UserQuestion): Choice => draft[question.question] ?? NOTHING_CHOSEN

  const answers: readonly QuestionAnswer[] = questions.questions.map((question) => {
    const choice = choiceFor(question)
    const other = choice.other?.trim() ?? ''

    return {
      question: question.question,
      selected: [...choice.selected],
      other: other === '' ? null : other
    }
  })

  const anythingChosen = answers.some(
    (answer) => answer.selected.length > 0 || answer.other !== null
  )

  const put = (question: UserQuestion, choice: Choice): void => {
    setDraft((current) => ({ ...current, [question.question]: choice }))
  }

  const pick = (question: UserQuestion, label: string): void => {
    const choice = choiceFor(question)

    if (!question.multiSelect) {
      // One answer replaces another, and puts away anything typed as "other" —
      // there they are alternatives rather than additions.
      put(question, { selected: [label], other: null })
      return
    }

    put(question, {
      ...choice,
      selected: choice.selected.includes(label)
        ? choice.selected.filter((kept) => kept !== label)
        : [...choice.selected, label]
    })
  }

  const pickOther = (question: UserQuestion): void => {
    const choice = choiceFor(question)
    const opening = choice.other === null

    put(question, {
      // Same rule as above: in a single-answer question "other" is one of the
      // answers, so choosing it clears the option that was ticked.
      selected: question.multiSelect ? choice.selected : [],
      other: opening ? '' : null
    })
  }

  return (
    <div className="border-line rounded-[var(--radius-panel)] border">
      <p className="border-line text-ink-soft flex items-center gap-2 border-b px-3 py-2 text-[11px]">
        <MessageCircleQuestion aria-hidden size={12} />
        {t('chat.questionTitle')}
      </p>

      <div className="flex flex-col gap-4 px-3 py-2.5">
        {questions.questions.map((question, index) => {
          const recorded = answered?.find((entry) => entry.question === question.question)
          // While it can be answered the card shows the draft; afterwards it
          // shows what was actually sent, which is the whole reason that answer
          // is written to the transcript.
          const choice = answerable
            ? choiceFor(question)
            : { selected: recorded?.selected ?? [], other: recorded?.other ?? null }

          // The name has to be unique per question or two radio groups on one
          // card would fight over the same selection.
          const group = `q${String(index)}`

          return (
            <fieldset key={question.question} className="min-w-0">
              {/* The chip sits inside the legend rather than above it. A
                  fieldset lifts its legend to the top of the box whatever the
                  source order, so a chip written first rendered second. */}
              {/* Every string here is the agent's, so it goes through `shown`
                  for the reason the chat's other surfaces do: an override
                  reorders what is read while the label sent back is untouched,
                  and this card is answered rather than merely read. The label
                  keeps its raw form as the key and as the answer — only what
                  is drawn is substituted. */}
              <legend className="font-medium">
                {question.header !== '' && (
                  <span className="bg-muted text-ink-soft mb-1 block w-fit rounded-[4px] px-1.5 py-0.5 text-[11px] font-normal">
                    {shown(question.header)}
                  </span>
                )}
                {shown(question.question)}
              </legend>

              <div className="mt-1.5 flex flex-col gap-1">
                {question.options.map((option) => (
                  <div key={option.label} className="min-w-0">
                    <label
                      className="hover:bg-muted/60 flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] px-1 py-0.5 transition-colors"
                      onMouseEnter={() => {
                        setShowing(option.label)
                      }}
                    >
                      <input
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        name={group}
                        checked={choice.selected.includes(option.label)}
                        disabled={!answerable}
                        onChange={() => {
                          pick(question, option.label)
                        }}
                        onFocus={() => {
                          setShowing(option.label)
                        }}
                        // `mt-1` rather than a baseline alignment: the control
                        // is a box with no text in it, so it has no baseline of
                        // its own to sit on.
                        className="choice focus-ring mt-1"
                      />
                      <span className="min-w-0">
                        <span className="font-medium">{shown(option.label)}</span>
                        {option.description !== '' && (
                          <span className="text-ink-soft"> — {shown(option.description)}</span>
                        )}
                      </span>
                    </label>

                    {/* Under the option it belongs to, and only while that one
                        is being looked at: four mock-ups open at once is a wall
                        rather than a comparison. */}
                    {option.preview !== undefined && showing === option.label && (
                      <div className="border-line text-ink-soft mt-1 mb-1 ml-6 border-l pl-3 text-[11px]">
                        <Markdown text={option.preview} />
                      </div>
                    )}
                  </div>
                ))}

                <label className="hover:bg-muted/60 flex cursor-pointer items-start gap-2 rounded-[var(--radius-control)] px-1 py-0.5 transition-colors">
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name={group}
                    checked={choice.other !== null}
                    disabled={!answerable}
                    onChange={() => {
                      pickOther(question)
                    }}
                    className="choice focus-ring mt-1"
                  />
                  <span>{t('chat.questionOther')}</span>
                </label>

                {choice.other !== null && (
                  <textarea
                    value={choice.other}
                    disabled={!answerable}
                    placeholder={t('chat.questionOtherPlaceholder')}
                    // Not the checkbox's own label: two controls answering to
                    // one name is ambiguous to anyone reaching for either.
                    aria-label={t('chat.questionOtherPlaceholder')}
                    onChange={(event) => {
                      put(question, { ...choice, other: event.target.value })
                    }}
                    className="focus-ring border-line bg-surface field-sizing-content mt-0.5 ml-6 max-h-40 min-h-[2rem] resize-none rounded-[var(--radius-control)] border px-2 py-1 outline-none disabled:opacity-70"
                  />
                )}
              </div>
            </fieldset>
          )
        })}
      </div>

      <div className="border-line flex items-center gap-2 border-t px-3 py-2">
        {answerable ? (
          <>
            <Button
              variant="accent"
              size="sm"
              disabled={!anythingChosen}
              onClick={() => {
                onAnswer(answers)
              }}
            >
              {t('chat.questionSend')}
            </Button>

            {/* The tool's own affordance: it runs with nothing filled in, and
                the agent reads that as "nobody answered" — its cue to ask again
                rather than to guess. */}
            <Button size="sm" onClick={onSkip}>
              {t('chat.questionSkip')}
            </Button>
          </>
        ) : (
          <p className="text-ink-faint text-[11px]">
            {answered === null ? t('chat.questionUnanswered') : t('chat.questionAnswered')}
          </p>
        )}
      </div>
    </div>
  )
}
