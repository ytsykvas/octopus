import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `node-pty` is a native module: it spawns a real shell and is rebuilt against
 * Electron's ABI. Loading it here would test the operating system rather than
 * this class, so a stand-in records what it was asked to do and lets a test
 * drive the callbacks a real pty would fire.
 */
const { FakePty, spawned } = vi.hoisted(() => {
  interface Exit {
    exitCode: number
    signal?: number
  }

  class FakePty {
    written: string[] = []
    resizes: [number, number][] = []
    killed = false

    private data: ((chunk: string) => void) | null = null
    private exit: ((event: Exit) => void) | null = null

    constructor(
      readonly file: string,
      readonly args: readonly string[],
      readonly options: Record<string, unknown>
    ) {}

    onData(handler: (chunk: string) => void): void {
      this.data = handler
    }

    onExit(handler: (event: Exit) => void): void {
      this.exit = handler
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
      this.exit?.(event)
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

beforeEach(() => {
  spawned.length = 0
  manager = new TerminalManager()
  renderer = target()
})

const SPEC = { cwd: '/tmp/work', command: [], env: {}, cols: 80, rows: 24 }

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
  it('kills the process and forgets the session', () => {
    const id = manager.create(SPEC, renderer as never)
    manager.dispose(id)

    expect(spawned[0]?.killed).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('disposing twice is harmless', () => {
    const id = manager.create(SPEC, renderer as never)
    manager.dispose(id)

    expect(() => {
      manager.dispose(id)
    }).not.toThrow()
  })

  it('ignores an id it never issued', () => {
    expect(() => {
      manager.dispose('term-999')
    }).not.toThrow()
  })

  // Closing a window destroys its WebContents without unmounting React, so the
  // cleanup in Terminal.tsx never runs. On macOS the app outlives its last
  // window, and the shell would keep running with nothing to talk to.
  it('kills the sessions of a window that closes', () => {
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, renderer as never)

    renderer.close()

    expect(spawned.every((pty) => pty.killed)).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('leaves the sessions of other windows alone', () => {
    const other = target()
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, other as never)

    renderer.close()

    expect(spawned[0]?.killed).toBe(true)
    expect(spawned[1]?.killed).toBe(false)
    expect(manager.size).toBe(1)
  })

  it('kills every session when the application quits', () => {
    manager.create(SPEC, renderer as never)
    manager.create(SPEC, renderer as never)

    manager.disposeAll()

    expect(spawned.every((pty) => pty.killed)).toBe(true)
    expect(manager.size).toBe(0)
  })
})
