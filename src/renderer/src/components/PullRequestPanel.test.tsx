import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PullRequest, PullRequestView } from '@core/pullRequests.js'

import { octopus } from '../test/octopus.js'
import { workspaceView } from '../test/workspaces.js'
import { PullRequestPanel } from './PullRequestPanel.js'

const anna = workspaceView('anna')

/** A branch with commits and no pull request — the state that offers the form. */
function view(overrides: Partial<PullRequestView> = {}): PullRequestView {
  return { request: null, pushed: true, dirty: false, ahead: 2, ...overrides }
}

/** A pull request as `gh` reports one — all four fields, never some of them. */
function request(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    state: 'open',
    title: 'Rename the thing',
    url: 'https://github.com/o/p/pull/7',
    ...overrides
  }
}

function answer(value: PullRequestView): void {
  vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value })
}

function renderPanel(
  overrides: {
    workspace?: typeof anna | null
    visible?: boolean
    chatId?: string | null
    onEditInstructions?: () => void
  } = {}
): { onEditInstructions: ReturnType<typeof vi.fn>; onError: ReturnType<typeof vi.fn> } {
  const onEditInstructions = vi.fn()
  const onError = vi.fn()

  render(
    <PullRequestPanel
      workspace={overrides.workspace === undefined ? anna : overrides.workspace}
      visible={overrides.visible ?? true}
      chatId={overrides.chatId === undefined ? 'chat-1' : overrides.chatId}
      onEditInstructions={overrides.onEditInstructions ?? onEditInstructions}
      onError={onError}
    />
  )

  return { onEditInstructions, onError }
}

/** The title field, once the form has arrived. */
const titleField = (): Promise<HTMLElement> => screen.findByLabelText('Title')

