import { ChevronDown, Eraser, FoldVertical, Paperclip } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ContextUsage } from '@core/agent.js'
import type { AutoCompactView } from '@core/autoCompact.js'
import {
  AUTO_COMPACT_OFF_VARIABLES,
  AUTO_COMPACT_VARIABLE,
  AUTO_COMPACT_WINDOWS,
  type AutoCompactWindow,
  windowStrayed
} from '@core/chats.js'
import type { RateLimit, SessionUsage } from '@core/service.js'
import type { SkillListing } from '@core/skills.js'

import { useConfirm } from '../../hooks/useConfirm.js'
import { AgentsChip } from './AgentsChip.js'
import { DropdownMenu, type MenuAction, type MenuSection } from '../DropdownMenu.js'
import { formatTokens, usageTone } from './format.js'
import { PromptFan } from './PromptFan.js'
import { SkillsPanel } from './SkillsPanel.js'

interface ComposerAtticProps {
  readonly usage: SessionUsage
  /**
   * The account's own word on its windows, pushed by the agent.
   *
   * Kept beside the pulled percentages because it carries something no
   * percentage can: a status the server asserts. A share of 84 is a fact about
   * the past; `rejected` is a fact about the next turn.
   */
  readonly limit: RateLimit | null
  /**
   * The same channel the field below uses.
   *
   * A slash command is not dispatched by this app: it goes out as the text of
   * an ordinary message and the agent's CLI is what reads it. So the menu here
   * has nothing to route — it puts the same characters on the same wire, and
   * `/clear` gets its whole behaviour, transcript deletion included, from the
   * path a typed command already takes.
   */
  readonly onSend: (text: string) => Promise<boolean>
  /** Every skill this conversation could use, and whether it is on. */
  readonly skills: readonly SkillListing[]
  readonly onToggleSkill: (key: string, enabled: boolean) => void
  /** Asked for a fresh list when the panel opens; nothing pushes one. */
  readonly onRefreshSkills: () => void
  /** Where the panel sends someone who has no skills to switch yet. */
  readonly onOpenSettings: () => void
  /** Which project's prompts the fan offers, besides the installation's. */
  readonly projectId: string
  /** Writes a chosen prompt's text into the field, where its caret is. */
  readonly onInsert: (text: string) => void
  /** Where the fan sends someone who has no prompts yet, or wants to order them. */
  readonly onOpenPromptSettings: () => void
  /** Opens the file dialog. The paperclip is the visible way in of three. */
  readonly onAttach: () => void
  /** Where this conversation compacts itself; null hands it back to the agent. */
  readonly onAutoCompact: (window: AutoCompactWindow | null) => void
}

/**
 * Wide enough that the window group's notes — a variable name and a path among
 * them — take two lines rather than four. The rest of the app's menus keep
 * their narrower widths.
 */
const MENU_WIDTH = 360

/**
 * What the two rows send, written as it goes on the wire.
 *
 * Not taken from `CLEAR_COMMAND` in `core/chats.ts`, which is the same word
 * answering a different question: that one *recognises* what the user typed —
 * bare, slash stripped, aliases consulted — so the service can drop the
 * transcript when the reset comes back. This one is text to send, and sharing
 * would mean writing `/${CLEAR_COMMAND}` to put back the slash the recogniser
 * exists to remove. `/compact` has no counterpart there at all.
 */
const CLEAR = '/clear'
const COMPACT = '/compact'

/**
 * What the next message is up against, above the field it is typed in.
 *
 * Two readings, both quiet: how full this conversation's context window is, and
 * how much of the subscription's five-hour and weekly windows is gone. One step
 * fainter than the pickers below, which are clicked where these are mostly
 * read — mostly, because the left one is also the way out of what it reports:
 * the account's windows empty on a clock nobody here controls, while a full
 * context window has two commands that answer it.
 *
 * It used to disappear entirely when it had nothing to say, and that was right
 * while everything on it was a measurement: an empty rule above the field would
 * have been chrome asserting that a reading exists. It carries controls now —
 * the skills this conversation may use, and what a message may bring with it —
 * and a control that comes and goes with an unrelated measurement is worse than
 * a strip that is sometimes half empty. So the readings still vanish one by
 * one, and the strip itself stays.
 */
