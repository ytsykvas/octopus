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
    owner: { login: 'ytsykvas' },
    description: 'A planner',
    isPrivate: true,
    updatedAt: '2026-08-01T10:00:00Z',
    defaultBranchRef: { name: 'main' },
    ...overrides
  }
}

/** A repository as GitHub returns it, before the two fields that filter it. */
function node(
  overrides: Partial<RemoteRepository> & {
    isArchived?: boolean
    viewerPermission?: string | null
  } = {}
): unknown {
  return { ...repo(), isArchived: false, viewerPermission: 'ADMIN', ...overrides }
}

/** One page of the GraphQL reply, as `gh api graphql` prints it. */
function page(
  nodes: readonly unknown[],
  { login = 'ytsykvas', endCursor = null as string | null } = {}
): string {
  return JSON.stringify({
    data: {
      viewer: {
        login,
        repositories: {
          pageInfo: { hasNextPage: endCursor !== null, endCursor },
          nodes
        }
      }
    }
  })
}

const succeeds =
  (payload: string): CommandExec =>
  () =>
    Promise.resolve(payload)

const fails: CommandExec = () => Promise.reject(new Error('gh failed'))

/** Records what `gh` was asked, page by page, and replies with what it is given. */
function recording(...payloads: readonly string[]): {
  exec: CommandExec
  calls: readonly string[][]
} {
  const calls: string[][] = []
  const exec: CommandExec = (_command, args) => {
    calls.push([...args])
    return Promise.resolve(payloads[calls.length - 1] ?? page([]))
  }

  return { exec, calls }
}

describe('listRepositories', () => {
  it('returns the repositories gh reports', async () => {
    const list = await listRepositories(succeeds(page([node()])))
    expect(list).toHaveLength(1)
    expect(list[0]?.nameWithOwner).toBe('ytsykvas/planner')
  })

  it('puts the most recently updated first', async () => {
    const payload = page([
      node({ name: 'new', updatedAt: '2026-08-01T00:00:00Z' }),
      node({ name: 'middle', updatedAt: '2024-01-01T00:00:00Z' }),
      node({ name: 'old', updatedAt: '2020-01-01T00:00:00Z' })
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.name)).toEqual(['new', 'middle', 'old'])
  })

  /*
   * The bug this replaced `gh repo list` for.
   *
   * That command lists what one owner owns, and with no owner given that is the
   * signed-in user — so a work organisation's repositories were unreachable,
   * which is every repository somebody employed somewhere came here to add.
   */
  it('offers an organisation\u2019s repositories, not only the account\u2019s own', async () => {
    const payload = page([
      node({ name: 'planner', nameWithOwner: 'Hylab/planner', owner: { login: 'Hylab' } }),
      node()
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.nameWithOwner)).toContain('Hylab/planner')
  })

  it('asks for both affiliations, since one alone answers with a subset', async () => {
    const { exec, calls } = recording()

    await listRepositories(exec)

    const query = calls[0]?.join(' ') ?? ''
    expect(query).toContain('affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]')
    expect(query).toContain('ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]')
  })

  // octopus works by pushing a branch and opening a pull request from it, so a
  // repository that can only be read looks like a working choice until the
  // first push fails.
  it('leaves out a repository the account can only read', async () => {
    const payload = page([
      node({ name: 'readable', viewerPermission: 'READ' }),
      node({ name: 'triage-only', viewerPermission: 'TRIAGE' }),
      node({ name: 'unknown', viewerPermission: null }),
      node({ name: 'writable', viewerPermission: 'WRITE' }),
      node({ name: 'maintained', viewerPermission: 'MAINTAIN' })
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.name)).toEqual(['writable', 'maintained'])
  })

  it('leaves out an archived repository, which cannot receive work', async () => {
    const payload = page([node({ name: 'retired', isArchived: true }), node({ name: 'live' })])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.name)).toEqual(['live'])
  })

  // The picker groups on this, so the order it groups in is decided here.
  it('puts the account\u2019s own repositories before any organisation\u2019s', async () => {
    const payload = page([
      node({ name: 'zeta', nameWithOwner: 'Zeta/zeta', owner: { login: 'Zeta' } }),
      node({ name: 'alpha', nameWithOwner: 'Alpha/alpha', owner: { login: 'Alpha' } }),
      node({ name: 'mine' })
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.owner.login)).toEqual(['ytsykvas', 'Alpha', 'Zeta'])
  })

  it('keeps the update order inside each owner', async () => {
    const payload = page([
      node({ name: 'newer', nameWithOwner: 'Hylab/newer', owner: { login: 'Hylab' } }),
      node({ name: 'mine' }),
      node({ name: 'older', nameWithOwner: 'Hylab/older', owner: { login: 'Hylab' } })
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list.map((item) => item.name)).toEqual(['mine', 'newer', 'older'])
  })

  // GraphQL caps a page at 100 while the limit above it is 200, so more than
  // one request is the ordinary case rather than the exception.
  it('follows the cursor to the next page', async () => {
    const { exec, calls } = recording(
      page([node({ name: 'first' })], { endCursor: 'cursor-1' }),
      page([node({ name: 'second' })])
    )

    const list = await listRepositories(exec)

    expect(list.map((item) => item.name)).toEqual(['first', 'second'])
    expect(calls[0]?.join(' ')).not.toContain('after=')
    expect(calls[1]).toContain('after=cursor-1')
  })

  it('stops asking once GitHub says there is no next page', async () => {
    const { exec, calls } = recording(page([node()]))

    await listRepositories(exec)
    expect(calls).toHaveLength(1)
  })

  // A cursor GitHub omits ends the walk too: asking again without one would
  // fetch the first page for ever.
  it('stops when a next page is promised without a cursor', async () => {
    const payload = JSON.stringify({
      data: {
        viewer: {
          login: 'ytsykvas',
          repositories: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [node()] }
        }
      }
    })
    const { exec, calls } = recording(payload)

    await listRepositories(exec)
    expect(calls).toHaveLength(1)
  })

  it('never asks for more than the limit allows', async () => {
    const { exec, calls } = recording(
      page([node({ name: 'a' }), node({ name: 'b' })], { endCursor: 'cursor-1' })
    )

    const list = await listRepositories(exec, 2)

    expect(list).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('first=2')
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
    const payload = JSON.stringify({ data: { viewer: { login: 'ytsykvas' } } })
    const error = await listRepositories(succeeds(payload)).catch((cause: unknown) => cause)
    expect((error as GitHubError).code).toBe('listFailed')
  })

  it('accepts a repository without a description or default branch', async () => {
    const payload = page([
      {
        name: 'bare',
        nameWithOwner: 'me/bare',
        owner: { login: 'me' },
        isPrivate: false,
        updatedAt: '2026-01-01T00:00:00Z',
        isArchived: false,
        viewerPermission: 'ADMIN'
      }
    ])

    const list = await listRepositories(succeeds(payload))
    expect(list[0]?.name).toBe('bare')
  })

  // They decide what is offered and nothing beyond this module reads them, so
  // they have no business crossing IPC.
  it('does not hand the filtering fields on to the caller', async () => {
    const list = await listRepositories(succeeds(page([node()])))

    expect(list[0]).not.toHaveProperty('isArchived')
    expect(list[0]).not.toHaveProperty('viewerPermission')
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
