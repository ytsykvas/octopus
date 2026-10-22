import { CheckCheck, Map, Shield, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AgentCommand,
  type AgentEntry,
  type AgentModel,
  type AutoCompactWindow,
  type ChatEfforts,
  type ChatModels,
  DEFAULT_MODEL,
  type EffortChoice,
  findAgentModel,
  type WorkingMode
} from '@core/chats.js'

import type { RateLimit, SessionUsage } from '@core/service.js'
import { parseBtw } from '@core/sideQuestions.js'
import type { SkillListing } from '@core/skills.js'

import type { ChatMode } from '../../hooks/useChat.js'

import { useDismiss } from '../../hooks/useDismiss.js'
import { type ChatNote, withNotes } from './attachments.js'
import { ComposerAttachments } from './ComposerAttachments.js'
import { ComposerAttic } from './ComposerAttic.js'
import { EffortPicker } from './EffortPicker.js'
import { modelRows } from './modelRows.js'
import { ModelPicker } from './ModelPicker.js'
import { SendButton } from './SendButton.js'
import { isSubmitEnter } from './submitKey.js'
import { commandText, rankByName, readTrigger, replaceToken, type Trigger } from './suggest.js'
import { type Suggestion, SuggestionMenu } from './SuggestionMenu.js'

interface ComposerProps {
  /**
   * What was in the field when this workspace was last left.
   *
   * Seeded rather than controlled: the value is read once, on mount, and the
   * component is remounted per workspace — see `latest` below for why it is not
   * reported on every keystroke.
   */
  readonly initialDraft: string
  /**
   * Text to put in the field now — by default replacing what is there, a
   * rewound message handed back to be edited and sent again; with `append`,
   * after what is there, on a line of its own, for text that is added to a
   * message rather than being one (a heads-up's words, "add to chat").
   *
   * Applied once per `id`, so the same text can be handed back twice and a
   * render that passes the same seed again changes nothing. One present when
   * the composer mounts is taken as already applied.
   */
  readonly seed?:
    { readonly text: string; readonly id: number; readonly append?: boolean } | undefined
  /** Where the text goes when the composer is left, so it is there on return. */
  readonly onDraftLeave: (text: string) => void
  readonly busy: boolean
  /**
   * Takes the caret on mount — for a workspace just made, whose task is the
   * next thing typed.
   */
  readonly focusOnMount?: boolean
  /** What the agent may do without asking, once it is doing anything. */
  readonly workingMode: WorkingMode
  /** Whether the next message is asked for a plan first. */
  readonly planMode: boolean
  /** The two above, moved together as the one control presents them. */
  readonly onMode: (mode: ChatMode) => void
  /** How much thinking the next message asks for; always answered. */
  readonly effort: EffortChoice
  /** The effort planning runs at; null means the one above does both. */
  readonly planEffort: EffortChoice | null
  /** Either or both of the two above, written together. */
  readonly onEfforts: (efforts: ChatEfforts) => void
  /** Where the conversation compacts itself; the choice lives in the context menu. */
  readonly onAutoCompact: (window: AutoCompactWindow | null) => void
  /**
   * Paths the next message will name.
   *
   * Never copies of the files. What goes out is where they are, which is the
   * plainest form §4's rule that nothing implicit reaches the agent can take —
   * and what the chips above the field make checkable before it is sent.
   */
  readonly files: readonly string[]
  readonly onRemoveFile: (path: string) => void
  /** The paperclip. One of three ways in, and the only visible one. */
  readonly onAttachFiles: () => void
  /** Files dropped on the composer, whose paths the window cannot read itself. */
  readonly onDropFiles: (files: readonly File[]) => void
  /** An image pasted into the field, which has no path until one is made. */
  readonly onPasteImage: (image: Blob) => void
  /**
   * The model this conversation writes code with; null leaves it to the agent.
   *
   * Both halves arrive as they are stored, and which of them is *in force* is
   * worked out here — the chip names it and the effort control answers about
   * it. Deciding that outside would mean the caller knowing that planning moves
   * the model, which is this row's business rather than the pane's.
   */
  readonly model: string | null
  /** The model it plans with; null means the one above does both jobs. */
  readonly planModel: string | null
  /** Either or both of the two above, written together. */
  readonly onModels: (models: ChatModels) => void
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
  /** Subagents to suggest after an `@`; empty until this chat has run a session. */
  readonly agents: readonly AgentEntry[]
  /** What the next message is up against; each reading hides when there is none. */
  readonly usage: SessionUsage
  readonly limit: RateLimit | null
  /** Every skill this conversation could use, and whether it is on. */
  readonly skills: readonly SkillListing[]
  readonly onToggleSkill: (key: string, enabled: boolean) => void
  readonly onRefreshSkills: () => void
  /** Where the skills panel sends someone who has none to switch yet. */
  readonly onOpenSettings: () => void
  /** Answers whether the message went; the field and the notes clear only then. */
  readonly onSend: (text: string) => Promise<boolean>
  /** A `/btw`, taken aside before the notes are wrapped around it. */
  readonly onSideQuestion: (question: string) => void
  readonly onStop: () => void
  /**
   * Notes waiting to go out with this message — from the diff, from a review,
   * or both.
   *
   * Composed into the text here rather than in `Chat`, so the attic's own
   * `onSend` — which puts `/clear` and `/compact` on the same wire — never
   * carries them.
   */
  readonly notes: readonly ChatNote[]
  readonly onRemoveNote: (note: ChatNote) => void
  readonly onNotesSent: () => void
}

