import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AgentModel, Effort, PlanExecutionMode, WorkingMode } from '@core/chats.js'
import type { ProjectColor } from '@core/colors.js'
import type { WorkspaceView } from '@core/workspaces.js'
import type { SessionUsage } from '@core/service.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Result } from '../../../../preload/index.js'
import { useChatTabs } from '../../hooks/useChatTabs.js'
import { useFileTabs } from '../../hooks/useFileTabs.js'
import { STEP_MARGIN } from '../../hooks/useMessageSteps.js'
import { useAttachedFiles } from '../../hooks/useAttachedFiles.js'
import { useCodeNotes } from '../../hooks/useCodeNotes.js'
import { useSideQuestions } from '../../hooks/useSideQuestions.js'
import type { DiffCommentController } from '../../hooks/useDiffComments.js'
import type { PullRequestQuoteController } from '../../hooks/usePullRequestQuotes.js'
import {
  chat,
  CHAT_ID,
  emitAgentEvent,
  emitChatStatus,
  givenChat,
  givenChats
} from '../../test/chat.js'
import { commentController, quoteController } from '../../test/comments.js'
import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { task } from '../../test/tasks.js'
import { workspaceView } from '../../test/workspaces.js'
import { Chat } from './Chat.js'
import { messageBlocks } from './userMessage.js'
import type * as UserMessageModule from './userMessage.js'

// Watched rather than replaced: a user's bubble reads its message through this
// on every render, which makes it the way to tell whether the log's rows were
// drawn again.
vi.mock('./userMessage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UserMessageModule>()
  return { ...actual, messageBlocks: vi.fn(actual.messageBlocks) }
})

// The plan's approval is a dialog now, and jsdom implements none of `<dialog>`.
beforeAll(stubDialogElement)

interface PaneProps {
  readonly workspace: WorkspaceView
  readonly draft?: string
  readonly onDraftLeave?: (tabKey: string, text: string) => void
  readonly comments?: DiffCommentController
  readonly quotes?: PullRequestQuoteController
  readonly color?: ProjectColor
  readonly defaultWorkingMode?: WorkingMode
  readonly planExecutionMode?: PlanExecutionMode
  readonly defaultEffort?: Effort
  readonly defaultModel?: string | null
  readonly defaultPlanModel?: string | null
  readonly dismissedTips?: readonly string[]
  readonly onDismissTip?: (id: string) => void
  /** Where a failure the strip owns is reported, as `App` reports it. */
  readonly onError?: (message: string | null) => void
  readonly focusComposer?: boolean
  readonly onWorkspacesChanged?: () => void
}

/**
 * The pane as `App` assembles it.
 *
 * The strip's controller is the real hook rather than a stub, because the two
 * halves are what this pane is: the strip decides which conversation is
 * showing, and the panes below are what shows. It is also what reads
 * `chats.list`, which is the signal every test here waits on.
 */
function ChatPane({
  workspace: target,
  draft = '',
  onDraftLeave = vi.fn(),
  comments = commentController(),
  quotes = quoteController(),
  color = 'blue',
  defaultWorkingMode = 'default',
  planExecutionMode = 'acceptEdits',
  defaultEffort = 'medium',
  defaultModel = null,
  defaultPlanModel = null,
  dismissedTips = [],
  onDismissTip = vi.fn(),
  onError = vi.fn(),
  focusComposer = false,
  onWorkspacesChanged = vi.fn()
}: PaneProps): React.JSX.Element {
  const tabs = useChatTabs(target.id, vi.fn(), onError)
  const files = useFileTabs(target.id)
  const codeNotes = useCodeNotes(target.id)
  const attachedFiles = useAttachedFiles(target.id)
  const sideQuestions = useSideQuestions()

  return (
    <Chat
      // Keyed as `App` keys it: switching workspace builds the panes fresh
      // rather than handing one workspace's conversation to another's tabs.
      key={target.id}
      workspace={target}
      tabs={tabs}
      files={files}
      onError={onError}
      draftOf={() => draft}
      onDraftLeave={onDraftLeave}
      comments={comments}
      quotes={quotes}
      codeNotes={codeNotes}
      attachedFiles={attachedFiles}
      sideQuestions={sideQuestions}
      color={color}
      defaultWorkingMode={defaultWorkingMode}
      planExecutionMode={planExecutionMode}
      defaultEffort={defaultEffort}
      defaultModel={defaultModel}
      defaultPlanModel={defaultPlanModel}
      onOpenSkillSettings={vi.fn()}
      focusComposer={focusComposer}
      projectEnvProfile="default"
      onWorkspacesChanged={onWorkspacesChanged}
      dismissedTips={dismissedTips}
      onDismissTip={onDismissTip}
    />
  )
}

/**
 * Renders the pane and waits for the chat lookup to settle.
 *
 * The two defaults are what the settings say a new conversation starts with;
 * a test that is not about them leaves them at the schema's own values.
 */
async function openChat(
  target: WorkspaceView = workspaceView('anna'),
  defaults: {
    workingMode?: WorkingMode
    planExecutionMode?: PlanExecutionMode
    effort?: Effort
    model?: string | null
    planModel?: string | null
  } = {}
): Promise<void> {
  render(
    <ChatPane
      workspace={target}
      defaultWorkingMode={defaults.workingMode ?? 'default'}
      planExecutionMode={defaults.planExecutionMode ?? 'acceptEdits'}
      defaultEffort={defaults.effort ?? 'medium'}
      defaultModel={defaults.model ?? null}
      defaultPlanModel={defaults.planModel ?? null}
    />
  )
  await waitFor(() => {
    expect(octopus().chats.list).toHaveBeenCalled()
  })
}

/** The panel's coding half; both columns hold the same names. */
const codeColumn = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Writing code' })
const planColumn = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Plan and research' })

/** What the radios in one column say they are, ticked ones only. */
function ticked(column: HTMLElement): string[] {
  return within(column)
    .getAllByRole('radio')
    .filter((radio) => radio.getAttribute('aria-checked') === 'true')
    .map((radio) => radio.textContent)
}

/**
 * The catalogue a live account sent: Opus is `opus[1m]` and there is no plain
 * `opus`, which is the whole reason `/model opusplan` needs a fallback.
 */
function givenLiveCatalogue(): void {
  const row = (value: string, resolvedModel: string, displayName: string): AgentModel => ({
    value,
    resolvedModel,
    displayName,
    description: '',
    supportsEffort: null,
    supportedEffortLevels: null
  })

  vi.mocked(octopus().chats.models).mockResolvedValue({
    ok: true,
    value: [
      row('default', 'claude-opus-5[1m]', 'Default (recommended)'),
      row('opus[1m]', 'claude-opus-5[1m]', 'Opus (1M context)'),
      row('sonnet', 'claude-sonnet-5', 'Sonnet')
    ]
  })
}

/**
 * Renders a pane whose chat already exists, and waits until it is loaded.
 *
 * The history call is the signal. It used to be the mode picker becoming
 * enabled — but the picker is now enabled from the start, since the mode of the
 * first message is exactly the one worth choosing, so that signal would be true
 * before the chat had arrived and every test after it would race the load.
 */
async function openLoadedChat(planExecutionMode: PlanExecutionMode = 'acceptEdits'): Promise<void> {
  await openChat(workspaceView('anna'), { planExecutionMode })
  await waitFor(() => {
    expect(octopus().chats.history).toHaveBeenCalled()
  })
}

const field = (): HTMLElement => screen.getByRole('textbox')

describe('a workspace nobody has written in', () => {
  it('invites the first message without creating a record', async () => {
    await openChat()

    expect(await screen.findByText('Start the conversation')).toBeInTheDocument()
    expect(octopus().chats.open).not.toHaveBeenCalled()
  })

  // `anna ytsykvas/anna` was the same word twice: a workspace branch is made
  // from the workspace name, so the branch already carries it.
  // The branch moved to the title bar, beside the project's directory: it says
  // where the work lands, which is a fact about the window rather than about
  // any one conversation. `App.test.tsx` is where it is asserted now.
  it('leaves the branch to the title bar', async () => {
    await openChat()

    expect(screen.queryByText('ytsykvas/anna')).toBeNull()
  })

  // Nothing else in this pane says that string is a branch.

  // The mode the first message runs under is the one most worth choosing, so
  // the control is live before there is a record — picking one creates it.
  it('offers the mode before there is anything to change', async () => {
    await openChat()

    expect(screen.getByRole('button', { name: /^Permissions:/ })).toBeEnabled()
  })
})

