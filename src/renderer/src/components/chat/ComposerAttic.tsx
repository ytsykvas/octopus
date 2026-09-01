import { ChevronDown, Eraser, FoldVertical, Paperclip } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { RateLimit, SessionUsage } from '@core/service.js'
import type { SkillListing } from '@core/skills.js'

import { useConfirm } from '../../hooks/useConfirm.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { formatTokens, usageTone } from './format.js'
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
}

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
  onOpenSettings
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
  const { context } = usage

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
              {
                // Last, and in the danger colour: of the two it is the one
                // that loses something, and the reader should land first on
                // the option that keeps the conversation.
                id: CLEAR,
                label: CLEAR,
                description: t('chat.contextClearNote'),
                icon: <Eraser aria-hidden size={12} />,
                destructive: true,
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
                title={t('chat.contextTitle', {
                  used: formatTokens(context.usedTokens),
                  total: formatTokens(context.maxTokens)
                })}
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

          {/* No behaviour yet, and it says so rather than swallowing a click.
              A control that looks live and does nothing is read as a bug in
              the app; one that is plainly not ready yet is read as a plan. */}
          <button
            type="button"
            disabled
            aria-label={t('chat.attach')}
            title={t('chat.attachSoon')}
            className="text-ink-faint -my-0.5 inline-flex items-center rounded-[var(--radius-control)] px-1 py-0.5 opacity-50"
          >
            <Paperclip aria-hidden size={12} />
          </button>
        </span>
      </div>

      {dialog}
    </>
  )
}