const MODE_LABELS: Record<
  ChatMode,
  'chat.modeDefault' | 'chat.modeAcceptEdits' | 'chat.planMode' | 'chat.modeAuto'
> = {
  default: 'chat.modeDefault',
  acceptEdits: 'chat.modeAcceptEdits',
  plan: 'chat.planMode',
  auto: 'chat.modeAuto'
}

/**
 * The mode's own icon rather than one for the control, because the row is
 * scanned rather than read: what the agent is allowed to do is the thing worth
 * seeing without stopping on the words.
 *
 * A pencil stood for accepting edits for a while and read as "edit this
 * setting" — the icon of the control rather than of what it says. The double
 * tick is what the mode does: answering yes before being asked. The bolt is
 * auto mode's: the agent goes ahead on its own judgement, quickly.
 */
const MODE_ICONS: Record<ChatMode, React.ReactNode> = {
  default: <Shield aria-hidden size={12} />,
  acceptEdits: <CheckCheck aria-hidden size={12} />,
  plan: <Map aria-hidden size={12} />,
  auto: <Zap aria-hidden size={12} />
}

/**
 * How each mode tints the chip.
 *
 * Tinted for the modes that change what the agent does unasked or at all: of
 * the settings in this row, those are the ones worth noticing without being
 * looked for. Each in its own colour, so the mode reads at a glance without the
 * word: Accept edits in the amber the app uses for "goes ahead, take note",
 * planning in the accent, and Auto in green — the one where a classifier, not
 * a rule, decides.
 */
const MODE_TINTS: Record<ChatMode, string> = {
  default: 'text-ink-soft hover:bg-muted hover:text-ink',
  acceptEdits: 'bg-warning/12 text-warning',
  plan: 'bg-accent/12 text-accent',
  auto: 'bg-success/12 text-success'
}

/**
 * What a click or shift+tab lands on.
 *
 * The order Claude Code's own shift+tab goes in, so a hand that learned it
 * there does not have to learn it again. Written out rather than derived by
 * rotation: "the next one" is a decision, and this is where it is taken.
 */
const NEXT_MODE: Record<ChatMode, ChatMode> = {
  default: 'acceptEdits',
  acceptEdits: 'plan',
  plan: 'auto',
  auto: 'default'
}

/** A row of the suggestion list, and what picking it writes into the text. */
interface Choice extends Suggestion {
  readonly text: string
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
  planMode,
  onMode,
  effort,
  planEffort,
  onEfforts,
  onAutoCompact,
  files,
  onRemoveFile,
  onAttachFiles,
  onDropFiles,
  onPasteImage,
  model,
  planModel,
  onModels,
  models,
  activeModel,
  commands,
  agents,
  usage,
  limit,
  skills,
  onToggleSkill,
  onRefreshSkills,
  onOpenSettings,
  onSend,
  onSideQuestion,
  onStop,
  notes,
  onRemoveNote,
  onNotesSent,
  initialDraft,
  seed,
  onDraftLeave,
  focusOnMount = false
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
  const textarea = useRef<HTMLTextAreaElement>(null)
  /** Where the caret goes once the next value has been written, or null. */
  const caretAfterWrite = useRef<number | null>(null)
  const [caret, setCaret] = useState(initialDraft.length)

  useEffect(() => {
    if (focusOnMount) textarea.current?.focus()
  }, [focusOnMount])