describe('the environment a new task runs against', () => {
  const SWITCH = 'Set of variables this workspace runs with'

  /*
   * The first message is where a task starts, and whether the work behind it
   * runs against production or staging data is a question for that moment —
   * not for after a build has already pulled the wrong dump.
   */
  it('offers the sets on the empty conversation', async () => {
    vi.mocked(octopus().projects.envProfiles).mockResolvedValue({
      ok: true,
      value: { profiles: ['default', 'prod'], projectDefault: 'default' }
    })
    await openChat()

    const sets = await screen.findByRole('group', { name: SWITCH })
    expect(screen.getByText('Runs against')).toBeInTheDocument()
    expect(within(sets).getByRole('button', { name: 'default' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('puts the workspace on a set and has the list read again', async () => {
    vi.mocked(octopus().projects.envProfiles).mockResolvedValue({
      ok: true,
      value: { profiles: ['default', 'prod'], projectDefault: 'default' }
    })
    const onWorkspacesChanged = vi.fn()
    render(<ChatPane workspace={workspaceView('anna')} onWorkspacesChanged={onWorkspacesChanged} />)

    const sets = await screen.findByRole('group', { name: SWITCH })
    await userEvent.click(within(sets).getByRole('button', { name: 'prod' }))

    expect(octopus().workspaces.setEnvProfile).toHaveBeenCalledWith('planner/anna', 'prod')
    await waitFor(() => {
      expect(onWorkspacesChanged).toHaveBeenCalled()
    })
  })

  it('shows the set the workspace is already on', async () => {
    vi.mocked(octopus().projects.envProfiles).mockResolvedValue({
      ok: true,
      value: { profiles: ['default', 'prod'], projectDefault: 'default' }
    })
    await openChat(workspaceView('anna', { envProfile: 'prod' }))

    const sets = await screen.findByRole('group', { name: SWITCH })
    expect(within(sets).getByRole('button', { name: 'prod' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('says in the conversation why the workspace could not be moved', async () => {
    vi.mocked(octopus().projects.envProfiles).mockResolvedValue({
      ok: true,
      value: { profiles: ['default', 'prod'], projectDefault: 'default' }
    })
    vi.mocked(octopus().workspaces.setEnvProfile).mockResolvedValue({ ok: false, error: 'nope' })
    await openChat()

    const sets = await screen.findByRole('group', { name: SWITCH })
    await userEvent.click(within(sets).getByRole('button', { name: 'prod' }))

    expect(await screen.findByText(/nope/)).toBeInTheDocument()
  })

  it('draws nothing for a project with a single set', async () => {
    // `default` alone is what the stub answers: no choice, so no switch and no
    // label promising one.
    await openChat()
    await waitFor(() => {
      expect(octopus().projects.envProfiles).toHaveBeenCalled()
    })

    expect(screen.queryByRole('group', { name: SWITCH })).not.toBeInTheDocument()
    expect(screen.queryByText('Runs against')).not.toBeInTheDocument()
  })
})

describe('a workspace just made', () => {
  // What somebody knows at this moment is the task, so the caret is already
  // where it goes.
  it('puts the caret in the composer', async () => {
    render(<ChatPane workspace={workspaceView('anna')} focusComposer />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask the agent/)).toHaveFocus()
    })
  })

  it('leaves the caret alone on any other visit', async () => {
    await openChat()

    expect(screen.getByPlaceholderText(/Ask the agent/)).not.toHaveFocus()
  })
})

describe('the project it belongs to', () => {
  // The stylesheet owns how the colour is used; the component only says which
  // one, and it resolves to a token rather than to a value (§10.4).
  it('carries the colour down for the stylesheet to use', async () => {
    const { container } = render(<ChatPane workspace={workspaceView('anna')} color="teal" />)
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })

    expect(container.firstElementChild).toHaveStyle({ '--project-color': 'var(--project-teal)' })
  })
})

describe('a /btw typed into the main field', () => {
  const answering = (text: string): void => {
    vi.mocked(octopus().chats.sideQuestion).mockResolvedValue({
      ok: true,
      value: { text, synthetic: false }
    })
  }
  const drawer = (): HTMLElement | null => screen.queryByRole('region', { name: 'Side questions' })

  it('is answered in the side drawer and never sent to the conversation', async () => {
    const user = userEvent.setup()
    answering('It uses Kyiv.')
    await openChat()

    await user.type(field(), '/btw which city?{Enter}')

    expect(await screen.findByText('It uses Kyiv.')).toBeInTheDocument()
    expect(octopus().chats.sideQuestion).toHaveBeenCalledWith('chat-1', 'which city?', [])
    expect(octopus().chats.send).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText(/Ask the agent/)).toHaveValue('')
  })

  it('opens the drawer on the thread so far when bare', async () => {
    const user = userEvent.setup()
    await openChat()

    await user.type(field(), '/btw{Enter}')

    await waitFor(() => {
      expect(drawer()).toBeInTheDocument()
    })
    expect(octopus().chats.sideQuestion).not.toHaveBeenCalled()
    expect(octopus().chats.send).not.toHaveBeenCalled()
  })

  it('opens, asks and clears from the drawer itself', async () => {
    const user = userEvent.setup()
    answering('Because.')
    await openChat()

    await user.click(screen.getByRole('button', { name: 'Ask a side question' }))
    await user.type(
      await screen.findByRole('textbox', { name: 'Your side question' }),
      'why?{Enter}'
    )
    expect(await screen.findByText('Because.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear side questions' }))
    expect(screen.queryByText('Because.')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close side questions', expanded: true }))
    expect(drawer()).toBeNull()
  })

  describe('continued from an answer', () => {
    const forkButton = (): Promise<HTMLElement> =>
      screen.findByRole('button', { name: 'Continue from this answer in a new conversation' })

    async function answered(): Promise<ReturnType<typeof userEvent.setup>> {
      const user = userEvent.setup()
      answering('It uses Kyiv.')
      givenChats([chat({ title: 'main', sessionId: 'sess-1' })])
      await openChat()
      await user.type(field(), '/btw which city?{Enter}')
      await screen.findByText('It uses Kyiv.')
      return user
    }

    // The CLI's panel goes once the fork is open; the answer has moved on.
    it('opens the fork in a new tab and puts the drawer away', async () => {
      const user = await answered()
      const forked = chat({ id: 'chat-2', title: 'btw: which city?', sessionId: 'sess-2' })
      vi.mocked(octopus().chats.fork).mockResolvedValue({ ok: true, value: forked })
      givenChats([chat({ title: 'main', sessionId: 'sess-1' }), forked])

      await user.click(await forkButton())

      expect(octopus().chats.fork).toHaveBeenCalledWith('chat-1', {
        question: 'which city?',
        response: 'It uses Kyiv.'
      })
      await user.click(await screen.findByRole('button', { name: /^main: / }))
      expect(drawer()).toBeNull()
    })

    it('leaves the drawer out when the fork is refused', async () => {
      const user = await answered()
      vi.mocked(octopus().chats.fork).mockResolvedValue({ ok: false, error: 'no such session' })

      await user.click(await forkButton())

      // Offered again once the refusal is in, which is when a close would have come.
      await waitFor(async () => {
        expect(await forkButton()).toBeEnabled()
      })
      expect(octopus().chats.fork).toHaveBeenCalled()
      expect(drawer()).toBeInTheDocument()
    })
  })

  it('asks nothing when the conversation could not be opened', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: false, error: 'no such workspace' })
    await openChat()

    await user.type(field(), '/btw why?{Enter}')
    await user.click(screen.getByRole('button', { name: 'Ask a side question' }))

    expect(await screen.findByText(/no such workspace/)).toBeInTheDocument()
    expect(octopus().chats.sideQuestion).not.toHaveBeenCalled()
    expect(drawer()).toBeNull()
  })

  it.each([
    ['cleared', { type: 'conversation_reset', cleared: true }],
    ['rewound', { type: 'conversation_rewound', messageId: 'm-1' }]
  ] as const)('forgets the thread once the conversation is %s', async (_name, event) => {
    const user = userEvent.setup()
    answering('Kyiv.')
    await openChat()
    await user.type(field(), '/btw which city?{Enter}')
    expect(await screen.findByText('Kyiv.')).toBeInTheDocument()

    emitAgentEvent(event)

    expect(screen.queryByText('Kyiv.')).toBeNull()
  })

  it('keeps the thread when the reset only left plan mode', async () => {
    const user = userEvent.setup()
    answering('Kyiv.')
    await openChat()
    await user.type(field(), '/btw which city?{Enter}')
    expect(await screen.findByText('Kyiv.')).toBeInTheDocument()

    emitAgentEvent({ type: 'conversation_reset', cleared: false })

    expect(screen.getByText('Kyiv.')).toBeInTheDocument()
  })
})

describe('sending the first message', () => {
  it('creates the chat and sends the message to it', async () => {
    const user = userEvent.setup()
    await openChat()

    await user.type(field(), 'add a test{Enter}')

    await waitFor(() => {
      expect(octopus().chats.open).toHaveBeenCalledWith('planner/anna')
    })
    expect(octopus().chats.send).toHaveBeenCalledWith('chat-1', 'add a test')
  })

  // Waiting for the disk to confirm the message makes typing feel unresponsive.
  it('draws the message before the round trip finishes', async () => {
    const user = userEvent.setup()
    await openChat()

    await user.type(field(), 'add a test{Enter}')

    expect(await screen.findByText('add a test')).toBeInTheDocument()
  })

  it('reuses the chat for the next message', async () => {
    const user = userEvent.setup()
    await openChat()

    await user.type(field(), 'first{Enter}')
    await waitFor(() => {
      expect(octopus().chats.open).toHaveBeenCalledTimes(1)
    })

    await user.type(field(), 'second{Enter}')
    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledTimes(2)
    })
    expect(octopus().chats.open).toHaveBeenCalledTimes(1)
  })

  it('says so when the chat could not be created', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: false, error: 'no such workspace' })
    await openChat()

    await user.type(field(), 'add a test{Enter}')

    expect(await screen.findByText(/no such workspace/)).toBeInTheDocument()
    expect(octopus().chats.send).not.toHaveBeenCalled()
  })

  // A setting also creates the record, so it meets the same failure — and
  // storing a choice against a chat that does not exist would be worse than
  // saying it did not take.
  it('says so when a setting could not create the record either', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: false, error: 'no such workspace' })
    await openChat()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByText('Low'))

    expect(await screen.findByText(/no such workspace/)).toBeInTheDocument()
    expect(octopus().chats.setEfforts).not.toHaveBeenCalled()
  })

  it('says so when the message could not be sent', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'the agent is gone' })
    await openChat()

    await user.type(field(), 'add a test{Enter}')

    expect(await screen.findByText(/the agent is gone/)).toBeInTheDocument()
    // Back to offering a send: nothing is running to stop.
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  // Inside the log it was drawn above every message — out of sight in any
  // conversation long enough to scroll, so a failed send looked like silence.
  it('says it beside the field rather than at the top of the log', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'the agent is gone' })
    await openChat()

    await user.type(field(), 'add a test{Enter}')

    const banner = await screen.findByText(/the agent is gone/)
    expect(banner.closest('.overflow-auto')).toBeNull()
    expect(banner.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('an existing conversation', () => {
  it('is read back from the transcript', async () => {
    givenChat([
      { role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'add a test' },
      {
        role: 'agent',
        at: '2026-08-11T09:00:01.000Z',
        event: { type: 'text', text: 'Looking at auth.rb' }
      }
    ])

    await openChat()

    expect(await screen.findByText('add a test')).toBeInTheDocument()
    expect(screen.getByText('Looking at auth.rb')).toBeInTheDocument()
  })

  it('says so when the history could not be read', async () => {
    givenChat()
    vi.mocked(octopus().chats.history).mockResolvedValue({ ok: false, error: 'unreadable file' })

    await openChat()

    expect(await screen.findByText(/unreadable file/)).toBeInTheDocument()
  })

  /*
   * Reported to the window rather than into the pane, unlike a failed history
   * read. The list belongs to the tab strip, which is what decides how many
   * panes there are — a failure there is not about any one conversation.
   */
  it('reports a chat list that could not be read to the window', async () => {
    const onError = vi.fn()
    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: false, error: 'state is corrupt' })

    render(<ChatPane workspace={workspaceView('anna')} onError={onError} />)

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('state is corrupt'))
    })
  })

  // Selecting a different workspace shows a different conversation, not a
  // continuation of this one.
  it('is replaced when the workspace changes', async () => {
    givenChat([{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'first workspace' }])
    const { rerender } = render(<ChatPane workspace={workspaceView('anna')} />)

    expect(await screen.findByText('first workspace')).toBeInTheDocument()

    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [] })
    vi.mocked(octopus().chats.history).mockResolvedValue({ ok: true, value: [] })
    rerender(<ChatPane workspace={workspaceView('maria')} />)

    await waitFor(() => {
      expect(screen.queryByText('first workspace')).not.toBeInTheDocument()
    })
  })
})