describe('the pull request tab', () => {
  it('asks for a workspace before anything else', () => {
    renderPanel({ workspace: null })

    expect(
      screen.getByText('Select a workspace to open a pull request for it.')
    ).toBeInTheDocument()
    expect(octopus().workspaces.pullRequest).not.toHaveBeenCalled()
  })

  /*
   * The one rule that matters more here than on the diff: this leaves the
   * machine. A hidden tab reading on every workspace opened would be a network
   * call each time, for a pane nobody is looking at.
   */
  it('asks GitHub nothing while another tab is showing', () => {
    renderPanel({ visible: false })

    expect(octopus().workspaces.pullRequest).not.toHaveBeenCalled()
  })

  /*
   * The instruction is the project's, and it is edited where it lives. A second
   * editor here would be a second place for the two to disagree — the same
   * reasoning that has "Write the script" open the settings rather than a box.
   */
  it('sends the reader to the project instructions rather than editing them here', async () => {
    const user = userEvent.setup()
    answer(view())
    const { onEditInstructions } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Instructions for a new PR' }))

    expect(onEditInstructions).toHaveBeenCalledOnce()
  })

  /*
   * Sent as a message rather than asked behind the reader's back. §4 leaves no
   * room for the app prompting the agent invisibly, and the conversation is
   * where the answer has to appear anyway.
   */
  it('sends the instruction that applies to the conversation', async () => {
    const user = userEvent.setup()
    answer(view())
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Ask the agent to describe it' }))

    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(anna.id, 'pullRequest')
    expect(octopus().chats.send).toHaveBeenCalledWith('chat-1', 'Describe what changed and why.')
  })

  // A conversation started by a button pressed for something else is a surprise.
  it('will not ask when there is no conversation to ask in', async () => {
    answer(view())
    renderPanel({ chatId: null })

    expect(
      await screen.findByRole('button', { name: 'Ask the agent to describe it' })
    ).toBeDisabled()
  })

  /*
   * Both steps can fail, and a press that quietly did neither is worse than one
   * that says so (§13). The file may be unreadable; the conversation may have
   * gone since the pane last drew it.
   */
  it('sends nothing and says why when the instruction could not be read', async () => {
    const user = userEvent.setup()
    answer(view())
    vi.mocked(octopus().workspaces.instruction).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    const { onError } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Ask the agent to describe it' }))

    expect(octopus().chats.send).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('EACCES'))
  })

  it('says why when the message could not be sent', async () => {
    const user = userEvent.setup()
    answer(view())
    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'no such chat' })
    const { onError } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Ask the agent to describe it' }))

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('no such chat'))
  })

  it('names the branch it is about', async () => {
    answer(view())
    renderPanel()

    expect(await screen.findByText(anna.branch)).toBeInTheDocument()
  })

  it('offers the form for a branch that has commits and no request', async () => {
    answer(view())
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Open pull request' })).toBeInTheDocument()
  })

  // An empty title is a pull request nobody can find again, and `gh` refuses it
  // anyway — better said by the button than by a failed command.
  it('will not open one without a title', async () => {
    answer(view())
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Open pull request' })).toBeDisabled()
  })

  it('sends the title, the description and the draft flag', async () => {
    const user = userEvent.setup()
    answer(view())
    renderPanel()

    await user.type(await screen.findByLabelText('Title'), 'Rename the thing')
    await user.type(screen.getByLabelText('Description'), 'Because it was wrong.')
    await user.click(screen.getByLabelText('Open as a draft'))
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(octopus().workspaces.createPullRequest).toHaveBeenCalledWith(anna.id, {
      title: 'Rename the thing',
      body: 'Because it was wrong.',
      draft: true
    })
  })

  // Trimmed here rather than in core: the field is where the stray space was
  // typed, and a title that is only spaces should not reach `gh` at all.
  it('trims the title on the way out', async () => {
    const user = userEvent.setup()
    answer(view())
    renderPanel()

    await user.type(await titleField(), '  spaced  ')
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(octopus().workspaces.createPullRequest).toHaveBeenCalledWith(
      anna.id,
      expect.objectContaining({ title: 'spaced' })
    )
  })

  /*
   * Both warnings are said before the button, not after it fails. One is about
   * touching somebody else's machine and the other is about work that will not
   * travel; neither should be discovered afterwards.
   */
  it('says that opening will push a branch that is not pushed', async () => {
    answer(view({ pushed: false }))
    renderPanel()

    expect(
      await screen.findByText('This branch is not on GitHub yet. Opening will push it.')
    ).toBeInTheDocument()
  })

  it('says what uncommitted work will be left behind', async () => {
    answer(view({ dirty: true }))
    renderPanel()

    expect(await screen.findByText(/uncommitted changes/)).toBeInTheDocument()
  })

  it('offers nothing to open on a branch that has not moved', async () => {
    answer(view({ ahead: 0 }))
    renderPanel()

    expect(await screen.findByText(/Nothing to open yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open pull request' })).not.toBeInTheDocument()
  })

  it('reports the request there already is, and offers to open it', async () => {
    answer(view({ request: request() }))
    renderPanel()

    expect(await screen.findByText('Pull request #7 is open.')).toBeInTheDocument()
    expect(screen.getByText('Rename the thing')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/o/p/pull/7'
    )
    expect(screen.queryByRole('button', { name: 'Open pull request' })).not.toBeInTheDocument()
  })

  it('says when one was merged and when one was closed', async () => {
    answer(view({ request: request({ state: 'merged' }) }))
    renderPanel()
    expect(await screen.findByText('Pull request #7 was merged.')).toBeInTheDocument()

    answer(view({ request: request({ state: 'closed', number: 8 }) }))
    render(
      <PullRequestPanel
        workspace={workspaceView('bob')}
        visible
        chatId="chat-1"
        onEditInstructions={vi.fn()}
        onError={vi.fn()}
      />
    )
    expect(
      await screen.findByText('Pull request #8 was closed without merging.')
    ).toBeInTheDocument()
  })

  // Read again rather than assembled from the reply: what came back is a URL,
  // and the number and the title are things only the next read knows.
  it('reads the branch again once one has been opened', async () => {
    const user = userEvent.setup()
    answer(view())
    renderPanel()

    await user.type(await titleField(), 'Rename')
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({
      ok: true,
      value: view({ request: request() })
    })
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(await screen.findByText('Pull request #7 is open.')).toBeInTheDocument()
  })

  it('says why the request could not be opened', async () => {
    const user = userEvent.setup()
    answer(view())
    vi.mocked(octopus().workspaces.createPullRequest).mockResolvedValue({
      ok: false,
      error: 'push failed',
      code: 'pushFailed',
      params: { branch: 'octopus/anna' }
    })
    renderPanel()

    await user.type(await titleField(), 'Rename')
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(await screen.findByText(/Could not push octopus\/anna/)).toBeInTheDocument()
  })

  it('says why GitHub could not be asked', async () => {
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({
      ok: false,
      error: 'not connected',
      code: 'notConnected'
    })
    renderPanel()

    expect(await screen.findByText(/Could not reach GitHub/)).toBeInTheDocument()
  })

  it('says nothing about the last workspace when another is opened', async () => {
    answer(view({ request: request() }))
    const { rerender } = render(
      <PullRequestPanel
        workspace={anna}
        visible
        chatId="chat-1"
        onEditInstructions={vi.fn()}
        onError={vi.fn()}
      />
    )
    await screen.findByText('Pull request #7 is open.')

    answer(view())
    rerender(
      <PullRequestPanel
        workspace={workspaceView('bob')}
        visible
        chatId="chat-1"
        onEditInstructions={vi.fn()}
        onError={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.queryByText('Pull request #7 is open.')).not.toBeInTheDocument()
    })
  })
})
