import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalExit } from '@core/terminal.js'

import { octopus } from '../test/octopus.js'
import { sessionId, sessionsOpened, stubTerminalHost } from '../test/terminal.js'
import { workspaceView } from '../test/workspaces.js'
import { ScriptRunner } from './ScriptRunner.js'

const anna = workspaceView('anna', { port: 3111 })
const SETUP_SCRIPT = '/tmp/scripts/planner/setup.sh'
const RUN_SCRIPT = '/tmp/scripts/planner/run.sh'

/** Every listener hears every exit; a terminal keeps only its own. */
const listeners: ((exit: TerminalExit) => void)[] = []

function processExits(id: string): void {
  act(() => {
    for (const notify of listeners) notify({ id, exitCode: 0 })
  })
}

describe('ScriptRunner', () => {
  beforeEach(() => {
    stubTerminalHost()
    listeners.length = 0
    vi.mocked(octopus().terminal.onExit).mockImplementation((handler) => {
      listeners.push(handler)
      return vi.fn()
    })
  })

  it('asks for a workspace to run in when none is selected', () => {
    render(
      <ScriptRunner
        workspace={null}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.getByText(/Select a workspace to run this in/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers to write the build script when the project has none', async () => {
    const onOpenSettings = vi.fn()
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={null}
        port={3111}
        onOpenSettings={onOpenSettings}
      />
    )

    expect(screen.getByText(/No build script yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Write the script' }))

    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('offers to write the server script when the project has none', () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        scriptPath={null}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.getByText(/No server script yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write the script' })).toBeInTheDocument()
  })

  // Both scripts have consequences worth choosing — one installs, the other
  // takes a port — so opening the tab must not start anything.
  it('waits to be told to run', () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.getByText(SETUP_SCRIPT)).toBeInTheDocument()
    expect(screen.getByText(/Runs setup.sh in this workspace/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  it('runs the script in the workspace directory', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Run' }))

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/planner/anna',
        command: [SETUP_SCRIPT],
        env: {}
      })
    )
  })

  // Several workspaces serve at once, so each one needs a port of its own.
  it('hands the server script the workspace port', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        scriptPath={RUN_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.getByText('OCTOPUS_PORT=3111')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ env: { OCTOPUS_PORT: '3111' } })
    )
  })

  it('kills the process when stopped', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        scriptPath={RUN_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(screen.getByText(/Starts the dev server for this workspace/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  // The output is why anyone is looking at this tab; a script that finished
  // must not take its own log off the screen.
  it('keeps the output after the process ends on its own', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)

    processExits(sessionId(1))

    expect(screen.getByRole('button', { name: 'Run again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Runs setup.sh in this workspace/)).not.toBeInTheDocument()
    expect(octopus().terminal.dispose).not.toHaveBeenCalled()
  })

  it('starts a new session when restarted', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        scriptPath={RUN_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await sessionsOpened(1)

    await userEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await sessionsOpened(2)
    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(octopus().terminal.dispose).not.toHaveBeenCalledWith(sessionId(2))
  })
})
