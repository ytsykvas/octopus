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
      for (const notify of [...this.exits]) notify(event)
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

const { TerminalManager } = await import('./terminals.js')

/** Stands in for a renderer's WebContents. */
function target(): {
  sent: [string, unknown][]
  destroyed: boolean
  send: (channel: string, payload: unknown) => void
  isDestroyed: () => boolean
  once: (event: string, handler: () => void) => void
  /** Pretends the window was closed. */
  close: () => void
} {
  const listeners: (() => void)[] = []

  const state = {
    sent: [] as [string, unknown][],
    destroyed: false,
    send(channel: string, payload: unknown) {
      state.sent.push([channel, payload])
    },
    isDestroyed: () => state.destroyed,
    once(event: string, handler: () => void) {
      if (event === 'destroyed') listeners.push(handler)
    },
    close() {
      state.destroyed = true
      for (const handler of listeners) handler()
    }
  }

  return state
}

let manager: InstanceType<typeof TerminalManager>
let renderer: ReturnType<typeof target>
/** Every signal the manager sent, instead of sending it. */
let signals: [number, NodeJS.Signals][]

beforeEach(() => {
  spawned.length = 0
  signals = []
  manager = new TerminalManager((pid, signal) => {
    signals.push([pid, signal])
  })
  renderer = target()
})

const SPEC = {
  owner: { workspaceId: null, purpose: 'shell' as const },
  cwd: '/tmp/work',
  command: [],
  commandLine: '',
  env: {},
  cols: 80,
  rows: 24
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
    const id = manager.create(SPEC, renderer as never)
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
    const id = manager.create(SPEC, renderer as never)
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
      const id = manager.create(SPEC, renderer as never)

      void manager.dispose(id)

      expect(signals).toHaveLength(1)
      expect(spawned[0]?.killed).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  // The fallback is for a process that ignores SIGTERM, and only for that one.
  it('hangs up on a session that has not gone once the grace is over', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      void manager.dispose(id)

      vi.advanceTimersByTime(5_000)

      expect(spawned[0]?.killed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a session that shut down politely alone', () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      void manager.dispose(id)

      spawned[0]?.end({ exitCode: 0 })
      vi.advanceTimersByTime(5_000)

      expect(spawned[0]?.killed).toBe(false)
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
    const id = manager.create(SPEC, renderer as never)

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
  it('answers once the fallback has hung up on a process that ignored it', async () => {
    vi.useFakeTimers()
    try {
      const id = manager.create(SPEC, renderer as never)
      const answer = manager.dispose(id)

      vi.advanceTimersByTime(5_000)
      // `pty.kill()` is what a real pty answers with; the fake says so itself.
      spawned[0]?.end({ exitCode: 0, signal: 1 })

      await expect(answer).resolves.toBeUndefined()
      expect(spawned[0]?.killed).toBe(true)
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
    const mine = manager.create(SPEC, renderer as never)
    const theirs = manager.create(SPEC, other as never)

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
    manager.create(SPEC, renderer as never)

    await expect(manager.disposeFor(target() as never)).resolves.toBeUndefined()
    expect(manager.size).toBe(1)
  })

  // A script that has just finished takes its group with it, and the signal
  // then lands on nothing. That is the ordinary case, not a failure.
  it('carries on when the group has already gone', () => {
    const throwing = new TerminalManager(() => {
      throw new Error('ESRCH')
    })
    const id = throwing.create(SPEC, renderer as never)

    expect(() => {
      void throwing.dispose(id)
    }).not.toThrow()

    expect(throwing.size).toBe(0)
  })

  it('disposing twice is harmless', () => {
    const id = manager.create(SPEC, renderer as never)
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
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, renderer as never)

    renderer.close()

    expect(signals.map(([pid]) => pid)).toEqual(spawned.map((pty) => -pty.pid))
    expect(manager.size).toBe(0)
  })

  it('leaves the sessions of other windows alone', () => {
    const other = target()
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, other as never)

    renderer.close()

    expect(signals).toEqual([[-(spawned[0]?.pid ?? 0), 'SIGTERM']])
    expect(manager.size).toBe(1)
  })

  it('kills every session when the application quits', () => {
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, renderer as never)

    manager.disposeAll()

    expect(signals.map(([pid]) => pid)).toEqual(spawned.map((pty) => -pty.pid))
    expect(manager.size).toBe(0)
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
