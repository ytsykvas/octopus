import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { useChatTabs } from '../../hooks/useChatTabs.js'
import { chat, emitAgentEvent, givenChats } from '../../test/chat.js'
import { commentController, quoteController } from '../../test/comments.js'
import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { workspaceView } from '../../test/workspaces.js'
import { Chat } from './Chat.js'

// The plan's approval is a dialog, and jsdom implements none of `<dialog>`.
beforeAll(stubDialogElement)

const WORKSPACE = workspaceView('anna')

/** The pane as `App` assembles it, tab strip and all. */
function Pane({ workspace = WORKSPACE }: { workspace?: WorkspaceView }): React.JSX.Element {
  const tabs = useChatTabs(
    workspace.id,
    () => Promise.resolve({ confirmed: true, checked: false }),
    vi.fn(),
    vi.fn()
  )

  return (
    <Chat
      workspace={workspace}
      tabs={tabs}
      draftOf={() => ''}
      onDraftLeave={vi.fn()}
      comments={commentController()}
      quotes={quoteController()}
      color="blue"
      defaultWorkingMode="default"
      defaultEffort="medium"
      defaultModel={null}
      defaultPlanModel={null}
      onOpenSkillSettings={vi.fn()}
    />
  )
}

async function openTwo(): Promise<void> {
  givenChats([chat(), chat({ id: 'chat-2' })])
  render(<Pane />)
  await waitFor(() => {
    expect(screen.getByText('Claude 2')).toBeInTheDocument()
  })
}

describe('the pane', () => {
  // The row carries the strip alone; the branch that shared it has moved to the
  // title bar, where it sits beside the directory it is a branch of.
  it('gives the header row to the conversations', async () => {
    await openTwo()

    expect(screen.getByRole('navigation', { name: 'Conversations' })).toBeInTheDocument()
    expect(screen.queryByText('ytsykvas/anna')).toBeNull()
  })

  // The stylesheet owns how the colour is used; the component only says which
  // one, and it resolves to a token rather than to a value (§10.4).
  it('carries the project colour down for the stylesheet to use', async () => {
    const { container } = render(<Pane />)
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })

    expect(container.firstElementChild).toHaveStyle({ '--project-color': 'var(--project-blue)' })
  })
})

/*
 * Every conversation stays mounted while its workspace is open, the arrangement
 * the right pane uses for its own tabs: one that unmounted would lose its
 * scroll position and the answer half-streamed into it each time you looked at
 * another — which, with several agents at work, is most of the time.
 */
describe('the conversations that are not showing', () => {
  it('keeps them mounted and hides them', async () => {
    await openTwo()

    const logs = screen.getAllByRole('log', { hidden: true })
    expect(logs).toHaveLength(2)
    expect(logs[1]?.closest('[aria-hidden]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('goes on drawing what a background conversation says', async () => {
    const user = userEvent.setup()
    await openTwo()

    emitAgentEvent({ type: 'text', text: 'still working on it' }, 'chat-2')
    // `findBy` rather than `getBy`: the event arrives through a synchronous
    // `act`, which covers the state update but not an effect that lands on the
    // next tick. A bare read here has no window at all to be late in.
    expect(await screen.findByText('still working on it')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Claude 2: / }))

    expect(screen.getByText('still working on it')).toBeVisible()
  })

  /*
   * A modal raised by a conversation nobody is looking at is the worst kind of
   * interruption: it is about work the reader cannot see, and it takes the
   * keyboard from work they can. The tab's dot turns amber instead.
   */
  it('does not let one of them raise the plan dialog', async () => {
    await openTwo()

    emitAgentEvent(
      {
        type: 'permission_request',
        requestId: 'r-1',
        toolName: 'ExitPlanMode',
        input: { plan: '# Do the thing' }
      },
      'chat-2'
    )

    expect(screen.queryByText('The plan is ready')).not.toBeInTheDocument()
  })

  it('raises it once that conversation is the one showing', async () => {
    const user = userEvent.setup()
    await openTwo()

    emitAgentEvent(
      {
        type: 'permission_request',
        requestId: 'r-1',
        toolName: 'ExitPlanMode',
        input: { plan: '# Do the thing' }
      },
      'chat-2'
    )
    await user.click(screen.getByRole('button', { name: /^Claude 2: / }))

    expect(await screen.findByText('The plan is ready')).toBeInTheDocument()
  })
})

