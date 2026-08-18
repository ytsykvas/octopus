import type { WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'

import { homedir } from 'node:os'

import {
  buildTerminalArgv,
  buildTerminalEnv,
  resolveCwd,
  resolveShell,
  type TerminalId,
  type TerminalSpec
} from '../core/terminal.js'

/**
 * Live pseudo-terminal sessions.
 *
 * PTYs are process resources bound to a window, which is why they live in
 * `main/` rather than the core — the same reasoning that keeps dialogs and
 * windows here. The pure decisions (shell, argv, environment) come from
 * `core/terminal.ts`.
 *
 * Every session must be disposed of: an orphaned PTY keeps a shell process
 * alive after its window is gone.
 */

/**
 * How long a session has to end on its own before it is hung up on.
 *
 * Long enough for a dev server to run its SIGTERM handler — closing sockets,
 * removing its pid file — and short enough that a process which ignores the
 * signal does not sit there holding a port.
 */
const GRACE_MS = 2_000

/** How a signal reaches a process, injected so tests never send a real one. */
export type Kill = (pid: number, signal: NodeJS.Signals) => void

export class TerminalManager {
  private readonly sessions = new Map<TerminalId, IPty>()
  private nextId = 1

  /**
   * `process.kill` by default, replaced in tests.
   *
   * Bound, because it reads `process` through `this` and a bare reference to
   * the method loses it.
   */
  constructor(private readonly kill: Kill = process.kill.bind(process)) {}

  /** Starts a session and streams its output to the given renderer. */
  create(spec: TerminalSpec, target: WebContents): TerminalId {
    const id = `term-${String(this.nextId++)}`
    const shell = resolveShell()

    const pty = spawn(shell, [...buildTerminalArgv(spec)], {
      name: 'xterm-256color',
      cwd: resolveCwd(spec.cwd, homedir()),
      env: buildTerminalEnv(process.env, spec.env),
      cols: spec.cols,
      rows: spec.rows
    })

    pty.onData((data) => {
      // The window can close while the shell is still writing.
      if (!target.isDestroyed()) target.send('terminal:data', { id, data })
    })

    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      if (target.isDestroyed()) return

      // The typings say `signal?: number`, but a normal exit reports 0 rather
      // than undefined — checking for undefined reported every run as killed.
      // Signal numbers start at 1, so falsy means "no signal".
      target.send('terminal:exit', { id, exitCode: signal ? null : exitCode })
    })

    // Closing a window destroys its WebContents without unmounting React, so
    // the cleanup in `Terminal.tsx` never runs and never asks for disposal.
    // On macOS the application outlives its last window, so without this the
    // shell — and anything it started, a dev server included — keeps running
    // with nothing left to talk to.
    target.once('destroyed', () => {
      this.dispose(id)
    })

    this.sessions.set(id, pty)
    return id
  }

  write(id: TerminalId, data: string): void {
    this.sessions.get(id)?.write(data)
  }

  resize(id: TerminalId, cols: number, rows: number): void {
    // A resize arriving after the session ended is normal, not an error.
    this.sessions.get(id)?.resize(cols, rows)
  }

  /**
   * Ends a session, and everything it started with it.
   *
   * `pty.kill()` alone reaches the shell and nothing below it. A dev server is
   * a grandchild — the shell runs `run.sh`, which runs the server — so killing
   * the shell only re-parents the server to init, where it keeps its port and
   * its pid file and refuses the next start as "already running". That is what
   * a rebuild used to hit.
   *
   * The negative pid is the process group. node-pty gives each session its own
   * through `setsid`, so this reaches the whole tree and nothing outside it,
   * and the group outlives its leader for as long as a member is still there.
   *
   * SIGTERM rather than the SIGHUP a closing terminal sends: to a server a
   * hangup often means "reopen your logs" and it carries on — Puma reads it
   * that way — while SIGTERM is the shutdown it cleans up after, pid file
   * included.
   *
   * `pty.kill()` is the fallback for a process that ignores SIGTERM, and it
   * waits. node-pty's kill sends SIGHUP, and where a run script `exec`s into
   * its server that server *is* this pid: fired in the same tick, the hangup
   * arrives first, kills it outright, and the SIGTERM handler never runs — so
   * the pid file it would have removed survives, which is the "a server is
   * already running" this whole thing set out to end.
   */
  dispose(id: TerminalId): void {
    const pty = this.sessions.get(id)
    if (!pty) return

    this.sessions.delete(id)

    try {
      this.kill(-pty.pid, 'SIGTERM')
    } catch {
      // The group ended between being read and being signalled, which is the
      // ordinary case for a script that has just finished.
    }

    const fallback = setTimeout(() => {
      pty.kill()
    }, GRACE_MS)

    // Cleared on the way out, so a session that shut down politely is never
    // signalled again — and so the timer does not hold the process open.
    pty.onExit(() => {
      clearTimeout(fallback)
    })
  }

  /** Kills every session — called when the application quits. */
  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id)
  }

  get size(): number {
    return this.sessions.size
  }
}