  useEffect(() => {
    if (caretAfterWrite.current === null) return

    textarea.current?.setSelectionRange(caretAfterWrite.current, caretAfterWrite.current)
    caretAfterWrite.current = null
  }, [draft])

  // Replaces the draft, as Claude Code's own rewind does: the message is what
  // was asked for back, and the field is where it is edited. Written through
  // the same two places `write` keeps, with the caret at the end and the focus
  // in the field, so the next key continues the message.
  const seeded = useRef(seed?.id)
  useEffect(() => {
    if (seed === undefined || seed.id === seeded.current) return

    seeded.current = seed.id
    // Appended after a blank line, so a half-written message is added to and
    // not overwritten; with nothing written there is nothing to separate from.
    const text =
      seed.append === true && latest.current.trim() !== ''
        ? `${latest.current.trimEnd()}\n\n${seed.text}`
        : seed.text
    latest.current = text
    caretAfterWrite.current = text.length
    setDraft(text)
    setCaret(text.length)
    textarea.current?.focus()
  }, [seed])
  /** Which suggestion Enter would take. */
  const [active, setActive] = useState(0)
  /**
   * Where the command list was sent away, or null.
   *
   * Needed because "is a command being typed" is derived from the text, and
   * Escape does not change the text. Held as the token's position rather than
   * a flag, so the dismissal belongs to that one word: the caret moving on to
   * another `/` brings the list back for it. Reset by the next keystroke, since
   * dismissing is about this moment, not about the word for good.
   */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  /* Only so the frame can say a drop would land. Nothing else reads it, and it
     is cleared by the drop as well as by leaving. */
  const [dragging, setDragging] = useState(false)

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
   * What the chip says: the chosen row's name, unless the session has moved off
   * it — which a `/model` command is what causes: the CLI scopes it to the
   * session, so it changes what is running without changing what this chat
   * chose, and the chip names what is running.
   */
  const movedTo =
    activeModel !== null && runningModel?.value !== modelValue
      ? (runningModel?.displayName ?? activeModel)
      : null
  const modelLabel = movedTo ?? chosenModel?.displayName ?? rows[0].displayName

  // And the panel says why its tick disagrees — but only with a catalogue to
  // compare against. Without one the default row has no model behind it, so
  // every session would read as moved by a `/model` nobody typed.
  const sessionMovedTo = models.length > 0 ? movedTo : null

  const trimmed = draft.trim()

  /*
   * The word being typed at the caret, if it names something. One word at a
   * time, so at most one of these is set: a word starts with one sigil or the
   * other.
   *
   * After `/`, at the very start of the message, every command is offered,
   * since that is where one runs; anywhere else only skills are — a skill
   * named mid-sentence is permission for Claude to run it, while a built-in
   * such as `/clear` there would do nothing. After `@`, the subagents: picking
   * one writes `@agent-<name>`, which is how Claude Code is told to hand the
   * work to that agent rather than leave the choice to Claude.
   */
  const command = readTrigger(draft, caret, '/')
  const mention = readTrigger(draft, caret, '@')
  const token = command ?? mention
  const choices: readonly Choice[] =
    command !== null
      ? rankByName(
          command.start === 0 ? commands : commands.filter((offered) => offered.skill),
          command.query
        ).map((chosen) => ({
          label: `/${chosen.name}`,
          hint: chosen.argumentHint,
          description: chosen.description,
          text: commandText(chosen, command.start === 0)
        }))
      : mention !== null
        ? rankByName(
            // The written form answers too: `@agent-Exp` is how the docs spell
            // it, and somebody who types that should not find the list empty.
            agents.map((agent) => ({ ...agent, aliases: [`agent-${agent.name}`] })),
            mention.query
          ).map((agent) => ({
            label: `@${agent.name}`,
            hint: '',
            description: agent.description,
            text: `@agent-${agent.name} `
          }))
        : []
  // `choices.length > 0` is what stops a lone sigil from swallowing Enter:
  // with no suggestions there is nothing to complete, so the key means what it
  // always means. The token itself rather than a flag, so everything below that
  // acts on one holds it and has no null to answer for.
  const tokenAt = token?.start ?? null
  const shown = token !== null && tokenAt !== dismissedAt && choices.length > 0 ? token : null

  useDismiss(shown !== null, field, () => {
    setDismissedAt(tokenAt)
  })

  const mode: ChatMode = planMode ? 'plan' : workingMode
  const nextMode = (): void => {
    onMode(NEXT_MODE[mode])
  }

