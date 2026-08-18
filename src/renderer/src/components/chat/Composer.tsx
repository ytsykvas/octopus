import { ArrowUp, CheckCheck, Map, Shield } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentCommand,
  type AgentModel,
  DEFAULT_MODEL,
  type EffortChoice,
  findAgentModel,
  type WorkingMode
} from '@core/chats.js'

import type { RateLimit, SessionUsage } from '@core/service.js'

import type { DiffComment } from '../../hooks/useDiffComments.js'
import { useDismiss } from '../../hooks/useDismiss.js'
import { CommandMenu } from './CommandMenu.js'
import { completeCommand, matchCommands, readCommandQuery } from './commandMatch.js'
import { withComments } from './attachments.js'
import { ComposerAttachments } from './ComposerAttachments.js'
import { ComposerAttic } from './ComposerAttic.js'
import { EffortPicker } from './EffortPicker.js'
import { modelRows } from './modelRows.js'
import { ModelPicker } from './ModelPicker.js'

interface ComposerProps {
  /**
   * What was in the field when this workspace was last left.
   *
   * Seeded rather than controlled: the value is read once, on mount, and the
   * component is remounted per workspace — see `latest` below for why it is not
   * reported on every keystroke.
   */
  readonly initialDraft: string
  /** Where the text goes when the composer is left, so it is there on return. */
  readonly onDraftLeave: (text: string) => void
  readonly busy: boolean
  /** What the agent may do without asking, once it is doing anything. */
  readonly workingMode: WorkingMode
  readonly onWorkingMode: (mode: WorkingMode) => void
  /** Whether the next message is asked for a plan first. */
  readonly planMode: boolean
  readonly onPlanMode: (planning: boolean) => void
  /** How much thinking the next message asks for; always answered. */
  readonly effort: EffortChoice
  readonly onEffort: (effort: EffortChoice) => void
  /**
   * The model this conversation writes code with; null leaves it to the agent.
   *
   * Both halves arrive as they are stored, and which of them is *in force* is
   * worked out here — the chip names it and the effort control answers about
   * it. Deciding that outside would mean the caller knowing that planning moves
   * the model, which is this row's business rather than the pane's.
   */
  readonly model: string | null
  readonly onModel: (model: string | null) => void
  /** The model it plans with; null means the one above does both jobs. */
  readonly planModel: string | null
  readonly onPlanModel: (model: string | null) => void
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
  /** Answers whether the message went; the field and the notes clear only then. */
  readonly onSend: (text: string) => Promise<boolean>
  readonly onStop: () => void
  /**
   * Review notes waiting to go out with this message.
   *
   * Composed into the text here rather than in `Chat`, so the attic's own
   * `onSend` — which puts `/clear` and `/compact` on the same wire — never
   * carries them.
   */
  readonly comments: readonly DiffComment[]
  readonly onRemoveComment: (comment: DiffComment) => void
  readonly onCommentsSent: () => void
}

const MODE_LABELS: Record<WorkingMode, 'chat.modeDefault' | 'chat.modeAcceptEdits'> = {
  default: 'chat.modeDefault',
  acceptEdits: 'chat.modeAcceptEdits'
}

/**
 * The mode's own icon rather than one for the control, because the row is
 * scanned rather than read: what the agent is allowed to do is the thing worth
 * seeing without stopping on the words.
 *
 * A pencil stood for accepting edits for a while and read as "edit this
 * setting" — the icon of the control rather than of what it says. The double
 * tick is what the mode does: answering yes before being asked.
 */
const MODE_ICONS: Record<WorkingMode, React.ReactNode> = {
  default: <Shield aria-hidden size={12} />,
  acceptEdits: <CheckCheck aria-hidden size={12} />
}

/**
 * What a click on the mode lands on.
 *
 * Written out rather than derived from `WORKING_MODES` by rotation: a third
 * mode would make "the next one" a decision rather than an inevitability, and
 * this is where that decision would have to be taken.
 */
