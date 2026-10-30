/**
 * Most of this file drives the watcher through a fake `watch`, because what is
 * being decided — which file names count, what a burst collapses into, which
 * project is still wanted after an await — is ours, and FSEvents would only add
 * timing to it. The last block is the exception: one real repository, one real
 * remote, a real `git push`, so that the path watched and the file read are
 * proven against what git actually writes.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import {
  createRemoteRefWatch,
  parseRemoteRef,
  REF_DEBOUNCE_MS,
  type RefWatcher,
  type RemoteRefWatchDeps
} from './remoteRefs.js'

const run = promisify(execFile)

const SHA = 'a'.repeat(40)
const NEXT = 'b'.repeat(40)

describe('parseRemoteRef', () => {
  it('names the branch of a remote-tracking ref', () => {
    expect(parseRemoteRef('remotes/origin/octopus/ava')).toBe('octopus/ava')
    expect(parseRemoteRef('remotes/origin/main')).toBe('main')
  })

  // git writes the new value beside the ref and renames it over: the lock is
  // often the only name the event carries.
  it('reads through the lock git writes first', () => {
    expect(parseRemoteRef('remotes/origin/octopus/ava.lock')).toBe('octopus/ava')
  })

  it('answers null for anything that is not a branch on a remote', () => {
    expect(parseRemoteRef('remotes/origin/HEAD')).toBeNull()
    expect(parseRemoteRef('heads/main')).toBeNull()
    expect(parseRemoteRef('remotes/origin')).toBeNull()
    expect(parseRemoteRef('remotes/origin/')).toBeNull()
    expect(parseRemoteRef('')).toBeNull()
  })
})

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

const PROJECT = { id: 'planner', repoPath: '/work/planner' }
const COMMON = '/work/planner/.git'

describe('createRemoteRefWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  interface Bench {
    readonly fake: ReturnType<typeof fakeWatch>
    readonly onRef: Mock<RemoteRefWatchDeps['onRef']>
    readonly contents: Map<string, string>
    readonly readFile: Mock<(path: string) => Promise<string>>
    readonly commonDirOf: Mock<(repoPath: string) => Promise<string>>
    readonly refs: ReturnType<typeof createRemoteRefWatch>
  }

  function setUp(files: Record<string, string> = {}): Bench {
    const fake = fakeWatch()
    const onRef = vi.fn<RemoteRefWatchDeps['onRef']>()
    const contents = new Map(Object.entries(files))
    const readFile = vi.fn((path: string): Promise<string> => {
      const found = contents.get(path)
      return found === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(found)
    })
    const commonDirOf = vi.fn<(repoPath: string) => Promise<string>>(() => Promise.resolve(COMMON))
    const refs = createRemoteRefWatch({ commonDirOf, onRef, watch: fake.watch, readFile })

    return { fake, onRef, contents, readFile, commonDirOf, refs }
  }

  const REF = join(COMMON, 'refs', 'remotes/origin/octopus/ava')

  // `refs/remotes/` does not exist in a clone that has never fetched, and
  // watching a directory that is not there throws.
  it('watches the refs directory of the common git dir', async () => {
    const { fake, commonDirOf, refs } = setUp()

    await refs.sync([PROJECT])

    expect(commonDirOf).toHaveBeenCalledWith(PROJECT.repoPath)
    expect(fake.paths).toEqual([join(COMMON, 'refs')])
  })

  it('names the project, the branch and the commit the remote moved to', async () => {
    const { fake, onRef, refs } = setUp({ [REF]: `${SHA}\n` })
    await refs.sync([PROJECT])

    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(onRef).toHaveBeenCalledWith('planner', 'octopus/ava', SHA)
  })

  // The lock, the rename and the reflog arrive as several events for the one
  // change: one read, one announcement.
  it('collapses a burst into one read', async () => {
    const { fake, onRef, readFile, refs } = setUp({ [REF]: SHA })
    await refs.sync([PROJECT])

    fake.fire('remotes/origin/octopus/ava.lock')
    fake.fire('remotes/origin/octopus/ava.lock')
    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(readFile).toHaveBeenCalledTimes(1)
    expect(onRef).toHaveBeenCalledTimes(1)
  })

  // A fetch rewrites every ref it touches whether it moved or not.
  it('says nothing when the ref was rewritten with the commit it had', async () => {
    const { fake, onRef, contents, refs } = setUp({ [REF]: SHA })
    await refs.sync([PROJECT])

    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)
    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(onRef).toHaveBeenCalledTimes(1)

    contents.set(REF, NEXT)
    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(onRef).toHaveBeenLastCalledWith('planner', 'octopus/ava', NEXT)
    expect(onRef).toHaveBeenCalledTimes(2)
  })

  it('ignores what is not a remote branch, gone, or not a commit', async () => {
    const { fake, onRef, readFile, contents, refs } = setUp()
    await refs.sync([PROJECT])

    fake.fire(null)
    fake.fire('heads/main')
    fake.fire('remotes/origin/HEAD')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)
    expect(readFile).not.toHaveBeenCalled()

    // Pruned: the event comes, the file does not.
    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    contents.set(REF, 'ref: refs/remotes/origin/main\n')
    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(readFile).toHaveBeenCalledTimes(2)
    expect(onRef).not.toHaveBeenCalled()
  })

  it('takes a SHA-256 commit as well', async () => {
    const long = 'c'.repeat(64)
    const { fake, onRef, refs } = setUp({ [REF]: long })
    await refs.sync([PROJECT])

    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(onRef).toHaveBeenCalledWith('planner', 'octopus/ava', long)
  })

  it('watches a project once, and lets go of one no longer asked for', async () => {
    const { fake, refs } = setUp()

    await refs.sync([PROJECT])
    await refs.sync([PROJECT])
    expect(fake.paths).toHaveLength(1)

    await refs.sync([])
    expect(fake.closed).toEqual([join(COMMON, 'refs')])
  })

  it('closes everything at once', async () => {
    const { fake, commonDirOf, refs } = setUp()
    commonDirOf.mockImplementation((repoPath: string) => Promise.resolve(join(repoPath, '.git')))

    await refs.sync([PROJECT, { id: 'site', repoPath: '/work/site' }])
    refs.close()

    expect(fake.closed).toEqual(fake.paths)
    expect(fake.closed).toHaveLength(2)
  })

  // A pending read of a project that went away would announce a branch of a
  // project nobody has any more.
  it('drops a read still waiting when its project goes', async () => {
    const { fake, onRef, readFile, refs } = setUp({ [REF]: SHA })
    await refs.sync([PROJECT])

    fake.fire('remotes/origin/octopus/ava')
    await refs.sync([])
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)

    expect(readFile).not.toHaveBeenCalled()
    expect(onRef).not.toHaveBeenCalled()
  })

  it('drops a read that finishes after its project went', async () => {
    const { fake, onRef, readFile, refs } = setUp()
    let answer: (content: string) => void = () => undefined
    readFile.mockImplementationOnce(
      () =>
        new Promise((settle) => {
          answer = settle
        })
    )
    await refs.sync([PROJECT])

    fake.fire('remotes/origin/octopus/ava')
    await vi.advanceTimersByTimeAsync(REF_DEBOUNCE_MS)
    await refs.sync([])
    answer(SHA)
    await vi.advanceTimersByTimeAsync(0)

    expect(onRef).not.toHaveBeenCalled()
  })

  it('closes a watcher once, even when it fails after being let go of', async () => {
    const { fake, refs } = setUp()
    await refs.sync([PROJECT])

    await refs.sync([])
    fake.fail()

    expect(fake.closed).toHaveLength(1)
  })

  it('does not start a project removed while its git dir was being found', async () => {
    const { fake, commonDirOf, refs } = setUp()
    let answer: (dir: string) => void = () => undefined
    commonDirOf.mockImplementationOnce(
      () =>
        new Promise((settle) => {
          answer = settle
        })
    )

    const first = refs.sync([PROJECT])
    await refs.sync([])
    answer(COMMON)
    await first

    expect(fake.paths).toEqual([])
  })

  it('does not start one twice when two syncs overlap', async () => {
    const { fake, refs } = setUp()

    await Promise.all([refs.sync([PROJECT]), refs.sync([PROJECT])])

    expect(fake.paths).toHaveLength(1)
  })

  /*
   * Silently, because this is an accelerator and nothing more: the pane reads
   * on its own clock without it. The next sync tries again.
   */
  it('skips a project whose git dir cannot be found, and tries again later', async () => {
    const { fake, commonDirOf, refs } = setUp()
    commonDirOf.mockRejectedValueOnce(new Error('not a git repository'))

    await refs.sync([PROJECT])
    expect(fake.paths).toEqual([])

    await refs.sync([PROJECT])
    expect(fake.paths).toHaveLength(1)
  })

  it('gives a watcher up when it cannot start or when it fails, and tries again later', async () => {
    const { fake, refs, commonDirOf } = setUp()
    const throwing: NonNullable<RemoteRefWatchDeps['watch']> = () => {
      throw new Error('ENOENT')
    }
    const failing = createRemoteRefWatch({
      commonDirOf,
      onRef: vi.fn(),
      watch: throwing,
      readFile: vi.fn()
    })
    await expect(failing.sync([PROJECT])).resolves.toBeUndefined()

    await refs.sync([PROJECT])
    fake.fail()
    expect(fake.closed).toEqual([join(COMMON, 'refs')])

    await refs.sync([PROJECT])
    expect(fake.paths).toHaveLength(2)
  })
})

