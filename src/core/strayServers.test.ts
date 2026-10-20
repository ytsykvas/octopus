import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  defaultStrayDeps,
  findStrayServers,
  type Kill,
  type Lsof,
  lsofVia,
  parseLsof,
  runLsof,
  StrayError,
  stopStrayServers
} from './strayServers.js'

/**
 * A machine described as processes, each listening or not and sitting
 * somewhere, answered in the `-F` format `lsof` prints — `f` lines included,
 * since the real one adds them whatever was asked for.
 */
interface FakeProcess {
  readonly pid: number
  readonly command: string
  readonly cwd: string
  readonly listens: readonly string[]
}

function fakeLsof(machine: () => readonly FakeProcess[]): Lsof {
  return (args) => {
    const processes = machine()

    if (args.includes('-iTCP')) {
      return Promise.resolve(
        processes
          .filter((item) => item.listens.length > 0)
          .map(
            (item) =>
              `p${String(item.pid)}\nc${item.command}\n` +
              item.listens.map((name, fd) => `f${String(fd + 10)}\nn${name}\n`).join('')
          )
          .join('')
      )
    }

    const asked = (args[args.indexOf('-p') + 1] ?? '').split(',').map(Number)
    return Promise.resolve(
      processes
        .filter((item) => asked.includes(item.pid))
        .map((item) => `p${String(item.pid)}\nfcwd\nn${item.cwd}\n`)
        .join('')
    )
  }
}

let dir = ''
let worktree = ''

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'octopus-strays-')))
  worktree = join(dir, 'kyiv')
  await mkdir(worktree)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parseLsof', () => {
  it('reads one record per process, its command and every name', () => {
    expect(parseLsof('p1\ncruby\nf8\nn*:3000\nf9\nn[::1]:3000\np2\ncnode\nn*:5173\n')).toEqual([
      { pid: 1, command: 'ruby', names: ['*:3000', '[::1]:3000'] },
      { pid: 2, command: 'node', names: ['*:5173'] }
    ])
  })

  it('ignores anything before the first process', () => {
    expect(parseLsof('cstray\nnnowhere\n')).toEqual([])
  })
})

describe('findStrayServers', () => {
  it('finds a server listening from the worktree, with its ports once each', async () => {
    const lsof = fakeLsof(() => [
      { pid: 76404, command: 'ruby', cwd: worktree, listens: ['127.0.0.1:3110', '[::1]:3110'] }
    ])

    expect(await findStrayServers(worktree, lsof)).toEqual([
      { pid: 76404, command: 'ruby', ports: [3110] }
    ])
  })

  it('finds one started from a directory below the worktree', async () => {
    const lsof = fakeLsof(() => [
      { pid: 7, command: 'node', cwd: join(worktree, 'web'), listens: ['*:5173'] }
    ])

    expect(await findStrayServers(worktree, lsof)).toEqual([
      { pid: 7, command: 'node', ports: [5173] }
    ])
  })

  // Everybody else's servers are none of this workspace's business — another
  // workspace's included, even one whose name begins with this one's.
  it('leaves alone servers running anywhere else', async () => {
    const lsof = fakeLsof(() => [
      { pid: 1, command: 'postgres', cwd: '/opt/homebrew/var', listens: ['[::1]:5432'] },
      { pid: 2, command: 'ruby', cwd: `${worktree}2`, listens: ['*:3120'] },
      { pid: 3, command: 'ruby', cwd: dir, listens: ['*:3130'] }
    ])

    expect(await findStrayServers(worktree, lsof)).toEqual([])
  })

  it('does not ask where processes run when nothing is listening', async () => {
    const asked: (readonly string[])[] = []
    const lsof: Lsof = (args) => {
      asked.push(args)
      return Promise.resolve('')
    }

    expect(await findStrayServers(worktree, lsof)).toEqual([])
    expect(asked).toHaveLength(1)
  })

  // A pid whose directory `lsof` could not report — it exited between the two
  // questions — is not guessed at.
  it('skips a listener whose directory went unreported', async () => {
    const lsof: Lsof = (args) =>
      Promise.resolve(args.includes('-iTCP') ? 'p9\ncruby\nn*:3110\n' : '')

    expect(await findStrayServers(worktree, lsof)).toEqual([])
  })

  it('drops a name that carries no port', async () => {
    const lsof = fakeLsof(() => [
      { pid: 4, command: 'odd', cwd: worktree, listens: ['*:*', '*:3140'] }
    ])

    expect(await findStrayServers(worktree, lsof)).toEqual([
      { pid: 4, command: 'odd', ports: [3140] }
    ])
  })
})