const NEXT_MODE: Record<WorkingMode, WorkingMode> = {
  default: 'acceptEdits',
  acceptEdits: 'default'
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
  planModel,
  onPlanModel,
  models,
  activeModel,
  commands,
  usage,
  limit,
  onSend,
  onStop,
  comments,
  onRemoveComment,
  onCommentsSent,
  initialDraft,
  onDraftLeave
}: ComposerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialDraft)

  /*
   * The text as it stands, and where to leave it.
   *
   * The draft belongs to the workspace it was typed in, and the pane keeps one
   * per workspace so looking at another does not cost a half-written prompt.
   * Handed up **once, on the way out** rather than on every keystroke: this
   * component is remounted per workspace, so leaving is exactly when the value
   * is wanted — and reporting a change would put a `setState` in `App` under
   * every key pressed, with `ChatLog` re-rendering behind it.
   *
   * Refs, written in a handler and read in a cleanup, never during render.
   */
  const latest = useRef(draft)
  const leave = useRef(onDraftLeave)

  useEffect(() => {
    leave.current = onDraftLeave
  })

  useEffect(
    () => () => {
      leave.current(latest.current)
    },
    []
  )

  /** The one way the text moves, so what is handed up cannot fall behind it. */
  const write = (text: string): void => {
    latest.current = text
    setDraft(text)
  }

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

  /*
   * Which of the conversation's two models the next message will run with.
   *
   * A conversation whose plan and code models differ runs the plan one while
   * planning, so that is what the chip has to name and what the effort control
   * has to answer about. With no split — `planModel` null — there is one model
   * and this is it, whatever the toggle says.
   */
  const modelNow = planMode && planModel !== null ? planModel : model

  const rows = modelRows(
    models,
    { fallback: t('chat.modelDefault'), note: t('chat.modelDefaultNote') },
    modelNow
  )

  // Through the catalogue rather than by string equality: a session names
  // itself in full while the list may hold a short name, and `claude-sonnet-5`
  // has to find the row called `sonnet`.
  const chosenModel = modelNow === null ? undefined : findAgentModel(rows, modelNow)
  const runningModel = activeModel === null ? undefined : findAgentModel(rows, activeModel)

  // Which model the effort control answers about: what this chat chose, or
  // failing that what the session is on, or failing that whatever the default
  // runs — which is a row now, so there is always an answer.
  const modelInForce = chosenModel ?? runningModel ?? rows[0]

  // Nothing chosen ticks the agent's own default, which is a row like any
  // other now rather than a sentinel standing in for the absence of one.
  const modelValue = chosenModel?.value ?? DEFAULT_MODEL

  /*
   * What the chip says.
   *
   * The chosen row's name, unless the session has moved off it — which a
   * `/model` command is what causes: the CLI scopes it to the session, so it
   * changes what is running without changing what this chat chose, and the chip
   * names what is running.
   */
  const modelLabel =
    activeModel === null || runningModel?.value === modelValue
      ? (chosenModel?.displayName ?? rows[0].displayName)
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
    // A message that is only notes is still a message: the field may be empty
    // and the review is the thing being sent.
    if (trimmed === '' && comments.length === 0) return

    // The suggestion list closes at once: it is about the keystroke, not about
    // the message, and leaving it open over a send in flight reads as stuck.
    setDismissed(false)
    setActive(0)

    /*
     * Cleared only once the message is known to have gone.
     *
     * It used to clear on the next line, and the send is fire-and-forget — no
     * session, the agent busy, the IPC call refused — so a failure took the
     * review with it. A review is minutes of reading and nothing writes it to
     * disk, which left nowhere at all to get it back from.
     */
    void (async () => {
      if (!(await onSend(withComments(trimmed, comments, t('diff.commentIntro'))))) return

      onCommentsSent()
      write('')
    })()
  }

  /**
   * Puts a chosen command in the field. It does not send it.
   *
   * Deliberate: the command may take arguments, and a single Enter that both
   * chose and ran would leave no way to type them. It also means no command
   * ever runs from one keystroke aimed at a list that had just moved.
   */
  const complete = (command: AgentCommand): void => {
    write(completeCommand(command))
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

        {/* The strip's own menu sends slash commands, and it sends them the
            way the field does — a slash command here is the text of an
            ordinary message, so there is one channel and not two. */}
        <ComposerAttic usage={usage} limit={limit} onSend={onSend} />

        <ComposerAttachments comments={comments} onRemove={onRemoveComment} />

        <textarea
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(event) => {
            write(event.target.value)
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
          <ModelPicker
            models={models}
            model={model}
            onModel={onModel}
            planModel={planModel}
            onPlanModel={onPlanModel}
            display={modelLabel}
          />

          <EffortPicker value={effort} onChange={onEffort} model={modelInForce} />

          {/* Last of the three, and the only one that is not a menu. Model and
              effort are two halves of one question — which brain, and how hard
              it thinks — so they sit together, and what the agent is allowed to
              do without asking is a different question altogether.

              Switched in place rather than picked from a menu: there are two
              modes, so the list was a click to open it, a list in which one of
              the two visible rows was already in force, and a click to choose
              the other — three steps to say the thing the button says in one.
              The pickers before it keep their menus, their lists being
              open-ended.

              Planning is a third state and still not a third mode: the agent
              runs no tools at all in it, so this stays usable while planning —
              what it names is what happens once the plan is approved, which is
              exactly when it is worth deciding. */}
          <button
            type="button"
            aria-label={t('chat.modeToggle', { mode: t(MODE_LABELS[workingMode]) })}
            {...(planMode && { title: t('chat.modeAfterPlan') })}
            onClick={() => {
              onWorkingMode(NEXT_MODE[workingMode])
            }}
            // Tinted while the agent may write unasked, the same treatment the
            // plan toggle uses when it is on: of the settings in this row, that
            // is the one worth noticing without being looked for.
            className={`focus-ring inline-flex h-6 min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[11px] transition-colors ${
              workingMode === 'acceptEdits'
                ? 'bg-accent/12 text-accent'
                : 'text-ink-soft hover:bg-muted hover:text-ink'
            }`}
          >
            <span className="shrink-0">{MODE_ICONS[workingMode]}</span>
            <span className="truncate">{t(MODE_LABELS[workingMode])}</span>
          </button>

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
                // A review with nothing typed is still something to send.
                disabled={trimmed === '' && comments.length === 0}
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
