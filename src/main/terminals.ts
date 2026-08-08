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
export class TerminalManager {
  private readonly sessions = new Map<TerminalId, IPty>()
  private nextId = 1

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

  dispose(id: TerminalId): void {
    const pty = this.sessions.get(id)
    if (!pty) return

    this.sessions.delete(id)
    pty.kill()
  }

  /** Kills every session — called when the application quits. */
  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.dispose(id)
  }

  get size(): number {
    return this.sessions.size
  }
}
