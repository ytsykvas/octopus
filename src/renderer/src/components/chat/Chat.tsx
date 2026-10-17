import type { Chat as ChatRecord, Effort, WorkingMode } from '@core/chats.js'
import type { ProjectColor } from '@core/colors.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ChatTabsController } from '../../hooks/useChatTabs.js'
import type { FileTabsController } from '../../hooks/useFileTabs.js'
import { Button } from '../Button.js'
import { RepoTrustReview } from '../RepoTrustReview.js'
import type { CodeNoteController } from '../../hooks/useCodeNotes.js'
import type { DiffCommentController } from '../../hooks/useDiffComments.js'
import type { PullRequestQuoteController } from '../../hooks/usePullRequestQuotes.js'
import { ChatSession } from './ChatSession.js'
import { ChatTabs } from './ChatTabs.js'
import { chatName } from './chatName.js'
import { FileTabs } from '../files/FileTabs.js'
import { FileViewer } from '../files/FileViewer.js'

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
   * The files opened from the right pane's tree, beside the conversations.
   *
   * When one is in front, every conversation is hidden behind it — still
   * mounted, so a turn keeps streaming into the pane nobody is looking at.
   */
  readonly files: FileTabsController
  /** Says a failure in the window's banner — a file the system would not open. */
  readonly onError: (message: string | null) => void
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
  readonly quotes: PullRequestQuoteController
  /** Notes from the file viewer, each held by the conversation it was sent to. */
  readonly codeNotes: CodeNoteController
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
  readonly defaultModel: string | null
  readonly defaultPlanModel: string | null
  /** Opens the settings on skills — the way out of an empty skills panel. */
  readonly onOpenSkillSettings: () => void
  /** The workspace was just made here, so its composer takes the caret. */
  readonly focusComposer: boolean
  /** The set of variables the workspace's project uses, until the list is read. */
  readonly projectEnvProfile: string
  /** The workspace's record changed — the set it runs with — and the list should be read again. */
  readonly onWorkspacesChanged: () => void
  readonly dismissedTips: readonly string[]
  readonly onDismissTip: (id: string) => void
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
  files,
  onError,
  draftOf,
  onDraftLeave,
  comments,
  quotes,
  codeNotes,
  color,
  defaultWorkingMode,
  defaultEffort,
  defaultModel,
  defaultPlanModel,
  onOpenSkillSettings,
  focusComposer,
  projectEnvProfile,
  onWorkspacesChanged,
  dismissedTips,
  onDismissTip
}: ChatProps): React.JSX.Element {
  const { t } = useTranslation()
  const [reviewing, setReviewing] = useState(false)
  /*
   * The verdict, and the workspace it belongs to.
   *
   * Reset during render rather than in the effect, the way `useServingPort`
   * does it: an effect runs after the paint, so the next workspace would show
   * one frame of the last one's answer — and here that frame is a warning
   * about a repository it is not about.
   */
  const [trust, setTrust] = useState<{ id: string; untrusted: boolean }>({
    id: workspace.id,
    untrusted: false
  })
  if (trust.id !== workspace.id) setTrust({ id: workspace.id, untrusted: false })
  const untrusted = trust.id === workspace.id && trust.untrusted

  /*
   * Asked per workspace, because the files live in the worktree a session runs
   * in — a branch may carry different ones from the branch beside it.
   *
   * Only ever turned on here. Approving turns it off, and a fresh workspace
   * asks again from scratch.
   */
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.workspaces.trust(workspace.id)
      // A question that could not be answered is not evidence of anything.
      if (!controller.signal.aborted && answer.ok) {
        setTrust({ id: workspace.id, untrusted: !answer.value.approved })
      }
    })()

    return () => {
      controller.abort()
    }
  }, [workspace.id])

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      // The sanctioned inline style (§10.4): the value is dynamic but still
      // resolves to a token, and setting it on the container is what lets the
      // stylesheet own how the colour is used rather than each component.
      style={{ '--project-color': `var(--project-${color})` } as React.CSSProperties}
    >
      <header className="border-line flex h-9 min-w-0 shrink-0 items-center border-b px-6">
        {/* Held to the pane's left edge rather than to the capped column below
            it. Lined up with the log, the strip drifted to the middle of a wide
            window, and tabs are found by where they start, not by what they
            label.

            The row carries the strip alone. The branch used to share it, and
            has moved to the title bar beside the project's directory: it says
            where the work lands, which is a fact about the window rather than
            about any one conversation. */}
        <ChatTabs
          tabs={tabs}
          filesInFront={files.active !== null}
          notesWaiting={(tabKey) => codeNotes.pendingFor(tabKey).length}
        />
        <FileTabs files={files} />
      </header>

      {/* Pinned under the header rather than inside the scroller, where
          `chat.error` lives: this is a standing fact about the workspace, not
          an event in one conversation, and a notice that scrolls away is one
          nobody reads twice. */}
      {untrusted && (
        <div className="border-warning/30 bg-warning-bg mx-6 mt-3 flex items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2">
          <p className="min-w-0 flex-1 leading-relaxed">{t('trust.notice')}</p>
          <Button
            size="sm"
            onClick={() => {
              setReviewing(true)
            }}
          >
            {t('trust.review')}
          </Button>
        </div>
      )}

      {reviewing && (
        <RepoTrustReview
          projectId={workspace.projectId}
          workspaceId={workspace.id}
          onApproved={() => {
            setReviewing(false)
            setTrust({ id: workspace.id, untrusted: false })
          }}
          onClose={() => {
            setReviewing(false)
          }}
        />
      )}

      {tabs.tabs.map((tab) => (
        <ChatSession
          // Fixed for the tab's life, and deliberately not the chat id: the
          // record appears on the first message, and a key that moved with it
          // would remount the pane in the middle of the turn that created it.
          key={tab.key}
          workspace={workspace}
          tab={tab}
          // Behind a file as well as behind another conversation: only the
          // pane on screen may raise a dialog (§10.8).
          visible={tab.key === tabs.activeKey && files.active === null}
          onOpened={(chat: ChatRecord) => {
            tabs.bind(tab.key, chat)
          }}
          draft={draftOf(tab.key)}
          onDraftLeave={(text) => {
            onDraftLeave(tab.key, text)
          }}
          comments={comments}
          quotes={quotes}
          codeNotes={codeNotes}
          defaultWorkingMode={defaultWorkingMode}
          defaultEffort={defaultEffort}
          defaultModel={defaultModel}
          defaultPlanModel={defaultPlanModel}
          onOpenSkillSettings={onOpenSkillSettings}
          focusComposer={focusComposer && tab.key === tabs.activeKey}
          projectEnvProfile={projectEnvProfile}
          onWorkspacesChanged={onWorkspacesChanged}
          dismissedTips={dismissedTips}
          onDismissTip={onDismissTip}
        />
      ))}

      {/* Mounted only while in front, unlike the conversations: a file is read
          again each time it comes forward, which is when it may have changed,
          and there is nothing in it to lose by going. */}
      {files.active !== null && (
        <FileViewer
          key={files.active}
          workspaceId={workspace.id}
          path={files.active}
          onError={onError}
          // Every conversation in the strip, named as the strip names it. The
          // one in front last leads, which is where "the chat I was in" is.
          targets={tabs.tabs.map((tab, index) => ({
            key: tab.key,
            name: chatName(t, tab, index + 1),
            active: tab.key === tabs.activeKey
          }))}
          onNote={codeNotes.add}
        />
      )}
    </div>
  )
}
