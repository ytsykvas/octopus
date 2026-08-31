import { describe, expect, it } from 'vitest'

import { ChatError } from '../core/chats.js'
import { ProjectValidationError } from '../core/projects.js'
import { StateConflictError } from '../core/store.js'
import { WorkspaceError } from '../core/workspaces.js'
import { attempt } from './result.js'

describe('attempt', () => {
  it('reports a value on success', async () => {
    await expect(attempt(() => 42)).resolves.toEqual({ ok: true, value: 42 })
  })

  it('awaits an asynchronous operation', async () => {
    await expect(attempt(() => Promise.resolve('done'))).resolves.toEqual({
      ok: true,
      value: 'done'
    })
  })

  // The code is what lets the renderer show a localised message instead of the
  // English text, so losing it downgrades every known failure to a raw string.
  it('keeps the code and params of a project validation failure', async () => {
    const result = await attempt(() => {
      throw new ProjectValidationError('notARepository', { path: '/tmp/x' }, 'not a repository')
    })

    expect(result).toEqual({
      ok: false,
      error: 'not a repository',
      code: 'notARepository',
      params: { path: '/tmp/x' }
    })
  })

  /*
   * `StateConflictError` is the one whose code is optional: most of what it
   * refuses is a condition the interface cannot reach, and only the few a user
   * can produce carry one. An explicit `undefined` is not the same as an absent
   * key at this boundary, which is why the spread is conditional.
   */
  it('keeps the code of a state conflict that has one', async () => {
    const result = await attempt(() => {
      throw new StateConflictError('still has workspaces', 'repoPathHasWorkspaces')
    })

    expect(result).toMatchObject({ ok: false, code: 'repoPathHasWorkspaces' })
  })

  it('carries no code at all for a state conflict without one', async () => {
    const result = await attempt(() => {
      throw new StateConflictError('a project name cannot be empty')
    })

    expect(result).toEqual({ ok: false, error: 'a project name cannot be empty', params: {} })
  })

  it('keeps the code of a workspace failure', async () => {
    const result = await attempt(() => {
      throw new WorkspaceError('branchExists', { branch: 'x' }, 'branch exists')
    })

    expect(result).toMatchObject({ ok: false, code: 'branchExists' })
  })

  it('keeps the code and params of a refused conversation', async () => {
    const result = await attempt(() => {
      throw new ChatError('tooManyChats', { limit: '3' }, 'too many chats')
    })

    expect(result).toEqual({
      ok: false,
      error: 'too many chats',
      code: 'tooManyChats',
      params: { limit: '3' }
    })
  })

  it('describes an ordinary error without inventing a code', async () => {
    const result = await attempt(() => {
      throw new Error('something broke')
    })

    expect(result).toEqual({ ok: false, error: 'something broke' })
  })

  // A rejected promise is the common case for git and filesystem work.
  it('handles a rejection, not only a throw', async () => {
    const result = await attempt(() => Promise.reject(new Error('async failure')))
    expect(result).toMatchObject({ ok: false, error: 'async failure' })
  })

  // Not every failure arrives as an Error — a library may reject with a plain
  // value, and the bridge still has to answer with something readable.
  it('copes with a failure that is not an Error', async () => {
    const result = await attempt(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the point of the test
      throw 'a bare string'
    })

    expect(result).toMatchObject({ ok: false })
    expect((result as { error: string }).error.length).toBeGreaterThan(0)
  })
})