  const submit = (): void => {
    // A message that is only notes is still a message: the field may be empty
    // and the review is the thing being sent.
    if (trimmed === '' && notes.length === 0) return

    // The suggestion list closes at once: it is about the keystroke, not about
    // the message, and leaving it open over a send in flight reads as stuck.
    setDismissedAt(null)
    setActive(0)

    // On the typed text: wrapped, the notes come first and `/btw` is no longer
    // at the start. The notes stay for the next real message.
    const btw = parseBtw(trimmed)
    if (btw !== null) {
      onSideQuestion(btw.question)
      write('')
      return
    }

    /*
     * Cleared only once the message is known to have gone.
     *
     * It used to clear on the next line, and the send is fire-and-forget — no
     * session, the agent busy, the IPC call refused — so a failure took the
     * review with it. A review is minutes of reading and nothing writes it to
     * disk, which left nowhere at all to get it back from.
     */
    void (async () => {
      const message = withNotes(
        trimmed,
        notes,
        {
          diff: t('diff.commentIntro'),
          pullRequest: t('pullRequest.quoteIntro'),
          oldSide: t('diff.noteOldSide'),
          files: t('chat.attachIntro')
        },
        files
      )

      if (!(await onSend(message))) return

      onNotesSent()
      write('')
    })()
  }

  /**
   * Puts a choice in the field. It does not send it.
   *
   * Deliberate: a command may take arguments, and a single Enter that both
   * chose and ran would leave no way to type them. It also means nothing ever
   * runs from one keystroke aimed at a list that had just moved.
   *
   * The caret goes after what was written, once React has written the new
   * value: setting it before would be undone by the render that follows.
   */
  const complete = (taken: Trigger, chosen: Choice): void => {
    const next = replaceToken(draft, taken, caret, chosen.text)
    write(next.draft)
    setCaret(next.caret)
    caretAfterWrite.current = next.caret
    // Closed over what it just wrote: a command that takes no arguments is
    // still a `/word` at the caret, and the list would open again on it.
    setDismissedAt(taken.start)
  }

