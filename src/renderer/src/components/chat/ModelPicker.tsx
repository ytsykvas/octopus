import { Map, PencilLine, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  type AgentModel,
  type ChatModels,
  choosePlan,
  chooseWork,
  findAgentModel,
  type JobPair,
  modelPair,
  planInForce,
  storedModels
} from '@core/chats.js'

import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'
import { ComposerChip } from './ComposerChip.js'
import { modelRows } from './modelRows.js'

interface ModelPickerProps {
  /** What the agent last said this account may use; empty on a first run. */
  readonly models: readonly AgentModel[]
  /** The model that writes the code; null is the agent's own default. */
  readonly model: string | null
  /** The model that plans; null means the one above does both jobs. */
  readonly planModel: string | null
  /** Both, as they are to be stored after a click. */
  readonly onChange: (models: ChatModels) => void
  /**
   * What the chip says: the model in force, which the caller works out.
   *
   * Passed rather than derived here because two facts decide it and both live
   * in the composer — whether this conversation is planning, and what a
   * `/model` command moved the running session to behind the record's back.
   */
  readonly display: string
  /**
   * The model a `/model` command moved this session to, when the columns do
   * not tick it; null otherwise.
   *
   * The CLI scopes the command to the session, so the record — what the
   * columns tick — rightly stays put. Without a line saying so the panel read
   * as the model the next message would run on, contradicting the chip.
   */
  readonly sessionMovedTo: string | null
}

/**
 * Two columns of names, and the room the pair needs.
 *
 * Wide enough that both lists sit side by side, which is the whole argument for
 * the panel: the question is not "which model" twice but "which of these two
 * does which job", and an answer you have to scroll between halves of is that
 * question asked twice again.
 */
const PANEL_WIDTH = 420

/** Enough per row, per heading and per title to flip the panel in time. */
const ROW_HEIGHT = 30
const HEADING_HEIGHT = 26
const TITLE_HEIGHT = 30
/**
 * The `/model` line, counted as three lines: two in English at this width, and
 * a longer translation or a raw model id can take a third. Erring high only
 * flips the panel a little sooner.
 */
const MOVED_LINE_HEIGHT = 64

/** What the columns sit inside, counted so the estimate errs high. */
const PANEL_PADDING = 12

/** One choice in a column, already resolved to what clicking it does. */
interface Choice {
  readonly key: string
  readonly label: string
  /** A faint second line: what "the same as plan" resolves to, or "by default". */
  readonly note: string
  readonly selected: boolean
  readonly onSelect: () => void
}

/**
 * Which model plans and which one writes the code.
 *
 * The plan is the choice and the writing may follow it, so "the same" sits at
 * the head of the writing column. Every click goes through `choosePlan` and
 * `chooseWork`, which say what that means for the two stored fields.
 *
 * The composer's model chip, and it opens a panel rather than a list because
 * the question has two halves now. Neither answer means much alone: a
 * conversation runs one model until these two differ, and the moment they do,
 * the difference is the interesting fact.
 *
 * No second control was added for it. A chip for the plan model beside the one
 * for the coding model would be two settings in a row that already holds three,
 * with nothing on screen saying they are two halves of one question.
 *
 * Placed by `useAnchoredPanel`, which the effort scale uses too.
 *
 * **A click leaves the panel open**, which is the one way it differs from every
 * menu in the app. Two columns is two answers, and closing on the first would
 * make setting both a matter of opening the thing twice.
 */