describe('events arriving from the agent', () => {
  it('appends what the agent says', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent({ type: 'text', text: 'Looking at auth.rb' })

    expect(screen.getByText('Looking at auth.rb')).toBeInTheDocument()
  })

  it('shows text as it is written, then the finished block', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent({ type: 'text_delta', text: 'Look' })
    emitAgentEvent({ type: 'text_delta', text: 'ing' })
    expect(await screen.findByText('Looking')).toBeInTheDocument()

    emitAgentEvent({ type: 'text', text: 'Looking at auth.rb' })
    expect(screen.getByText('Looking at auth.rb')).toBeInTheDocument()
    expect(screen.queryByText('Looking')).not.toBeInTheDocument()
  })

  /*
   * The log is memoised and everything the pane hands it is held still, so a
   * streamed token draws the block being written and nothing above it. It used
   * to draw every row again, and parse every answer in the conversation again,
   * once per token.
   */
  it('draws only the block being written while text arrives', async () => {
    givenChat([{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'look at auth' }])
    await openLoadedChat()
    expect(await screen.findByText('look at auth')).toBeInTheDocument()
    vi.mocked(messageBlocks).mockClear()

    emitAgentEvent({ type: 'text_delta', text: 'Look' })
    emitAgentEvent({ type: 'text_delta', text: 'ing' })
    expect(await screen.findByText('Looking')).toBeInTheDocument()

    expect(messageBlocks).not.toHaveBeenCalled()
  })

  it('shows reasoning as it is written', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent({ type: 'thinking_delta', text: 'weighing' })

    expect(await screen.findByText('Thinking')).toBeInTheDocument()
  })

  // Broadcast reaches every window and covers every chat; this pane draws one.
  it('ignores events belonging to another chat', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent({ type: 'text', text: 'meant for someone else' }, 'chat-other')

    expect(screen.queryByText('meant for someone else')).not.toBeInTheDocument()
  })

  it('stops offering to stop once the turn ends', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.type(field(), 'work{Enter}')
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()

    emitAgentEvent({
      type: 'result',
      ok: true,
      costUsd: 0.01,
      durationMs: 900,
      inputTokens: null,
      outputTokens: null,
      terminalReason: null
    })

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('stops offering to stop when the session dies', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.type(field(), 'work{Enter}')
    emitAgentEvent({ type: 'error', message: 'claude exited with code 1' })

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByText('claude exited with code 1')).toBeInTheDocument()
  })

  /*
   * `/clear` asks the agent to forget the conversation, and the core has by
   * then deleted the transcript. Leaving the log on screen would show a history
   * that exists nowhere and that nothing can continue.
   */
  it('empties the log when the user cleared the conversation', async () => {
    givenChat([{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'remember this' }])
    await openLoadedChat()

    expect(screen.getByText('remember this')).toBeInTheDocument()

    emitAgentEvent({ type: 'conversation_reset', cleared: true })

    await waitFor(() => {
      expect(screen.queryByText('remember this')).not.toBeInTheDocument()
    })
  })

  // A reset the user did not ask for — leaving plan mode sends one too. The
  // record stands, with a line saying the agent no longer holds it.
  it('keeps the log when nobody asked for it to go', async () => {
    givenChat([{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'remember this' }])
    await openLoadedChat()

    emitAgentEvent({ type: 'conversation_reset', cleared: false })

    expect(screen.getByText('remember this')).toBeInTheDocument()
    expect(
      await screen.findByText('The agent’s memory of this conversation starts again here')
    ).toBeInTheDocument()
  })
})

describe('a question from an MCP server', () => {
  /*
   * Reachable today: `settingSources` includes the project layer, and a
   * worktree's own `.mcp.json` starts servers — so any repository somebody
   * clones can raise one of these. Before the card, the SDK declined it and
   * nobody saw anything.
   */
  it('is drawn, and answered where the whole pane can see it', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    emitAgentEvent({
      type: 'elicitation_request',
      requestId: 'e-1',
      serverName: 'ledger',
      message: 'Which token should I use?',
      title: '',
      fields: [
        { kind: 'text', name: 'token', label: 'Token', description: '', required: true, value: '' }
      ]
    })

    expect(screen.getByText('A question from ledger')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Token'), 'abc')
    // The card's own confirm, which is deliberately not the composer's `Send`.
    await user.click(screen.getByRole('button', { name: 'Answer' }))

    await waitFor(() => {
      expect(octopus().chats.answerElicitation).toHaveBeenCalledWith('e-1', 'accept', {
        token: 'abc'
      })
    })
  })
})

