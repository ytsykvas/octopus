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
    expect(screen.getByRole('button', { name: 'Build' })).toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await sessionsOpened(1)

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(screen.getByText(/Starts the dev server for this workspace/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Build' }))
    await sessionsOpened(1)

    processExits(sessionId(1))

    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Runs setup.sh in this workspace/)).not.toBeInTheDocument()
    expect(octopus().terminal.dispose).not.toHaveBeenCalled()
  })

  /*
   * A build offers no Stop, which is the whole of what makes the two halves
   * different rather than one component wearing two labels. A server is started
   * and stopped for as long as the work lasts; a build is run, read, and run
   * again — and stopping one half way is not what anybody reaches for.
   */
  it('offers a build no way to stop, only to run it again', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Build' }))
    await sessionsOpened(1)

    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeInTheDocument()
  })

  /*
   * Which leaves rebuilding as the way a run ends, so it has to actually end
   * one: the old session is disposed and a new one opened, the same thing the
   * server's Restart does.
   */
  it('ends the running build when it is rebuilt', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Build' }))
    await sessionsOpened(1)

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild' }))

    await sessionsOpened(2)
    expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
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
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await sessionsOpened(1)

    await userEvent.click(screen.getByRole('button', { name: 'Restart' }))

    await sessionsOpened(2)
    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(octopus().terminal.dispose).not.toHaveBeenCalledWith(sessionId(2))
  })
  /*
   * The env goes in before the build, not only when the workspace was made.
   *
   * A project that gained its env afterwards would otherwise build against
   * nothing until the workspace was recreated — and the core never overwrites,
   * so a `.env` edited inside the worktree survives this.
   */
  it('puts the project env in place before building', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))
    await sessionsOpened(1)

    expect(octopus().workspaces.applyEnv).toHaveBeenCalledWith(anna.id)
  })

  // Nothing makes a build come first: the server is as likely to be the first
  // thing started, and a dev server is what reads the env in the first place.
  it('puts the project env in place before starting the server too', async () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        scriptPath={RUN_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await sessionsOpened(1)

    expect(octopus().workspaces.applyEnv).toHaveBeenCalledWith(anna.id)
  })

  // Starting anyway would fail further in, complaining about whatever the
  // missing value fed rather than about the env.
  it('says so and does not build when the env cannot be written', async () => {
    vi.mocked(octopus().workspaces.applyEnv).mockResolvedValue({
      ok: false,
      error: 'Permission denied.'
    })

    render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        scriptPath={SETUP_SCRIPT}
        port={3111}
        onOpenSettings={vi.fn()}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: 'Build' }))

    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument()
    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })
})
