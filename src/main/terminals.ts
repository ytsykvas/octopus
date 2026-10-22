import type { WebContents } from 'electron'
import { spawn, type IPty } from 'node-pty'

import { homedir } from 'node:os'

import {
  appendTail,
  isRunPurpose,
  RUN_PURPOSES,
  withRun,
  type RecordedRun,
  type RunOutcome,
  type RunPurpose,
  type WorkspaceRuns
} from '../core/runLog.js'
import {
  buildTerminalArgv,
  buildTerminalEnv,
  resolveCwd,
  resolveShell,
  type TerminalId,
  type TerminalOwner,
  type TerminalPurpose,
  type TerminalSession,
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
 * How long a session has to end on its own before its shell is hung up on.
 *
 * Long enough for a dev server to run its SIGTERM handler — closing sockets,
 * removing its pid file — and short enough that a process which ignores the
 * signal does not sit there holding a port.
 */
const GRACE_MS = 2_000

/**
 * How long after the hangup the whole group is killed.
 *
 * The hangup is what an interactive shell answers by hanging up its own jobs,
 * and job control has put each of those in a group of its own, out of reach of
 * a signal to the shell's. Killed in the same tick, the shell would die before
 * passing it on: a tab closed with `npm run dev &` in it left the server
 * running.
 */
const HANGUP_MS = 500

/** How often a group the shell has left is asked whether it is empty yet. */
const POLL_MS = 50

/**
 * How long past the kill a stop still waits for the group to empty.
 *
 * SIGKILL cannot be ignored, but a process stuck in the kernel dies only when
 * it comes out — and a restart held on it for ever is worse than a port that
 * frees itself a moment late.
 */
const KILL_WAIT_MS = 1_000

/**
 * How long output is gathered before it is sent, after the first chunk.
 *
 * node-pty reads about a kilobyte at a time, and each read used to be a
 * message of its own: a build printing fast was 30 000 messages a second,
 * which held this process and the window at a full core each before anything
 * had been drawn. Gathered over 16 ms that is under a hundred.
 */
export const BATCH_MS = 16

/**
 * How much may be gathered before it is sent without waiting for the window.
 *
 * Characters rather than bytes, which is close enough for a limit whose job
 * is only to keep a single message from growing without bound.
 */
export const BATCH_CHARS = 64 * 1024

/**
 * How a signal reaches a process, injected so tests never send a real one.
 *
 * Signal 0 sends nothing: it throws when no such process — or, for a negative
 * pid, no such group — exists, which is how a stop knows a group has emptied.
 */
export type Kill = (pid: number, signal: NodeJS.Signals | 0) => void

/** A live session, and the window it belongs to. */
interface Session {
  readonly pty: IPty
  readonly target: WebContents
  /** Whose it is, kept because `main` cannot work it out from a spec. */
  readonly owner: TerminalOwner
  /** A tab's shell, started with no command — `buildTerminalArgv`'s own test. */
  readonly bareShell: boolean
}

/**
 * The most recent build or server of one workspace, as it streamed.
 *
 * Mutable and local to `main`: it is written on every chunk, and a copy per
 * chunk would be 30 000 objects a second for a build that prints fast.
 */
interface RunRecord {
  outcome: RunOutcome
  /** At most `TAIL_CHARS`; cleaned only when somebody asks. */
  raw: string
}

export class TerminalManager {
  private readonly sessions = new Map<TerminalId, Session>()
  /**
   * The last build and server of each workspace, kept past its session.
   *
   * Here rather than in the window, because the window throws a pane's buffer
   * away when it unmounts — and "why does Run not work?" is asked after the
   * run, often from somewhere else. Kept in memory only: it survives a reload
   * of the window and not a restart of the application.
   */
  private readonly runs = new Map<string, WorkspaceRuns<RunRecord>>()
  /**
   * Sessions out of `sessions` whose group has not emptied yet, by id.
   *
   * A session leaves `sessions` the moment it is disposed or its shell exits,
   * so a quit asked for within the grace of a Stop, a closed window or a reload
   * found nothing to wait for, and left the run's child behind with its port.
   * Kept by id so a Stop arriving meanwhile waits on the same thing.
   */
  private readonly ending = new Map<TerminalId, Promise<void>>()
  private nextId = 1

  /**
   * `process.kill` by default, replaced in tests.
   *
   * Bound, because it reads `process` through `this` and a bare reference to
   * the method loses it.
   */
  constructor(
    private readonly kill: Kill = process.kill.bind(process),
    /** When a run ended is read from this, so a test can say when that was. */
    private readonly now: () => Date = () => new Date()
  ) {}

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

    const record = this.record(spec.owner.workspaceId, spec.owner.purpose, { kind: 'running' })

    const send = (data: string): void => {
      // The window can close while the shell is still writing.
      if (!target.isDestroyed()) target.send('terminal:data', { id, data })
    }

    /*
     * Output is sent the moment it starts and gathered after that.
     *
     * The first chunk goes at once, so the echo of a key somebody typed is not
     * held back; whatever follows within `BATCH_MS` travels together. Not
     * dropped on `dispose`: a stopped run keeps its log on screen, and the
     * exit that always follows sends what is left.
     */
    let pending = ''
    let batch: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      if (pending === '') return
      const data = pending
      pending = ''
      send(data)
    }

    pty.onData((data) => {
      if (record) record.raw = appendTail(record.raw, data)

      if (batch === null) {
        send(data)
        batch = setTimeout(() => {
          batch = null
          flush()
        }, BATCH_MS)
        return
      }

      pending += data
      if (pending.length >= BATCH_CHARS) flush()
    })

    // Closing a window destroys its WebContents without unmounting React, so
    // the cleanup in `Terminal.tsx` never runs and never asks for disposal.
    // On macOS the application outlives its last window, so without this the
    // shell — and anything it started, a dev server included — keeps running
    // with nothing left to talk to.
    const closeWithWindow = (): void => {
      void this.dispose(id)
    }
    target.once('destroyed', closeWithWindow)

    pty.onExit(({ exitCode, signal }) => {
      // The typings say `signal?: number`, but a normal exit reports 0 rather
      // than undefined — checking for undefined reported every run as killed.
      // Signal numbers start at 1, so falsy means "no signal".
      const code = signal ? null : exitCode

      // Here, not in `report`, which does nothing once the window is gone — and
      // a window closed mid-run is one of the times the record is asked for.
      if (record) record.outcome = { kind: 'exited', at: this.now().toISOString(), exitCode: code }

      // What is still gathered goes first. Told of the exit before it, the pane
      // forgets the session and drops the run's last lines on arrival.
      if (batch !== null) clearTimeout(batch)
      batch = null
      flush()

      // Taken off here rather than in `dispose`: a script that finishes on its
      // own never goes through `dispose`, and every session ends here. Left
      // on, one listener per run piled up on a window that lives all day.
      target.off('destroyed', closeWithWindow)

      const report = (): void => {
        if (target.isDestroyed()) return
        target.send('terminal:exit', { id, exitCode: code })
      }

      // Gone already means a stop took it, and is ending the group itself.
      const stopped = !this.sessions.delete(id)
      if (stopped || this.groupGone(pty.pid)) {
        report()
        return
      }

      /*
       * The shell left on its own and a member of its group carries on — a
       * server's child that outlived the script, something it started with
       * `&`. The pane forgets the session on the exit, so nothing could reach
       * that member any more, and the next Run failed on its port. It belonged
       * to the run, and goes the way a Stop would have sent it; the exit is
       * reported once it has, so Run is not offered while the port is held.
       */
      this.signalGroup(pty.pid, 'SIGTERM')
      void this.untilGroupEnds(id, pty, true).then(report)
    })

    this.sessions.set(id, {
      pty,
      target,
      owner: spec.owner,
      bareShell: spec.command.length === 0
    })
    return id
  }

  /**
   * Keeps a start the Scripts tab refused before its script ran, in the words
   * it showed: a port somebody else holds, an env file it would not write, a
   * shell that would not spawn. None of those leaves a session behind, so Help
   * would have said nothing had run — or quoted the Run before as this one.
   */
  refuse(workspaceId: string, purpose: RunPurpose, reason: string): void {
    this.record(workspaceId, purpose, { kind: 'refused', reason })
  }

  /**
   * A fresh record for a workspace's build or server, replacing the last one.
   *
   * Replaced at the start rather than the end: the question is about the run
   * somebody just pressed, and a server restarted after a failed one should
   * not answer with the failure.
   */
  private record(
    workspaceId: string | null,
    purpose: TerminalPurpose,
    outcome: RunOutcome
  ): RunRecord | null {
    if (workspaceId === null || !isRunPurpose(purpose)) return null

    const record: RunRecord = { outcome, raw: '' }
    this.runs.set(workspaceId, withRun(this.runs.get(workspaceId), purpose, record))
    return record
  }

  /**
   * The last build and server of a workspace, whichever exist, build first.
   *
   * Copies, so nothing outside can write into a record still streaming.
   */
  lastRuns(workspaceId: string): RecordedRun[] {
    const runs = this.runs.get(workspaceId)
    return RUN_PURPOSES.flatMap((purpose) => {
      const record = runs?.[purpose]
      return record ? [{ purpose, ...record }] : []
    })
  }

  /** Drops a workspace's records: when it is removed, and when a new one is made under its id. */
  forgetRuns(workspaceId: string): void {
    this.runs.delete(workspaceId)
  }

  write(id: TerminalId, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: TerminalId, cols: number, rows: number): void {
    // A resize arriving after the session ended is normal, not an error.
    this.sessions.get(id)?.pty.resize(cols, rows)
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
   * A bare shell — a tab — is the exception, and gets the hangup at once. An
   * interactive zsh ignores SIGTERM outright: sent one, every tab sat out the
   * whole grace, which a quit waiting on its terminals turned into two seconds
   * added to every quit. The hangup is what closing any terminal sends, and
   * what the shell answers by hanging up its own jobs. The price is a server
   * somebody started in a tab with `exec`: it is the shell's pid, gets the
   * hangup rather than SIGTERM, and is killed with its pid file in place.
   *
   * Whatever ignores SIGTERM is hung up on once the grace is over, and the
   * whole group is killed `HANGUP_MS` later. Both wait: where a run script
   * `exec`s into its server that server *is* this pid, and anything stronger
   * fired in the same tick arrives first and kills it outright — the SIGTERM
   * handler never runs, and the pid file it would have removed survives, the
   * "a server is already running" this whole thing set out to end. The hangup
   * alone used to be the end of it, and a child ignoring both signals kept its
   * port.
   */
  dispose(id: TerminalId): Promise<void> {
    const session = this.sessions.get(id)
    if (!session) return this.ending.get(id) ?? Promise.resolve()

    const { pty } = session
    this.sessions.delete(id)

    if (session.bareShell) pty.kill()
    else this.signalGroup(pty.pid, 'SIGTERM')

    return this.untilGroupEnds(id, pty, false)
  }

  /**
   * Answers when a session's group has gone, not when it was signalled — nor
   * when its shell went.
   *
   * A restart is a disposal and a start with nothing in between, and a dev
   * server does not release its port the instant it is asked to: the next one
   * then binds against the last one and fails on the port, blaming itself.
   * Answering on the shell's exit was not enough either: a child that ignored
   * SIGTERM stayed behind with the port, and the stop answered in a
   * millisecond. The only thing that knows when to stop waiting is here.
   *
   * The caller has sent the first signal; this runs the rest of the order.
   */
  private untilGroupEnds(id: TerminalId, pty: IPty, exited: boolean): Promise<void> {
    const ending = new Promise<void>((resolve) => {
      let shellGone = exited
      let done = false
      let poll: ReturnType<typeof setTimeout> | undefined

      // Every timer goes on the way out, so none holds the process open and
      // none signals a group that has already been answered for.
      const finish = (): void => {
        done = true
        clearTimeout(hangup)
        clearTimeout(kill)
        clearTimeout(ceiling)
        clearTimeout(poll)
        resolve()
      }

      const settle = (): void => {
        if (done || !shellGone) return
        if (this.groupGone(pty.pid)) {
          finish()
          return
        }

        clearTimeout(poll)
        poll = setTimeout(settle, POLL_MS)
      }

      // The hangup is for a shell still there to pass it on to its jobs.
      const hangup = setTimeout(() => {
        if (!shellGone) pty.kill()
      }, GRACE_MS)
      const kill = setTimeout(() => {
        this.signalGroup(pty.pid, 'SIGKILL')
        settle()
      }, GRACE_MS + HANGUP_MS)
      const ceiling = setTimeout(finish, GRACE_MS + HANGUP_MS + KILL_WAIT_MS)

      if (shellGone) settle()
      else
        pty.onExit(() => {
          shellGone = true
          settle()
        })
    })

    this.ending.set(id, ending)
    void ending.then(() => this.ending.delete(id))
    return ending
  }

  /** Signals the group a session's shell leads, which may have ended since. */
  private signalGroup(leader: number, signal: NodeJS.Signals): void {
    try {
      this.kill(-leader, signal)
    } catch {
      // The group ended between being read and being signalled, which is the
      // ordinary case for a script that has just finished.
    }
  }

  /** Whether nothing is left in the group a session's shell led. */
  private groupGone(leader: number): boolean {
    try {
      this.kill(-leader, 0)
      return false
    } catch {
      // ESRCH is the answer asked for. Any other failure counts as gone too:
      // a probe that cannot tell must not hold a stop for ever.
      return true
    }
  }

  /**
   * Ends every session of one window.
   *
   * A reload keeps the `WebContents` and loses everything the renderer knew, so
   * without this a dev server carries on with nothing on screen that can reach
   * it: no Stop, no output, and a port held by something the pane has forgotten.
   */
  async disposeFor(target: WebContents): Promise<void> {
    const theirs = [...this.sessions]
      .filter(([, session]) => session.target === target)
      .map(([id]) => id)

    await Promise.all(theirs.map((id) => this.dispose(id)))
  }

  /**
   * Kills every session — called when the application quits.
   *
   * Every signal goes out before the first `await`, and the answer comes once
   * every group has gone, those already being stopped included: a quit that
   * did not wait exited long before the kill was due, and a run's child that
   * ignored SIGTERM outlived the application.
   */
  async disposeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) void this.dispose(id)
    await Promise.all(this.ending.values())
  }

  /**
   * Everything still running, whichever window asked for it.
   *
   * The residue this exists to make visible: a session whose pane is gone is
   * held here and nothing on screen could say so. Every window's, not the
   * caller's own — a pty orphaned by one window is exactly the one the reader
   * cannot see from the other.
   */
  list(): TerminalSession[] {
    return [...this.sessions].map(([id, session]) => ({ id, owner: session.owner }))
  }

  /**
   * Each session's process group leader and whose it is.
   *
   * What the resource reading charges a subtree by: the pid is only known
   * here, because this is what spawned it.
   */
  leaders(): { pid: number; owner: TerminalOwner }[] {
    return [...this.sessions.values()].map(({ pty, owner }) => ({ pid: pty.pid, owner }))
  }

  get size(): number {
    return this.sessions.size
  }
}
