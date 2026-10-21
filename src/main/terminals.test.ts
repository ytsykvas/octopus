import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `node-pty` is a native module that spawns a real shell. Loading it here would
 * test the operating system rather than this class, so a stand-in records what
 * it was asked to do and lets a test drive the callbacks a real pty would fire.
 */
const { FakePty, spawned } = vi.hoisted(() => {
  interface Exit {
    exitCode: number
    signal?: number
  }

  let nextPid = 1000

  class FakePty {
    written: string[] = []
    resizes: [number, number][] = []
    killed = false
    /** A real pty has one, and `dispose` signals the group it leads. */
    readonly pid = nextPid++
    /** Whether the shell itself is still running. */
    running = true
    /**
     * A member of the group that outlives the shell — a server's child that
     * ignores SIGTERM. It goes only when the whole group is killed.
     */
    lingering = false

    private data: ((chunk: string) => void) | null = null
    /* A list, not a field: `dispose` subscribes beside the one `create` made,
       and a fake that kept only the last would hide whichever ran first. */
    private readonly exits: ((event: Exit) => void)[] = []

    constructor(
      readonly file: string,
      readonly args: readonly string[],
      readonly options: Record<string, unknown>
    ) {}

    onData(handler: (chunk: string) => void): void {
      this.data = handler
    }

    onExit(handler: (event: Exit) => void): void {
      this.exits.push(handler)
    }

    write(chunk: string): void {
      this.written.push(chunk)
    }

    resize(cols: number, rows: number): void {
      this.resizes.push([cols, rows])
    }

    kill(): void {
      this.killed = true
    }

    /** Pretends the shell printed something. */
    emit(chunk: string): void {
      this.data?.(chunk)
    }

    /** Pretends the shell ended. */
    end(event: Exit): void {
      this.running = false
      for (const notify of [...this.exits]) notify(event)
    }

    /** Whether anything in the group the shell leads is still running. */
    groupAlive(): boolean {
      return this.running || this.lingering
    }

    /** What SIGKILL to the group does: everyone goes, the shell included. */
    killGroup(): void {
      this.lingering = false
      if (this.running) this.end({ exitCode: 0, signal: 9 })
    }
  }

  const spawned: FakePty[] = []
  return { FakePty, spawned }
})

vi.mock('node-pty', () => ({
  spawn: (file: string, args: readonly string[], options: Record<string, unknown>) => {
    const pty = new FakePty(file, args, options)
    spawned.push(pty)
    return pty
  }
}))

const { BATCH_CHARS, BATCH_MS, TerminalManager } = await import('./terminals.js')

/** Stands in for a renderer's WebContents. */
function target(): {
  sent: [string, unknown][]
  destroyed: boolean
  send: (channel: string, payload: unknown) => void
  isDestroyed: () => boolean
  once: (event: string, handler: () => void) => void
  off: (event: string, handler: () => void) => void
  /** How many `destroyed` listeners are still registered. */
  listening: () => number
  /** Pretends the window was closed. */
  close: () => void
} {
  const listeners = new Set<() => void>()

  const state = {
    sent: [] as [string, unknown][],
    destroyed: false,
    send(channel: string, payload: unknown) {
      state.sent.push([channel, payload])
    },
    isDestroyed: () => state.destroyed,
    once(event: string, handler: () => void) {
      if (event === 'destroyed') listeners.add(handler)
    },
    off(event: string, handler: () => void) {
      if (event === 'destroyed') listeners.delete(handler)
    },
    listening: () => listeners.size,
    close() {
      state.destroyed = true
      // Only what is still registered, as a real emitter does.
      for (const handler of [...listeners]) handler()
      listeners.clear()
    }
  }

  return state
}

let manager: InstanceType<typeof TerminalManager>
let renderer: ReturnType<typeof target>
/** Every signal the manager sent, instead of sending it. */
let signals: [number, NodeJS.Signals][]

/**
 * `process.kill` against the fake groups.
 *
 * Signal 0 is only a question — is anything left in the group — so it answers
 * as the real call does, by throwing once nothing is, and is not counted among
 * the signals sent.
 */
function groupKill(pid: number, signal: NodeJS.Signals | 0): void {
  const pty = spawned.find((candidate) => candidate.pid === -pid)
  if (signal === 0) {
    if (pty?.groupAlive() !== true) throw new Error('ESRCH')
    return
  }

  signals.push([pid, signal])
  if (signal === 'SIGKILL') pty?.killGroup()
}

