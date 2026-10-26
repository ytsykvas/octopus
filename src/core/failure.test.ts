import { describe, expect, it } from 'vitest'

import { z } from 'zod'

import { ChatError } from './chats.js'
import { failureOf } from './failure.js'
import { InvalidFileError } from './persist.js'
import { ProjectValidationError } from './projects.js'
import { StateConflictError } from './store.js'
import { WorkspaceError } from './workspaces.js'

describe('failureOf', () => {
  // The code is what lets the renderer show a localised message instead of the
  // English text, so losing it downgrades every known failure to a raw string.
  it('keeps the code and params of a project validation failure', () => {
    const result = failureOf(
      new ProjectValidationError('notARepository', { path: '/tmp/x' }, 'not a repository')
    )

    expect(result).toEqual({
      ok: false,
      error: 'not a repository',
      code: 'notARepository',
      params: { path: '/tmp/x' }
    })
  })

  /*
   * A `ZodError`'s `message` under zod 4 **is** `JSON.stringify(issues)`, so
   * without an arm of its own the window pasted a multi-line array of `origin`
   * / `code` / `maximum` objects into its generic frame. The reachable case is
   * ordinary use: a chat message past its cap is what pasting a file looks
   * like.
   */
  it('says in words what the boundary refused, rather than serialising it', () => {
    const result = failureOf(z.string().max(5).safeParse('far too long').error)

    expect(result).toMatchObject({ ok: false, code: 'valueRefused' })
    expect(result).not.toMatchObject({ error: expect.stringContaining('{') })
  })

  // Every issue, not the first: one value can fail two ways, and naming one of
  // them sends the reader to fix half the problem.
  it('names each thing that was wrong with it', () => {
    const schema = z.object({ name: z.string().min(3), port: z.number().max(10) })
    const result = failureOf(schema.safeParse({ name: 'a', port: 99 }).error)

    const reason = result.params?.reason ?? ''
    expect(reason.split('; ')).toHaveLength(2)
  })

  /*
   * The same list being short in a second place. A corrupt `state.json` crossed
   * as a bare `Error`: its message is a sentence, because `readJsonFile`
   * flattens the issues by hand, but it carried no code and so no translation.
   */
  it('keeps the code of a file it can no longer read', () => {
    const result = failureOf(new InvalidFileError('/tmp/state.json', 'projects: expected array'))

    expect(result).toMatchObject({
      ok: false,
      code: 'fileUnreadable',
      params: { path: '/tmp/state.json', issues: 'projects: expected array' }
    })
  })

  /*
   * `StateConflictError` is the one whose code is optional: most of what it
   * refuses is a condition the interface cannot reach, and only the few a user
   * can produce carry one. An explicit `undefined` is not the same as an absent
   * key at this boundary, which is why the spread is conditional.
   */
  it('keeps the code of a state conflict that has one', () => {
    const result = failureOf(
      new StateConflictError('still has workspaces', 'repoPathHasWorkspaces')
    )

    expect(result).toMatchObject({ ok: false, code: 'repoPathHasWorkspaces' })
  })

  it('carries no code at all for a state conflict without one', () => {
    const result = failureOf(new StateConflictError('a project name cannot be empty'))

    expect(result).toEqual({ ok: false, error: 'a project name cannot be empty', params: {} })
  })

  it('keeps the code of a workspace failure', () => {
    const result = failureOf(new WorkspaceError('branchExists', { branch: 'x' }, 'branch exists'))

    expect(result).toMatchObject({ ok: false, code: 'branchExists' })
  })

  it('keeps the code and params of a refused conversation', () => {
    const result = failureOf(new ChatError('tooManyChats', { limit: '3' }, 'too many chats'))

    expect(result).toEqual({
      ok: false,
      error: 'too many chats',
      code: 'tooManyChats',
      params: { limit: '3' }
    })
  })

  it('describes an ordinary error without inventing a code', () => {
    const result = failureOf(new Error('something broke'))

    expect(result).toEqual({ ok: false, error: 'something broke' })
  })

  // Not every failure arrives as an Error — a library may reject with a plain
  // value, and the bridge still has to answer with something readable.
  it('copes with a failure that is not an Error', () => {
    const result = failureOf('a bare string')

    expect(result).toMatchObject({ ok: false })
    expect(result.error.length).toBeGreaterThan(0)
  })
})
