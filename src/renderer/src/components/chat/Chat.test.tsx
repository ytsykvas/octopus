import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { WorkspaceView } from '@core/workspaces.js'

import { CHAT_ID, emitAgentEvent, givenChat } from '../../test/chat.js'
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
    missing: false,
    changedFiles: 0,
    ...overrides
  }
}

/** Renders the pane and waits for the chat lookup to settle. */
async function openChat(target: WorkspaceView | null = workspace()): Promise<void> {
  render(<Chat workspace={target} color="blue" />)
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

describe('without a workspace', () => {
  // A conversation belongs to a workspace: its worktree is the agent's working
  // directory, so there is nowhere to run without one.
  it('says which one to pick and asks the bridge for nothing', () => {
    render(<Chat workspace={null} color="blue" />)

    expect(screen.getByText('Select a workspace')).toBeInTheDocument()
    expect(octopus().chats.list).not.toHaveBeenCalled()
  })
})

describe('a workspace nobody has written in', () => {
  it('invites the first message without creating a record', async () => {
    await openChat()

    expect(await screen.findByText('Start the conversation')).toBeInTheDocument()
    expect(octopus().chats.open).not.toHaveBeenCalled()
  })

  // `anna ytsykvas/anna` was the same word twice: a workspace branch is made
  // from the workspace name, so the branch already carries it.
  it('says which branch the work lands on, and not the name twice', async () => {
    await openChat()

    expect(screen.getByText('ytsykvas/anna')).toBeInTheDocument()
    expect(screen.queryByText('anna')).toBeNull()
  })

  // Nothing else in this pane says that string is a branch.
  it('marks the branch as one', async () => {
    await openChat()

    const header = screen.getByText('ytsykvas/anna').parentElement
    expect(header?.querySelector('svg')).toBeInTheDocument()
  })

  // The mode the first message runs under is the one most worth choosing, so
  // the control is live before there is a record — picking one creates it.
  it('offers the mode before there is anything to change', async () => {
    await openChat()

    expect(screen.getByRole('button', { name: 'Permissions' })).toBeEnabled()
  })
})

describe('the project it belongs to', () => {
  // The stylesheet owns how the colour is used; the component only says which
  // one, and it resolves to a token rather than to a value (§10.4).
  it('carries the colour down for the stylesheet to use', async () => {
    const { container } = render(<Chat workspace={workspace()} color="teal" />)
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

  it('says so when the chat list could not be read', async () => {
    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: false, error: 'state is corrupt' })

    await openChat()

    expect(await screen.findByText(/state is corrupt/)).toBeInTheDocument()
  })

  // Selecting a different workspace shows a different conversation, not a
  // continuation of this one.
  it('is replaced when the workspace changes', async () => {
    givenChat([{ role: 'user', at: '2026-08-11T09:00:00.000Z', text: 'first workspace' }])
    const { rerender } = render(<Chat workspace={workspace()} color="blue" />)

    expect(await screen.findByText('first workspace')).toBeInTheDocument()

    vi.mocked(octopus().chats.history).mockResolvedValue({ ok: true, value: [] })
    rerender(<Chat workspace={workspace({ id: 'planner/maria', name: 'maria' })} color="blue" />)

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
    vi.mocked(octopus().chats.interrupt).mockResolvedValue({ ok: false, error: 'nothing running' })
    givenChat()
    await openLoadedChat()

    await user.type(field(), 'work{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Stop' }))

    expect(await screen.findByText(/nothing running/)).toBeInTheDocument()
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
  const picker = (): HTMLElement => screen.getByRole('button', { name: 'Permissions' })

  it('shows the mode the chat is in and changes it', async () => {
    const user = userEvent.setup()
    givenChat([], { workingMode: 'acceptEdits' })
    await openLoadedChat()

    await waitFor(() => {
      expect(picker()).toHaveTextContent('Accept edits')
    })

    await user.click(picker())
    await user.click(screen.getByRole('menuitemradio', { name: 'Ask first' }))

    expect(octopus().chats.setWorkingMode).toHaveBeenCalledWith(CHAT_ID, 'default')
    expect(picker()).toHaveTextContent('Ask first')
  })

  // The core deliberately leaves `bypassPermissions` out, and planning is a
  // toggle of its own now — so this list is two entries and nothing else.
  it('offers only the two degrees of permission', async () => {
    const user = userEvent.setup()
    givenChat()
    await openLoadedChat()

    await user.click(picker())

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    expect(screen.queryByRole('menuitemradio', { name: /bypass/i })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Agent decides')
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
    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Agent decides')
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
    await user.click(screen.getByRole('menuitemradio', { name: 'Accept edits' }))

    expect(await screen.findByText(/no such chat/)).toBeInTheDocument()
    expect(picker()).toHaveTextContent('Ask first')
  })
})
