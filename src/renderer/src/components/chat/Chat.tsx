import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { PERMISSION_MODES, type PermissionMode } from '@core/chats.js'
import type { ProjectColor } from '@core/colors.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { Placeholder } from '../Placeholder.js'
import { useChat } from '../../hooks/useChat.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { useRateLimit } from '../../hooks/useRateLimit.js'
import { ChatLog } from './ChatLog.js'
import { Composer } from './Composer.js'
import { RateLimit } from './RateLimit.js'

interface ChatProps {
  readonly workspace: WorkspaceView | null
  /**
   * The project's colour, for the messages you sent.
   *
   * The project rather than the workspace: workspaces of one project are
   * shades of the same work, and the colour is what says which project the
   * window is in — the tab strip and the sidebar already read that way.
   *
   * Not nullable: the centre shows a placeholder until a project is open, so a
   * chat without one is a state that never renders.
   */
  readonly color: ProjectColor
}

const MODE_LABELS: Record<
  PermissionMode,
  'chat.modeDefault' | 'chat.modePlan' | 'chat.modeAcceptEdits'
> = {
  default: 'chat.modeDefault',
  plan: 'chat.modePlan',
  acceptEdits: 'chat.modeAcceptEdits'
}

/**
 * The agent chat — the centre of the window (§10.8 docs/PROJECT.md).
 *
 * Scoped to one workspace, because that is what the conversation acts on: its
 * worktree is the agent's working directory and its branch is where the work
 * lands. Selecting a different workspace shows a different conversation, not a
 * continuation of this one.
 */
export function Chat({ workspace, color }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const chat = useChat(workspace?.id ?? null, describeFailure)
  const rateLimit = useRateLimit()

  const scroller = useRef<HTMLDivElement | null>(null)
  const pinnedToBottom = useRef(true)

  // Follows the conversation, but only while the user is already at the end of
  // it — yanking the view down while they read something further up is the
  // single most irritating thing a log can do.
  useEffect(() => {
    const element = scroller.current
    if (!element || !pinnedToBottom.current) return

    element.scrollTop = element.scrollHeight
  }, [chat.entries, chat.streaming])

  if (!workspace) {
    return <Placeholder title={t('chat.noWorkspaceTitle')}>{t('chat.noWorkspaceBody')}</Placeholder>
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // The sanctioned inline style (§10.4): the value is dynamic but still
      // resolves to a token, and setting it on the container is what lets the
      // stylesheet own how the colour is used rather than each component.
      style={{ '--project-color': `var(--project-${color})` } as React.CSSProperties}
    >
      <header className="border-line flex h-9 shrink-0 items-center gap-3 border-b px-6">
        <span className="truncate font-medium">{workspace.name}</span>
        <span className="text-ink-faint truncate font-mono text-[11px]">{workspace.branch}</span>

        <span className="ml-auto flex shrink-0 items-center gap-3">
          <RateLimit limit={rateLimit} />

          <select
            value={chat.chat?.permissionMode ?? 'default'}
            // Until the first message there is no record to change, and the
            // global setting is what the chat will start from.
            disabled={chat.chat === null}
            aria-label={t('chat.mode')}
            onChange={(event) => {
              const mode = event.target.value
              // The value comes back as a string; narrowing it keeps the union
              // honest rather than casting it back into shape.
              const known = PERMISSION_MODES.find((candidate) => candidate === mode)
              if (known) void chat.setMode(known)
            }}
            className="border-line bg-canvas text-ink-soft focus-ring h-6 shrink-0 rounded-[var(--radius-control)] border px-1.5 disabled:opacity-50"
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(MODE_LABELS[mode])}
              </option>
            ))}
          </select>
        </span>
      </header>

      <div
        ref={scroller}
        // A log rather than a plain box: the content appends over time, which
        // is what tells a screen reader to announce additions rather than
        // re-read the conversation from the top.
        role="log"
        onScroll={(event) => {
          const element = event.currentTarget
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight
          // A few pixels of slack: smooth scrolling and sub-pixel heights mean
          // "at the bottom" is rarely exactly zero.
          pinnedToBottom.current = distance < 40
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {chat.error !== null && (
          <div className="mx-auto w-full max-w-3xl px-6 pt-5">
            <p className="bg-danger-bg text-danger border-danger/25 rounded-[var(--radius-control)] border px-3 py-2">
              {chat.error}
            </p>
          </div>
        )}

        {/* Streaming counts as content even before the first entry lands:
            without it the answer to the very first message would draw over the
            placeholder, and the pane would say "start the conversation" while
            the agent was replying to it. */}
        {chat.entries.length === 0 &&
        !chat.loading &&
        !chat.busy &&
        chat.streaming.text === '' &&
        chat.streaming.thinking === '' ? (
          <Placeholder title={t('chat.emptyTitle')}>{t('chat.emptyBody')}</Placeholder>
        ) : (
          <ChatLog
            entries={chat.entries}
            streaming={chat.streaming}
            busy={chat.busy}
            pendingRequestId={chat.pendingRequestId}
            onAnswer={(requestId, answer) => void chat.answer(requestId, answer)}
          />
        )}
      </div>

      <Composer
        busy={chat.busy}
        onSend={(text) => void chat.send(text)}
        onStop={() => void chat.interrupt()}
      />
    </div>
  )
}
