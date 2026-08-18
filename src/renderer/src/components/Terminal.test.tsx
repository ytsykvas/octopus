import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalExit, TerminalOutput } from '@core/terminal.js'
import type { Result } from '../../../preload/index.js'

import { Terminal } from './Terminal.js'

/**
 * xterm.js measures glyphs against a real canvas, which jsdom does not have —
 * a genuine emulator here would either crash or size itself to nothing. The
 * stand-in keeps only what this component talks to: the options it was built
 * with, what was written to the screen, and the keystroke handler.
 */
const { FakeXTerm, FakeFitAddon } = vi.hoisted(() => {
  class FakeXTerm {
    static readonly instances: FakeXTerm[] = []

    // Deliberately not xterm's own 80x24: the size has to reach the session
    // from the emulator, and a hardcoded default would pass unnoticed.
    readonly cols = 120
    readonly rows = 40
    readonly screen: string[] = []
    typed: ((data: string) => void) | null = null
    focused = false
    disposed = false

    constructor(public options: { theme: Record<string, string> }) {
      FakeXTerm.instances.push(this)
    }

    loadAddon(): void {
      // Addons are the real emulator's business; nothing here needs them.
    }

    open(): void {
      // Attaching to the DOM is what a canvas renderer would do.
    }

    write(data: string): void {
      this.screen.push(data)
    }

    onData(handler: (data: string) => void): void {
      this.typed = handler
    }

    focus(): void {
      this.focused = true
    }

    dispose(): void {
      this.disposed = true
    }
  }

  class FakeFitAddon {
    fit(): void {
      // Sizing needs measured glyphs, so the fake keeps its size throughout.
    }
  }

  return { FakeXTerm, FakeFitAddon }
})

vi.mock('@xterm/xterm', () => ({ Terminal: FakeXTerm }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: FakeFitAddon }))

// The class itself lives inside the hoisted factory, which runs before this
// module's body; only its instance type can be named out here.
type Emulator = InstanceType<typeof FakeXTerm>

/** jsdom has no ResizeObserver, and the component resizes the session from one. */
class FakeResizeObserver {
  static readonly instances: FakeResizeObserver[] = []

  disconnected = false

  constructor(readonly notify: () => void) {
    FakeResizeObserver.instances.push(this)
  }

  observe(): void {
    // Nothing is laid out in jsdom, so a resize only ever arrives on demand.
  }

  unobserve(): void {
    // Same.
  }

  disconnect(): void {
    this.disconnected = true
  }
}

beforeEach(() => {
  FakeXTerm.instances.length = 0
  FakeResizeObserver.instances.length = 0
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})

afterEach(() => {
  // The theme test writes tokens onto the root element. Cleared here rather
  // than at the end of it, so a failed assertion cannot leave them behind.
  document.documentElement.style.removeProperty('--canvas')
  document.documentElement.style.removeProperty('--ink')
  document.documentElement.classList.remove('dark')
})

/** The emulator the component under test just built. */
function emulator(): Emulator {
  const term = FakeXTerm.instances.at(-1)
  if (!term) throw new Error('the component built no terminal')
  return term
}

function resizer(): FakeResizeObserver {
  const observer = FakeResizeObserver.instances.at(-1)
  if (!observer) throw new Error('the component observed no element')
  return observer
}

/** Hands back the callback the component gave the main process for `channel`. */
function subscriberFor<T>(
  subscribe: (handler: (payload: T) => void) => () => void
): (payload: T) => void {
  const call = vi.mocked(subscribe).mock.calls.at(-1)
  if (!call) throw new Error('the component subscribed to nothing')
  return call[0]
}

/** The unsubscribe function `subscribe` handed back when it was called. */
function unsubscribeFrom(subscribe: (...args: never[]) => () => void): () => void {
  const result = vi.mocked(subscribe).mock.results[0]
  if (result?.type !== 'return') throw new Error('the component subscribed to nothing')
  // A mock result is only ever typed as loosely as `unknown`, so the shape the
  // bridge promises has to be restated here.
  return result.value as () => void
}

/** Waits until the session exists, which is when the component knows its id. */
async function sessionStarted(): Promise<void> {
  await waitFor(() => {
    expect(window.octopus.terminal.create).toHaveBeenCalled()
  })
}

