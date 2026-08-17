import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Effort, WorkingMode } from '@core/chats.js'
import type { ProjectColor } from '@core/colors.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useChatTabs } from '../../hooks/useChatTabs.js'
import type { DiffCommentController } from '../../hooks/useDiffComments.js'
import { CHAT_ID, emitAgentEvent, emitChatStatus, givenChat } from '../../test/chat.js'
import { commentController } from '../../test/comments.js'
import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { Chat } from './Chat.js'

// The plan's approval is a dialog now, and jsdom implements none of `<dialog>`.
beforeAll(stubDialogElement)

function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'planner/anna',
    projectId: 'planner',
    name: 'anna',
    branch: 'ytsykvas/anna',
    path: '/ws/planner/anna',
    status: 'idle',
    port: 3100,
    createdAt: '2026-08-07T12:00:00.000Z',
    ownerId: null,
    chats: [],
    missing: false,
    changedFiles: 0,
    ...overrides
  }
}

interface PaneProps {
  readonly workspace: WorkspaceView
  readonly draft?: string
  readonly onDraftLeave?: (tabKey: string, text: string) => void
  readonly comments?: DiffCommentController
  readonly color?: ProjectColor
  readonly defaultWorkingMode?: WorkingMode
  readonly defaultEffort?: Effort
  /** Where a failure the strip owns is reported, as `App` reports it. */
  readonly onError?: (message: string) => void
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
  color = 'blue',
  defaultWorkingMode = 'default',
  defaultEffort = 'medium',
  onError = vi.fn()
}: PaneProps): React.JSX.Element {
  const tabs = useChatTabs(
    target.id,
    () => Promise.resolve({ confirmed: true, checked: false }),
    vi.fn(),
    onError
  )

  return (
    <Chat
      // Keyed as `App` keys it: switching workspace builds the panes fresh
      // rather than handing one workspace's conversation to another's tabs.
      key={target.id}
      workspace={target}
      tabs={tabs}
      draftOf={() => draft}
      onDraftLeave={onDraftLeave}
      comments={comments}
      color={color}
      defaultWorkingMode={defaultWorkingMode}
      defaultEffort={defaultEffort}
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
  target: WorkspaceView = workspace(),
  defaults: { workingMode?: WorkingMode; effort?: Effort } = {}
): Promise<void> {
  render(
    <ChatPane
      workspace={target}
      defaultWorkingMode={defaults.workingMode ?? 'default'}
      defaultEffort={defaults.effort ?? 'medium'}
    />
  )
  await waitFor(() => {
    expect(octopus().chats.list).toHaveBeenCalled()
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
async function openLoadedChat(): Promise<void> {
  await openChat()
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

describe('the project it belongs to', () => {
  // The stylesheet owns how the colour is used; the component only says which
  // one, and it resolves to a token rather than to a value (§10.4).
  it('carries the colour down for the stylesheet to use', async () => {
    const { container } = render(<ChatPane workspace={workspace()} color="teal" />)
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })

    expect(container.firstElementChild).toHaveStyle({ '--project-color': 'var(--project-teal)' })
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
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))

    expect(await screen.findByText(/no such workspace/)).toBeInTheDocument()
    expect(octopus().chats.setEffort).not.toHaveBeenCalled()
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

    render(<ChatPane workspace={workspace()} onError={onError} />)

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('state is corrupt'))
    })
  })

  // Selecting a different workspace shows a different conversation, not a
  // continuation of this one.
  it('is replaced when the workspace changes', async () => {
    givenChat([{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'first workspace' }])
    const { rerender } = render(<ChatPane workspace={workspace()} />)

    expect(await screen.findByText('first workspace')).toBeInTheDocument()

    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [] })
    vi.mocked(octopus().chats.history).mockResolvedValue({ ok: true, value: [] })
    rerender(<ChatPane workspace={workspace({ id: 'planner/maria', name: 'maria' })} />)

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
    expect(screen.getByText('Looking')).toBeInTheDocument()

    emitAgentEvent({ type: 'text', text: 'Looking at auth.rb' })
    expect(screen.getByText('Looking at auth.rb')).toBeInTheDocument()
    expect(screen.queryByText('Looking')).not.toBeInTheDocument()
  })

  it('shows reasoning as it is written', async () => {
    givenChat()
    await openLoadedChat()

    emitAgentEvent({ type: 'thinking_delta', text: 'weighing' })

    expect(screen.getByText('Thinking')).toBeInTheDocument()
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
        context: { percentage: 8, usedTokens: 16_000, maxTokens: 200_000, model: 'claude-opus-5' },
        subscription: null
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
   * Approving the plan has to answer the request *and* put the toggle out —
   * the core clears the stored field, but nothing tells a window that a record
   * changed, so a Plan button still lit over an agent that has started editing
   * is exactly the state this was reported as.
   */
  it('answers and stops showing the chat as planning', async () => {
    const user = userEvent.setup()
    givenChat([], { planMode: true, workingMode: 'acceptEdits' })
    await openLoadedChat()

    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true')

    emitAgentEvent(planRequest)
    await user.click(await screen.findByRole('button', { name: 'Execute' }))

    expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-plan', 'allow', undefined)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'false')
    })
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
  })

  /*
   * Reported from a running app: the footer said "without asking" and the agent
   * asked about every edit.
   *
   * Turning planning off is what hands the session the mode the footer names —
   * the same handover approving through the dialog performs. Sent without it,
   * the message went out with the conversation still recorded as planning, and
   * the agent worked in whatever mode it had fallen back to.
   *
   * Before the message, not after: the mode has to be in force by the time the
   * agent reads the instruction.
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
      { planMode: true, workingMode: 'acceptEdits' }
    )
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalled()
    })
    expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, false)

    const stopped = vi.mocked(octopus().chats.setPlanMode).mock.invocationCallOrder[0] ?? 0
    const sent = vi.mocked(octopus().chats.send).mock.invocationCallOrder[0] ?? 0
    expect(stopped).toBeLessThan(sent)

    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'false')
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
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('the permission mode', () => {
  const picker = (): HTMLElement => screen.getByRole('button', { name: /^Permissions:/ })

  it('shows the mode the chat is in and changes it', async () => {
    const user = userEvent.setup()
    givenChat([], { workingMode: 'acceptEdits' })
    await openLoadedChat()

    await waitFor(() => {
      expect(picker()).toHaveTextContent('Auto mode')
    })

    await user.click(picker())

    expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'default')
    expect(picker()).toHaveTextContent('Ask first')
  })

  /*
   * The footer used to show the schema's defaults for a workspace with no
   * record, while `openChat` created that record from the settings. Set
   * "Accept edits" as the global default and the first message ran with it
   * while the footer said the agent would ask — and both pickers then flipped
   * on their own as the record came back.
   */
  it('names what the settings will create the first record with', async () => {
    await openChat(workspace(), { workingMode: 'acceptEdits', effort: 'high' })

    expect(picker()).toHaveTextContent('Auto mode')
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('High')
  })

  // And once there is a record it answers for itself, whatever the settings
  // say a new conversation would have started on.
  it('lets the record overrule the settings', async () => {
    givenChat([], { workingMode: 'default', effort: 'low' })
    await openChat(workspace(), { workingMode: 'acceptEdits', effort: 'high' })

    await waitFor(() => {
      expect(octopus().chats.history).toHaveBeenCalled()
    })

    expect(picker()).toHaveTextContent('Ask first')
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Low')
  })

  /*
   * The core deliberately leaves `bypassPermissions` out, and planning is a
   * toggle of its own — so there are two degrees and the control switches
   * between them rather than listing them. Asserted by going round: a third
   * mode could not hide in a cycle that returns in two clicks.
   */
  it('cycles between the two degrees of permission and no others', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.click(picker())
    expect(picker()).toHaveTextContent('Auto mode')

    await user.click(picker())
    expect(picker()).toHaveTextContent('Ask first')

    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  // Its own stored field now, rather than a third value crowding the one the
  // picker above writes to.
  it('turns planning on for the chat without disturbing the permissions', async () => {
    const user = userEvent.setup()
    givenChat([], { workingMode: 'acceptEdits' })
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Plan' }))

    await waitFor(() => {
      expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, true)
    })
    expect(octopus().chats.setWorkingMode).not.toHaveBeenCalled()
  })

  // The record is created by the choice itself — that is what makes the mode of
  // the first message choosable at all.
  it('creates the record when a mode is chosen before anything is sent', async () => {
    const user = userEvent.setup()
    await openChat()

    await user.click(screen.getByRole('button', { name: 'Plan' }))

    await waitFor(() => {
      expect(octopus().chats.open).toHaveBeenCalledWith('planner/anna')
    })
    expect(octopus().chats.setPlanMode).toHaveBeenCalledWith(CHAT_ID, true)
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
    await user.click(await screen.findByRole('menuitemradio', { name: 'Opus 5' }))

    await waitFor(() => {
      expect(octopus().chats.setModel).toHaveBeenCalledWith(CHAT_ID, 'claude-opus-5')
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
    vi.mocked(octopus().chats.setModel).mockResolvedValue({ ok: false, error: 'no such chat' })
    givenChat()
    await openLoadedChat()

    await user.click(await screen.findByRole('button', { name: 'Model' }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Opus 5' }))

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
    await user.click(screen.getByRole('menuitemradio', { name: 'Very high' }))

    await waitFor(() => {
      expect(octopus().chats.setEffort).toHaveBeenCalledWith(CHAT_ID, 'xhigh')
    })
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Very high')
  })

  it('keeps the old effort on screen when the change failed', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.setEffort).mockResolvedValue({ ok: false, error: 'no such chat' })
    givenChat()
    await openLoadedChat()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))

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
    expect(picker()).toHaveTextContent('Ask first')
  })
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
  const anna = workspace()
  const bob = workspace({ id: 'planner/bob', name: 'bob', path: '/ws/planner/bob' })

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
describe('a turn that was left running', () => {
  it('offers to stop a turn found already in flight', async () => {
    givenChat([], { status: 'running' })
    render(<ChatPane workspace={workspace()} />)

    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('stops it when asked', async () => {
    const user = userEvent.setup()
    givenChat([], { status: 'running' })
    render(<ChatPane workspace={workspace()} />)

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
    render(<ChatPane workspace={workspace()} />)
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
