import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoardWatch } from './boardWatch.js'
import type { RefWatcher, RemoteRefWatchDeps } from './remoteRefs.js'

/** A `watch` that hands the test the listener and counts what was closed. */
function fakeWatch(): {
  readonly watch: NonNullable<RemoteRefWatchDeps['watch']>
  readonly paths: string[]
  readonly closed: string[]
  readonly fire: (filename: string | null, path?: string) => void
  readonly fail: (path?: string) => void
} {
  const paths: string[] = []
  const closed: string[] = []
  const listeners = new Map<string, (event: string, filename: string | null) => void>()
  const errors = new Map<string, (error: Error) => void>()

  const watch: NonNullable<RemoteRefWatchDeps['watch']> = (path, options, listener) => {
    expect(options).toEqual({ recursive: true, persistent: false })
    paths.push(path)
    listeners.set(path, listener)
    const watcher: RefWatcher = {
      close: () => {
        closed.push(path)
      },
      on: (_event, handler) => {
        errors.set(path, handler)
        return watcher
      }
    }
    return watcher
  }

  const only = (path: string | undefined): string => path ?? paths[paths.length - 1] ?? ''

  return {
    watch,
    paths,
    closed,
    fire: (filename, path) => {
      listeners.get(only(path))?.('rename', filename)
    },
    fail: (path) => {
      errors.get(only(path))?.(new Error('EPERM'))
    }
  }
}

const PLANNER = { id: 'p1', name: 'planner' }
const ESL = { id: 'p2', name: 'esl' }
const FOLDER = '/board'

