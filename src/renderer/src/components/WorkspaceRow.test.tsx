import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { WorkspaceView } from '@core/workspaces.js'

import { WorkspaceRow } from './WorkspaceRow.js'

function workspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'planner/anna',
    projectId: 'planner',
    name: 'anna',
    branch: 'ytsykvas/anna',
    path: '/tmp/planner/anna',
    status: 'idle',
    port: 3100,
    createdAt: '2026-08-08T00:00:00.000Z',
    ownerId: null,
    envProfile: null,
    chats: [],
    changedFiles: 0,
    ahead: 0,
    missing: false,
    ...overrides
  }
}

type WorkspaceRowProps = React.ComponentProps<typeof WorkspaceRow>

function renderRow(overrides: Partial<WorkspaceRowProps> = {}): WorkspaceRowProps {
  const props: WorkspaceRowProps = {
    workspace: workspace(),
    request: null,
    selected: false,
    editing: false,
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onEditingChange: vi.fn(),
    onRemove: vi.fn(),
    ...overrides
  }

  render(<WorkspaceRow {...props} />)
  return props
}

describe('WorkspaceRow', () => {
  it('names the workspace', () => {
    renderRow({ workspace: workspace({ name: 'anna' }) })

    expect(screen.getByText('anna')).toBeInTheDocument()
  })

  // The row that is open is drawn as a lifted surface with a coloured mark down
  // its edge, and neither reaches a screen reader.
  it('announces the workspace that is open', () => {
    renderRow({ workspace: workspace({ name: 'anna' }), selected: true })

    expect(screen.getByRole('button', { current: true })).toHaveTextContent('anna')
  })

  it('marks nothing as current while the row is not the open one', () => {
    renderRow({ selected: false })

    expect(screen.queryByRole('button', { current: true })).toBeNull()
  })

  it('shows the branch on hover', () => {
    renderRow({ workspace: workspace({ branch: 'ytsykvas/anna' }) })

    expect(screen.getByTitle('ytsykvas/anna')).toBeInTheDocument()
  })

  it('counts the uncommitted files', () => {
    renderRow({ workspace: workspace({ changedFiles: 3 }) })

    expect(screen.getByText('3 files')).toBeInTheDocument()
  })

  it('counts a single file in the singular', () => {
    renderRow({ workspace: workspace({ changedFiles: 1 }) })

    expect(screen.getByText('1 file')).toBeInTheDocument()
  })

  // A clean workspace says nothing rather than "0 files": the count is there to
  // draw the eye, and a row of zeroes would stop it doing that.
  it('says nothing about changes when the workspace is clean', () => {
    renderRow({ workspace: workspace({ name: 'anna', changedFiles: 0 }) })

    expect(screen.getByText('anna')).toBeInTheDocument()
    expect(screen.queryByText(/files?$/)).not.toBeInTheDocument()
  })

  /*
   * The whole point of a list of workspaces is that several are working at
   * once. Until the row read `status`, the only way to find out that another
   * one was busy — or stopped, waiting on an answer — was to open it.
   */
  it('says when the agent is working in a workspace that is not open', () => {
    renderRow({ workspace: workspace({ status: 'running' }) })

    expect(screen.getByLabelText('The agent is working here')).toBeInTheDocument()
  })

  // The one state worth crossing the window for: the turn has stopped, and it
  // stopped on a question only the user can answer.
  it('says when a workspace is waiting on an answer', () => {
    renderRow({ workspace: workspace({ status: 'waiting_permission' }) })

    expect(screen.getByLabelText('Waiting for your answer')).toBeInTheDocument()
  })

  it('says when the last turn there ended badly', () => {
    renderRow({ workspace: workspace({ status: 'error' }) })

    expect(screen.getByLabelText('The last turn ended in an error')).toBeInTheDocument()
  })

  // One mark, not two: idle with changes is the ordinary case, and the agent's
  // state only takes the dot while there is something to report.
  it('says nothing about an agent that is doing nothing', () => {
    renderRow({ workspace: workspace({ status: 'idle', changedFiles: 2 }) })

    expect(screen.queryByLabelText(/agent|waiting|error/i)).not.toBeInTheDocument()
    expect(screen.getByText('2 files')).toBeInTheDocument()
  })

  /*
   * The one thing a single summarising dot cannot say: two agents at work while
   * a third waits for an answer summarises to "waiting", and the row would be
   * hiding the two that are still going.
   */
  it('draws a dot per conversation once a workspace holds several', () => {
    renderRow({
      workspace: workspace({
        status: 'waiting_permission',
        chats: [
          {
            id: 'chat-1',
            agent: 'claude' as const,
            title: null,
            status: 'running' as const,
            started: true
          },
          {
            id: 'chat-2',
            agent: 'claude' as const,
            title: null,
            status: 'waiting_permission' as const,
            started: true
          },
          {
            id: 'chat-3',
            agent: 'claude' as const,
            title: null,
            status: 'idle' as const,
            started: true
          }
        ]
      })
    })

    expect(screen.getByLabelText('Claude 1: The agent is working here')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude 2: Waiting for your answer')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude 3: finished')).toBeInTheDocument()
  })

  /*
   * The two quiet states, which are the ones a glance down the list is usually
   * telling apart: a conversation that ran and finished, against one nobody has
   * written in. Both are `idle`, so the status alone cannot say which — and
   * drawn the same they made a finished workspace look untouched.
   */
  it('tells a conversation that has run from one nobody has written in', () => {
    renderRow({
      workspace: workspace({
        status: 'idle',
        chats: [
          { id: 'chat-1', agent: 'claude' as const, title: null, status: 'idle', started: true },
          { id: 'chat-2', agent: 'claude' as const, title: null, status: 'idle', started: false }
        ]
      })
    })

    expect(screen.getByLabelText('Claude 1: finished')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude 2: nothing written yet')).toBeInTheDocument()
  })

  // Whether it ever started says nothing about a turn that is under way, or one
  // waiting on an answer, or one that ended badly. Those speak for themselves.
  it('leaves a conversation with something to report saying it', () => {
    renderRow({
      workspace: workspace({
        status: 'error',
        chats: [
          { id: 'chat-1', agent: 'claude' as const, title: null, status: 'error', started: true },
          { id: 'chat-2', agent: 'claude' as const, title: null, status: 'running', started: false }
        ]
      })
    })

    expect(screen.getByLabelText('Claude 1: The last turn ended in an error')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude 2: The agent is working here')).toBeInTheDocument()
  })

  it('says when one of several conversations ended badly', () => {
    renderRow({
      workspace: workspace({
        status: 'error',
        chats: [
          {
            id: 'chat-1',
            agent: 'claude' as const,
            title: null,
            status: 'error' as const,
            started: true
          },
          {
            id: 'chat-2',
            agent: 'claude' as const,
            title: null,
            status: 'idle' as const,
            started: true
          }
        ]
      })
    })

    expect(screen.getByLabelText('Claude 1: The last turn ended in an error')).toBeInTheDocument()
  })

  // One conversation is the ordinary case, and the row reads as it always has.
  it('keeps the single mark for a workspace with one conversation', () => {
    renderRow({
      workspace: workspace({
        status: 'running',
        chats: [
          {
            id: 'chat-1',
            agent: 'claude' as const,
            title: null,
            status: 'running' as const,
            started: true
          }
        ]
      })
    })

    expect(screen.getByLabelText('The agent is working here')).toBeInTheDocument()
  })

  it('marks a workspace whose directory has gone', () => {
    renderRow({ workspace: workspace({ missing: true }) })

    expect(screen.getByText('Directory is gone')).toBeInTheDocument()
  })

  // Removed outside the app, so the hint explains that removing the entry is
  // safe rather than leaving the branch looking like the culprit.
  it('explains the missing directory on hover instead of showing the branch', () => {
    renderRow({ workspace: workspace({ missing: true, branch: 'ytsykvas/anna' }) })

    expect(
      screen.getByTitle('Removed outside the app. Removing the entry is safe.')
    ).toBeInTheDocument()
    expect(screen.queryByTitle('ytsykvas/anna')).not.toBeInTheDocument()
  })

  // The directory is gone, so any earlier count is stale — the marker replaces
  // it rather than sitting beside it.
  it('drops the change count for a missing workspace', () => {
    renderRow({ workspace: workspace({ missing: true, changedFiles: 4 }) })

    expect(screen.getByText('Directory is gone')).toBeInTheDocument()
    expect(screen.queryByText('4 files')).not.toBeInTheDocument()
  })

  it('selects the workspace when its name is clicked', async () => {
    const user = userEvent.setup()
    const props = renderRow()

    await user.click(screen.getByText('anna'))

    expect(props.onSelect).toHaveBeenCalledTimes(1)
  })

  it('starts a rename on a double click', async () => {
    const user = userEvent.setup()
    const props = renderRow()

    await user.dblClick(screen.getByText('anna'))

    expect(props.onEditingChange).toHaveBeenCalledWith(true)
  })

  it('starts a rename from the row menu', async () => {
    const user = userEvent.setup()
    const props = renderRow()

    await user.click(screen.getByTitle('More'))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    expect(props.onEditingChange).toHaveBeenCalledWith(true)
  })

  it('removes the workspace from the row menu', async () => {
    const user = userEvent.setup()
    const props = renderRow()

    await user.click(screen.getByTitle('More'))
    await user.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))

    expect(props.onRemove).toHaveBeenCalledTimes(1)
  })

  it('offers the current name for editing while a rename is in progress', () => {
    renderRow({ workspace: workspace({ name: 'anna' }), editing: true })

    expect(screen.getByTitle('Enter to save, Escape to cancel')).toHaveValue('anna')
  })

  it('saves the new name on Enter', async () => {
    const user = userEvent.setup()
    const props = renderRow({ editing: true })

    await user.clear(screen.getByTitle('Enter to save, Escape to cancel'))
    await user.type(screen.getByTitle('Enter to save, Escape to cancel'), 'bella{Enter}')

    expect(props.onRename).toHaveBeenCalledWith('bella')
    expect(props.onEditingChange).toHaveBeenCalledWith(false)
  })

  // Clicking away is a common way to mean "done"; losing the edit there would
  // be surprising.
  it('saves the new name when the field loses focus', async () => {
    const user = userEvent.setup()
    const props = renderRow({ editing: true })

    await user.clear(screen.getByTitle('Enter to save, Escape to cancel'))
    await user.type(screen.getByTitle('Enter to save, Escape to cancel'), 'bella')
    await user.tab()

    expect(props.onRename).toHaveBeenCalledWith('bella')
  })

  it('keeps the old name when the rename is cancelled with Escape', async () => {
    const user = userEvent.setup()
    const props = renderRow({ editing: true })

    await user.clear(screen.getByTitle('Enter to save, Escape to cancel'))
    await user.type(screen.getByTitle('Enter to save, Escape to cancel'), 'bella{Escape}')

    expect(props.onRename).not.toHaveBeenCalled()
    expect(props.onEditingChange).toHaveBeenCalledWith(false)
  })

  // An empty name is clearly a mistake mid-typing, not a request.
  it('treats an emptied field as a cancelled rename', async () => {
    const user = userEvent.setup()
    const props = renderRow({ editing: true })

    await user.clear(screen.getByTitle('Enter to save, Escape to cancel'))
    await user.type(screen.getByTitle('Enter to save, Escape to cancel'), '{Enter}')

    expect(props.onRename).not.toHaveBeenCalled()
    expect(props.onEditingChange).toHaveBeenCalledWith(false)
  })

  // Renaming a workspace moves a worktree and a branch; doing that for a name
  // that did not change would be work with nothing to show for it.
  it('does not rename when the name comes back unchanged', async () => {
    const user = userEvent.setup()
    const props = renderRow({ workspace: workspace({ name: 'anna' }), editing: true })

    await user.type(screen.getByTitle('Enter to save, Escape to cancel'), '{Enter}')

    expect(props.onRename).not.toHaveBeenCalled()
    expect(props.onEditingChange).toHaveBeenCalledWith(false)
  })
})
