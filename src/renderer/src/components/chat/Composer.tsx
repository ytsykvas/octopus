import { ArrowUp, Gauge, Map, Pencil, Shield, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentCommand,
  type AgentModel,
  DEFAULT_MODEL,
  EFFORT_LEVELS,
  type Effort,
  findAgentModel,
  WORKING_MODES,
  type WorkingMode
} from '@core/chats.js'

import type { RateLimit, SessionUsage } from '@core/service.js'

import { useDismiss } from '../../hooks/useDismiss.js'
import { CommandMenu } from './CommandMenu.js'
import { completeCommand, matchCommands, readCommandQuery } from './commandMatch.js'
import { ComposerAttic } from './ComposerAttic.js'
import { ComposerPicker } from './ComposerPicker.js'
import { modelRows } from './modelRows.js'

interface ComposerProps {
  readonly busy: boolean
  /** What the agent may do without asking, once it is doing anything. */
  readonly workingMode: WorkingMode
  readonly onWorkingMode: (mode: WorkingMode) => void
  /** Whether the next message is asked for a plan first. */
  readonly planMode: boolean
  readonly onPlanMode: (planning: boolean) => void
  /** How much thinking the next message asks for; always a level. */
  readonly effort: Effort
  readonly onEffort: (effort: Effort) => void
  /** Null means nothing was chosen here, which the default row stands for. */
  readonly model: string | null
  readonly onModel: (model: string | null) => void
  /** What the agent last said this account may use; empty on a first run. */
  readonly models: readonly AgentModel[]
  /**
   * The model the session is actually running, as it last reported.
   *
   * Separate from `model` above, which is what was *chosen* — they are
   * different facts and the footer needs both. Null when no session has
   * answered yet.
   */
  readonly activeModel: string | null
  /** Slash commands to suggest; empty until this chat has run a session. */
  readonly commands: readonly AgentCommand[]
  /** What the next message is up against; the strip hides when there is none. */
  readonly usage: SessionUsage
  readonly limit: RateLimit | null
  readonly onSend: (text: string) => void
  readonly onStop: () => void
}

const EFFORT_LABELS: Record<
  Effort,
  'chat.effortLow' | 'chat.effortMedium' | 'chat.effortHigh' | 'chat.effortXhigh' | 'chat.effortMax'
> = {
  low: 'chat.effortLow',
  medium: 'chat.effortMedium',
  high: 'chat.effortHigh',
  xhigh: 'chat.effortXhigh',
  max: 'chat.effortMax'
}

/**
 * Which effort levels to offer for the model in force.
 *
 * A model that says nothing about effort gets the full list — silence is not a
 * refusal, and hiding levels the model would in fact accept is worse than
 * offering one it quietly downgrades.
 */
function effortChoicesFor(model: AgentModel | undefined, inForce: Effort): readonly Effort[] {
  const supported = model?.supportedEffortLevels
  if (!supported) return EFFORT_LEVELS

  // The level in force is offered whatever the model says about it. It is what
  // the next message will run with, and a picker whose value has no row of its
  // own falls back to printing the raw name.
  return EFFORT_LEVELS.filter((level) => supported.includes(level) || level === inForce)
}

const MODE_LABELS: Record<WorkingMode, 'chat.modeDefault' | 'chat.modeAcceptEdits'> = {
  default: 'chat.modeDefault',
  acceptEdits: 'chat.modeAcceptEdits'
}

/**
 * The mode's own icon rather than one for the control, because the row is
 * scanned rather than read: what the agent is allowed to do is the thing worth
 * seeing without stopping on the words.
 */
const MODE_ICONS: Record<WorkingMode, React.ReactNode> = {
  default: <Shield aria-hidden size={12} />,
  acceptEdits: <Pencil aria-hidden size={12} />
}

/**
 * The input field, and the settings the next message will run under.
 *
 * Enter sends and shift+enter breaks the line, which is what every chat does.
 * The field grows with the text — through `field-sizing`, so the browser does
 * the measuring — up to a cap, past which it scrolls: a prompt long enough to
 * fill the pane would push the conversation it refers to off the screen.
 *
 * The settings sit here rather than in the header because the choice belongs to
 * the message being written. In the header they were also disabled until the
 * first message had been sent, which made the mode of the first message the one
 * mode that could not be chosen.
 */