describe('createBoardWatch', () => {
  let fake: ReturnType<typeof fakeWatch>
  let onChange: ReturnType<typeof vi.fn<(projectId: string) => void>>
  let board: ReturnType<typeof createBoardWatch>

  beforeEach(() => {
    vi.useFakeTimers()
    fake = fakeWatch()
    onChange = vi.fn<(projectId: string) => void>()
    board = createBoardWatch({ onChange, watch: fake.watch })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('watches the board folder once for every project', () => {
    board.sync(FOLDER, [PLANNER, ESL])

    expect(fake.paths).toEqual(['/board'])
  })

  it('watches nothing while no folder is set', () => {
    board.sync('', [PLANNER])

    expect(fake.paths).toEqual([])
  })

  it('names the project whose folder changed', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/backlog/a.md')
    vi.advanceTimersByTime(300)

    expect(onChange.mock.calls).toEqual([['p1']])
  })

  it("finds the project's folder whatever its case or normalisation", () => {
    board.sync(FOLDER, [{ id: 'p3', name: 'Gr\u00f6\u00dfe' }])
    fake.fire('gro\u0308\u00dfe/done/x.md')
    vi.advanceTimersByTime(300)

    expect(onChange.mock.calls).toEqual([['p3']])
  })

  it('collapses a burst into one announcement', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/backlog/a.md')
    vi.advanceTimersByTime(100)
    fake.fire('planner/backlog/a.md')
    vi.advanceTimersByTime(100)
    fake.fire('planner/backlog/a.md')
    vi.advanceTimersByTime(300)

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('announces a card renamed in Finder once', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/backlog/a.md')
    fake.fire('planner/backlog/b.md')
    vi.advanceTimersByTime(300)

    expect(onChange.mock.calls).toEqual([['p1']])
  })

  it('waits the whole quiet period', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/a.md')
    vi.advanceTimersByTime(299)

    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange.mock.calls).toEqual([['p1']])
  })

  it('waits the quiet period it is given', () => {
    const quick = createBoardWatch({ onChange, watch: fake.watch, debounceMs: 50 })
    quick.sync(FOLDER, [PLANNER])
    fake.fire('planner/a.md')
    vi.advanceTimersByTime(49)

    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onChange.mock.calls).toEqual([['p1']])
  })

  it('keeps two projects apart', () => {
    board.sync(FOLDER, [PLANNER, ESL])
    fake.fire('planner/a.md')
    fake.fire('esl/b.md')
    vi.advanceTimersByTime(300)

    expect(onChange.mock.calls).toEqual([['p1'], ['p2']])
  })

  it('ignores its own temporary files and hidden ones', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/backlog/a.md.3f9a.tmp')
    fake.fire('planner/.DS_Store')
    vi.advanceTimersByTime(300)

    expect(onChange).not.toHaveBeenCalled()
  })

  it("counts a change among a card's attachments", () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/_attachments/a/mockup.png')
    vi.advanceTimersByTime(300)

    expect(onChange.mock.calls).toEqual([['p1']])
  })

  it('ignores a folder no project owns', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('other/a.md')
    vi.advanceTimersByTime(300)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('tells every project when the event names no file', () => {
    board.sync(FOLDER, [PLANNER, ESL])
    fake.fire(null)
    vi.advanceTimersByTime(300)

    expect(onChange.mock.calls).toEqual([['p1'], ['p2']])
  })

  it('follows the project list without watching again', () => {
    board.sync(FOLDER, [PLANNER])
    board.sync(FOLDER, [ESL])
    fake.fire('esl/a.md')
    vi.advanceTimersByTime(300)

    expect(fake.paths).toEqual(['/board'])
    expect(onChange.mock.calls).toEqual([['p2']])
  })

  it('moves to a new folder and closes the old one', () => {
    board.sync('/a', [PLANNER])
    board.sync('/b', [PLANNER])

    expect(fake.closed).toEqual(['/a'])
    expect(fake.paths).toEqual(['/a', '/b'])
  })

  it('stops watching when the folder is unset', () => {
    board.sync('/a', [PLANNER])
    board.sync('', [PLANNER])

    expect(fake.closed).toEqual(['/a'])
  })

  it('drops a failed watcher and watches again on the next sync', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fail()
    board.sync(FOLDER, [PLANNER])

    expect(fake.closed).toEqual(['/board'])
    expect(fake.paths).toEqual(['/board', '/board'])
  })

  it('ignores an error from a watcher it already let go of', () => {
    board.sync('/a', [PLANNER])
    board.sync('/b', [PLANNER])
    fake.fail('/a')
    fake.fire('planner/a.md', '/b')
    vi.advanceTimersByTime(300)

    expect(fake.closed).toEqual(['/a'])
    expect(onChange.mock.calls).toEqual([['p1']])
  })

  it('survives a folder it cannot watch', () => {
    let calls = 0
    const watch: NonNullable<RemoteRefWatchDeps['watch']> = (path, options, listener) => {
      calls += 1
      if (calls === 1) throw new Error('ENOENT')
      return fake.watch(path, options, listener)
    }
    const flaky = createBoardWatch({ onChange, watch })

    expect(() => {
      flaky.sync(FOLDER, [PLANNER])
    }).not.toThrow()
    flaky.sync(FOLDER, [PLANNER])
    expect(fake.paths).toEqual(['/board'])
  })

  it('forgets pending announcements when closed', () => {
    board.sync(FOLDER, [PLANNER])
    fake.fire('planner/a.md')
    board.close()
    vi.advanceTimersByTime(300)

    expect(onChange).not.toHaveBeenCalled()
    expect(fake.closed).toEqual(['/board'])
  })

  it('closes without having watched anything', () => {
    expect(() => {
      board.close()
    }).not.toThrow()
    expect(fake.closed).toEqual([])
  })

  it('watches through fs.watch when none is given', async () => {
    vi.useRealTimers()
    const real = await mkdtemp(join(tmpdir(), 'octopus-watch-'))
    const watching = createBoardWatch({ onChange })

    expect(() => {
      watching.sync(real, [PLANNER])
      watching.close()
    }).not.toThrow()
    await rm(real, { recursive: true })
  })
})