describe('following the conversation', () => {
  // Yanking the view down while someone reads something further up is the
  // single most irritating thing a log can do.
  it('stops following once the reader scrolls away from the end', async () => {
    givenChat()
    await openLoadedChat()

    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
    log.scrollTop = 0
    fireEvent.scroll(log)

    emitAgentEvent({ type: 'text', text: 'a new line' })
    expect(log.scrollTop).toBe(0)

    // Back at the end, and it follows again.
    log.scrollTop = 700
    fireEvent.scroll(log)
    emitAgentEvent({ type: 'text', text: 'another line' })

    expect(log.scrollTop).toBe(1000)
  })

  // Hiding a tab resets its scroll position and reports it. Read as the reader
  // leaving the end, it stopped the log following for good — and a session
  // opened afterwards began at the top.
  it('does not read a scroll with no height as leaving the end', async () => {
    givenChat()
    await openLoadedChat()

    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
    log.scrollTop = 0
    fireEvent.scroll(log)

    emitAgentEvent({ type: 'text', text: 'a new line' })

    expect(log.scrollTop).toBe(1000)
  })

  // Rows grow after they are laid out, so the scroll to the end lands short.
  it('keeps to the end as the content grows, until the reader leaves it', async () => {
    const watchers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(notify: () => void) {
          watchers.push(notify)
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    givenChat()
    await openLoadedChat()

    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
    watchers.forEach((notify) => {
      notify()
    })
    expect(log.scrollTop).toBe(1000)

    log.scrollTop = 0
    fireEvent.scroll(log)
    watchers.forEach((notify) => {
      notify()
    })
    expect(log.scrollTop).toBe(0)
  })

  // jsdom lays nothing out, so the class is all there is to check.
  it('never scrolls the log sideways', async () => {
    givenChat()
    await openLoadedChat()

    const log = screen.getByRole('log')
    expect(log).toHaveClass('overflow-x-hidden')
    expect(log).toHaveClass('overflow-y-auto')
  })

  it('offers the way back down once the reader is a screen above the end', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
    const jump = (): HTMLElement | null =>
      screen.queryByRole('button', { name: 'Jump to the latest message' })

    log.scrollTop = 1500
    fireEvent.scroll(log)
    expect(jump()).toBeNull()

    log.scrollTop = 0
    fireEvent.scroll(log)
    await user.click(screen.getByRole('button', { name: 'Jump to the latest message' }))

    expect(log.scrollTop).toBe(2000)
    expect(jump()).toBeNull()
  })

  /*
   * Reported from a running app: the menu on the context reading shut a few
   * times a second for as long as the agent was answering, and stayed open
   * once the turn ended.
   *
   * The log pins itself to the bottom on every streamed fragment, and a menu
   * at fixed coordinates used to close on any scroll at all. The composer does
   * not move when the log scrolls, so nothing was wrong with where the panel
   * was — it was answering an event that had nothing to do with it.
   */
  it('leaves the composer’s menus open while the log follows the agent', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.usage).mockResolvedValue({
      ok: true,
      value: {
        context: {
          percentage: 8,
          usedTokens: 16_000,
          maxTokens: 200_000,
          model: 'claude-opus-5',
          modelWindow: null
        },
        autoCompact: null
      }
    })
    givenChat()
    await openLoadedChat()

    await user.click(await screen.findByRole('button', { name: /Context 8%/ }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    emitAgentEvent({ type: 'text', text: 'still writing' })
    fireEvent.scroll(screen.getByRole('log'))

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})

/** Pins where the log and the marks inside it sit, as layout would. */
function placeMarks(
  log: HTMLElement,
  selector: string,
  topOf: (mark: HTMLElement, index: number) => number | undefined
): void {
  log.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  // A scroll with no height is a hidden tab's and is not read; the end of the
  // log is measured against it too.
  Object.defineProperty(log, 'clientHeight', { value: 300, configurable: true })
  for (const [index, mark] of [...log.querySelectorAll<HTMLElement>(selector)].entries()) {
    // Read on every call, so a mark can follow the log as it scrolls.
    mark.getBoundingClientRect = () => ({ top: topOf(mark, index) }) as DOMRect
  }
}

describe('the day on screen', () => {
  function place(log: HTMLElement, tops: Record<string, number>): void {
    placeMarks(log, '[data-day]', (separator) => tops[separator.dataset.day ?? ''])
  }

  // Telegram's floating date: once a day's own separator has gone off the
  // top, a copy of it floats there, and it changes as the next day arrives.
  it('floats the day being read once its separator has scrolled away', async () => {
    givenChat([
      { role: 'user', at: '2025-03-02T09:00:00.000Z', text: 'first' },
      { role: 'user', at: '2025-03-04T09:00:00.000Z', text: 'later' }
    ])
    await openLoadedChat()
    await screen.findByText('later')

    const log = screen.getByRole('log')
    // Nothing has scrolled past, so the separators speak for themselves.
    expect(screen.getAllByText('2 March 2025')).toHaveLength(1)

    place(log, { '2025-03-02': -200, '2025-03-04': 300 })
    fireEvent.scroll(log)
    expect(screen.getAllByText('2 March 2025')).toHaveLength(2)

    place(log, { '2025-03-02': -600, '2025-03-04': -10 })
    fireEvent.scroll(log)
    expect(screen.getAllByText('2 March 2025')).toHaveLength(1)
    expect(screen.getAllByText('4 March 2025')).toHaveLength(2)
  })

  /*
   * The log can move under a scroller that has not: a turn landing, or a
   * rewind cutting the days below away. No scroll event comes, so the change
   * in the log is what asks again.
   */
  it('reads the day again when the log changes under a still scroller', async () => {
    givenChat([
      { role: 'user', at: '2025-03-02T09:00:00.000Z', text: 'first' },
      { role: 'user', at: '2025-03-04T09:00:00.000Z', text: 'later' }
    ])
    await openLoadedChat()
    await screen.findByText('later')
    const log = screen.getByRole('log')
    place(log, { '2025-03-02': -200, '2025-03-04': 300 })
    fireEvent.scroll(log)
    expect(screen.getAllByText('2 March 2025')).toHaveLength(2)

    place(log, { '2025-03-02': -600, '2025-03-04': -10 })
    emitAgentEvent({ type: 'text', text: 'still here' })

    await screen.findByText('still here')
    expect(screen.getAllByText('4 March 2025')).toHaveLength(2)
  })
})

describe("stepping between the user's messages", () => {
  // Three messages in a 2000px log, the last too near its end ever to reach the top.
  const places = [100, 600, 1900]

  async function openThree(): Promise<HTMLElement> {
    givenChat([
      { role: 'user', at: '2025-03-02T09:00:00.000Z', text: 'one' },
      { role: 'user', at: '2025-03-02T09:01:00.000Z', text: 'two' },
      { role: 'user', at: '2025-03-02T09:02:00.000Z', text: 'three' }
    ])
    await openLoadedChat()
    await screen.findByText('three')

    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { value: 2000, configurable: true })
    placeMarks(log, '[data-user-message]', (_, index) => (places[index] ?? 0) - log.scrollTop)
    return log
  }

  const up = (): HTMLElement => screen.getByRole('button', { name: 'Previous message you sent' })
  const down = (): HTMLElement => screen.getByRole('button', { name: 'Next message you sent' })

  function scrollLog(log: HTMLElement, top: number): void {
    log.scrollTop = top
    fireEvent.scroll(log)
  }

  // Inside the first message's answer.
  it('lands on the message above and the message below', async () => {
    const user = userEvent.setup()
    const log = await openThree()
    scrollLog(log, 300)

    await user.click(up())
    expect(log.scrollTop).toBe(100 - STEP_MARGIN)

    scrollLog(log, 300)
    await user.click(down())
    expect(log.scrollTop).toBe(600 - STEP_MARGIN)
  })

  it('moves on from the message it just landed on', async () => {
    const user = userEvent.setup()
    const log = await openThree()
    scrollLog(log, 1100 - STEP_MARGIN)

    await user.click(up())
    expect(log.scrollTop).toBe(600 - STEP_MARGIN)
  })

  it('offers no step past either end of the log', async () => {
    const log = await openThree()

    scrollLog(log, 0)
    expect(up()).toHaveAttribute('aria-disabled', 'true')
    expect(down()).not.toHaveAttribute('aria-disabled')

    // The last message is still below the line, but the log has ended.
    scrollLog(log, 1700)
    expect(up()).not.toHaveAttribute('aria-disabled')
    expect(down()).toHaveAttribute('aria-disabled', 'true')
  })

  // Chromium drops the focus of a natively disabled button and jsdom does not,
  // so the native attribute is what is checked.
  it('keeps the focus on a step that runs out', async () => {
    const user = userEvent.setup()
    const log = await openThree()
    scrollLog(log, 300)

    down().focus()
    await user.keyboard('{Enter}')
    scrollLog(log, 1700)
    expect(down()).toHaveAttribute('aria-disabled', 'true')
    expect(down()).toBeEnabled()

    await user.keyboard('{Enter}')
    expect(log.scrollTop).toBe(1700)
  })

  // A turn landing moves the log under a still scroller: no scroll event comes.
  it('reads the steps again when the log changes under a still scroller', async () => {
    const log = await openThree()
    log.scrollTop = 300
    expect(up()).toHaveAttribute('aria-disabled', 'true')

    emitAgentEvent({ type: 'text', text: 'still here' })

    await screen.findByText('still here')
    expect(up()).not.toHaveAttribute('aria-disabled')
  })

  // Opening a row, or resizing the window, moves the log without a scroll.
  it('reads the steps again when the log is resized', async () => {
    const watchers: (() => void)[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(notify: () => void) {
          watchers.push(notify)
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
    const log = await openThree()
    // Off the end, so the observer only measures and does not pin.
    scrollLog(log, 0)
    log.scrollTop = 300

    act(() => {
      watchers.forEach((notify) => {
        notify()
      })
    })

    expect(up()).not.toHaveAttribute('aria-disabled')
  })

  it('offers no steps in a conversation with nothing the user wrote', async () => {
    givenChat()
    await openLoadedChat()
    emitAgentEvent({ type: 'text', text: 'hello' })
    await screen.findByText('hello')

    expect(screen.queryByRole('button', { name: 'Previous message you sent' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next message you sent' })).toBeNull()
  })
})

describe('stopping a turn', () => {
  it('asks the agent to stop', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.type(field(), 'work{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(octopus().chats.interrupt).toHaveBeenCalledWith(CHAT_ID)
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('says so when stopping failed', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.interrupt).mockResolvedValue({ ok: false, error: 'no turn to stop' })
    givenChat()
    await openLoadedChat()

    await user.type(field(), 'work{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(await screen.findByText(/no turn to stop/)).toBeInTheDocument()
  })
})

describe('answering a permission request', () => {
  const request = {
    type: 'permission_request' as const,
    requestId: 'r-1',
    toolName: 'Bash',
    input: { command: 'npm test' }
  }

  it('sends the answer and takes the card down', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    emitAgentEvent(request)
    await user.click(screen.getByRole('button', { name: 'Allow' }))

    // No third argument: words only accompany a refusal, and only the plan
    // dialog offers anywhere to write them.
    expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-1', 'allow', undefined)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
    })
  })

  it('says so when the answer could not be delivered', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.answerPermission).mockResolvedValue({
      ok: false,
      error: 'the session is gone'
    })
    givenChat()
    await openLoadedChat()

    emitAgentEvent(request)
    await user.click(screen.getByRole('button', { name: 'Allow' }))

    expect(await screen.findByText(/the session is gone/)).toBeInTheDocument()
  })

  it('takes the card down when the turn ends unanswered', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent(request)
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()

    emitAgentEvent({
      type: 'result',
      ok: true,
      costUsd: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      terminalReason: null
    })

    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  })
})

describe('deciding on a plan', () => {
  const mode = (): HTMLElement => screen.getByRole('button', { name: /^Permissions:/ })

  const PLAN = '# Normalising the locales\n\nUse `en.ts` as the source.'

  const planRequest = {
    type: 'permission_request' as const,
    requestId: 'r-plan',
    toolName: 'ExitPlanMode',
    input: { plan: PLAN }
  }

  it('opens the dialog rather than a card in the log', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent(planRequest)

    expect(await screen.findByText('Normalising the locales')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument()
  })

  /*
   * The whole point of the change, end to end.
   *
   * Approving the plan has to answer the request *and* move the control on —
   * the core rewrites the stored fields, but nothing tells a window that a
   * record changed, so a control still saying Plan over an agent that has
   * started editing is exactly the state this was reported as.
   *
   * To Accept edits whatever the chat was asking before, as the core does: that
   * is what an approved plan runs in, so it is what the control must name.
   */
  it('answers and shows the chat in Accept edits', async () => {
    const user = userEvent.setup()
    givenChat([], { planMode: true, workingMode: 'default' })
    await openLoadedChat()

    expect(mode()).toHaveTextContent('Plan')

    emitAgentEvent(planRequest)
    expect(
      await screen.findByText('Runs with Accept edits on — file changes go ahead without asking.')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Execute' }))

    expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-plan', 'allow', undefined)
    await waitFor(() => {
      expect(mode()).toHaveTextContent('Accept edits')
    })
  })

  // With the setting on Auto — its default — an approved plan goes on in auto
  // mode, and the dialog says so before the click.
  it('answers and shows the chat in Auto when that is the setting', async () => {
    const user = userEvent.setup()
    givenChat([], { planMode: true, workingMode: 'default' })
    await openLoadedChat('auto')

    emitAgentEvent(planRequest)
    expect(
      await screen.findByText(
        'Runs in Auto — each step is approved or refused for you, and anything unclear is asked.'
      )
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Execute' }))

    expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-plan', 'allow', undefined)
    await waitFor(() => {
      expect(mode()).toHaveTextContent('Auto')
    })
  })

  // The plan in the log, carried out later while still planning: the same
  // rule, so the chat goes on in the mode the settings name.
  it('carries a set-aside plan out in Auto when that is the setting', async () => {
    const user = userEvent.setup()
    givenChat(
      [
        {
          role: 'agent',
          at: '2026-08-13T09:00:00.000Z',
          event: {
            type: 'tool_use',
            toolUseId: 'call-1',
            name: 'ExitPlanMode',
            input: { plan: '# Normalising the locales' }
          }
        }
      ],
      { planMode: true, workingMode: 'default' }
    )
    await openLoadedChat('auto')

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    await waitFor(() => {
      expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'auto')
    })
    expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, false)
  })

  /*
   * Coming back to a plan that was set aside.
   *
   * The request it belonged to was answered when the dialog closed, so there
   * is nothing left to approve — this is an ordinary message, and it names the
   * plan because a conversation may hold several by the time anyone returns to
   * one.
   */
  it('asks for a plan in the log to be carried out, by name', async () => {
    const user = userEvent.setup()
    givenChat([
      {
        role: 'agent',
        at: '2026-08-13T09:00:00.000Z',
        event: {
          type: 'tool_use',
          toolUseId: 'call-1',
          name: 'ExitPlanMode',
          input: { plan: '# Normalising the locales\n\nUse `en.ts` as the source.' }
        }
      }
    ])
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledWith(
        CHAT_ID,
        'Carry out the plan “Normalising the locales”.'
      )
    })
    // Not planning, so carrying it out changes no mode: a plan the agent
    // offered unasked does not lift the conversation out of asking first.
    expect(octopus().chats.setWorkingMode).not.toHaveBeenCalled()
    expect(octopus().chats.setPlanMode).not.toHaveBeenCalled()
  })

  // The same rule through the dialog: approving a plan offered outside
  // planning leaves the conversation asking first, and says nothing otherwise.
  it('keeps asking first when a plan arrives outside planning', async () => {
    const user = userEvent.setup()
    givenChat([], { planMode: false, workingMode: 'default' })
    await openLoadedChat()

    emitAgentEvent(planRequest)
    await user.click(await screen.findByRole('button', { name: 'Execute' }))

    expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-plan', 'allow', undefined)
    expect(screen.queryByText(/Runs with Accept edits on/)).not.toBeInTheDocument()
    expect(mode()).toHaveTextContent('Manual')
  })

  /*
   * Reported from a running app: the footer said "without asking" and the agent
   * asked about every edit.
   *
   * Turning planning off is what hands the session the mode the footer names —
   * the same handover approving through the dialog performs, and to the same
   * mode, `acceptEdits`. Sent without it, the message went out with the
   * conversation still recorded as planning, and the agent worked in whatever
   * mode it had fallen back to.
   *
   * Before the message, not after: the mode has to be in force by the time the
   * agent reads the instruction. And the working mode before planning ends, so
   * the session never passes through the one it was asking in.
   */
  it('stops planning before asking for the work, so the footer is telling the truth', async () => {
    const user = userEvent.setup()
    givenChat(
      [
        {
          role: 'agent',
          at: '2026-08-13T09:00:00.000Z',
          event: {
            type: 'tool_use',
            toolUseId: 'call-1',
            name: 'ExitPlanMode',
            input: { plan: '# Normalising the locales' }
          }
        }
      ],
      { planMode: true, workingMode: 'default' }
    )
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalled()
    })
    expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'acceptEdits')
    expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, false)

    const accepting = vi.mocked(octopus().chats.setWorkingMode).mock.invocationCallOrder[0] ?? 0
    const stopped = vi.mocked(octopus().chats.setPlanMode).mock.invocationCallOrder[0] ?? 0
    const sent = vi.mocked(octopus().chats.send).mock.invocationCallOrder[0] ?? 0
    expect(accepting).toBeLessThan(stopped)
    expect(stopped).toBeLessThan(sent)

    expect(mode()).toHaveTextContent('Accept edits')
  })

  // Sending it back is not leaving planning: the agent is still working the
  // problem, and the toggle has to go on saying so.
  it('sends the note back and stays planning', async () => {
    const user = userEvent.setup()
    givenChat([], { planMode: true })
    await openLoadedChat()

    emitAgentEvent(planRequest)
    // Enter sends it, the composer's own convention — there is no second
    // button any more, and writing here is what carrying on planning is.
    await user.type(
      await screen.findByLabelText('Anything to work out first?'),
      'Add a step for the tests{Enter}'
    )

    expect(octopus().chats.answerPermission).toHaveBeenCalledWith(
      'r-plan',
      'deny',
      'Add a step for the tests'
    )
    expect(mode()).toHaveTextContent('Plan')
  })
})