export function Composer({
  busy,
  workingMode,
  onWorkingMode,
  planMode,
  onPlanMode,
  effort,
  onEffort,
  model,
  onModel,
  models,
  activeModel,
  commands,
  usage,
  limit,
  onSend,
  onStop
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const field = useRef<HTMLDivElement>(null)
  /** Which suggestion Enter would take. */
  const [active, setActive] = useState(0)
  /**
   * Whether the list was sent away for this draft.
   *
   * Needed because "is the draft a command being typed" is derived from the
   * text, and Escape does not change the text. Reset by the next keystroke:
   * dismissing is about this moment, not about the word.
   */
  const [dismissed, setDismissed] = useState(false)

  const rows = modelRows(
    models,
    { fallback: t('chat.modelDefault'), note: t('chat.modelDefaultNote') },
    model
  )

  // Through the catalogue rather than by string equality: a session names
  // itself in full while the list may hold a short name, and `claude-sonnet-5`
  // has to find the row called `sonnet`.
  const chosenModel = model === null ? undefined : findAgentModel(rows, model)
  const runningModel = activeModel === null ? undefined : findAgentModel(rows, activeModel)

  // Which model the effort control answers about: what this chat chose, or
  // failing that what the session is on, or failing that whatever the default
  // runs — which is a row now, so there is always an answer.
  const modelInForce = chosenModel ?? runningModel ?? rows[0]
  const effortChoices = effortChoicesFor(modelInForce, effort)

  // Nothing chosen ticks the agent's own default, which is a row like any
  // other now rather than a sentinel standing in for the absence of one.
  const modelValue = chosenModel?.value ?? DEFAULT_MODEL

  /*
   * What the button says, when that is not what the menu has ticked.
   *
   * Only when the two genuinely differ, which a `/model` command is what
   * causes: the CLI scopes it to the session, so it moves what is running
   * without moving what this chat chose. Naming the running model when it is
   * already the ticked row would just say it twice.
   */
  const runningLabel =
    activeModel === null || runningModel?.value === modelValue
      ? undefined
      : (runningModel?.displayName ?? activeModel)

  const trimmed = draft.trim()

  const query = readCommandQuery(draft)
  const matches = query === null ? [] : matchCommands(commands, query)
  // `matches.length > 0` is what stops a lone `/` from swallowing Enter: with
  // no suggestions there is nothing to complete, so the key means what it
  // always means.
  const suggesting = !dismissed && query !== null && matches.length > 0

  useDismiss(suggesting, field, () => {
    setDismissed(true)
  })

  const submit = (): void => {
    if (trimmed === '') return
    onSend(trimmed)
    setDraft('')
    setDismissed(false)
    setActive(0)
  }

  /**
   * Puts a chosen command in the field. It does not send it.
   *
   * Deliberate: the command may take arguments, and a single Enter that both
   * chose and ran would leave no way to type them. It also means no command
   * ever runs from one keystroke aimed at a list that had just moved.
   */
  const complete = (command: AgentCommand): void => {
    setDraft(completeCommand(command))
    setDismissed(true)
  }

  return (
    <div className="border-line bg-canvas border-t px-6 py-3">
      {/* No padding on the frame: the settings sit in a footer of their own,
          and its rule has to run the whole width. Padding here would inset the
          line and leave it looking like an underline for the field rather than
          a division of the box. Each half brings its own instead. */}
      {/* `relative` so the suggestion list can hang off the top of the whole
          block rather than off the field: it opens upwards, and anchoring it
          to the textarea would put it over the text being typed. */}
      <div
        ref={field}
        className="border-line bg-surface focus-within:border-line-strong relative mx-auto flex w-full max-w-6xl flex-col rounded-[var(--radius-panel)] border transition-colors"
      >
        {suggesting && (
          <CommandMenu commands={matches} active={active} onActive={setActive} onPick={complete} />
        )}

        <ComposerAttic usage={usage} limit={limit} />

        <textarea
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(event) => {
            setDraft(event.target.value)
            // Typing brings the list back — dismissing was about the draft as
            // it stood — and returns the highlight to the top, since filtering
            // has moved what sits at each index.
            setDismissed(false)
            setActive(0)
          }}
          onKeyDown={(event) => {
            // The list gets first refusal on the keys it uses, because it is
            // the thing the user is looking at. When it is closed every one of
            // these falls through to the field's own behaviour.
            if (suggesting) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((current) => (current + step + matches.length) % matches.length)
                return
              }

              // Tab as well as Enter: completing with tab is what a shell does,
              // and without `preventDefault` it would take the focus out of the
              // field instead.
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault()
                // Iterated rather than indexed with a `!`: `active` is always
                // inside the list — every keystroke that could move it out
                // resets it — but the index signature says otherwise, and one
                // element is exactly what this walks.
                for (const chosen of matches.slice(active, active + 1)) complete(chosen)
                return
              }

              if (event.key === 'Escape') {
                // The draft is left alone. Escape here means "stop suggesting",
                // not "undo what I typed".
                setDismissed(true)
                return
              }
            }

            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            submit()
          }}
          // `field-sizing-content` is what grows it, so there is no `rows` here
          // and no measuring in JavaScript: the field also has to re-fit when
          // the panes either side of it are dragged, and the browser already
          // knows about that.
          className="focus-ring field-sizing-content max-h-80 min-h-[8rem] w-full resize-none bg-transparent px-3 py-2.5 outline-none"
        />

        {/* Wraps rather than overflows. The centre pane may be dragged down to
            `MIN_CENTRE_WIDTH`, and at that width the row cannot hold three
            pickers and the send button side by side — it used to run past the
            rounded border, taking the send button off the edge of the block.
            Two lines keep every control named and reachable; widen the pane and
            it unwraps on its own. */}
        <div className="border-line flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
          <ComposerPicker
            label={t('chat.model')}
            value={modelValue}
            icon={<Sparkles aria-hidden size={12} />}
            {...(runningLabel !== undefined && { display: runningLabel })}
            options={rows.map((candidate) => ({
              value: candidate.value,
              label: candidate.displayName,
              ...(candidate.description !== '' && { description: candidate.description })
            }))}
            onChange={(value) => {
              onModel(value === DEFAULT_MODEL ? null : value)
            }}
          />

          {/* A toggle, not a third entry in the picker beside it. Planning is
              a state the conversation is in — the agent runs no tools at all —
              rather than another degree of permission, and listing the three
              together made them look like peers. */}
          <ComposerPicker
            label={t('chat.mode')}
            value={workingMode}
            icon={MODE_ICONS[workingMode]}
            // Left usable while planning: what it names is what the agent will
            // do once the plan is approved, which is exactly when it is worth
            // deciding.
            {...(planMode && { title: t('chat.modeAfterPlan') })}
            options={WORKING_MODES.map((value) => ({
              value,
              label: t(MODE_LABELS[value])
            }))}
            onChange={onWorkingMode}
          />

          <ComposerPicker
            label={t('chat.effort')}
            value={effort}
            icon={<Gauge aria-hidden size={12} />}
            // Greyed out rather than hidden when the model does not use effort:
            // a control that disappears as you change model is harder to make
            // sense of than one that stays put and explains itself.
            disabled={modelInForce.supportsEffort === false}
            {...(modelInForce.supportsEffort === false && { title: t('chat.effortUnsupported') })}
            options={effortChoices.map((value) => ({
              value,
              label: t(EFFORT_LABELS[value])
            }))}
            onChange={onEffort}
          />

          {/* Beside send rather than among the pickers on the left. Those three
              are settings, changed rarely and left alone; this is turned on for
              the message being written, so it belongs next to the button that
              sends it. */}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-pressed={planMode}
              title={t('chat.planModeHint')}
              onClick={() => {
                onPlanMode(!planMode)
              }}
              className={`focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[11px] transition-colors ${
                planMode
                  ? 'bg-accent/12 text-accent'
                  : 'text-ink-soft hover:bg-muted hover:text-ink'
              }`}
            >
              <Map aria-hidden size={12} />
              {t('chat.planMode')}
            </button>

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
          </span>
        </div>
      </div>
    </div>
  )
}