/*
 * The real thing: git's own push into a real remote, watched with the
 * defaults. The one test here that waits on the file system.
 */
describe('a real push', () => {
  const temporary: string[] = []

  afterEach(async () => {
    await Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true })))
    temporary.length = 0
  })

  async function scratch(prefix: string): Promise<string> {
    const made = await mkdtemp(join(tmpdir(), prefix))
    temporary.push(made)
    return made
  }

  it('is heard, with the commit it sent', async () => {
    const dir = await scratch('octopus-refs-')
    const remote = await scratch('octopus-refs-remote-')
    await run('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'README.md'), '# test\n', 'utf8')
    await run('git', ['add', '.'], { cwd: dir })
    await run('git', ['commit', '-q', '-m', 'first'], { cwd: dir })
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: dir })
    await run('git', ['switch', '-q', '-c', 'octopus/ava'], { cwd: dir })

    const onRef = vi.fn<RemoteRefWatchDeps['onRef']>()
    const refs = createRemoteRefWatch({
      commonDirOf: () => Promise.resolve(join(dir, '.git')),
      onRef
    })

    try {
      await refs.sync([{ id: 'planner', repoPath: dir }])
      await run('git', ['push', '-q', '-u', 'origin', 'octopus/ava'], { cwd: dir })
      const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()

      await vi.waitFor(
        () => {
          expect(onRef).toHaveBeenCalledWith('planner', 'octopus/ava', head)
        },
        { timeout: 5_000, interval: 50 }
      )
    } finally {
      refs.close()
    }
  })
})