describe('a repository that has not been read', () => {
  /*
   * octopus loads every settings source as the CLI does, so a clone's
   * `.claude/settings.json` would pre-approve tools and run its own commands
   * the moment somebody opened it. Until it is read the agent gets nothing from
   * the repository, and the pane has to say why.
   */
  it('says the agent is working without the repository', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: { approved: false, files: [{ path: '.claude/settings.json', contents: '{}' }] }
    })
    givenChats([chat()])
    render(<Pane />)

    expect(await screen.findByText(/pre-approve tools/)).toBeInTheDocument()
  })

  it('says nothing about a repository that grants nothing', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: { approved: true, files: [] }
    })
    givenChats([chat()])
    render(<Pane />)

    await waitFor(() => {
      expect(octopus().workspaces.trust).toHaveBeenCalled()
    })
    expect(screen.queryByText(/pre-approve tools/)).toBeNull()
  })

  // The whole contents, not a summary: a summary of a file that grants
  // capability is a summary somebody has to trust instead.
  it('shows what the files hold, and puts the notice away once allowed', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: {
        approved: false,
        files: [{ path: '.claude/settings.json', contents: '"Bash(rm -rf /:*)"' }]
      }
    })
    givenChats([chat()])
    render(<Pane />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    expect(await screen.findByText(/Bash\(rm -rf \/:\*\)/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

    await waitFor(() => {
      expect(screen.queryByText(/pre-approve tools/)).toBeNull()
    })
    expect(octopus().workspaces.approveSettings).toHaveBeenCalledWith(WORKSPACE.id)
  })

  // Closing without allowing leaves the notice standing, since nothing changed.
  it('keeps the notice when the review is closed unanswered', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: { approved: false, files: [{ path: '.claude/settings.json', contents: '{}' }] }
    })
    givenChats([chat()])
    render(<Pane />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByText(/pre-approve tools/)).toBeInTheDocument()
    expect(octopus().workspaces.approveSettings).not.toHaveBeenCalled()
  })

  // The approval failing must not put the notice away — nothing was recorded.
  it('keeps the notice when the approval could not be written', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: { approved: false, files: [{ path: '.claude/settings.json', contents: '{}' }] }
    })
    vi.mocked(octopus().workspaces.approveSettings).mockResolvedValue({
      ok: false,
      error: 'EACCES'
    })
    givenChats([chat()])
    render(<Pane />)

    await userEvent.click(await screen.findByRole('button', { name: 'Review' }))
    await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

    await waitFor(() => {
      expect(octopus().workspaces.approveSettings).toHaveBeenCalled()
    })
    // The strip's own words: the modal is still open and explains the same
    // mechanism in its own.
    expect(screen.getByText(/without anything from this repository/)).toBeInTheDocument()
  })

  // The read landing after the pane has gone belongs to nobody.
  it('drops an answer that arrives after it has gone', async () => {
    const gate: { land: (() => void) | null } = { land: null }
    vi.mocked(octopus().workspaces.trust).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.land = () => {
            resolve({ ok: true, value: { approved: false, files: [] } })
          }
        })
    )
    givenChats([chat()])
    const { unmount } = render(<Pane />)
    await waitFor(() => {
      expect(gate.land).not.toBeNull()
    })

    unmount()
    gate.land?.()

    expect(screen.queryByText(/pre-approve tools/)).toBeNull()
  })

  /*
   * The verdict belongs to the workspace it was asked about. Carried over, the
   * next workspace would show a warning about a repository it is not about —
   * for one frame at least, which is a frame of a false alarm.
   */
  it('does not carry the warning to the next workspace', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: { approved: false, files: [] }
    })
    givenChats([chat()])
    const { rerender } = render(<Pane />)
    await screen.findByText(/pre-approve tools/)

    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: { approved: true, files: [] }
    })
    rerender(<Pane workspace={workspaceView('bob')} />)

    expect(screen.queryByText(/pre-approve tools/)).toBeNull()
  })

  // A question that could not be answered is not evidence of anything.
  it('says nothing when the answer never came', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({ ok: false, error: 'EACCES' })
    givenChats([chat()])
    render(<Pane />)

    await waitFor(() => {
      expect(octopus().workspaces.trust).toHaveBeenCalled()
    })
    expect(screen.queryByText(/pre-approve tools/)).toBeNull()
  })
})
