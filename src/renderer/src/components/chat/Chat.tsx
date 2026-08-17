import type { Chat as ChatRecord, Effort, WorkingMode } from '@core/chats.js'
import type { ProjectColor } from '@core/colors.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { ChatTabsController } from '../../hooks/useChatTabs.js'
import type { DiffCommentController } from '../../hooks/useDiffComments.js'
import { ChatSession } from './ChatSession.js'
import { ChatTabs } from './ChatTabs.js'

interface ChatProps {
  /**
   * The workspace these conversations act on.
   *
   * Not nullable: a pane with no workspace selected is a different screen, and
   * `App` shows it instead — the way out of that state is to create one, which
   * is not something the chat knows how to do.
   */
  readonly workspace: WorkspaceView
  /** The workspace's conversations, which `App` owns so ⌥1–⌥3 can reach them. */
  readonly tabs: ChatTabsController
  /**
   * What was in a tab's composer when it was last left.
   *
   * A reader rather than the map, because the key is `App`'s to compose: the
   * drafts are held per workspace *and* tab, and the chat knows only the tab.
   */
  readonly draftOf: (tabKey: string) => string
  readonly onDraftLeave: (tabKey: string, text: string) => void
  /** Review notes from the diff pane, riding out with the next message. */
  readonly comments: DiffCommentController
  /**
   * The project's colour, for the messages you sent and the active tab's rule.
   *
   * The project rather than the workspace: workspaces of one project are
   * shades of the same work, and the colour is what says which project the
   * window is in — the tab strip and the sidebar already read that way.
   *
   * Not nullable: the centre shows a placeholder until a project is open, so a
   * chat without one is a state that never renders.
   */
  readonly color: ProjectColor
  readonly defaultWorkingMode: WorkingMode
  readonly defaultEffort: Effort
}

/**
 * The agent chat — the centre of the window (§10.8 docs/PROJECT.md).
 *
 * Scoped to one workspace, because that is what the conversations act on: its
 * worktree is the agent's working directory and its branch is where the work
 * lands. Inside it there may be up to three, running at once in the same files
 * — the strip is what says which is which, and how each of them is getting on.
 *
 * Every one of them stays mounted while the workspace is open, the arrangement
 * the right pane uses for its tabs: a conversation that unmounted would lose
 * its scroll position and the answer half-streamed into it each time you looked
 * at another, which with several agents at work is most of the time.
 *
 * `App` keys this by workspace, which is what stops a sentence typed for one
 * workspace reaching another's agent — and what lets everything below drop the
 * "is this still the pane on screen" checks it used to need.
 */
export function Chat({
  workspace,
  tabs,
  draftOf,
  onDraftLeave,
  comments,
  color,
  defaultWorkingMode,
  defaultEffort
}: ChatProps): React.JSX.Element {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // The sanctioned inline style (§10.4): the value is dynamic but still
      // resolves to a token, and setting it on the container is what lets the
      // stylesheet own how the colour is used rather than each component.
      style={{ '--project-color': `var(--project-${color})` } as React.CSSProperties}
    >
      <header className="border-line flex h-9 shrink-0 items-center border-b px-6">
        {/* Capped like everything below it. The log, the composer and the error
            banner are all held to this width, and the strip has to line up with
            the conversation it labels.

            The row carries the strip alone. The branch used to share it, and
            has moved to the title bar beside the project's directory: it says
            where the work lands, which is a fact about the window rather than
            about any one conversation. */}
        <div className="mx-auto flex w-full max-w-6xl items-center">
          <ChatTabs tabs={tabs} />
        </div>
      </header>

      {tabs.tabs.map((tab) => (
        <ChatSession
          // Fixed for the tab's life, and deliberately not the chat id: the
          // record appears on the first message, and a key that moved with it
          // would remount the pane in the middle of the turn that created it.
          key={tab.key}
          workspace={workspace}
          tab={tab}
          visible={tab.key === tabs.activeKey}
          onOpened={(chat: ChatRecord) => {
            tabs.bind(tab.key, chat)
          }}
          draft={draftOf(tab.key)}
          onDraftLeave={(text) => {
            onDraftLeave(tab.key, text)
          }}
          comments={comments}
          defaultWorkingMode={defaultWorkingMode}
          defaultEffort={defaultEffort}
        />
      ))}
    </div>
  )
}
