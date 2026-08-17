import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { useChatTabs } from '../../hooks/useChatTabs.js'
import { chat, emitAgentEvent, givenChats } from '../../test/chat.js'
import { commentController } from '../../test/comments.js'
import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { workspaceView } from '../../test/workspaces.js'
import { Chat } from './Chat.js'

// The plan's approval is a dialog, and jsdom implements none of `<dialog>`.
beforeAll(stubDialogElement)

const WORKSPACE = workspaceView('anna')

/** The pane as `App` assembles it, tab strip and all. */
function Pane(): React.JSX.Element {
  const tabs = useChatTabs(
    WORKSPACE.id,
    () => Promise.resolve({ confirmed: true, checked: false }),
    vi.fn(),
    vi.fn()
  )

  return (
    <Chat
      workspace={WORKSPACE}
      tabs={tabs}
      draftOf={() => ''}
      onDraftLeave={vi.fn()}
      comments={commentController()}
      color="blue"
      defaultWorkingMode="default"
      defaultEffort="medium"
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
    expect(screen.getByText('still working on it')).toBeInTheDocument()

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