describe('the permission mode', () => {
  const picker = (): HTMLElement => screen.getByRole('button', { name: /^Permissions:/ })

  it('shows the mode the chat is in and changes it', async () => {
    const user = userEvent.setup()
    givenChat([], { workingMode: 'acceptEdits' })
    await openLoadedChat()

    await waitFor(() => {
      expect(picker()).toHaveTextContent('Accept edits')
    })

    await user.click(picker())

    expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, true)
    expect(picker()).toHaveTextContent('Plan')
  })

  /*
   * The footer used to show the schema's defaults for a workspace with no
   * record, while `openChat` created that record from the settings. Set
   * "Accept edits" as the global default and the first message ran with it
   * while the footer said the agent would ask — and both pickers then flipped
   * on their own as the record came back. A new record starts out planning,
   * whatever working mode the settings name.
   */
  it('names what the settings will create the first record with', async () => {
    await openChat(workspaceView('anna'), { workingMode: 'acceptEdits', effort: 'high' })

    expect(picker()).toHaveTextContent('Plan')
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('High')
  })

  // And once there is a record it answers for itself, whatever the settings
  // say a new conversation would have started on.
  it('lets the record overrule the settings', async () => {
    givenChat([], { workingMode: 'default', effort: 'low' })
    await openChat(workspaceView('anna'), { workingMode: 'acceptEdits', effort: 'high' })

    await waitFor(() => {
      expect(octopus().chats.history).toHaveBeenCalled()
    })

    expect(picker()).toHaveTextContent('Manual')
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Low')
  })

  /*
   * The ring Claude Code's shift+tab goes round, end to end: manual, accept
   * edits, plan, auto, and back. The core deliberately leaves
   * `bypassPermissions` out, and going all the way round is what shows no
   * fifth mode hides in it.
   */
  it('cycles through manual, accepting, planning and auto and no others', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.click(picker())
    await waitFor(() => {
      expect(picker()).toHaveTextContent('Accept edits')
    })

    await user.click(picker())
    await waitFor(() => {
      expect(picker()).toHaveTextContent('Plan')
    })

    await user.click(picker())
    await waitFor(() => {
      expect(picker()).toHaveTextContent('Auto')
    })

    await user.click(picker())
    await waitFor(() => {
      expect(picker()).toHaveTextContent('Manual')
    })

    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  // Planning is entered by turning its own field on; the working mode under it
  // is not touched, and is what the ring comes back out through.
  it('turns planning on for the chat without disturbing the permissions', async () => {
    const user = userEvent.setup()
    givenChat([], { workingMode: 'acceptEdits' })
    await openLoadedChat()

    await user.click(picker())

    await waitFor(() => {
      expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, true)
    })
    expect(octopus().chats.setWorkingMode).not.toHaveBeenCalled()
  })

  /*
   * Leaving a plan for auto mode changes both fields, and the order is the
   * point. Planning held `acceptEdits` underneath; ended first, the session
   * would pass through it, and an edit landing then would go through without
   * the classifier. The working mode moves while the agent still runs no
   * tools at all.
   */
  it('leaves planning for auto mode without passing through accepting edits', async () => {
    const user = userEvent.setup()
    givenChat([], { planMode: true, workingMode: 'acceptEdits' })
    await openLoadedChat()

    await user.click(picker())

    await waitFor(() => {
      expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, false)
    })
    expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'auto')

    const asking = vi.mocked(octopus().chats.setWorkingMode).mock.invocationCallOrder[0] ?? 0
    const stopped = vi.mocked(octopus().chats.setPlanMode).mock.invocationCallOrder[0] ?? 0
    expect(asking).toBeLessThan(stopped)
    expect(picker()).toHaveTextContent('Auto')
  })

  // Switching between the two degrees of permission is not a reason to touch
  // planning, which is already off.
  it('changes only the working mode while not planning', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.click(picker())

    await waitFor(() => {
      expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'acceptEdits')
    })
    expect(octopus().chats.setPlanMode).not.toHaveBeenCalled()
  })

  // The record is created by the choice itself — that is what makes the mode of
  // the first message choosable at all.
  it('creates the record when a mode is chosen before anything is sent', async () => {
    const user = userEvent.setup()
    await openChat()

    await user.click(picker())

    await waitFor(() => {
      expect(octopus().chats.open).toHaveBeenCalledWith('planner/anna')
    })
    expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'auto')
  })

  it('sends the model to the chat it belongs to', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.models).mockResolvedValue({
      ok: true,
      value: [
        {
          value: 'claude-opus-5',
          resolvedModel: null,
          displayName: 'Opus 5',
          description: '',
          supportsEffort: null,
          supportedEffortLevels: null
        }
      ]
    })
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Model' })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(within(codeColumn()).getByRole('radio', { name: 'Opus 5' }))

    // A writer of its own splits the pair; the plan keeps the default it was on.
    await waitFor(() => {
      expect(octopus().chats.setModels).toHaveBeenCalledWith(CHAT_ID, {
        model: 'claude-opus-5',
        planModel: 'default'
      })
    })
  })

  /*
   * A pick moves the session at once, but the reading that names its model
   * used to wait for the next turn's result — and the panel, which stays open
   * after a pick, then said "/model chose" the model just left, under the
   * reader's own click.
   */
  it('reads the running model again once a pick has landed', async () => {
    const user = userEvent.setup()
    givenLiveCatalogue()
    const reading = (model: string): Result<SessionUsage> => ({
      ok: true,
      value: {
        context: {
          percentage: 8,
          usedTokens: 16_000,
          maxTokens: 200_000,
          model,
          modelWindow: null
        },
        autoCompact: null
      }
    })
    vi.mocked(octopus().chats.usage).mockResolvedValue(reading('claude-opus-5[1m]'))
    givenChat()
    await openLoadedChat()
    await user.click(await screen.findByRole('button', { name: 'Model' }))
    vi.mocked(octopus().chats.usage).mockResolvedValue(reading('claude-sonnet-5'))

    await user.click(within(codeColumn()).getByRole('radio', { name: 'Sonnet' }))

    await waitFor(() => {
      expect(within(codeColumn()).getByRole('radio', { name: 'Sonnet' })).toBeChecked()
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Sonnet')
    })
    expect(screen.getByRole('dialog')).not.toHaveTextContent('/model')
  })

  // The plan is the choice and the writing follows it, so with no split one
  // pick moves both — in a single write.
  it('sends the model chosen for planning as the one both jobs share', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.models).mockResolvedValue({
      ok: true,
      value: [
        {
          value: 'claude-opus-5',
          resolvedModel: null,
          displayName: 'Opus 5',
          description: '',
          supportsEffort: null,
          supportedEffortLevels: null
        }
      ]
    })
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Model' })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Plan and research' })).getByRole('radio', {
        name: 'Opus 5'
      })
    )

    await waitFor(() => {
      expect(octopus().chats.setModels).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
        model: 'claude-opus-5',
        planModel: null
      })
    })
  })

  /*
   * The CLI scopes `/model` to the session, so the record stayed null and the
   * panel drew Opus on both rows over a session running two models. This one
   * command is what the panel's own split says, so it is written down.
   */
  it('shows /model opusplan as Opus for planning and Sonnet for writing code', async () => {
    const user = userEvent.setup()
    givenLiveCatalogue()
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Model' })

    await user.type(field(), '/model opusplan{Enter}')

    // One write for the pair, so a refusal cannot leave half of it behind.
    await waitFor(() => {
      expect(octopus().chats.setModels).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
        model: 'sonnet',
        planModel: 'opus[1m]'
      })
    })
    expect(octopus().chats.send).toHaveBeenCalledWith(CHAT_ID, '/model opusplan')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(ticked(codeColumn())).toEqual(['Sonnet'])
    expect(ticked(planColumn())).toEqual(['Opus (1M context)'])
  })

  // A refused pair leaves the panel as it was: no split, nothing on Sonnet.
  it('leaves the panel as it was when the pair is refused', async () => {
    const user = userEvent.setup()
    givenLiveCatalogue()
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Model' })
    vi.mocked(octopus().chats.setModels).mockResolvedValue({ ok: false, error: 'no such chat' })

    await user.type(field(), '/model opusplan{Enter}')

    expect(await screen.findByText(/no such chat/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(ticked(codeColumn())[0]).toContain('Same as plan')
    expect(ticked(planColumn()).join()).not.toContain('Sonnet')
  })

  // The command goes to the CLI first and the panel follows it, so a message
  // that was refused cannot leave a split behind for a command that never ran.
  it('leaves the panel alone when the command was not accepted', async () => {
    const user = userEvent.setup()
    givenLiveCatalogue()
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Model' })
    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'the agent is gone' })

    await user.type(field(), '/model opusplan{Enter}')

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledWith(CHAT_ID, '/model opusplan')
    })
    await screen.findByText(/the agent is gone/)
    expect(octopus().chats.setModels).not.toHaveBeenCalled()
  })

  // `/model` stays the session's own for everything else; the record is what
  // was chosen in the panel and the chip says what is running.
  it('leaves the panel alone for any other /model', async () => {
    const user = userEvent.setup()
    givenLiveCatalogue()
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Model' })

    await user.type(field(), '/model sonnet{Enter}')

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledWith(CHAT_ID, '/model sonnet')
    })
    expect(octopus().chats.setModels).not.toHaveBeenCalled()
  })

  /*
   * The paperclip is the visible one of three ways in. What goes out is the
   * file's **path** — nothing is copied anywhere, which is §4's rule that
   * nothing implicit reaches the agent in the plainest form it takes.
   */
  it('attaches a chosen file and names its path in the message', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().dialog.pickFiles).mockResolvedValue({
      ok: true,
      value: ['/a/shot.png']
    })
    givenChat()
    await openLoadedChat()

    await user.click(await screen.findByRole('button', { name: 'Attach files' }))
    expect(await screen.findByText('shot.png')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'have a look')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledWith(
        CHAT_ID,
        'Files I am pointing you at:\n\n/a/shot.png\n\nhave a look'
      )
    })
  })

  /*
   * `@` names a subagent. The pick is text in the message — `@agent-<name>` —
   * which is how Claude Code is told to hand the work to that agent, and the
   * list is the one the chat's session reported.
   */
  it('writes a subagent chosen from the @ list into the message', async () => {
    const user = userEvent.setup()
    // jsdom has no layout, so the list's scroll-into-view is not there to call.
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(octopus().chats.agents).mockResolvedValue({
      ok: true,
      value: [{ name: 'Explore', description: 'Searches the code' }]
    })
    givenChat()
    await openLoadedChat()

    await user.type(screen.getByRole('textbox'), 'ask @Ex')
    await user.click(await screen.findByRole('option', { name: /Explore/ }))
    await user.type(screen.getByRole('textbox'), 'where auth lives')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(octopus().chats.agents).toHaveBeenCalledWith(CHAT_ID)
    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledWith(
        CHAT_ID,
        'ask @agent-Explore where auth lives'
      )
    })
  })

  describe('rewriting a plan before approving it', () => {
    it('approves with the plan the user wrote', async () => {
      const user = userEvent.setup()
      givenChat([], { planMode: true })
      await openLoadedChat()

      emitAgentEvent({
        type: 'permission_request',
        requestId: 'r-plan',
        toolName: 'ExitPlanMode',
        input: { plan: '# Normalising the locales' }
      })
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      const editor = screen.getByRole('textbox', { name: 'The plan, as markdown' })
      await user.clear(editor)
      await user.type(editor, '# Only English first')
      await user.click(screen.getByRole('button', { name: 'Execute' }))

      expect(octopus().chats.answerPermission).toHaveBeenCalledWith(
        'r-plan',
        'allow',
        undefined,
        '# Only English first'
      )
    })
  })

  // Minimising is how a plan is checked against the code before answering it.
  // It answers nothing, keeps a way back on screen, and loses nothing typed.
  describe('setting a plan aside to check something', () => {
    it('hides the dialog without answering, and brings it back as it was', async () => {
      const user = userEvent.setup()
      givenChat([], { planMode: true })
      await openLoadedChat()

      emitAgentEvent({
        type: 'permission_request',
        requestId: 'r-plan',
        toolName: 'ExitPlanMode',
        input: { plan: '# Normalising the locales' }
      })
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      const editor = screen.getByRole('textbox', { name: 'The plan, as markdown' })
      await user.clear(editor)
      await user.type(editor, '# Only English first')
      await user.type(screen.getByRole('textbox', { name: /Anything to work out/ }), 'and tests')
      await user.click(screen.getByRole('button', { name: 'Minimise' }))

      expect(screen.queryByText('The plan is ready')).not.toBeInTheDocument()
      expect(screen.getByText('The plan is waiting for your answer')).toBeInTheDocument()
      expect(octopus().chats.answerPermission).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'Open the plan' }))

      expect(screen.queryByText('The plan is waiting for your answer')).not.toBeInTheDocument()
      expect(screen.getByText('Only English first')).toBeInTheDocument()
      const note = screen.getByRole('textbox', { name: /Anything to work out/ })
      expect(note).toHaveValue('and tests')

      await user.type(note, '{Enter}')
      expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-plan', 'deny', 'and tests')
    })

    // The next plan is a new question: it raises its own dialog, and it does
    // not inherit the note written to the one before it.
    it('raises the next plan however the last one was left', async () => {
      const user = userEvent.setup()
      givenChat([], { planMode: true })
      await openLoadedChat()

      emitAgentEvent({
        type: 'permission_request',
        requestId: 'r-1',
        toolName: 'ExitPlanMode',
        input: { plan: '# First plan' }
      })
      await user.type(
        await screen.findByRole('textbox', { name: /Anything to work out/ }),
        'old note'
      )
      await user.click(screen.getByRole('button', { name: 'Minimise' }))

      emitAgentEvent({
        type: 'permission_request',
        requestId: 'r-2',
        toolName: 'ExitPlanMode',
        input: { plan: '# Second plan' }
      })

      expect(await screen.findByText('Second plan')).toBeInTheDocument()
      expect(screen.queryByText('The plan is waiting for your answer')).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: /Anything to work out/ })).toHaveValue('')
    })
  })

  // The agent may hand over another plan while one is being rewritten. The old
  // edit describes a plan that is gone, and must not be sent as the new one's.
  describe('a plan replaced while it is being rewritten', () => {
    it('does not send the old edit as the new plan', async () => {
      const user = userEvent.setup()
      givenChat([], { planMode: true })
      await openLoadedChat()

      emitAgentEvent({
        type: 'permission_request',
        requestId: 'r-1',
        toolName: 'ExitPlanMode',
        input: { plan: '# First plan' }
      })
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      const editor = screen.getByRole('textbox', { name: 'The plan, as markdown' })
      await user.clear(editor)
      await user.type(editor, '# My edit of the first')

      emitAgentEvent({
        type: 'permission_request',
        requestId: 'r-2',
        toolName: 'ExitPlanMode',
        input: { plan: '# Second plan' }
      })

      // The dialog is for the new request: the plan as the agent wrote it, and
      // the editor closed.
      expect(await screen.findByText('Second plan')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Execute' }))

      expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-2', 'allow', undefined)
    })
  })

  describe('rewinding to a message', () => {
    const MESSAGE = '11111111-1111-4111-8111-111111111111'

    const SAID: ChatEntry[] = [
      { role: 'user', at: '2026-08-13T09:00:00.000Z', text: 'rename it', uuid: MESSAGE }
    ]

    /** What the core says a rewind would do: both halves on offer. */
    function givenPreview(): void {
      vi.mocked(octopus().chats.rewindPreview).mockResolvedValue({
        ok: true,
        value: {
          conversation: true,
          files: {
            canRewind: true,
            error: null,
            filesChanged: ['a.ts', 'b.ts'],
            insertions: 12,
            deletions: 4,
            skippedLinks: 0
          }
        }
      })
    }

    const mark = (): Promise<HTMLElement> =>
      screen.findByRole('button', { name: 'Rewind to before this message' })

    // Two steps, and the first changes nothing: the choice the user makes has
    // the numbers in it, because the core was asked what each half would do.
    it('asks what to put back, with what each would do, and does what was chosen', async () => {
      const user = userEvent.setup()
      givenPreview()
      givenChat(SAID)
      await openLoadedChat()

      await user.click(await mark())

      const both = await screen.findByRole('button', { name: /Conversation and files/ })
      expect(both).toHaveTextContent(
        'Puts 2 files back to how they were before this message (+12 −4).'
      )
      expect(octopus().chats.rewind).not.toHaveBeenCalled()

      await user.click(both)

      await waitFor(() => {
        expect(octopus().chats.rewind).toHaveBeenCalledWith(CHAT_ID, MESSAGE, 'both')
      })
    })

    it('does nothing when the dialog is dismissed', async () => {
      const user = userEvent.setup()
      givenPreview()
      givenChat(SAID)
      await openLoadedChat()

      await user.click(await mark())
      await user.click(await screen.findByRole('button', { name: 'Cancel' }))

      expect(octopus().chats.rewind).not.toHaveBeenCalled()
    })

    // Claude Code's own rewind does this: the message comes back to be
    // edited and sent again, in the field, with the caret at its end.
    it('hands the message back to the field after the conversation is rewound', async () => {
      const user = userEvent.setup()
      givenPreview()
      vi.mocked(octopus().chats.rewind).mockResolvedValue({
        ok: true,
        value: { files: null, text: 'rename it' }
      })
      givenChat(SAID)
      await openLoadedChat()
      await user.type(field(), 'half a thought')

      await user.click(await mark())
      await user.click(await screen.findByRole('button', { name: /Conversation only/ }))

      await waitFor(() => {
        expect(field()).toHaveValue('rename it')
      })
      expect(field()).toHaveFocus()
      expect(octopus().chats.rewind).toHaveBeenCalledWith(CHAT_ID, MESSAGE, 'conversation')
    })

    /*
     * The whole loop, end to end: rewind, send the message again as it came
     * back, and the new line can be rewound in its turn — without reopening
     * the conversation, which is what the id handed back with a send is for.
     */
    it('offers to rewind the message sent again after a rewind', async () => {
      const user = userEvent.setup()
      const AGAIN = '33333333-3333-4333-8333-333333333333'
      givenPreview()
      vi.mocked(octopus().chats.rewind).mockResolvedValue({
        ok: true,
        value: { files: null, text: 'rename it' }
      })
      givenChat(SAID)
      await openLoadedChat()

      await user.click(await mark())
      vi.mocked(octopus().chats.history).mockResolvedValue({ ok: true, value: [] })
      await user.click(await screen.findByRole('button', { name: /Conversation only/ }))
      emitAgentEvent({ type: 'conversation_rewound', messageId: MESSAGE })
      await waitFor(() => {
        expect(field()).toHaveValue('rename it')
      })
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Rewind to before this message' })
        ).not.toBeInTheDocument()
      })

      vi.mocked(octopus().chats.send).mockResolvedValue({ ok: true, value: AGAIN })
      await user.keyboard('{Enter}')
      emitAgentEvent({
        type: 'result',
        ok: true,
        costUsd: null,
        durationMs: 1000,
        inputTokens: 10,
        outputTokens: 10,
        terminalReason: 'completed'
      })
      emitChatStatus(CHAT_ID, 'idle')

      await user.click(await mark())
      await waitFor(() => {
        expect(octopus().chats.rewindPreview).toHaveBeenLastCalledWith(CHAT_ID, AGAIN)
      })
    })

    // The cut closed the session the gauge was reading, so it reads again
    // rather than go on showing the longer history's context.
    it('reads the context again once the conversation is rewound', async () => {
      const user = userEvent.setup()
      givenPreview()
      vi.mocked(octopus().chats.rewind).mockResolvedValue({
        ok: true,
        value: { files: null, text: 'rename it' }
      })
      givenChat(SAID)
      await openLoadedChat()
      await user.click(await mark())
      await waitFor(() => {
        expect(octopus().chats.usage).toHaveBeenCalled()
      })
      const asked = vi.mocked(octopus().chats.usage).mock.calls.length

      await user.click(await screen.findByRole('button', { name: /Conversation only/ }))

      await waitFor(() => {
        expect(vi.mocked(octopus().chats.usage).mock.calls.length).toBeGreaterThan(asked)
      })
    })

    // Only the files went back: the conversation, and what is being typed,
    // stay as they were.
    it('leaves the field alone when only the files were put back', async () => {
      const user = userEvent.setup()
      givenPreview()
      vi.mocked(octopus().chats.rewind).mockResolvedValue({
        ok: true,
        value: {
          files: {
            canRewind: true,
            error: null,
            filesChanged: ['a.ts'],
            insertions: 1,
            deletions: 0,
            skippedLinks: 0
          },
          text: null
        }
      })
      givenChat(SAID)
      await openLoadedChat()
      await user.type(field(), 'still typing')

      await user.click(await mark())
      await user.click(await screen.findByRole('button', { name: /Files only/ }))

      await waitFor(() => {
        expect(octopus().chats.rewind).toHaveBeenCalledWith(CHAT_ID, MESSAGE, 'files')
      })
      expect(field()).toHaveValue('still typing')
    })

    it('says why when it cannot be asked about at all', async () => {
      const user = userEvent.setup()
      vi.mocked(octopus().chats.rewindPreview).mockResolvedValue({
        ok: false,
        error: 'busy',
        code: 'rewindBusy'
      })
      givenChat(SAID)
      await openLoadedChat()

      await user.click(await mark())

      expect(
        await screen.findByText('The agent is working. Stop it before rewinding.')
      ).toBeInTheDocument()
    })

    it('says so when the real rewind is refused after choosing', async () => {
      const user = userEvent.setup()
      givenPreview()
      vi.mocked(octopus().chats.rewind).mockResolvedValue({
        ok: false,
        error: 'No checkpoint for that message',
        code: 'rewindUnavailable',
        params: { reason: 'No checkpoint for that message' }
      })
      givenChat(SAID)
      await openLoadedChat()

      await user.click(await mark())
      await user.click(await screen.findByRole('button', { name: /Files only/ }))

      expect(
        await screen.findByText(
          'This conversation cannot be rewound to that message: No checkpoint for that message'
        )
      ).toBeInTheDocument()
    })
  })

  // The agent's own task list, pinned above the field while it has work left.
  it('pins the agent task list above the field', async () => {
    givenChat([
      {
        role: 'agent',
        at: '2026-08-13T09:00:00.000Z',
        event: {
          type: 'tool_use',
          toolUseId: 'call-1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Write the test', status: 'completed', activeForm: 'Writing the test' },
              { content: 'Make it pass', status: 'in_progress', activeForm: 'Making it pass' }
            ]
          }
        }
      }
    ])
    await openLoadedChat()
    emitChatStatus(CHAT_ID, 'running')

    expect(await screen.findByRole('button', { name: /Tasks/ })).toBeInTheDocument()
    expect(screen.getByText('Making it pass')).toBeInTheDocument()
  })

  // A list left with items pending — interrupted, errored, abandoned — would
  // otherwise stay pinned across every later turn and every restart.
  it('lets go of the list once the turn is over', async () => {
    givenChat([
      {
        role: 'agent',
        at: '2026-08-13T09:00:00.000Z',
        event: {
          type: 'tool_use',
          toolUseId: 'call-1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Make it pass', status: 'in_progress', activeForm: 'Making it pass' }
            ]
          }
        }
      }
    ])
    await openLoadedChat()
    emitChatStatus(CHAT_ID, 'running')
    expect(await screen.findByRole('button', { name: /Tasks/ })).toBeInTheDocument()

    emitChatStatus(CHAT_ID, 'idle')

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Tasks/ })).not.toBeInTheDocument()
    })
  })

  it('shows no task list for a conversation without one', async () => {
    givenChat()
    await openLoadedChat()

    expect(screen.queryByRole('button', { name: /Tasks/ })).not.toBeInTheDocument()
  })

  /* A refused paste is news about the message being written, so it goes in the
     conversation's own banner rather than a second one beside it. */
  it('says so in the conversation when an attachment is refused', async () => {
    vi.mocked(octopus().attachments.paste).mockResolvedValue({
      ok: false,
      error: 'too large',
      code: 'attachmentTooLarge',
      params: { limit: '12' }
    })
    givenChat()
    await openLoadedChat()

    const image = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox'), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        getData: () => ''
      }
    })

    expect(await screen.findByText(/over 12 MB/)).toBeInTheDocument()
  })

  /* The other half of the same judgement: which brain plans, and how hard it
     thinks while it does. With no split the planning level is the shared one,
     so it moves both — in one write. */
  it('sends the planning effort the scale was set to', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()
    await screen.findByRole('button', { name: 'Effort' })

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByRole('tab', { name: /Planning/ }))
    await user.click(screen.getByText('Maximum'))

    await waitFor(() => {
      expect(octopus().chats.setEfforts).toHaveBeenCalledExactlyOnceWith(CHAT_ID, {
        effort: 'max',
        planEffort: null
      })
    })
  })

  it('keeps the old model on screen when the change failed', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.models).mockResolvedValue({
      ok: true,
      value: [
        {
          value: 'claude-opus-5',
          resolvedModel: null,
          displayName: 'Opus 5',
          description: '',
          supportsEffort: null,
          supportedEffortLevels: null
        }
      ]
    })
    vi.mocked(octopus().chats.setModels).mockResolvedValue({ ok: false, error: 'no such chat' })
    givenChat()
    await openLoadedChat()

    await user.click(await screen.findByRole('button', { name: 'Model' }))
    await user.click(within(codeColumn()).getByRole('radio', { name: 'Opus 5' }))

    expect(await screen.findByText(/no such chat/)).toBeInTheDocument()
    // This mocked catalogue has no `default` row, so the row that stands for
    // "nothing chosen here" has no model name to wear.
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Default model')
  })

  /*
   * The same wiring end to end, on a catalogue shaped like the real one: the
   * footer must name the model the agent's default runs, not the row's own
   * "Default (recommended)", which names nothing.
   */
  it('names the model the catalogue default stands for', async () => {
    vi.mocked(octopus().chats.models).mockResolvedValue({
      ok: true,
      value: [
        {
          value: 'default',
          resolvedModel: 'claude-opus-5[1m]',
          displayName: 'Default (recommended)',
          description: '',
          supportsEffort: null,
          supportedEffortLevels: null
        },
        {
          value: 'opus[1m]',
          resolvedModel: 'claude-opus-5[1m]',
          displayName: 'Opus (1M context)',
          description: '',
          supportsEffort: null,
          supportedEffortLevels: null
        }
      ]
    })
    givenChat()
    await openLoadedChat()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Opus (1M context)')
    })
  })

  it('sends the effort to the chat it belongs to', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByText('Very high'))

    await waitFor(() => {
      // Not planning, so the writing half is the one on screen; a level of its
      // own splits it from the plan, which keeps the level it was on.
      expect(octopus().chats.setEfforts).toHaveBeenCalledWith(CHAT_ID, {
        effort: 'xhigh',
        planEffort: 'medium'
      })
    })
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Very high')
  })

  // The far end of the scale crosses every layer the levels do — the hook, the
  // preload API, the channel's schema — and is the one value on it that is not
  // a level, so nothing about that journey is covered by the levels' own test.
  it('sends ultracode to the chat like any other choice', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByText('Ultracode'))

    await waitFor(() => {
      expect(octopus().chats.setEfforts).toHaveBeenCalledWith(CHAT_ID, {
        effort: 'ultracode',
        planEffort: 'medium'
      })
    })
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Ultracode')
  })

  it('keeps the old effort on screen when the change failed', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.setEfforts).mockResolvedValue({ ok: false, error: 'no such chat' })
    givenChat()
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByText('Low'))

    expect(await screen.findByText(/no such chat/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Medium')
  })

  it('keeps the old mode on screen when the change failed', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.setWorkingMode).mockResolvedValue({
      ok: false,
      error: 'no such chat'
    })
    givenChat()
    await openLoadedChat()

    await user.click(picker())

    expect(await screen.findByText(/no such chat/)).toBeInTheDocument()
    expect(picker()).toHaveTextContent('Manual')
  })

  // The core gave auto mode up by itself, and the line in the log is the only
  // word of it the window gets: the chip has to follow it, to wherever it went.
  it.each([
    ['default', 'Manual'],
    ['acceptEdits', 'Accept edits']
  ] as const)(
    'moves the chip off auto mode when the core falls back to %s',
    async (fallback, label) => {
      givenChat([], { workingMode: 'auto' })
      await openLoadedChat()
      expect(picker()).toHaveTextContent('Auto')

      emitAgentEvent({ type: 'auto_mode_unavailable', reason: 'not for this model', fallback })

      await waitFor(() => {
        expect(picker()).toHaveTextContent(label)
      })
      expect(
        screen.getByText(`Auto mode is not available here, so this chat is on ${label} now`)
      ).toBeInTheDocument()
      expect(screen.getByText('not for this model')).toBeInTheDocument()
    }
  )
})