export function ComposerAttic({
  usage,
  limit,
  onSend,
  skills,
  onToggleSkill,
  onRefreshSkills,
  onOpenSettings,
  projectId,
  onInsert,
  onOpenPromptSettings,
  onAttach,
  onAutoCompact
}: ComposerAtticProps): React.JSX.Element {
  const { t } = useTranslation()
  // Owned here rather than threaded down from `App`, where the shared one
  // lives: that one is passed into `useProjects` and `useWorkspaces` because a
  // hook cannot render a dialog of its own. This is a component, and `Modal`
  // sits on a native `<dialog>` — `showModal()` puts it in the top layer
  // wherever in the tree it is written.
  const { confirm, dialog } = useConfirm()

  /**
   * Asks before sending the command that throws the conversation away.
   *
   * The only one of the two that loses something: the service drops the
   * transcript file when the reset comes back, and the visible log goes with
   * it. Typing `/clear` asks nothing and still will — the question is here
   * because a menu is reached by a stray click in a way a typed command is not.
   */
  const requestClear = async (): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('chat.clearTitle'),
      message: t('chat.clearMessage'),
      detail: t('chat.clearDetail'),
      confirmLabel: t('chat.clearConfirm'),
      cancelLabel: t('chat.clearCancel'),
      destructive: true
    })

    if (confirmed) void onSend(CLEAR)
  }

  // Only a refusal is worth a word, and it sits *beside* the figures rather
  // than in place of them.
  //
  // The old header chip replaced its number with this, which was fair when
  // there was one number and a countdown. Here the words would cover the two
  // shares this strip exists to show, and say less than they do: "close to the
  // limit" is vaguer than "Week 84%", and the colour already carries it. Only
  // "limit reached" adds something a percentage cannot — that the next turn
  // will not run.
  const refused = limit?.status === 'rejected' ? t('chat.usageReached') : null

  /*
   * The account's two windows used to be drawn here beside the context share.
   * They moved to the foot of the sidebar: they say nothing about the
   * conversation they were sitting in, the same pair applies to every
   * workspace, and reading them should not require opening a chat first.
   *
   * The refusal stayed. That one *is* about this conversation — it says the
   * next turn will not run — and it is the one thing a percentage cannot say.
   */
  const { context, autoCompact } = usage

  /**
   * Where the conversation compacts, as a choice among six.
   *
   * Still choosable while a variable outranks them, with the note saying so.
   * Greyed, they were a dead end: a running session keeps the variable after
   * it is taken out, so nothing could start one that would notice — and a
   * choice here is what does, the same window included.
   */
  const windowRows = (view: AutoCompactView, reading: ContextUsage): MenuAction[] => {
    const tooLarge = (window: number): boolean =>
      view.modelWindow !== null && window > view.modelWindow

    return [
      {
        id: 'autocompact:auto',
        label: t('chat.autoCompactAuto'),
        // What "auto" means right now is only known while it is the choice:
        // the window then in force is the agent's own.
        description:
          view.chosen === null
            ? t('chat.autoCompactAutoNow', { window: formatTokens(view.effective) })
            : t('chat.autoCompactAutoNote'),
        selected: view.chosen === null,
        section: windowSection(view, reading),
        onSelect: () => {
          onAutoCompact(null)
        }
      },
      ...AUTO_COMPACT_WINDOWS.map((window) => ({
        id: `autocompact:${String(window)}`,
        label: formatTokens(window),
        // A second line only where it adds something: "300k" says where it
        // compacts already, and repeating it doubled the menu's height.
        ...(view.modelWindow !== null &&
          tooLarge(window) && {
            description: t('chat.autoCompactTooLarge', { window: formatTokens(view.modelWindow) })
          }),
        selected: view.chosen === window,
        disabled: tooLarge(window),
        onSelect: () => {
          onAutoCompact(window)
        }
      }))
    ]
  }

  /**
   * What the group needs saying, most pressing first.
   *
   * Compaction being off beats everything: no window is in force when none
   * fires, so a note about which one is would describe a choice with no effect.
   * Then a variable outranking the choice: nothing here can be in force while
   * it is set. Then a choice still waiting for the turn to end. Then a window
   * that is not the one chosen for any other reason — the model holding less,
   * or something this did not foresee — said as a measurement rather than left
   * as a silent disagreement with the tick. Failing all of them, where it does
   * compact, which is what the figure on the strip counts to.
   */
  const windowSection = (view: AutoCompactView, reading: ContextUsage): MenuSection => {
    const title = t('chat.autoCompactTitle')

    if (reading.autoCompactOn === false) {
      return {
        title,
        warning: true,
        note: t('chat.autoCompactOff', { variables: AUTO_COMPACT_OFF_VARIABLES.join(' / ') })
      }
    }

    if (view.override !== null) {
      const values = {
        variable: AUTO_COMPACT_VARIABLE,
        value: view.override.value,
        from: view.override.from
      }
      return {
        title,
        warning: true,
        note:
          view.override.from === null
            ? t('chat.autoCompactOverriddenEnv', values)
            : t('chat.autoCompactOverridden', values)
      }
    }

    if (view.pending) return { title, note: t('chat.autoCompactPending') }

    if (view.chosen !== null && windowStrayed(view)) {
      return {
        title,
        warning: true,
        note: t(view.settled ? 'chat.autoCompactMismatch' : 'chat.autoCompactMismatchRetry', {
          effective: formatTokens(view.effective),
          chosen: formatTokens(view.chosen)
        })
      }
    }

    // Unknown from a CLI that predates the threshold, which is when the figure
    // counts to the window instead and there is no point to name.
    if (reading.compactsAt === null) return { title, note: t('chat.autoCompactNote') }

    return {
      title,
      note: t('chat.autoCompactNoteAt', { threshold: formatTokens(reading.compactsAt) })
    }
  }

  return (
    <>
      {/* Wraps for the same reason the footer does: the two halves are held
          apart by `ml-auto`, and at the narrowest width the layout permits
          there is nothing to stop them meeting. A percentage that has been
          truncated is worse than one on a second line. */}
      <div className="border-line text-ink-faint flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[11px]">
        {context !== null && (
          // The one figure on the strip that can be acted on, so it is the one
          // that opens a menu. What acts on a full context window are two
          // commands the CLI already has, and neither is dispatched here —
          // they go out as the text of an ordinary message, which is what a
          // slash command is in this app.
          <DropdownMenu
            align="left"
            width={MENU_WIDTH}
            actions={[
              {
                id: COMPACT,
                label: COMPACT,
                description: t('chat.contextCompactNote'),
                icon: <FoldVertical aria-hidden size={12} />,
                onSelect: () => {
                  void onSend(COMPACT)
                }
              },
              ...(autoCompact === null ? [] : windowRows(autoCompact, context)),
              {
                // Last, and in the danger colour: of the two it is the one
                // that loses something, and the reader should land first on
                // the option that keeps the conversation.
                id: CLEAR,
                label: CLEAR,
                description: t('chat.contextClearNote'),
                icon: <Eraser aria-hidden size={12} />,
                destructive: true,
                // A line of its own, so it does not read as a seventh window.
                ...(autoCompact !== null && { section: {} }),
                onSelect: () => {
                  void requestClear()
                }
              }
            ]}
            trigger={({ onClick, open }) => (
              <button
                type="button"
                onClick={onClick}
                aria-haspopup="menu"
                aria-expanded={open}
                // No `aria-label`: the visible text is the better name, and one
                // here would replace "Context 48%" with a generic phrase —
                // taking the figure away from the reader who is told it rather
                // than shown it. The title stays what it was, and with text
                // content present it is read as the description.
                title={
                  context.compactsAt === null
                    ? t('chat.contextTitle', {
                        used: formatTokens(context.usedTokens),
                        total: formatTokens(context.maxTokens)
                      })
                    : t('chat.contextTitleCompactsAt', {
                        used: formatTokens(context.usedTokens),
                        total: formatTokens(context.maxTokens),
                        threshold: formatTokens(context.compactsAt)
                      })
                }
                // `px-1 py-0.5` gives the hover surface something to hold and
                // the negative margins cancel it exactly, so the reading stays
                // on the strip's own inset and the strip does not grow taller.
                //
                // No `hover:text-ink`, which is the one line the pickers below
                // have that must not be copied up here: `usageTone` paints this
                // `warning` at 60% and `danger` at 80%, and a hover that
                // repainted it would put the control's state over the
                // measurement. The open state is a background alone for the
                // same reason.
                className={`focus-ring hover:bg-muted -mx-1 -my-0.5 inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1 py-0.5 transition-colors ${usageTone(context.percentage)} ${open ? 'bg-muted' : ''}`}
              >
                {t('chat.context')} {context.percentage}%
                <ChevronDown aria-hidden size={10} className="shrink-0 opacity-50" />
              </button>
            )}
          />
        )}

        {/* Beside the context reading: both say what the conversation is
            carrying right now, and the count is gone when nothing has run. */}
        <AgentsChip />

        {/* The right-hand group, held apart by `ml-auto` on the group rather
            than on the refusal — which used to own it alone, back when there
            was nothing else over here to hold together. */}
        <span className="ml-auto flex items-center gap-2">
          {refused !== null && <span className="text-danger">{refused}</span>}

          <SkillsPanel
            skills={skills}
            onToggle={onToggleSkill}
            onOpen={onRefreshSkills}
            onOpenSettings={onOpenSettings}
          />

          <PromptFan projectId={projectId} onPick={onInsert} onManage={onOpenPromptSettings} />

          {/* One of three ways in, and the least used: a file is more often
              dragged onto the composer or pasted into it. It is here because it
              is the only one that is visible — the other two have to be
              guessed at, and this says the guess would be right. */}
          <button
            type="button"
            onClick={onAttach}
            aria-label={t('chat.attach')}
            title={t('chat.attach')}
            className="focus-ring text-ink-faint hover:text-ink -my-0.5 inline-flex items-center rounded-[var(--radius-control)] px-1 py-0.5"
          >
            <Paperclip aria-hidden size={12} />
          </button>
        </span>
      </div>

      {dialog}
    </>
  )
}