describe('stopStrayServers', () => {
  /**
   * A machine whose processes leave when signalled — after `graceTicks` polls,
   * or never for the signals in `ignores` — with every signal recorded.
   */
  function machine(
    processes: FakeProcess[],
    behaviour: { ignores?: readonly NodeJS.Signals[]; graceTicks?: number } = {}
  ): {
    deps: { lsof: Lsof; kill: Kill; sleep: (ms: number) => Promise<void> }
    signals: [number, NodeJS.Signals][]
  } {
    const signals: [number, NodeJS.Signals][] = []
    const dying = new Map<number, number>()
    let alive = [...processes]

    return {
      signals,
      deps: {
        lsof: fakeLsof(() => alive),
        kill: (pid, signal) => {
          signals.push([pid, signal])
          if (!alive.some((item) => item.pid === pid)) throw new Error('ESRCH')
          if (!(behaviour.ignores ?? []).includes(signal)) dying.set(pid, behaviour.graceTicks ?? 0)
        },
        sleep: () => {
          for (const [pid, ticks] of dying) {
            if (ticks === 0) {
              alive = alive.filter((item) => item.pid !== pid)
              dying.delete(pid)
            } else dying.set(pid, ticks - 1)
          }
          return Promise.resolve()
        }
      }
    }
  }

  const rails = (cwd: string): FakeProcess => ({
    pid: 76404,
    command: 'ruby',
    cwd,
    listens: ['127.0.0.1:3110']
  })

  it('asks a server to stop and waits until it has', async () => {
    const { deps, signals } = machine([rails(worktree)], { graceTicks: 3 })

    await stopStrayServers(worktree, [76404], deps)

    expect(signals).toEqual([[76404, 'SIGTERM']])
    expect(await findStrayServers(worktree, deps.lsof)).toEqual([])
  })

  it('kills one that ignores the request', async () => {
    const { deps, signals } = machine([rails(worktree)], { ignores: ['SIGTERM'] })

    await stopStrayServers(worktree, [76404], deps)

    expect(signals).toEqual([
      [76404, 'SIGTERM'],
      [76404, 'SIGKILL']
    ])
  })

  it('says which one would not stop', async () => {
    const { deps } = machine([rails(worktree)], { ignores: ['SIGTERM', 'SIGKILL'] })

    const failure = await stopStrayServers(worktree, [76404], deps).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(StrayError)
    expect(failure).toMatchObject({ code: 'strayStopFailed', params: { pid: '76404' } })
  })

  // The dialog was read a while ago. A pid that has since stopped serving from
  // here may already be somebody else's process, and is never signalled.
  it('signals only what is still serving from the worktree', async () => {
    const { deps, signals } = machine([rails(dir)])

    await stopStrayServers(worktree, [76404], deps)

    expect(signals).toEqual([])
  })

  it('stops only the servers it was given', async () => {
    const vite: FakeProcess = { pid: 8, command: 'node', cwd: worktree, listens: ['*:5173'] }
    const { deps, signals } = machine([rails(worktree), vite])

    await stopStrayServers(worktree, [8], deps)

    expect(signals).toEqual([[8, 'SIGTERM']])
  })

  it('takes a signal that finds nothing as the server having gone', async () => {
    const { deps, signals } = machine([rails(worktree)])

    await stopStrayServers(worktree, [76404], {
      ...deps,
      kill: (pid, signal) => {
        deps.kill(pid, signal)
        throw new Error('kill ESRCH')
      }
    })

    expect(signals).toEqual([[76404, 'SIGTERM']])
  })
})

describe('the real tools', () => {
  it('reads nothing listening as an empty answer rather than a failure', async () => {
    // Port 1 is privileged and never served in a test run; lsof exits 1.
    expect(await runLsof(['-nP', '-iTCP:1', '-sTCP:LISTEN', '-Fpcn'])).toBe('')
  })

  it('answers with what lsof printed', async () => {
    const lsof = lsofVia((file, args) => Promise.resolve({ stdout: `${file} ${args.join(' ')}` }))

    expect(await lsof(['-v'])).toBe('lsof -v')
  })

  it('still fails on anything but lsof finding nothing', async () => {
    const lsof = lsofVia(() =>
      Promise.reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }))
    )

    await expect(lsof([])).rejects.toThrow('timed out')
  })

  it('signals and waits for real', async () => {
    const child = spawn('sleep', ['30'])
    const exited = new Promise((resolve) => child.once('exit', resolve))

    await defaultStrayDeps.sleep(1)
    defaultStrayDeps.kill(child.pid ?? 0, 'SIGTERM')

    expect(await exited).toBeNull()
  })
})