/*
 * The whole point of the card, end to end: the agent asks, the user picks, and
 * the answer reaches the bridge. Before this, the tool ran with nothing filled
 * in and the agent reported that nobody had answered.
 */
describe('answering a question the agent asked', () => {
  const request = {
    type: 'permission_request' as const,
    requestId: 'r-q',
    toolName: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Which library should we use?',
          header: 'Library',
          multiSelect: false,
          options: [{ label: 'date-fns' }, { label: 'Luxon' }]
        }
      ]
    }
  }

  it('sends what was chosen and takes the buttons away', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    emitAgentEvent(request)
    await user.click(await screen.findByRole('radio', { name: /Luxon/ }))
    await user.click(screen.getByRole('button', { name: 'Answer' }))

    expect(octopus().chats.answerQuestions).toHaveBeenCalledWith('r-q', [
      { question: 'Which library should we use?', selected: ['Luxon'], other: null }
    ])
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Answer' })).not.toBeInTheDocument()
    })
  })

  // A question is part of the conversation, not an interruption to it: the plan
  // is the one thing worth a dialog.
  it('asks in the log rather than in a dialog', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent(request)

    expect(await screen.findByText('Which library should we use?')).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Answered in the other window on the same workspace. This one has to stop
  // offering buttons for a question that is already settled.
  it('takes the buttons away when another window answered', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent(request)
    expect(await screen.findByRole('button', { name: 'Answer' })).toBeVisible()

    emitAgentEvent({
      type: 'question_answered',
      requestId: 'r-q',
      answers: [{ question: 'Which library should we use?', selected: ['date-fns'], other: null }]
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Answer' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('radio', { name: /date-fns/ })).toBeChecked()
  })
})

