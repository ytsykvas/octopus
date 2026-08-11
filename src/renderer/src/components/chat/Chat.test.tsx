import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceView } from '@core/workspaces.js'

import { CHAT_ID, emitAgentEvent, givenChat } from '../../test/chat.js'
import { octopus } from '../../test/octopus.js'
import { Chat } from './Chat.js'

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
 * The picker is the signal: it is disabled until there is a record to change,
 * so an enabled one means the chat has arrived — and events for it are no
 * longer being dropped as belonging to some other chat.
 */
async function openLoadedChat(): Promise<void> {
  await openChat()
  await waitFor(() => {
    expect(screen.getByRole('combobox', { name: 'Permissions' })).toBeEnabled()
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

  it('shows the workspace and the branch it works on', async () => {
    await openChat()

    expect(screen.getByText('anna')).toBeInTheDocument()
    expect(screen.getByText('ytsykvas/anna')).toBeInTheDocument()
  })

  // The record is created by the first message, so until then there is nothing
  // whose mode could be changed.
  it('offers no mode to change yet', async () => {
    await openChat()

    expect(screen.getByRole('combobox', { name: 'Permissions' })).toBeDisabled()
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

    expect(octopus().chats.answerPermission).toHaveBeenCalledWith('r-1', 'allow')
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

describe('the permission mode', () => {
  it('shows the mode the chat is in and changes it', async () => {
    const user = userEvent.setup()
    givenChat([], { permissionMode: 'acceptEdits' })
    await openChat()

    const picker = await screen.findByRole('combobox', { name: 'Permissions' })
    await waitFor(() => {
      expect(picker).toHaveValue('acceptEdits')
    })

    await user.selectOptions(picker, 'plan')

    expect(octopus().chats.setPermissionMode).toHaveBeenCalledWith(CHAT_ID, 'plan')
    expect(picker).toHaveValue('plan')
  })

  // The narrowing is not ceremony: the value arrives as a bare string, and a
  // mode the core does not know would be stored and then fail to apply.
  it('ignores a value that is not a mode', async () => {
    givenChat()
    await openLoadedChat()

    fireEvent.change(screen.getByRole('combobox', { name: 'Permissions' }), {
      target: { value: 'bypassPermissions' }
    })

    expect(octopus().chats.setPermissionMode).not.toHaveBeenCalled()
  })

  it('keeps the old mode on screen when the change failed', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().chats.setPermissionMode).mockResolvedValue({
      ok: false,
      error: 'no such chat'
    })
    givenChat()
    await openChat()

    const picker = await screen.findByRole('combobox', { name: 'Permissions' })
    await waitFor(() => {
      expect(picker).toBeEnabled()
    })
    await user.selectOptions(picker, 'plan')

    expect(await screen.findByText(/no such chat/)).toBeInTheDocument()
    expect(picker).toHaveValue('default')
  })
})
