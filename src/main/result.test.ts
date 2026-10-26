import { describe, expect, it } from 'vitest'

import { WorkspaceError } from '../core/workspaces.js'
import { attempt } from './result.js'

/* What a failure turns into is `core/failure.test.ts`. This is the wrapper:
   a value, a throw and a rejection all come back as one shape. */
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

  it('reports a throw with its code', async () => {
    const result = await attempt(() => {
      throw new WorkspaceError('branchExists', { branch: 'x' }, 'branch exists')
    })

    expect(result).toMatchObject({ ok: false, code: 'branchExists' })
  })

  // A rejected promise is the common case for git and filesystem work.
  it('handles a rejection, not only a throw', async () => {
    const result = await attempt(() => Promise.reject(new Error('async failure')))
    expect(result).toMatchObject({ ok: false, error: 'async failure' })
  })
})