  return (
    // More room above than below: the ring's glow spreads past the frame, and
    // at an even 12px it ran up against the rule along the top.
    <div className="border-line bg-canvas border-t px-6 pt-5 pb-3">
      {/* No padding on the frame: the settings sit in a footer of their own,
          and its rule has to run the whole width. Padding here would inset the
          line and leave it looking like an underline for the field rather than
          a division of the box. Each half brings its own instead. */}
      {/* `relative` so the suggestion list can hang off the top of the whole
          block rather than off the field: it opens upwards, and anchoring it
          to the textarea would put it over the text being typed. */}
      {/* The whole box takes a drop, not the field alone. Aiming at a textarea
          that is two lines tall is a worse target than the frame around it, and
          a drop that lands a pixel outside would do the browser's own thing —
          navigate the window to the file. */}
      <div
        ref={field}
        onDragOver={(event) => {
          // Both, and neither is optional: without `preventDefault` the drop
          // never fires, and without `dropEffect` the cursor says "no".
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDragging(true)
        }}
        onDragLeave={(event) => {
          // Only when the pointer has left the box itself. Dragging over a
          // child fires `dragleave` for the parent, so a strip that flickered
          // as the cursor crossed the attic would be the naive version.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          onDropFiles([...event.dataTransfer.files])
        }}
        // A drop target says so in the plain accent: the ring is decoration,
        // and "let go here" has to read the same everywhere.
        className={`bg-surface relative mx-auto flex w-full max-w-6xl flex-col rounded-[var(--radius-panel)] border transition-colors ${
          dragging ? 'border-accent' : 'composer-ring'
        }`}
      >
        {/* The ring's line, the one layer that moves — its own element so that
            turning it repaints an edge rather than the whole frame. First, so
            the menus that open out of the frame draw over it. */}
        {!dragging && <span aria-hidden className="composer-ring-line" />}
        {shown !== null && (
          <SuggestionMenu
            rows={choices}
            active={active}
            onActive={setActive}
            onPick={(index) => {
              for (const chosen of choices.slice(index, index + 1)) complete(shown, chosen)
            }}
          />
        )}

        {/* The strip's own menu sends slash commands, and it sends them the
            way the field does — a slash command here is the text of an
            ordinary message, so there is one channel and not two. */}
        <ComposerAttic
          usage={usage}
          limit={limit}
          onSend={onSend}
          skills={skills}
          onToggleSkill={onToggleSkill}
          onRefreshSkills={onRefreshSkills}
          onOpenSettings={onOpenSettings}
          onAttach={onAttachFiles}
          onAutoCompact={onAutoCompact}
        />

        <ComposerAttachments
          notes={notes}
          onRemove={onRemoveNote}
          files={files}
          onRemoveFile={onRemoveFile}
        />

        <textarea
          ref={textarea}
          value={draft}
          placeholder={t('chat.placeholder')}
          onChange={(event) => {
            write(event.target.value)
            setCaret(event.target.selectionStart)
            // Typing brings the list back — dismissing was about the draft as
            // it stood — and returns the highlight to the top, since filtering
            // has moved what sits at each index.
            setDismissedAt(null)
            setActive(0)
          }}
          // The caret also moves without the text changing — arrows, a click —
          // and both lists are read at it.
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart)
          }}
          onPaste={(event) => {
            /* A screenshot on the clipboard is a picture, not a file, so this
               is the one attachment octopus has to write. Text pastes are
               untouched: an image item is what distinguishes the two, and a
               paste that has both — copying a cell out of a spreadsheet gives
               a picture beside the text — is the text the user meant. */
            const [image] = [...event.clipboardData.items]
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((file) => file !== null)

            if (image && event.clipboardData.getData('text') === '') {
              event.preventDefault()
              onPasteImage(image)
            }
          }}
          onKeyDown={(event) => {
            // Ahead of the list, which completes on Tab: with shift held it is
            // the mode, as in Claude Code, whatever else is open. Only here in
            // the field — anywhere else in the window shift+tab still moves the
            // focus back, which is what a keyboard reader relies on it for.
            if (event.key === 'Tab' && event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              nextMode()
              return
            }

            // The list gets first refusal on the keys it uses, because it is
            // the thing the user is looking at. When it is closed every one of
            // these falls through to the field's own behaviour.
            if (shown !== null) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((current) => (current + step + choices.length) % choices.length)
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
                for (const chosen of choices.slice(active, active + 1)) complete(shown, chosen)
                return
              }

              if (event.key === 'Escape') {
                // The draft is left alone. Escape here means "stop suggesting",
                // not "undo what I typed".
                setDismissedAt(shown.start)
                return
              }
            }

            // Escape stops the turn, as it does in Claude Code, once neither
            // list has taken it: those return above, so an Escape that closes
            // a suggestion never also interrupts the agent. Not while a
            // candidate is being composed — there Escape cancels the candidate.
            if (event.key === 'Escape' && busy && !event.nativeEvent.isComposing) {
              onStop()
              return
            }

            if (!isSubmitEnter(event)) return
            event.preventDefault()
            submit()
          }}
          // `field-sizing-content` is what grows it, so there is no `rows` here
          // and no measuring in JavaScript: the field also has to re-fit when
          // the panes either side of it are dragged, and the browser already
          // knows about that.
          className="focus-ring font-prompt field-sizing-content max-h-80 min-h-[8rem] w-full resize-none bg-transparent px-3 py-2.5 text-[13px] outline-none"
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
            planModel={planModel}
            onChange={onModels}
            display={modelLabel}
            sessionMovedTo={sessionMovedTo}
          />

          <EffortPicker
            value={effort}
            planValue={planEffort}
            onChange={onEfforts}
            planMode={planMode}
            model={modelInForce}
          />

          {/* Beside send rather than among the pickers on the left. Those
              two are settings, changed rarely and left alone; this is turned
              for the message being written, so it belongs next to the button
              that sends it.

              One control for what is stored as two fields. Planning is not a
              degree of permission — the agent runs no tools in it — but the
              four are what Claude Code cycles through on shift+tab, and one
              place to look beats two that each say half of it. Switched in
              place rather than picked from a menu: four states in a fixed
              ring are a click each, and a list would be two. */}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label={t('chat.modeToggle', { mode: t(MODE_LABELS[mode]) })}
              title={t('chat.modeCycle')}
              onClick={nextMode}
              className={`focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[11px] transition-colors ${MODE_TINTS[mode]}`}
            >
              {MODE_ICONS[mode]}
              {t(MODE_LABELS[mode])}
            </button>

            {busy ? (
              <button
                type="button"
                onClick={onStop}
                title={t('chat.stopHint')}
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
              <SendButton
                label={t('chat.send')}
                onClick={submit}
                // A review with nothing typed is still something to send.
                disabled={trimmed === '' && notes.length === 0}
              />
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
