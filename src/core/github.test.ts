import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CommandExec } from './accounts.js'
import {
  cloneRepository,
  clonePath,
  GitHubError,
  listRepositories,
  type RemoteRepository
} from './github.js'

function repo(overrides: Partial<RemoteRepository> = {}): RemoteRepository {
  return {
    name: 'planner',
    nameWithOwner: 'ytsykvas/planner',
    description: 'A planner',
    isPrivate: true,
    updatedAt: '2026-08-01T10:00:00Z',
    defaultBranchRef: { name: 'main' },
    ...overrides
  }
}

const succeeds =
  (payload: string): CommandExec =>
  () =>
    Promise.resolve(payload)

const fails: CommandExec = () => Promise.reject(new Error('gh failed'))

describe('listRepositories', () => {
  it('returns the repositories gh reports', async () => {
    const list = await listRepositories(succeeds(JSON.stringify([repo()])))
    expect(list).toHaveLength(1)
    expect(list[0]?.nameWithOwner).toBe('ytsykvas/planner')
  })

  it('puts the most recently updated first', async () => {
    const payload = JSON.stringify([
      repo({ name: 'old', updatedAt: '2020-01-01T00:00:00Z' }),
      repo({ name: 'new', updatedAt: '2026-08-01T00:00:00Z' }),
      repo({ name: 'middle', updatedAt: '2024-01-01T00:00:00Z' })
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.name)).toEqual(['new', 'middle', 'old'])
  })

  it('asks gh to skip archived repositories, which cannot receive work', async () => {
    let seen: readonly string[] = []
    const exec: CommandExec = (_command, args) => {
      seen = args
      return Promise.resolve('[]')
    }

    await listRepositories(exec)
    expect(seen).toContain('--no-archived')
  })

  it('passes the requested limit through', async () => {
    let seen: readonly string[] = []
    const exec: CommandExec = (_command, args) => {
      seen = args
      return Promise.resolve('[]')
    }

    await listRepositories(exec, 5)
    expect(seen).toContain('5')
  })

  it('reports a disconnected account rather than a raw failure', async () => {
    const error = await listRepositories(fails).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(GitHubError)
    expect((error as GitHubError).code).toBe('notConnected')
  })

  it('reports unreadable output separately from a missing account', async () => {
    const error = await listRepositories(succeeds('<html>')).catch((cause: unknown) => cause)
    expect((error as GitHubError).code).toBe('listFailed')
  })

  it('reports an unexpected shape rather than passing it on', async () => {
    const payload = JSON.stringify([{ name: 'planner' }])
    const error = await listRepositories(succeeds(payload)).catch((cause: unknown) => cause)
    expect((error as GitHubError).code).toBe('listFailed')
  })

  it('accepts a repository without a description or default branch', async () => {
    const payload = JSON.stringify([
      {
        name: 'bare',
        nameWithOwner: 'me/bare',
        isPrivate: false,
        updatedAt: '2026-01-01T00:00:00Z'
      }
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list[0]?.name).toBe('bare')
  })
})

describe('clonePath', () => {
  it('places the repository under the destination by its own name', () => {
    expect(clonePath(repo(), '/Users/test/projects')).toBe(join('/Users/test/projects', 'planner'))
  })

  // The name arrives from GitHub and becomes a filesystem path, so a crafted
  // one must not be able to climb out of the destination directory.
  it('cannot escape the destination directory', () => {
    const hostile = repo({ name: '../../etc/passwd' })
    expect(clonePath(hostile, '/Users/test/projects')).toBe(join('/Users/test/projects', 'passwd'))
  })

  it('ignores the owner part, using only the repository name', () => {
    expect(clonePath(repo({ name: 'app', nameWithOwner: 'someone/app' }), '/dest')).toBe(
      join('/dest', 'app')
    )
  })
})

describe('cloneRepository', () => {
  const missing = (): Promise<boolean> => Promise.resolve(false)
  const present = (): Promise<boolean> => Promise.resolve(true)

  it('clones into the destination and returns the path', async () => {
    let seen: readonly string[] = []
    const exec: CommandExec = (_command, args) => {
      seen = args
      return Promise.resolve('')
    }

    const path = await cloneRepository(repo(), '/dest', exec, missing)
    expect(path).toBe(join('/dest', 'planner'))
    expect(seen).toEqual(['repo', 'clone', 'ytsykvas/planner', join('/dest', 'planner')])
  })

  it('refuses when the target directory already exists', async () => {
    const error = await cloneRepository(repo(), '/dest', succeeds(''), present).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).code).toBe('alreadyExists')
  })

  it('does not run gh at all when the target exists', async () => {
    let called = false
    const exec: CommandExec = () => {
      called = true
      return Promise.resolve('')
    }

    await cloneRepository(repo(), '/dest', exec, present).catch(() => undefined)
    expect(called).toBe(false)
  })

  it('reports a failed clone with the repository name', async () => {
    const error = await cloneRepository(repo(), '/dest', fails, missing).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).code).toBe('cloneFailed')
    expect((error as GitHubError).params.repository).toBe('ytsykvas/planner')
  })

  it('checks the real filesystem by default: a free path proceeds to cloning', async () => {
    const error = await cloneRepository(repo(), '/nonexistent-root-xyz', fails).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).code).toBe('cloneFailed')
  })

  it('checks the real filesystem by default: an occupied path is refused', async () => {
    // `/tmp` exists everywhere this runs, so cloning a repository named "tmp"
    // into the root would collide with it.
    const error = await cloneRepository(repo({ name: 'tmp' }), '/', fails).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).code).toBe('alreadyExists')
  })
})
