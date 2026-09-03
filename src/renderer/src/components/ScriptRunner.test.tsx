import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalExit } from '@core/terminal.js'

import { octopus } from '../test/octopus.js'
import { sessionId, sessionsOpened, stubTerminalHost } from '../test/terminal.js'
import type { ResolvedScript } from '@core/repoSource.js'
import type { ScriptKind } from '@core/scripts.js'
import { workspaceView } from '../test/workspaces.js'
import { ScriptRunner } from './ScriptRunner.js'

const anna = workspaceView('anna', { port: 3111 })
const SETUP_PATH = '/tmp/scripts/planner/setup.sh'
const RUN_PATH = '/tmp/scripts/planner/run.sh'

/** One of the project's own scripts — a file, and never gated. */
function ownScript(kind: ScriptKind, path: string): ResolvedScript {
  return {
    kind,
    source: 'project',
    from: path,
    run: { type: 'file', path },
    contents: '#!/bin/sh\n'
  }
}

const SETUP_SCRIPT = ownScript('setup', SETUP_PATH)
const RUN_SCRIPT = ownScript('run', RUN_PATH)

/** Every listener hears every exit; a terminal keeps only its own. */
const listeners: ((exit: TerminalExit) => void)[] = []

function processExits(id: string): void {
  act(() => {
    for (const notify of listeners) notify({ id, exitCode: 0 })
  })
}

/**
 * Mounts a half and then asks it to run.
 *
 * Two steps, because the token is an edge now: a half that mounts with one
 * already standing deliberately does nothing.
 */