export function ModelPicker({
  models,
  model,
  planModel,
  onChange,
  display,
  sessionMovedTo
}: ModelPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { open, position, container, toggle } = useAnchoredPanel()

  const labels = { fallback: t('chat.modelDefault'), note: t('chat.modelDefaultNote') }
  const pair = modelPair({ model, planModel })
  const plan = planInForce(pair)
  const split = planModel !== null
  const choose = (next: JobPair<string>): void => {
    onChange(storedModels(next))
  }

  // Two calls rather than one shared list: each column pins its own value, and
  // `modelRows` keeps a pinned model the catalogue has since forgotten. Shared,
  // one column would drop the row the other one is running on.
  const planRows = modelRows(models, labels, plan)
  const codeRows = modelRows(models, labels, model)

  /*
   * Which row each column ticks, matched through the catalogue rather than by
   * string equality: the record may hold `claude-sonnet-5` while the list
   * offers the row called `sonnet`, and compared as text the two read as
   * different models — nothing would be ticked at all. `modelRows` pins the
   * plan's value, so it always finds a row; the fallback is for the type.
   */
  /* v8 ignore next */
  const chosenPlan = findAgentModel(planRows, plan) ?? planRows[0]
  const chosenCode = split ? findAgentModel(codeRows, pair.work) : undefined

  const planChoices: readonly Choice[] = planRows.map((row, index) => ({
    key: row.value,
    label: row.displayName,
    // Only under the head row, and only the wording `modelRows` put there — it
    // empties the description when the default has no real name to wear, which
    // is exactly when "by default" underneath would say it twice.
    note: index === 0 ? row.description : '',
    selected: chosenPlan.value === row.value,
    onSelect: () => {
      choose(choosePlan(pair, row.value))
    }
  }))

  const codeChoices: readonly Choice[] = [
    {
      key: 'same',
      label: t('chat.modelsSameAsPlan'),
      // Named rather than left as "the same": the row is ticked precisely when
      // the reader wants to know what writing will actually run on.
      note: chosenPlan.displayName,
      selected: !split,
      onSelect: () => {
        choose(chooseWork(pair, null))
      }
    },
    ...codeRows.map((row, index) => ({
      key: row.value,
      label: row.displayName,
      note: index === 0 ? row.description : '',
      selected: chosenCode?.value === row.value,
      onSelect: () => {
        choose(chooseWork(pair, row.value))
      }
    }))
  ]

  // The taller column decides how much room to ask for.
  const rows = Math.max(codeChoices.length, planChoices.length)
  const height =
    TITLE_HEIGHT +
    (sessionMovedTo === null ? 0 : MOVED_LINE_HEIGHT) +
    HEADING_HEIGHT +
    rows * ROW_HEIGHT +
    PANEL_PADDING

  return (
    <div ref={container} className="contents">
      <ComposerChip
        label={t('chat.model')}
        value={display}
        open={open}
        popup="dialog"
        icon={<Sparkles aria-hidden size={12} />}
        onClick={(event) => {
          event.stopPropagation()
          toggle(event.currentTarget, { width: PANEL_WIDTH, height })
        }}
      />

      {open && position && (
        <div
          role="dialog"
          aria-label={t('chat.modelsTitle')}
          style={{ ...position, width: PANEL_WIDTH }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border shadow-[var(--shadow-pop)]"
        >
          <p className="border-line text-ink-faint border-b px-3 py-2">{t('chat.modelsTitle')}</p>
          {sessionMovedTo !== null && (
            <p className="border-line text-ink-soft border-b px-3 py-2">
              {t('chat.modelsSessionOnly', { model: sessionMovedTo })}
            </p>
          )}

          <div className="flex">
            <Column
              heading={t('chat.modelsPlan')}
              icon={<Map aria-hidden size={12} />}
              choices={planChoices}
            />
            <div aria-hidden className="bg-line w-px" />
            <Column
              heading={t('chat.modelsCode')}
              icon={<PencilLine aria-hidden size={12} />}
              choices={codeChoices}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One job and the models that could do it.
 *
 * A radio group rather than a menu: every row is the same question answered
 * differently, and only one of them is true at a time. Names only — the
 * descriptions the agent writes run to a sentence and would turn a column two
 * hundred pixels wide into a paragraph.
 */
function Column({
  heading,
  icon,
  choices
}: {
  heading: string
  icon: React.ReactNode
  choices: readonly Choice[]
}): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1 p-1">
      <p className="text-ink-faint flex items-center gap-1.5 px-2 py-1.5">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{heading}</span>
      </p>

      <div role="radiogroup" aria-label={heading}>
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            role="radio"
            aria-checked={choice.selected}
            onClick={choice.onSelect}
            className={`row focus-ring flex w-full items-center gap-2 px-2 py-1 text-left ${
              choice.selected ? 'text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {/* The dot keeps its space when it is not the current choice, so
                the names line up instead of stepping sideways as the selection
                moves — the same arrangement the menu's tick uses. */}
            <span
              aria-hidden
              className={`size-1.5 shrink-0 rounded-full ${
                choice.selected ? 'bg-accent' : 'bg-transparent'
              }`}
            />

            <span className="min-w-0 flex-1">
              <span className="block truncate">{choice.label}</span>
              {choice.note !== '' && (
                <span className="text-ink-faint block truncate text-[11px] leading-4">
                  {choice.note}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