/** What reached the window on one channel, in order. */
function sentOn(channel: string): unknown[] {
  return renderer.sent.filter(([sent]) => sent === channel).map(([, payload]) => payload)
}

beforeEach(() => {
  spawned.length = 0
  signals = []
  manager = new TerminalManager(groupKill)
  renderer = target()
})

const SPEC = {
  owner: { workspaceId: null, purpose: 'shell' as const },
  cwd: '/tmp/work',
  command: [],
  env: {},
  cols: 80,
  rows: 24
}

/**
 * A run: a command rather than a shell to type into.
 *
 * What the stopping order is written for — a script that may `exec` into its
 * server, which has a SIGTERM handler and a pid file. A tab is ended otherwise.
 */
const RUN = {
  ...SPEC,
  owner: { workspaceId: null, purpose: 'run' as const },
  command: ['bin/dev']
}

describe('creating a session', () => {
  it('starts one pty and hands back an id', () => {
    const id = manager.create(SPEC, renderer as never)

    expect(spawned).toHaveLength(1)
    expect(id).toMatch(/^term-/)
    expect(manager.size).toBe(1)
  })

  it('gives every session its own id', () => {
    const first = manager.create(SPEC, renderer as never)
    const second = manager.create(SPEC, renderer as never)

    expect(second).not.toBe(first)
  })

  it('runs in the directory it was given', () => {
    manager.create(SPEC, renderer as never)
    expect(spawned[0]?.options.cwd).toBe('/tmp/work')
  })

  // A command runs through the login shell so the user's PATH applies; `gh`
  // and `claude` usually live somewhere only a shell profile knows about.
  it('passes a command through the shell rather than executing it directly', () => {
    manager.create({ ...SPEC, command: ['gh', 'auth', 'login'] }, renderer as never)

    expect(spawned[0]?.args).toContain('-i')
    // Each word is quoted: a path can carry shell metacharacters, and a
    // repository cloned from GitHub brings its name from whoever wrote it.
    expect(spawned[0]?.args.join(' ')).toContain("'gh' 'auth' 'login'")
  })

  it('starts an interactive shell when no command is given', () => {
    manager.create(SPEC, renderer as never)
    expect(spawned[0]?.args).toHaveLength(0)
  })

  // This is how run.sh learns which port it should listen on.
  it('carries extra environment into the session', () => {
    manager.create({ ...SPEC, env: { OCTOPUS_PORT: '3123' } }, renderer as never)

    const env = spawned[0]?.options.env as Record<string, string>
    expect(env.OCTOPUS_PORT).toBe('3123')
    expect(env.TERM).toBe('xterm-256color')
  })
})