/*
 * This application's whole premise is that several agents work at once, so
 * looking at another workspace mid-sentence is ordinary rather than careless.
 */
describe('a draft and the workspace it was typed in', () => {
  const anna = workspaceView('anna')
  const bob = workspaceView('bob')

  function renderFor(target: WorkspaceView, draft = ''): (next: WorkspaceView) => void {
    const { rerender } = render(<ChatPane workspace={target} draft={draft} />)

    return (next) => {
      rerender(<ChatPane workspace={next} draft={draft} />)
    }
  }

  // Typed for anna, sent from bob: it ran in bob's worktree, on bob's branch,
  // with the text still in the field saying it belonged where it was read.
  it('does not carry what was typed in one workspace into another', async () => {
    const user = userEvent.setup()
    const switchTo = renderFor(anna)
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })
    await user.type(field(), 'drop the old migration and rerun the seeds')

    switchTo(bob)

    expect(field()).toHaveValue('')
    await user.type(field(), '{Enter}')
    expect(octopus().chats.send).not.toHaveBeenCalled()
  })

  it('opens the field on the draft it was given', async () => {
    renderFor(anna, 'half a sentence')
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })

    expect(field()).toHaveValue('half a sentence')
  })
})

/*
 * The one control that stops an agent editing files, missing exactly when
 * somebody has come back to check on it. The list beside the pane says the
 * workspace is working, so the window used to disagree with itself.
 */
/** The agent ran a command, and then said so: the moment the heads-up waits for. */
const RAN_A_COMMAND: ChatEntry[] = [
  {
    role: 'agent',
    at: '2026-08-13T09:00:00.000Z',
    event: { type: 'tool_use', toolUseId: 'call-1', name: 'Bash', input: { command: 'npm test' } }
  },
  { role: 'agent', at: '2026-08-13T09:00:01.000Z', event: { type: 'text', text: 'Tests pass.' } }
]

const headsUp = (): HTMLElement | null => screen.queryByRole('region', { name: 'Heads up' })

