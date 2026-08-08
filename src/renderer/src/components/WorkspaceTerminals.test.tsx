import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { octopus } from '../test/octopus.js'
import { openedDirectories, sessionId, sessionsOpened, stubTerminalHost } from '../test/terminal.js'
import { workspaceView } from '../test/workspaces.js'
import { WorkspaceTerminals } from './WorkspaceTerminals.js'

const anna = workspaceView('anna')
const bob = workspaceView('bob')

describe('WorkspaceTerminals', () => {
  beforeEach(() => {
    stubTerminalHost()
  })

  it('asks for a workspace when none is open', () => {
    render(<WorkspaceTerminals workspaces={[anna]} activeId={null} />)

    expect(screen.getByText(/Select a workspace to open a terminal/)).toBeInTheDocument()
    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  it('opens a terminal in the active workspace directory', async () => {
    render(<WorkspaceTerminals workspaces={[anna, bob]} activeId={anna.id} />)

    await sessionsOpened(1)
    expect(openedDirectories()).toEqual(['/tmp/planner/anna'])
  })

  it('gives each workspace a terminal of its own', async () => {
    const { rerender } = render(<WorkspaceTerminals workspaces={[anna, bob]} activeId={anna.id} />)
    await sessionsOpened(1)

    rerender(<WorkspaceTerminals workspaces={[anna, bob]} activeId={bob.id} />)

    await sessionsOpened(2)
    expect(openedDirectories()).toEqual(['/tmp/planner/anna', '/tmp/planner/bob'])
  })

  // The point of keeping every terminal mounted: a dev server or a half-typed
  // command survives a trip to another workspace and back.
  it('leaves the terminal of a workspace running while another one is on screen', async () => {
    const { rerender } = render(<WorkspaceTerminals workspaces={[anna, bob]} activeId={anna.id} />)
    await sessionsOpened(1)

    rerender(<WorkspaceTerminals workspaces={[anna, bob]} activeId={bob.id} />)
    await sessionsOpened(2)

    expect(octopus().terminal.dispose).not.toHaveBeenCalled()
  })

  it('does not open a second terminal when a workspace is revisited', async () => {
    const { rerender } = render(<WorkspaceTerminals workspaces={[anna, bob]} activeId={anna.id} />)
    await sessionsOpened(1)

    rerender(<WorkspaceTerminals workspaces={[anna, bob]} activeId={bob.id} />)
    await sessionsOpened(2)

    rerender(<WorkspaceTerminals workspaces={[anna, bob]} activeId={anna.id} />)

    expect(openedDirectories()).toEqual(['/tmp/planner/anna', '/tmp/planner/bob'])
  })

  it('closes the terminal of a workspace that has been removed', async () => {
    const { rerender } = render(<WorkspaceTerminals workspaces={[anna, bob]} activeId={anna.id} />)
    await sessionsOpened(1)

    rerender(<WorkspaceTerminals workspaces={[anna, bob]} activeId={bob.id} />)
    await sessionsOpened(2)

    rerender(<WorkspaceTerminals workspaces={[bob]} activeId={bob.id} />)

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(octopus().terminal.dispose).not.toHaveBeenCalledWith(sessionId(2))
  })

  // The worktree was deleted outside the app, so the shell has no directory
  // left to sit in.
  it('closes the terminal of a workspace whose directory is gone', async () => {
    const { rerender } = render(<WorkspaceTerminals workspaces={[anna]} activeId={anna.id} />)
    await sessionsOpened(1)

    rerender(
      <WorkspaceTerminals
        workspaces={[workspaceView('anna', { missing: true })]}
        activeId={anna.id}
      />
    )

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
  })
})