function mountAndStart(props: Omit<ComponentProps<typeof ScriptRunner>, 'startToken'>): {
  rerender: (next: Partial<ComponentProps<typeof ScriptRunner>>) => void
} {
  const { rerender } = render(<ScriptRunner {...props} startToken={0} />)
  rerender(<ScriptRunner {...props} startToken={1} />)

  return {
    rerender: (next) => {
      rerender(<ScriptRunner {...props} startToken={1} {...next} />)
    }
  }
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
        script={SETUP_SCRIPT}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
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
        script={null}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
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
        script={null}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
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
        script={SETUP_SCRIPT}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.getByText(SETUP_PATH)).toBeInTheDocument()
    expect(screen.getByText(/Runs setup.sh in this workspace/)).toBeInTheDocument()
    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  /*
   * Every control lives on the tab's header now.
   *
   * The two halves were four buttons in two places, two of them called the
   * same thing; a half's job is to show what is happening, and the pressing
   * belongs where the whole sequence is decided.
   */
  it('carries no controls of its own', () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        script={RUN_SCRIPT}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
        onOpenSettings={vi.fn()}
      />
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  /*
   * The token is a level, not an edge: it stays put after the run it asked for
   * has ended. `WorkspaceScripts` remounts every runner of a project when that
   * project is opened, so a half that started from zero re-ran its script with
   * nobody pressing anything — for every workspace, not only the one on screen.
   */
  /*
   * A port free when the workspace was made can belong to something else by the
   * time anybody runs it, and the old scheme handed it out anyway — the server
   * then failed as it bound, blaming itself.
   */
  it('serves on the port it was moved to, not the one on record', async () => {
    vi.mocked(octopus().workspaces.port).mockResolvedValue({ ok: true, value: 3220 })

    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ OCTOPUS_PORT: '3220' }) as unknown
      })
    )
    expect(await screen.findByText('OCTOPUS_PORT=3220')).toBeInTheDocument()
  })

  // The same window as the env write, one step later: a stop that lands while
  // the port is being settled asked for nothing to be running.
  it('abandons a start that was stopped while the port was being settled', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    vi.mocked(octopus().workspaces.port).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () => {
            resolve({ ok: true, value: 3220 })
          }
        })
    )

    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    await waitFor(() => {
      expect(gate.release).not.toBeNull()
    })

    rerender({ stopToken: 1 })
    await act(async () => {
      gate.release?.()
      await Promise.resolve()
    })

    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  // The build binds nothing, so there is nothing to settle for it.
  it('does not ask about a port for the build', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    expect(octopus().workspaces.port).not.toHaveBeenCalled()
  })

  it('says so and starts nothing when the port cannot be settled', async () => {
    vi.mocked(octopus().workspaces.port).mockResolvedValue({ ok: false, error: 'no workspace' })

    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    expect(await screen.findByText(/no workspace/)).toBeInTheDocument()
    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  it('runs nothing when it mounts with a token already standing', () => {
    render(
      <ScriptRunner
        workspace={anna}
        kind="run"
        script={RUN_SCRIPT}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
        onOpenSettings={vi.fn()}
        startToken={7}
      />
    )

    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  it('runs the script in the workspace directory when asked', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tmp/planner/anna', command: [SETUP_PATH] })
    )
  })

  /*
   * A worktree is a copy of the repository and not the repository: anything
   * gitignored is missing, and `../../` from a workspace is our own data
   * directory rather than the user's code. A script cannot work the way back
   * out for itself.
   */
  it('tells the script where the checkout is and what this workspace is called', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          OCTOPUS_ROOT_PATH: '/Users/test/planner',
          OCTOPUS_WORKSPACE_NAME: 'anna',
          OCTOPUS_WORKSPACE_SLUG: 'anna'
        }
      })
    )
  })

  it("runs a repository's command line as a line, with Conductor's names", async () => {
    /*
     * The two forms are opposites. A file is executed; a line goes to the shell
     * as written, or `$CONDUCTOR_PORT` would be part of a program's name. And
     * the workspace name it is given is the slug, so the database the build
     * script makes is the one the cleanup script drops.
     */
    mountAndStart({
      workspace: workspaceView('Fix login bug'),
      kind: 'run',
      script: {
        kind: 'run',
        source: 'repoConductor',
        from: '.conductor/settings.toml',
        run: { type: 'command', command: 'bin/rails server -p $CONDUCTOR_PORT' },
        contents: 'bin/rails server -p $CONDUCTOR_PORT'
      },
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'develop',
      onOpenSettings: vi.fn()
    })

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commandLine: 'bin/rails server -p $CONDUCTOR_PORT',
        env: expect.objectContaining({
          OCTOPUS_PORT: '3111',
          CONDUCTOR_PORT: '3111',
          CONDUCTOR_WORKSPACE_NAME: 'fix_login_bug',
          CONDUCTOR_DEFAULT_BRANCH: 'develop'
        }) as unknown
      })
    )
  })

  it('hands the server script the workspace port', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    await sessionsOpened(1)
    expect(octopus().terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        command: [RUN_PATH],
        env: expect.objectContaining({
          OCTOPUS_ROOT_PATH: '/Users/test/planner',
          OCTOPUS_WORKSPACE_NAME: 'anna',
          OCTOPUS_PORT: '3111',
          // Nine more come with it, for whatever else the stack listens on.
          OCTOPUS_PORT_1: '3112',
          OCTOPUS_PORT_9: '3120'
        }) as unknown
      })
    )
  })

  it('starts again when the token is bumped', async () => {
    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    rerender({ startToken: 2 })

    await sessionsOpened(2)
    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
  })

  // Unmounting the terminal is what ends the process — and its whole group,
  // since `TerminalManager` signals the group a session leads.
  it('ends the run when the stop token is bumped', async () => {
    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    rerender({ stopToken: 1 })

    await waitFor(() => {
      expect(octopus().terminal.dispose).toHaveBeenCalledWith(sessionId(1))
    })
    expect(screen.getByText(/Starts the dev server/)).toBeInTheDocument()
  })

  /*
   * Its terminal goes with it, so the build really is over — and the sequence
   * that was waiting for it to report has no other way of hearing.
   */
  it('says so when it goes while its process is still running', async () => {
    const onGone = vi.fn()
    const props = {
      workspace: anna,
      kind: 'setup' as const,
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn(),
      onGone
    }
    // The token is a level, so a runner mounted with one already standing does
    // not run: it has to be bumped after the mount.
    const { rerender, unmount } = render(<ScriptRunner {...props} startToken={0} />)
    rerender(<ScriptRunner {...props} startToken={1} />)
    await sessionsOpened(1)

    unmount()

    expect(onGone).toHaveBeenCalledTimes(1)
  })

  it('says nothing when it goes with nothing running', () => {
    const onGone = vi.fn()
    const { unmount } = render(
      <ScriptRunner
        workspace={anna}
        kind="setup"
        script={SETUP_SCRIPT}
        port={3111}
        rootPath="/Users/test/planner"
        defaultBranch="main"
        onOpenSettings={vi.fn()}
        onGone={onGone}
      />
    )

    unmount()

    expect(onGone).not.toHaveBeenCalled()
  })

  /*
   * `settlePort` answers "is anything listening here", and on a restart the
   * thing listening is us. Asked before the old session is torn down, it moved
   * the workspace to another block on every press — back and forth, taking the
   * whole `$OCTOPUS_PORT_1..9` block with it and pointing the open browser tab
   * at a port nothing binds.
   *
   * The existing restart tests could not see this: the stub answers with a
   * fixed port whatever is asked.
   */
  it('asks for a port only once its own server has gone', async () => {
    const order: string[] = []
    vi.mocked(octopus().terminal.dispose).mockImplementation(() => {
      order.push('dispose')
      return Promise.resolve()
    })
    vi.mocked(octopus().workspaces.port).mockImplementation(() => {
      order.push('port')
      return Promise.resolve({ ok: true, value: 3111 })
    })

    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    rerender({ startToken: 2 })
    await sessionsOpened(2)

    // The first start had nothing to tear down; the restart tore down first.
    expect(order).toEqual(['port', 'dispose', 'port'])
  })

  // The env block may name the port, so it must not be written before the
  // teardown either — it would hold the number this run is about to leave.
  it('writes the env only once its own server has gone', async () => {
    const order: string[] = []
    vi.mocked(octopus().terminal.dispose).mockImplementation(() => {
      order.push('dispose')
      return Promise.resolve()
    })
    vi.mocked(octopus().workspaces.prepare).mockImplementation(() => {
      order.push('prepare')
      return Promise.resolve({ ok: true, value: [] })
    })

    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    rerender({ startToken: 2 })
    await sessionsOpened(2)

    expect(order).toEqual(['prepare', 'dispose', 'prepare'])
  })

  /*
   * A restart is a disposal and a start, and a dev server does not release its
   * port the instant it is asked to. Opening the next session before the last
   * one has gone fails on the port and blames the new server for it.
   */
  it('opens the next session only once the last one has closed', async () => {
    let release: (() => void) | null = null
    vi.mocked(octopus().terminal.dispose).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve()
          }
        })
    )

    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    rerender({ startToken: 2 })

    await waitFor(() => {
      expect(release).not.toBeNull()
    })
    // The old one is going and the new one is not there yet.
    expect(octopus().terminal.create).toHaveBeenCalledTimes(1)

    await act(async () => {
      release?.()
      await Promise.resolve()
    })

    await sessionsOpened(2)
  })

  /*
   * A half keeps its terminal on screen after the process exits — that is what
   * `started` is for. Waiting behind one waits for ever: `Terminal` disposes
   * nothing when its session is already null, so the close it holds out for
   * never comes and the run sits at `Building…` with nothing running.
   */
  it('does not wait behind a run that has already ended', async () => {
    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)
    processExits(sessionId(1))

    // The terminal is still on screen, holding the output, but nothing is alive
    // in it — and `dispose` never resolves here, so a wait would hang.
    vi.mocked(octopus().terminal.dispose).mockImplementation(() => new Promise(() => undefined))

    rerender({ startToken: 2 })

    await sessionsOpened(2)
  })

  // Nothing to wait for, so nothing waits: a first start must not be held up by
  // a session that was never there.
  it('does not wait when there is nothing running yet', async () => {
    vi.mocked(octopus().terminal.dispose).mockImplementation(() => new Promise(() => undefined))

    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    await sessionsOpened(1)
  })

  // The press that arrived after the restart asked for nothing to be running.
  it('abandons a pending restart when a stop arrives', async () => {
    let release: (() => void) | null = null
    vi.mocked(octopus().terminal.dispose).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve()
          }
        })
    )

    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    rerender({ startToken: 2 })
    await waitFor(() => {
      expect(release).not.toBeNull()
    })

    rerender({ startToken: 2, stopToken: 1 })
    await act(async () => {
      release?.()
      await Promise.resolve()
    })

    expect(octopus().terminal.create).toHaveBeenCalledTimes(1)
  })

  // A build has already exited by the time a server can be stopped, so the stop
  // reaches it as a bystander — and unmounting its terminal would throw away
  // the log somebody is reading, which is the one thing `started` exists for.
  it('keeps a finished run on screen when the stop reaches it', async () => {
    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)
    processExits(sessionId(1))

    rerender({ stopToken: 1 })

    expect(screen.queryByText(/Runs setup.sh in this workspace/)).not.toBeInTheDocument()
  })

  // The window is one `env:apply` round trip. Starting after a stop that landed
  // inside it leaves a server running with the header back on Run and no
  // control anywhere that could reach it.
  it('abandons a start that was stopped while the env was being written', async () => {
    let release: (() => void) | null = null
    vi.mocked(octopus().workspaces.prepare).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ ok: true, value: [] })
          }
        })
    )

    const { rerender } = mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })

    await waitFor(() => {
      expect(release).not.toBeNull()
    })

    rerender({ stopToken: 1 })
    await act(async () => {
      release?.()
      await Promise.resolve()
    })

    expect(octopus().terminal.create).not.toHaveBeenCalled()
  })

  // The output is why anyone is looking, and it has to survive the process
  // that produced it.
  it('keeps the output after the process ends on its own', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    processExits(sessionId(1))

    expect(screen.queryByText(/Runs setup.sh in this workspace/)).not.toBeInTheDocument()
  })

  // Beside a half that is going, so the header's own words stay free to say
  // what pressing something would do rather than what is already happening.
  it('says so while its script is running, and stops saying so when it ends', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    expect(await screen.findByText('running…')).toBeInTheDocument()

    processExits(sessionId(1))

    expect(screen.queryByText('running…')).not.toBeInTheDocument()
  })

  it('reports how the run ended to whatever sequenced it', async () => {
    const onOutcome = vi.fn()
    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn(),
      onOutcome
    })
    await sessionsOpened(1)

    processExits(sessionId(1))

    expect(onOutcome).toHaveBeenCalledWith(true)
  })

  /*
   * The env goes in before either script, not only when the workspace was made.
   *
   * A project that gained its env afterwards would otherwise run against
   * nothing until the workspace was recreated, and the server is as likely to
   * be the first thing started as the build.
   */
  it('puts the project env in place before running', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    expect(octopus().workspaces.prepare).toHaveBeenCalledWith(anna.id)
  })

  /*
   * The order, not just the fact. The env block may name the port, and it is
   * written with whatever the workspace holds at that moment — so preparing
   * first would bake in the number this very run is about to move away from.
   */
  it('settles the port before writing the env, not after', async () => {
    const order: string[] = []
    vi.mocked(octopus().workspaces.port).mockImplementation(() => {
      order.push('port')
      return Promise.resolve({ ok: true, value: 3220 })
    })
    vi.mocked(octopus().workspaces.prepare).mockImplementation(() => {
      order.push('prepare')
      return Promise.resolve({ ok: true, value: [] })
    })

    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    expect(order).toEqual(['port', 'prepare'])
  })

  it('puts it in place before the server too', async () => {
    mountAndStart({
      workspace: anna,
      kind: 'run',
      script: RUN_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn()
    })
    await sessionsOpened(1)

    expect(octopus().workspaces.prepare).toHaveBeenCalledWith(anna.id)
  })

  // Starting anyway would fail further in, complaining about whatever the
  // missing value fed rather than about the env.
  it('says so and starts nothing when the env cannot be written', async () => {
    vi.mocked(octopus().workspaces.prepare).mockResolvedValue({
      ok: false,
      error: 'Permission denied.'
    })
    const onOutcome = vi.fn()

    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn(),
      onOutcome
    })

    expect(await screen.findByText(/Permission denied/)).toBeInTheDocument()
    expect(octopus().terminal.create).not.toHaveBeenCalled()
    // A sequence waiting on this half would otherwise wait for ever.
    expect(onOutcome).toHaveBeenCalledWith(false)
  })

  /*
   * The third door, and the one that stranded the workspace.
   *
   * `prepare` succeeds and the run begins, so `begin()` has set this half
   * running — and then the session never starts. `onExit` is the only route to
   * `onOutcome` and it can never fire for a process that does not exist, so the
   * half reported busy for ever: Run disabled, no Stop drawn, and nothing to
   * press but leaving the project or restarting the app.
   */
  it('reports the half finished when its session never starts', async () => {
    vi.mocked(octopus().terminal.create).mockResolvedValue({
      ok: false,
      error: 'spawn /bin/zsh ENOENT'
    })
    const onOutcome = vi.fn()

    mountAndStart({
      workspace: anna,
      kind: 'setup',
      script: SETUP_SCRIPT,
      port: 3111,
      rootPath: '/Users/test/planner',
      defaultBranch: 'main',
      onOpenSettings: vi.fn(),
      onOutcome
    })

    await waitFor(() => {
      expect(onOutcome).toHaveBeenCalledWith(false)
    })
    // Drawn in the header, outside the terminal — the build half is folded on
    // every mount, so the red text on the canvas is the sign nobody sees.
    expect(await screen.findByText(/spawn \/bin\/zsh ENOENT/)).toBeInTheDocument()
  })
})