describe('a heads-up above the field', () => {
  it('warns that a rewind leaves commands alone once the agent has run one', async () => {
    givenChat(RAN_A_COMMAND)
    await openLoadedChat()

    const region = await screen.findByRole('region', { name: 'Heads up' })
    expect(region).toHaveTextContent('Changes made by commands in the terminal stay.')
  })

  it('says nothing in a conversation where no command has run', async () => {
    givenChat([
      {
        role: 'agent',
        at: '2026-08-13T09:00:00.000Z',
        event: { type: 'tool_use', toolUseId: 'call-1', name: 'Read', input: { file_path: '/a' } }
      },
      { role: 'agent', at: '2026-08-13T09:00:01.000Z', event: { type: 'text', text: 'Read it.' } }
    ])
    await openLoadedChat()
    expect(await screen.findByText('Read it.')).toBeInTheDocument()

    expect(headsUp()).not.toBeInTheDocument()
  })

  it('waits for the turn to end rather than pushing the field up mid-answer', async () => {
    givenChat(RAN_A_COMMAND, { status: 'running' })
    render(<ChatPane workspace={workspaceView('anna')} />)
    expect(await screen.findByText('Tests pass.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    expect(headsUp()).not.toBeInTheDocument()

    emitChatStatus(CHAT_ID, 'idle')

    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument()
  })

  it('stays away once the settings say it was already known', async () => {
    givenChat(RAN_A_COMMAND)
    render(<ChatPane workspace={workspaceView('anna')} dismissedTips={['rewindSkipsCommands']} />)
    expect(await screen.findByText('Tests pass.')).toBeInTheDocument()

    expect(headsUp()).not.toBeInTheDocument()
  })

  it('hands "knew this already" up to be kept in the settings', async () => {
    const user = userEvent.setup()
    const onDismissTip = vi.fn()
    givenChat(RAN_A_COMMAND)
    render(<ChatPane workspace={workspaceView('anna')} onDismissTip={onDismissTip} />)

    await user.click(await screen.findByRole('button', { name: 'Knew this already' }))

    expect(onDismissTip).toHaveBeenCalledWith('rewindSkipsCommands')
  })

  // The tip's words go into the field after whatever is being written, and the
  // heads-up closes for this conversation: they are in the field now, and a
  // second press would put them in twice. Nothing is written to the settings.
  it('adds its words to the message being written and closes', async () => {
    const user = userEvent.setup()
    const onDismissTip = vi.fn()
    givenChat(RAN_A_COMMAND)
    render(
      <ChatPane
        workspace={workspaceView('anna')}
        onDismissTip={onDismissTip}
        draft="why did it do that?"
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Add to chat' }))

    expect(field()).toHaveValue(
      'why did it do that?\n\nRewinding files undoes only what the agent changed with its editing tools. Changes made by commands in the terminal stay.'
    )
    expect(headsUp()).not.toBeInTheDocument()
    expect(onDismissTip).not.toHaveBeenCalled()
  })

  it('closes for this conversation alone without writing anything down', async () => {
    const user = userEvent.setup()
    const onDismissTip = vi.fn()
    givenChat(RAN_A_COMMAND)
    render(<ChatPane workspace={workspaceView('anna')} onDismissTip={onDismissTip} />)

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(headsUp()).not.toBeInTheDocument()
    expect(onDismissTip).not.toHaveBeenCalled()
  })
})

describe('a turn that was left running', () => {
  it('offers to stop a turn found already in flight', async () => {
    givenChat([], { status: 'running' })
    render(<ChatPane workspace={workspaceView('anna')} />)

    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('stops it when asked', async () => {
    const user = userEvent.setup()
    givenChat([], { status: 'running' })
    render(<ChatPane workspace={workspaceView('anna')} />)

    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(octopus().chats.interrupt).toHaveBeenCalledWith(CHAT_ID)
  })

  /*
   * Derived rather than seeded when the pane opens: the event that ends a turn
   * is filtered by the open chat's id and the chat is null until its history
   * has loaded, so one arriving in that window is dropped — and a seeded flag
   * would stay stuck on with nothing left to correct it.
   *
   * The conversation's own status, not its workspace's. Three tabs share a
   * workspace, so the one that finished used to report the other two idle and
   * take the stop button away from turns still running.
   */
  it('offers to send again once the conversation is no longer working', async () => {
    givenChat([], { status: 'running' })
    render(<ChatPane workspace={workspaceView('anna')} />)
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()

    emitChatStatus(CHAT_ID, 'idle')

    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('offers to send in a conversation that is doing nothing', async () => {
    givenChat()
    await openLoadedChat()

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })
})

describe('notes from two places riding one message', () => {
  const NOTE = {
    path: 'src/core/diff.ts',
    side: 'new' as const,
    line: 42,
    endLine: 42,
    code: 'const b = 2',
    text: 'This should be 3.'
  }

  const QUOTE = {
    key: 'inline:PRRC_1',
    reference: '#7',
    author: 'olena',
    place: 'src/core/git.ts:42',
    quote: '@@ -1 +1 @@',
    body: 'Why the second case?'
  }

  /*
   * The diff's notes and the review's remarks are two stores in `App`, kept
   * apart so the diff pane never has to narrow a shape it cannot hold. This is
   * the layer that puts them back together, and the one place that has to know
   * which store a note came from when it is given back.
   */
  it('gives a remark back to the store it came from', async () => {
    const user = userEvent.setup()
    const comments = commentController({ pending: [NOTE] })
    const quotes = quoteController({ pending: [QUOTE] })
    givenChat()
    render(<ChatPane workspace={workspaceView('anna')} comments={comments} quotes={quotes} />)

    const buttons = await screen.findAllByRole('button', { name: 'Remove this note' })
    await user.click(buttons[1]!)

    expect(quotes.remove).toHaveBeenCalledWith(expect.objectContaining({ key: QUOTE.key }))
    expect(comments.remove).not.toHaveBeenCalled()
  })

  it('gives a note on the diff back to the diff', async () => {
    const user = userEvent.setup()
    const comments = commentController({ pending: [NOTE] })
    const quotes = quoteController({ pending: [QUOTE] })
    givenChat()
    render(<ChatPane workspace={workspaceView('anna')} comments={comments} quotes={quotes} />)

    const buttons = await screen.findAllByRole('button', { name: 'Remove this note' })
    await user.click(buttons[0]!)

    expect(comments.remove).toHaveBeenCalledWith(expect.objectContaining({ path: NOTE.path }))
    expect(quotes.remove).not.toHaveBeenCalled()
  })
})

/*
 * The whole way from the menu to the core, because each piece of it has tests
 * of its own that would pass with the wire between them cut: the attic hands a
 * choice up, the composer passes it on, the session sends it — and the reading
 * is asked for again once the core has started the session over.
 */
describe('choosing where the conversation compacts', () => {
  it('sends the window chosen in the context menu, then reads the context again', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.usage).mockResolvedValue({
      ok: true,
      value: {
        context: {
          percentage: 8,
          usedTokens: 16_000,
          maxTokens: 1_000_000,
          model: 'claude-opus-5',
          modelWindow: 1_000_000
        },
        autoCompact: {
          chosen: null,
          effective: 1_000_000,
          modelWindow: 1_000_000,
          override: null,
          pending: false,
          settled: false
        }
      }
    })
    givenChat()
    await openLoadedChat()
    await user.click(await screen.findByRole('button', { name: /Context 8%/ }))
    const asked = vi.mocked(octopus().chats.usage).mock.calls.length

    await user.click(screen.getByRole('menuitemradio', { name: /^500k/ }))

    await waitFor(() => {
      expect(octopus().chats.setAutoCompact).toHaveBeenCalledWith(CHAT_ID, 500_000)
    })
    await waitFor(() => {
      expect(vi.mocked(octopus().chats.usage).mock.calls.length).toBeGreaterThan(asked)
    })

    // The same window again starts the session again too — to look for a
    // variable that may have been taken out — so it is read again as well.
    const again = vi.mocked(octopus().chats.usage).mock.calls.length
    await user.click(screen.getByRole('button', { name: /Context 8%/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /^500k/ }))
    await waitFor(() => {
      expect(vi.mocked(octopus().chats.usage).mock.calls.length).toBeGreaterThan(again)
    })
  })
})

describe('showing every step', () => {
  const AT = '2026-08-11T09:00:00.000Z'
  const history: ChatEntry[] = [
    { role: 'user', at: AT, text: 'look' },
    { role: 'agent', at: AT, event: { type: 'thinking', text: 'weighing it up' } },
    {
      role: 'agent',
      at: AT,
      event: {
        type: 'tool_use',
        toolUseId: 'c-1',
        name: 'Read',
        input: { file_path: '/tmp/planner/anna/src/App.tsx' }
      }
    }
  ]

  const pressCmdO = (extra: Partial<KeyboardEventInit> = {}): void => {
    fireEvent.keyDown(window, { key: 'o', metaKey: true, ...extra })
  }

  // Claude Code's ctrl+o, here ⌘O: every row and every piece of reasoning.
  it('opens everything on ⌘O, and folds it again on the next press', async () => {
    givenChat(history)
    await openChat()
    await screen.findByText('look')

    pressCmdO()
    expect(screen.getByText('weighing it up')).toBeVisible()

    pressCmdO()
    expect(screen.queryByText('weighing it up')).not.toBeInTheDocument()
  })

  it('ignores ⌘O with another modifier held, and O alone', async () => {
    givenChat(history)
    await openChat()
    await screen.findByText('look')

    pressCmdO({ shiftKey: true })
    pressCmdO({ altKey: true })
    fireEvent.keyDown(window, { key: 'o' })

    expect(screen.queryByText('weighing it up')).not.toBeInTheDocument()
  })

  // A dialog owns the keyboard while it is open.
  it('leaves ⌘O to an open dialog', async () => {
    givenChat(history)
    await openChat()
    await screen.findByText('look')

    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)
    try {
      pressCmdO()
      expect(screen.queryByText('weighing it up')).not.toBeInTheDocument()
    } finally {
      dialog.remove()
    }
  })

  it('offers the same from a button that says which way it goes', async () => {
    const user = userEvent.setup()
    givenChat(history)
    await openChat()

    const button = await screen.findByRole('button', { name: 'Show every step (⌘O)' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await user.click(button)

    expect(screen.getByRole('button', { name: 'Fold every step (⌘O)' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByText('weighing it up')).toBeVisible()
  })

  // The path in a row opens the file in the centre, the way the right pane's
  // tree opens one — and with the file in front, the conversation behind it
  // no longer answers ⌘O.
  it('opens a file a row names, and stops answering ⌘O behind it', async () => {
    const user = userEvent.setup()
    givenChat(history)
    await openChat()

    await user.click(await screen.findByRole('button', { name: 'src/App.tsx' }))

    await waitFor(() => {
      expect(octopus().files.read).toHaveBeenCalledWith(workspaceView('anna').id, 'src/App.tsx')
    })
    pressCmdO()
    expect(screen.queryByText('weighing it up')).not.toBeInTheDocument()
  })

  it('keeps a file opened with a double-click', async () => {
    const user = userEvent.setup()
    givenChat(history)
    await openChat()

    await user.dblClick(await screen.findByRole('button', { name: 'src/App.tsx' }))

    await waitFor(() => {
      expect(octopus().files.read).toHaveBeenCalledWith(workspaceView('anna').id, 'src/App.tsx')
    })
  })
})

/*
 * The agents a conversation sent off, read from its log after a restart and
 * from the core while they run. The count opens the map, and the map takes
 * the reader to the row that started an agent.
 */
describe('the agents of a conversation', () => {
  const SENT_ONE_OFF: ChatEntry[] = [
    {
      role: 'agent',
      at: '2026-08-13T09:00:00.000Z',
      event: {
        type: 'tool_use',
        toolUseId: 'call-1',
        name: 'Agent',
        input: { description: 'Look around', prompt: 'Read everything.' }
      }
    },
    {
      role: 'agent',
      at: '2026-08-13T09:00:01.000Z',
      event: {
        type: 'task_started',
        taskId: 't-1',
        toolUseId: 'call-1',
        kind: 'agent',
        description: 'Look around',
        backgrounded: true,
        ambient: false
      }
    }
  ]

  // Nothing is live after a restart, so one with no end was cut off.
  it('reads an agent a restart cut off as stopped', async () => {
    givenChat(SENT_ONE_OFF)
    await openLoadedChat()

    await userEvent.click(
      await screen.findByTitle('The agents this conversation ran — show what they did')
    )

    expect(screen.getByRole('button', { name: 'Look around, Stopped' })).toBeInTheDocument()
  })

  it('takes the reader from the map to the row that started the agent', async () => {
    givenChat(SENT_ONE_OFF)
    vi.mocked(octopus().tasks.onChanged).mockImplementation((push) => {
      push({
        chatId: CHAT_ID,
        workspaceId: 'planner/anna',
        tasks: [task({ taskId: 't-1' })],
        mainWorking: false
      })
      return vi.fn()
    })
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await openLoadedChat()

    await userEvent.click(await screen.findByTitle('1 agent working — show what it is doing'))
    await userEvent.click(screen.getByRole('button', { name: 'Audit route handlers, Working' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show in conversation' }))

    expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })

    await userEvent.click(screen.getByRole('button', { name: 'Stop agent' }))
    expect(octopus().tasks.stop).toHaveBeenCalledWith(CHAT_ID, 't-1')
  })

  // A nested agent's row is drawn only inside its parent's opened row, so the
  // parent is opened on the way to it.
  it('opens the row an agent was started inside to reach it', async () => {
    givenChat([
      ...SENT_ONE_OFF,
      {
        role: 'agent',
        at: '2026-08-13T09:00:02.000Z',
        event: {
          type: 'tool_use',
          toolUseId: 'call-2',
          name: 'Agent',
          input: { description: 'Look deeper', prompt: 'Read more.' },
          parentToolUseId: 'call-1'
        }
      }
    ])
    vi.mocked(octopus().tasks.onChanged).mockImplementation((push) => {
      push({
        chatId: CHAT_ID,
        workspaceId: 'planner/anna',
        tasks: [
          task({ taskId: 't-1', toolUseId: 'call-1', description: 'Look around' }),
          task({
            taskId: 't-2',
            toolUseId: 'call-2',
            parentTaskId: 't-1',
            description: 'Look deeper'
          })
        ],
        mainWorking: false
      })
      return vi.fn()
    })
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    await openLoadedChat()
    const nested = (): Element | null => document.querySelector('[data-tool-use-id="call-2"]')
    expect(nested()).toBeNull()

    await userEvent.click(await screen.findByTitle('2 agents working — show what they are doing'))
    await userEvent.click(screen.getByRole('button', { name: 'Look deeper, Working' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show in conversation' }))

    expect(nested()).not.toBeNull()
    expect(scrolled.mock.contexts.at(-1)).toBe(nested())
  })
})