describe('streaming', () => {
  it('forwards output to the renderer, tagged with its session', () => {
    const id = manager.create(SPEC, renderer as never)
    spawned[0]?.emit('hello')

    expect(renderer.sent).toContainEqual(['terminal:data', { id, data: 'hello' }])
  })

  // The window can close while the shell is still writing.
  it('stops forwarding once the window is gone', () => {
    manager.create(SPEC, renderer as never)
    renderer.destroyed = true

    spawned[0]?.emit('into the void')
    expect(renderer.sent).toHaveLength(0)
  })

  /*
   * node-pty reads about a kilobyte at a time, and each read used to be its own
   * message: a fast build was 30 000 a second, a full core here and another in
   * the window before anything was drawn.
   */
  it('gathers what follows the first chunk into one message', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      spawned[0]?.emit('a')
      spawned[0]?.emit('b')
      spawned[0]?.emit('c')
      expect(sentOn('terminal:data')).toEqual([{ id, data: 'a' }])

      vi.advanceTimersByTime(BATCH_MS)

      expect(sentOn('terminal:data')).toEqual([
        { id, data: 'a' },
        { id, data: 'bc' }
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // The echo of a key somebody typed is a chunk on its own; held for a window
  // it would make typing lag.
  it('sends output at once when nothing was sent a moment ago', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      spawned[0]?.emit('l')
      vi.advanceTimersByTime(BATCH_MS)
      spawned[0]?.emit('s')

      expect(sentOn('terminal:data')).toEqual([
        { id, data: 'l' },
        { id, data: 's' }
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends a full batch without waiting for the window to end', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      spawned[0]?.emit('first')
      spawned[0]?.emit('x'.repeat(BATCH_CHARS))

      expect(sentOn('terminal:data')).toEqual([
        { id, data: 'first' },
        { id, data: 'x'.repeat(BATCH_CHARS) }
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // Told of the exit first, the pane forgets the session and drops the run's
  // last lines when they land — the failure at the bottom of a build log.
  it('sends what is still gathered before it reports the exit', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      spawned[0]?.emit('building')
      spawned[0]?.emit('error: the last line')
      spawned[0]?.end({ exitCode: 1 })

      expect(renderer.sent).toEqual([
        ['terminal:data', { id, data: 'building' }],
        ['terminal:data', { id, data: 'error: the last line' }],
        ['terminal:exit', { id, exitCode: 1 }]
      ])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends nothing gathered to a window that closed meanwhile', () => {
    vi.useFakeTimers()
    try {
      manager.create(SPEC, renderer as never)
      spawned[0]?.emit('first')
      spawned[0]?.emit('into the void')
      renderer.destroyed = true

      vi.advanceTimersByTime(BATCH_MS)

      expect(sentOn('terminal:data')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts input for a live session', () => {
    const id = manager.create(SPEC, renderer as never)
    manager.write(id, 'ls\n')

    expect(spawned[0]?.written).toEqual(['ls\n'])
  })

  it('ignores input for a session that does not exist', () => {
    expect(() => {
      manager.write('term-999', 'x')
    }).not.toThrow()
  })

  it('resizes a live session', () => {
    const id = manager.create(SPEC, renderer as never)
    manager.resize(id, 120, 40)

    expect(spawned[0]?.resizes).toEqual([[120, 40]])
  })

  // A resize arriving after the session ended is normal, not an error.
  it('ignores a resize for a session that has gone', () => {
    expect(() => {
      manager.resize('term-999', 80, 24)
    }).not.toThrow()
  })
})

describe('exit', () => {
  it('reports the exit code', () => {
    const id = manager.create(SPEC, renderer as never)
    spawned[0]?.end({ exitCode: 0 })

    expect(renderer.sent).toContainEqual(['terminal:exit', { id, exitCode: 0 }])
  })

  // The typings say `signal?: number`, but a normal exit reports 0 rather than
  // undefined — checking for undefined reported every run as killed.
  it('treats signal 0 as a normal exit, not a kill', () => {
    const id = manager.create(SPEC, renderer as never)
    spawned[0]?.end({ exitCode: 3, signal: 0 })

    expect(renderer.sent).toContainEqual(['terminal:exit', { id, exitCode: 3 }])
  })

  it('reports null when a signal actually killed it', () => {
    const id = manager.create(SPEC, renderer as never)
    spawned[0]?.end({ exitCode: 0, signal: 9 })

    expect(renderer.sent).toContainEqual(['terminal:exit', { id, exitCode: null }])
  })

  it('forgets the session once it ends', () => {
    manager.create(SPEC, renderer as never)
    spawned[0]?.end({ exitCode: 0 })

    expect(manager.size).toBe(0)
  })

  it('says nothing to a window that has closed', () => {
    manager.create(SPEC, renderer as never)
    renderer.destroyed = true
    spawned[0]?.end({ exitCode: 0 })

    expect(renderer.sent).toHaveLength(0)
  })
})

describe('disposal', () => {
  // An orphaned pty keeps a shell process alive after its window is gone.
  it('ends the session and forgets it', () => {
    const id = manager.create(RUN, renderer as never)
    void manager.dispose(id)

    expect(signals).toEqual([[-(spawned[0]?.pid ?? 0), 'SIGTERM']])
    expect(manager.size).toBe(0)
  })

  /*
   * The bug this was written for.
   *
   * The shell runs `run.sh`, which runs the server, so the server is a
   * grandchild — killing the pty's own process left it running, re-parented to
   * init, still holding its port and its pid file. The next start then refused
   * with "a server is already running".
   */
  it('signals the whole process group, not just the shell', () => {
    const id = manager.create(RUN, renderer as never)
    const pid = spawned[0]?.pid ?? 0

    void manager.dispose(id)

    // Negative: the process group the session leads. SIGTERM rather than a
    // hangup, which a server reads as "reopen your logs" and survives.
    expect(signals).toEqual([[-pid, 'SIGTERM']])
  })

  /*
   * node-pty's own kill sends SIGHUP, and where a run script `exec`s into its
   * server that server *is* the pty's pid. Fired in the same tick as the
   * SIGTERM the hangup arrives first and kills it outright, so the SIGTERM
   * handler never runs and the pid file it would have removed survives — which
   * is the "a server is already running" this set out to end.
   */
  it('does not hang up in the same tick as the graceful signal', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)

      void manager.dispose(id)

      expect(signals).toHaveLength(1)
      expect(spawned[0]?.killed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // The fallback is for a process that ignores SIGTERM, and only for that one.
  it('hangs up on the shell once the grace is over, then kills the group', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      const pid = spawned[0]?.pid ?? 0
      void manager.dispose(id)

      vi.advanceTimersByTime(2_000)
      expect(spawned[0]?.killed).toBe(true)
      expect(signals).toEqual([[-pid, 'SIGTERM']])

      vi.advanceTimersByTime(500)
      expect(signals).toEqual([
        [-pid, 'SIGTERM'],
        [-pid, 'SIGKILL']
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * Found in review against a real zsh: an interactive shell ignores SIGTERM,
   * and the hangup is what it answers by hanging up its jobs — each in a group
   * of its own, which a signal to the shell's never reaches. Killed instead of
   * hung up on, the shell died first and a tab closed with `npm run dev &` in
   * it left the server running. A shell that leaves on the hangup takes nothing
   * stronger.
   */
  it('lets a shell that leaves on the hangup go without killing its group', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      const answer = manager.dispose(id)

      await vi.advanceTimersByTimeAsync(2_000)
      spawned[0]?.end({ exitCode: 0, signal: 1 })
      await answer
      await vi.advanceTimersByTimeAsync(5_000)

      expect(signals.map(([, signal]) => signal)).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a session that shut down politely alone', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      void manager.dispose(id)

      spawned[0]?.end({ exitCode: 0 })
      vi.advanceTimersByTime(5_000)

      expect(signals.map(([, signal]) => signal)).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * Reproduced against a real pty: a run whose child ignored SIGTERM and
   * SIGHUP was "stopped" in a millisecond — the shell went, and the stop
   * answered on the shell — while the child kept its port. The restart then
   * started the next server against it.
   */
  it('waits for a member that outlives the shell, and kills it at the grace', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      const pty = spawned[0]
      if (!pty) throw new Error('nothing spawned')
      pty.lingering = true

      let ended = false
      const answer = manager.dispose(id).then(() => {
        ended = true
      })

      pty.end({ exitCode: 0, signal: 15 })
      await vi.advanceTimersByTimeAsync(2_400)
      expect(ended).toBe(false)
      expect(signals.map(([, signal]) => signal)).toEqual(['SIGTERM'])

      await vi.advanceTimersByTimeAsync(100)
      await answer

      expect(signals).toContainEqual([-pty.pid, 'SIGKILL'])
      expect(pty.groupAlive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // The member that lingered may leave on its own before the grace is over.
  it('answers once a lingering member leaves on its own', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      const pty = spawned[0]
      if (!pty) throw new Error('nothing spawned')
      pty.lingering = true

      const answer = manager.dispose(id)
      pty.end({ exitCode: 0 })
      await vi.advanceTimersByTimeAsync(200)

      pty.lingering = false
      await vi.advanceTimersByTimeAsync(100)
      await answer

      expect(signals.map(([, signal]) => signal)).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })

  // Something stuck in the kernel survives even SIGKILL for a while; a restart
  // must not wait on it for ever.
  it('stops waiting for a group that never empties', async () => {
    vi.useFakeTimers()
    try {
      const stubborn = new TerminalManager((pid, signal) => {
        if (signal !== 0) signals.push([pid, signal])
      })
      const id = stubborn.create(RUN, renderer as never)

      let ended = false
      const answer = stubborn.dispose(id).then(() => {
        ended = true
      })
      spawned[0]?.end({ exitCode: 0 })

      await vi.advanceTimersByTimeAsync(3_000)
      expect(ended).toBe(false)

      await vi.advanceTimersByTimeAsync(500)
      await answer
      expect(ended).toBe(true)
      // Nothing keeps polling once it has given up.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * A restart is a disposal and a start with nothing in between, and a dev
   * server does not release its port the instant it is asked to. The caller can
   * only wait if something tells it when the waiting is over.
   */
  it('answers when the session has gone, not when it was signalled', async () => {
    const id = manager.create(RUN, renderer as never)

    let ended = false
    const answer = manager.dispose(id).then(() => {
      ended = true
    })

    await Promise.resolve()
    expect(ended).toBe(false)

    spawned[0]?.end({ exitCode: 0 })

    await answer
    expect(ended).toBe(true)
  })

  it('answers for a session it has already forgotten', async () => {
    await expect(manager.dispose('term-999')).resolves.toBeUndefined()
  })

  // Otherwise a process that ignores SIGTERM would hold the caller for ever.
  it('answers once the group has been killed for ignoring SIGTERM', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      const answer = manager.dispose(id)

      vi.advanceTimersByTime(5_000)

      await expect(answer).resolves.toBeUndefined()
      expect(spawned[0]?.groupAlive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * A reload keeps the WebContents and loses everything the renderer knew, so
   * a dev server would carry on with nothing on screen able to reach it.
   */
  it('ends one window\u2019s sessions and leaves another\u2019s alone', async () => {
    const other = target()
    const mine = manager.create(RUN, renderer as never)
    const theirs = manager.create(RUN, other as never)

    const ended = manager.disposeFor(renderer as never)
    spawned[0]?.end({ exitCode: 0 })
    await ended

    expect(signals).toEqual([[-(spawned[0]?.pid ?? 0), 'SIGTERM']])
    expect(manager.size).toBe(1)
    // The surviving one is the other window's, not ours.
    manager.write(mine, 'x')
    manager.write(theirs, 'y')
    expect(spawned[1]?.written).toEqual(['y'])
  })

  it('has nothing to end for a window with no sessions', async () => {
    manager.create(RUN, renderer as never)

    await expect(manager.disposeFor(target() as never)).resolves.toBeUndefined()
    expect(manager.size).toBe(1)
  })

  // A script that has just finished takes its group with it, and the signal
  // then lands on nothing. That is the ordinary case, not a failure.
  it('carries on when the group has already gone', () => {
    const throwing = new TerminalManager(() => {
      throw new Error('ESRCH')
    })
    const id = throwing.create(RUN, renderer as never)

    expect(() => {
      void throwing.dispose(id)
    }).not.toThrow()

    expect(throwing.size).toBe(0)
  })

  // The same at the grace: the group can go between the probe and the kill.
  it('carries on when the group has gone by the time it is killed', async () => {
    vi.useFakeTimers()
    try {
      const throwing = new TerminalManager(() => {
        throw new Error('ESRCH')
      })
      const answer = throwing.dispose(throwing.create(RUN, renderer as never))

      await vi.advanceTimersByTimeAsync(2_500)
      spawned[0]?.end({ exitCode: 0, signal: 9 })

      await expect(answer).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('disposing twice is harmless', () => {
    const id = manager.create(RUN, renderer as never)
    void manager.dispose(id)

    expect(() => {
      void manager.dispose(id)
    }).not.toThrow()
  })

  it('ignores an id it never issued', () => {
    expect(() => {
      void manager.dispose('term-999')
    }).not.toThrow()
  })

  // Closing a window destroys its WebContents without unmounting React, so the
  // cleanup in Terminal.tsx never runs. On macOS the app outlives its last
  // window, and the shell would keep running with nothing to talk to.
  it('kills the sessions of a window that closes', () => {
    manager.create(RUN, renderer as never)
    manager.create(RUN, renderer as never)

    renderer.close()

    expect(signals.map(([pid]) => pid)).toEqual(spawned.map((pty) => -pty.pid))
    expect(manager.size).toBe(0)
  })

  /*
   * Every script run or restart used to leave one listener on a window that
   * lives all day; after ten of them Node warned, and the count kept climbing.
   */
  it('takes its listener off the window when the session ends', () => {
    manager.create(RUN, renderer as never)
    manager.create(RUN, renderer as never)
    const stopped = manager.create(RUN, renderer as never)
    expect(renderer.listening()).toBe(3)

    void manager.dispose(stopped)
    for (const pty of spawned) pty.end({ exitCode: 0 })

    expect(renderer.listening()).toBe(0)
  })

  it('leaves the sessions of other windows alone', () => {
    const other = target()
    manager.create(RUN, renderer as never)
    manager.create(RUN, other as never)

    renderer.close()

    expect(signals).toEqual([[-(spawned[0]?.pid ?? 0), 'SIGTERM']])
    expect(manager.size).toBe(1)
  })

  it('kills every session when the application quits', () => {
    manager.create(RUN, renderer as never)
    manager.create(RUN, renderer as never)

    void manager.disposeAll()

    expect(signals.map(([pid]) => pid)).toEqual(spawned.map((pty) => -pty.pid))
    expect(manager.size).toBe(0)
  })

  /*
   * Reproduced: a quit sent SIGTERM and exited 50 ms later, long before the
   * hangup and the kill were due, and a run's child that ignored both was left
   * holding its port after the application had gone. The quit can wait only on
   * something that says when every group is empty.
   */
  it('answers for the quit once every group has gone', async () => {
    vi.useFakeTimers()
    try {
      manager.create(RUN, renderer as never)
      manager.create(RUN, renderer as never)
      const [polite, stubborn] = spawned
      if (!polite || !stubborn) throw new Error('nothing spawned')
      stubborn.lingering = true

      let ended = false
      const answer = manager.disposeAll().then(() => {
        ended = true
      })
      polite.end({ exitCode: 0 })
      stubborn.end({ exitCode: 0 })

      await vi.advanceTimersByTimeAsync(2_400)
      expect(ended).toBe(false)

      await vi.advanceTimersByTimeAsync(100)
      await answer
      expect(stubborn.groupAlive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  /*
   * Found in review: a session leaves the list the moment it is stopped, so a
   * quit within the grace of a Stop found nothing to wait for and left in 50 ms
   * — the stopped run's child with it, still holding its port.
   */
  it('waits for the quit on a run stopped just before it', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(RUN, renderer as never)
      const pty = spawned[0]
      if (!pty) throw new Error('nothing spawned')
      pty.lingering = true

      void manager.dispose(id)
      pty.end({ exitCode: 0 })

      let ended = false
      const answer = manager.disposeAll().then(() => {
        ended = true
      })

      await vi.advanceTimersByTimeAsync(2_400)
      expect(ended).toBe(false)

      await vi.advanceTimersByTimeAsync(100)
      await answer
      expect(pty.groupAlive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

/*
 * A run whose shell exits by itself while a member of its group carries on — a
 * server's child that outlived the script, something it started with `&`.
 * The pane forgets the session on the exit, so nothing on screen could reach
 * that member, and the next Run failed on its port.
 */
describe('a run that ends with a member still running', () => {
  /** A run whose shell has just exited, leaving a member of its group behind. */
  function endedWithLeftover(): { id: string; pty: InstanceType<typeof FakePty> } {
    const id = manager.create(RUN, renderer as never)
    const pty = spawned[0]
    if (!pty) throw new Error('nothing spawned')
    pty.lingering = true
    pty.end({ exitCode: 0 })
    return { id, pty }
  }

  it('ends the group with SIGTERM, then SIGKILL, and no hangup', async () => {
    vi.useFakeTimers()
    try {
      const { pty } = endedWithLeftover()
      expect(signals).toEqual([[-pty.pid, 'SIGTERM']])

      await vi.advanceTimersByTimeAsync(2_500)
      expect(signals).toEqual([
        [-pty.pid, 'SIGTERM'],
        [-pty.pid, 'SIGKILL']
      ])
      expect(pty.groupAlive()).toBe(false)
      // The shell had already gone; the hangup is for a shell still there.
      expect(pty.killed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // Told at once, the pane offers Run while the port is still held.
  it('reports the exit once the group has gone, not when the shell went', async () => {
    vi.useFakeTimers()
    try {
      const { id, pty } = endedWithLeftover()
      expect(sentOn('terminal:exit')).toEqual([])

      await vi.advanceTimersByTimeAsync(200)
      pty.lingering = false
      await vi.advanceTimersByTimeAsync(100)

      expect(sentOn('terminal:exit')).toEqual([{ id, exitCode: 0 }])
      expect(signals.map(([, signal]) => signal)).toEqual(['SIGTERM'])
    } finally {
      vi.useRealTimers()
    }
  })

  // The Stop the pane still offers meanwhile must wait for the same thing.
  it('answers a stop meanwhile once the group has gone', async () => {
    vi.useFakeTimers()
    try {
      const { id, pty } = endedWithLeftover()

      let ended = false
      const answer = manager.dispose(id).then(() => {
        ended = true
      })
      await vi.advanceTimersByTimeAsync(2_400)
      expect(ended).toBe(false)

      await vi.advanceTimersByTimeAsync(100)
      await answer
      expect(pty.groupAlive()).toBe(false)
      expect(signals.map(([, signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds a quit until the group has gone', async () => {
    vi.useFakeTimers()
    try {
      const { pty } = endedWithLeftover()

      let ended = false
      const answer = manager.disposeAll().then(() => {
        ended = true
      })
      await vi.advanceTimersByTimeAsync(2_400)
      expect(ended).toBe(false)

      await vi.advanceTimersByTimeAsync(100)
      await answer
      expect(pty.groupAlive()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // Not only a run: a build that leaves something behind on purpose is ended too.
  it('ends what a build left behind as well', () => {
    manager.create(
      { ...RUN, owner: { workspaceId: null, purpose: 'setup' as const } },
      renderer as never
    )
    const pty = spawned[0]
    if (!pty) throw new Error('nothing spawned')
    pty.lingering = true
    pty.end({ exitCode: 0 })

    expect(signals).toEqual([[-pty.pid, 'SIGTERM']])
  })

  it('signals nothing for a run that took its whole group with it', () => {
    const id = manager.create(RUN, renderer as never)
    spawned[0]?.end({ exitCode: 0 })

    expect(signals).toEqual([])
    expect(sentOn('terminal:exit')).toEqual([{ id, exitCode: 0 }])
  })
})

// Why a tab is hung up on rather than sent SIGTERM is on `dispose`.
describe('disposal of a tab', () => {
  it('hangs up on the shell at once, and sends its group nothing', () => {
    const id = manager.create(SPEC, renderer as never)

    void manager.dispose(id)

    expect(spawned[0]?.killed).toBe(true)
    expect(signals).toEqual([])
  })

  it('answers as soon as the shell has left on the hangup', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      let ended = false
      const answer = manager.dispose(id).then(() => {
        ended = true
      })

      spawned[0]?.end({ exitCode: 0, signal: 1 })
      await vi.advanceTimersByTimeAsync(0)
      await answer

      expect(ended).toBe(true)
      expect(signals).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  // The rest of the order still stands for a shell that did not go.
  it('kills the group of a shell that ignored the hangup', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      const pid = spawned[0]?.pid ?? 0
      void manager.dispose(id)

      vi.advanceTimersByTime(2_500)

      expect(signals).toEqual([[-pid, 'SIGKILL']])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('what is still running', () => {
  /*
   * The residue this exists to make visible. A pty whose pane is gone is held
   * here and nothing on screen could say so, and what it costs is a shell alive,
   * a port held, and a dev server writing to a file nobody reads.
   */
  it('names each session by whose it is', () => {
    manager.create(
      { ...SPEC, owner: { workspaceId: 'planner/anna', purpose: 'run' } },
      renderer as never
    )
    manager.create({ ...SPEC, owner: { workspaceId: null, purpose: 'auth' } }, renderer as never)

    expect(manager.list()).toEqual([
      { id: 'term-1', owner: { workspaceId: 'planner/anna', purpose: 'run' } },
      { id: 'term-2', owner: { workspaceId: null, purpose: 'auth' } }
    ])
  })

  /*
   * Every window's, not the caller's own — which is the whole point: the
   * session worth finding is precisely the one whose window is gone.
   */
  it('answers with every window\u2019s, not one window\u2019s', () => {
    const other = target()
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, other as never)

    expect(manager.list()).toHaveLength(2)
  })

  it('gives each session\u2019s group leader beside its owner', () => {
    const owner = { workspaceId: 'planner/anna', purpose: 'run' } as const
    manager.create({ ...SPEC, owner }, renderer as never)

    expect(manager.leaders()).toEqual([{ pid: spawned[0]?.pid, owner }])
  })

  it('has nothing to say before anything is started', () => {
    expect(manager.list()).toEqual([])
  })

  it('drops one that has been ended', async () => {
    const id = manager.create(SPEC, renderer as never)

    const ending = manager.dispose(id)
    spawned[0]?.end({ exitCode: 0 })
    await ending

    expect(manager.list()).toEqual([])
  })
})
