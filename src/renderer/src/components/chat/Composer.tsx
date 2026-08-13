import { ArrowUp, Gauge, Map, Pencil, Shield, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentModel,
  EFFORT_LEVELS,
  type Effort,
  WORKING_MODES,
  type WorkingMode
} from '@core/chats.js'

import type { RateLimit, SessionUsage } from '@core/service.js'

import { ComposerAttic } from './ComposerAttic.js'
import { ComposerPicker } from './ComposerPicker.js'

interface ComposerProps {
  readonly busy: boolean
  /** What the agent may do without asking, once it is doing anything. */
  readonly workingMode: WorkingMode
  readonly onWorkingMode: (mode: WorkingMode) => void
  /** Whether the next message is asked for a plan first. */
  readonly planMode: boolean
  readonly onPlanMode: (planning: boolean) => void
  /** Null means the agent decides, which is what a new chat starts on. */
  readonly effort: Effort | null
  readonly onEffort: (effort: Effort | null) => void
  /** Null means the agent decides. */
  readonly model: string | null
  readonly onModel: (model: string | null) => void
  /** What the agent last said this account may use; empty on a first run. */
  readonly models: readonly AgentModel[]
  /** What the next message is up against; the strip hides when there is none. */
  readonly usage: SessionUsage
  readonly limit: RateLimit | null
  readonly onSend: (text: string) => void
  readonly onStop: () => void
}

/**
 * "Leave it to the agent" needs a value a picker can hold, and null is not one.
 * It stays inside this file: the store and the SDK both speak in nulls.
 */
const AGENT_DECIDES = 'auto'
type EffortChoice = Effort | typeof AGENT_DECIDES

const EFFORT_LABELS: Record<
  EffortChoice,
  | 'chat.effortAuto'
  | 'chat.effortLow'
  | 'chat.effortMedium'
  | 'chat.effortHigh'
  | 'chat.effortXhigh'
  | 'chat.effortMax'
> = {
  auto: 'chat.effortAuto',
  low: 'chat.effortLow',
  medium: 'chat.effortMedium',
  high: 'chat.effortHigh',
  xhigh: 'chat.effortXhigh',
  max: 'chat.effortMax'
}

const EFFORT_CHOICES: readonly EffortChoice[] = [AGENT_DECIDES, ...EFFORT_LEVELS]

/**
 * Which effort levels to offer for the model in force.
 *
 * A model that says nothing about effort gets the full list — silence is not a
 * refusal, and hiding levels the model would in fact accept is worse than
 * offering one it quietly downgrades.
 */
function effortChoicesFor(model: AgentModel | undefined): readonly EffortChoice[] {
  const supported = model?.supportedEffortLevels
  if (!supported) return EFFORT_CHOICES

  return [AGENT_DECIDES, ...EFFORT_LEVELS.filter((level) => supported.includes(level))]
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
  usage,
  limit,
  onSend,
  onStop
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const chosenModel = models.find((candidate) => candidate.value === model)
  const effortChoices = effortChoicesFor(chosenModel)

  // A model the list no longer names is still the one this chat runs on, so it
  // is offered as itself. Dropping it would leave the picker claiming a default
  // that is not in force, and take away the one click that changes it.
  const modelChoices =
    model === null || chosenModel
      ? models
      : [{ value: model, displayName: model, description: '' }, ...models]

  const trimmed = draft.trim()

  const submit = (): void => {
    if (trimmed === '') return
    onSend(trimmed)
    setDraft('')
  }

  return (
    <div className="border-line bg-canvas border-t px-6 py-3">
      {/* No padding on the frame: the settings sit in a footer of their own,
          and its rule has to run the whole width. Padding here would inset the
          line and leave it looking like an underline for the field rather than
          a division of the box. Each half brings its own instead. */}
      <div className="border-line bg-surface focus-within:border-line-strong mx-auto flex w-full max-w-6xl flex-col rounded-[var(--radius-panel)] border transition-colors">
        <ComposerAttic usage={usage} limit={limit} />

        <textarea
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(event) => {
            setDraft(event.target.value)
          }}
          onKeyDown={(event) => {
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
            value={model ?? AGENT_DECIDES}
            icon={<Sparkles aria-hidden size={12} />}
            options={[
              { value: AGENT_DECIDES, label: t('chat.modelAuto') },
              ...modelChoices.map((candidate) => ({
                value: candidate.value,
                label: candidate.displayName,
                ...(candidate.description !== '' && { description: candidate.description })
              }))
            ]}
            onChange={(value) => {
              onModel(value === AGENT_DECIDES ? null : value)
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
            value={effort ?? AGENT_DECIDES}
            icon={<Gauge aria-hidden size={12} />}
            // Greyed out rather than hidden when the model does not use effort:
            // a control that disappears as you change model is harder to make
            // sense of than one that stays put and explains itself.
            disabled={chosenModel?.supportsEffort === false}
            {...(chosenModel?.supportsEffort === false && { title: t('chat.effortUnsupported') })}
            options={effortChoices.map((value) => ({
              value,
              label: t(EFFORT_LABELS[value])
            }))}
            onChange={(value) => {
              onEffort(value === AGENT_DECIDES ? null : value)
            }}
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