describe('Terminal', () => {
  it('opens a session in the directory it was given', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)

    await sessionStarted()

    expect(window.octopus.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tmp/planner/anna' })
    )
  })

  // Without a command the session is a plain interactive shell.
  it('asks for a shell when no command is given', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)

    await sessionStarted()

    expect(window.octopus.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ command: [], env: {} })
    )
  })

  it('runs the command it was given with the environment for it', async () => {
    render(
      <Terminal
        cwd="/tmp/planner/anna"
        command={['/tmp/planner/run.sh']}
        env={{ OCTOPUS_PORT: '3100' }}
      />
    )

    await sessionStarted()

    expect(window.octopus.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ['/tmp/planner/run.sh'],
        env: { OCTOPUS_PORT: '3100' }
      })
    )
  })

  // The pseudo-terminal must be told the size of the screen it is writing to,
  // or the output comes back wrapped at the wrong column.
  it('tells the session how large the screen is', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)

    await sessionStarted()

    expect(window.octopus.terminal.create).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 120, rows: 40 })
    )
  })

  it('sends what the user types to the session', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()

    await waitFor(() => {
      expect(emulator().typed).not.toBeNull()
    })
    emulator().typed?.('ls -la\r')

    expect(window.octopus.terminal.write).toHaveBeenCalledWith('term-1', 'ls -la\r')
  })

  // Typing is where the work happens, so the terminal takes focus as soon as
  // there is a session behind it.
  it('takes focus once the session is running', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()

    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })
  })

  it('shows output belonging to its own session', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    subscriberFor<TerminalOutput>(window.octopus.terminal.onData)({
      id: 'term-1',
      data: 'hello\r\n'
    })

    expect(emulator().screen).toContain('hello\r\n')
  })

  // Every terminal in the window listens on the same channel, so the id is the
  // only thing keeping one workspace's output out of another's screen.
  it('ignores output addressed to a different session', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    subscriberFor<TerminalOutput>(window.octopus.terminal.onData)({
      id: 'term-somebody-else',
      data: 'not yours\r\n'
    })

    expect(emulator().screen).not.toContain('not yours\r\n')
  })

  it('reports the exit code to its owner', async () => {
    const onExit = vi.fn()
    render(<Terminal cwd="/tmp/planner/anna" onExit={onExit} />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    subscriberFor<TerminalExit>(window.octopus.terminal.onExit)({ id: 'term-1', exitCode: 2 })

    expect(onExit).toHaveBeenCalledWith(2)
  })

  // The screen stays after the process is gone — the output is why anyone is
  // still looking — but there is nothing behind it to type into any more, and a
  // keystroke addressed to a dead session would land on whatever reused its id.
  it('sends nothing to a session that has already ended', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    subscriberFor<TerminalExit>(window.octopus.terminal.onExit)({ id: 'term-1', exitCode: 0 })
    emulator().typed?.('ls -la\r')

    expect(window.octopus.terminal.write).not.toHaveBeenCalled()
  })

  it('ignores another session ending', async () => {
    const onExit = vi.fn()
    render(<Terminal cwd="/tmp/planner/anna" onExit={onExit} />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    subscriberFor<TerminalExit>(window.octopus.terminal.onExit)({ id: 'term-other', exitCode: 0 })

    expect(onExit).not.toHaveBeenCalled()
  })

  // The handler is held in a ref precisely so a re-rendered parent cannot tear
  // a running session down; the newest one still has to be the one called.
  it('keeps the session alive when its owner passes a new exit handler', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const view = render(<Terminal cwd="/tmp/planner/anna" onExit={first} />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    view.rerender(<Terminal cwd="/tmp/planner/anna" onExit={second} />)
    subscriberFor<TerminalExit>(window.octopus.terminal.onExit)({ id: 'term-1', exitCode: 0 })

    expect(window.octopus.terminal.create).toHaveBeenCalledTimes(1)
    expect(emulator().disposed).toBe(false)
    expect(second).toHaveBeenCalledWith(0)
    expect(first).not.toHaveBeenCalled()
  })

  it('resizes the session when its container changes size', async () => {
    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })

    resizer().notify()

    expect(window.octopus.terminal.resize).toHaveBeenCalledWith('term-1', 120, 40)
  })

  // Nothing to resize before the session exists, and the id is what identifies it.
  it('does not resize a session that has not started yet', () => {
    render(<Terminal cwd="/tmp/planner/anna" />)

    resizer().notify()

    expect(window.octopus.terminal.resize).not.toHaveBeenCalled()
  })

  it('kills the session and stops listening when it goes away', async () => {
    const view = render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    await waitFor(() => {
      expect(emulator().focused).toBe(true)
    })
    const unsubscribeData = unsubscribeFrom(window.octopus.terminal.onData)
    const unsubscribeExit = unsubscribeFrom(window.octopus.terminal.onExit)

    view.unmount()

    expect(window.octopus.terminal.dispose).toHaveBeenCalledWith('term-1')
    expect(emulator().disposed).toBe(true)
    expect(resizer().disconnected).toBe(true)
    expect(unsubscribeData).toHaveBeenCalledTimes(1)
    expect(unsubscribeExit).toHaveBeenCalledTimes(1)
  })

  // A shell started for a workspace the user has already closed would otherwise
  // survive with nothing on screen attached to it.
  /*
   * `onExit` says the process reported a code; this says the session is gone and
   * its port is free. A restart waits on the second, not the first.
   */
  it('says when its session has closed, once the disposal answers', async () => {
    // A holder rather than a bare `let`: the assignment happens inside a
    // callback, and narrowing would otherwise call it unreachable.
    const gate: { release: (() => void) | null } = { release: null }
    vi.mocked(window.octopus.terminal.dispose).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.release = () => {
            resolve()
          }
        })
    )
    const onClosed = vi.fn()

    const { unmount } = render(<Terminal cwd="/tmp/work" onClosed={onClosed} />)
    await sessionStarted()

    unmount()
    await waitFor(() => {
      expect(gate.release).not.toBeNull()
    })
    expect(onClosed).not.toHaveBeenCalled()

    gate.release?.()

    await waitFor(() => {
      expect(onClosed).toHaveBeenCalledTimes(1)
    })
  })

  it('says nothing when there was no session to close', async () => {
    const onClosed = vi.fn()
    vi.mocked(window.octopus.terminal.create).mockResolvedValue({ ok: false, error: 'no shell' })

    const { unmount } = render(<Terminal cwd="/tmp/work" onClosed={onClosed} />)
    await sessionStarted()

    unmount()
    await Promise.resolve()

    expect(onClosed).not.toHaveBeenCalled()
  })

  it('kills a session that arrives after it has gone away', async () => {
    let start: ((result: Result<string>) => void) | undefined
    vi.mocked(window.octopus.terminal.create).mockReturnValue(
      new Promise<Result<string>>((resolve) => {
        start = resolve
      })
    )

    const view = render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    view.unmount()
    start?.({ ok: true, value: 'term-late' })

    await waitFor(() => {
      expect(window.octopus.terminal.dispose).toHaveBeenCalledWith('term-late')
    })
  })

  it('prints the reason on screen when no session can be started', async () => {
    vi.mocked(window.octopus.terminal.create).mockResolvedValue({
      ok: false,
      error: 'spawn /bin/zsh ENOENT'
    })

    render(<Terminal cwd="/tmp/planner/anna" />)

    await waitFor(() => {
      expect(emulator().screen.join('')).toContain('spawn /bin/zsh ENOENT')
    })
  })

  it('has nothing to dispose when the session never started', async () => {
    vi.mocked(window.octopus.terminal.create).mockResolvedValue({
      ok: false,
      error: 'spawn /bin/zsh ENOENT'
    })
    const view = render(<Terminal cwd="/tmp/planner/anna" />)
    await waitFor(() => {
      expect(emulator().screen.join('')).toContain('spawn /bin/zsh ENOENT')
    })

    view.unmount()

    expect(window.octopus.terminal.dispose).not.toHaveBeenCalled()
  })

  // The terminal sits inside the app rather than beside it, so it has to follow
  // the same theme as everything around it.
  it('colours itself from the theme tokens', async () => {
    document.documentElement.style.setProperty('--canvas', '#101216')
    document.documentElement.style.setProperty('--ink', '#e7e9ee')

    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()

    expect(emulator().options.theme).toMatchObject({
      background: '#101216',
      foreground: '#e7e9ee'
    })
  })

  // Reading once at mount was the bug: a terminal opened before the stored
  // preference came back over IPC read the light defaults and stayed white in
  // a dark window, and switching theme afterwards left it behind.
  it('follows the theme when it changes underneath it', async () => {
    document.documentElement.style.setProperty('--canvas', '#ffffff')

    render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()
    expect(emulator().options.theme).toMatchObject({ background: '#ffffff' })

    document.documentElement.style.setProperty('--canvas', '#0f1115')
    document.documentElement.classList.add('dark')

    await waitFor(() => {
      expect(emulator().options.theme).toMatchObject({ background: '#0f1115' })
    })
  })

  it('stops watching the theme when it goes away', async () => {
    document.documentElement.style.setProperty('--canvas', '#ffffff')
    const view = render(<Terminal cwd="/tmp/planner/anna" />)
    await sessionStarted()

    view.unmount()
    document.documentElement.style.setProperty('--canvas', '#0f1115')
    document.documentElement.classList.add('dark')
    await Promise.resolve()

    expect(emulator().options.theme).toMatchObject({ background: '#ffffff' })
  })
})
