import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type RunScript, runArchiveScript } from './archive.js'
import { writeScript } from './scripts.js'

let root: string

const values = { rootPath: '/Users/test/planner', workspaceName: 'anna', path: '/tmp/anna' }

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-archive-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('runArchiveScript', () => {
  it('runs the project script in the workspace, with the same environment', async () => {
    await writeScript('archive', 'planner', '#!/bin/sh\n', root)

    let seen: { path: string; options: Parameters<RunScript>[1] } | null = null
    const runner: RunScript = (path, options) => {
      seen = { path, options }
      return Promise.resolve()
    }

    await expect(runArchiveScript('planner', values, root, runner)).resolves.toBeNull()

    // `seen` is written inside the runner; TypeScript cannot see that.
    const call = seen as unknown as { path: string; options: Parameters<RunScript>[1] }
    expect(call.path).toContain(join('planner', 'scripts', 'archive.sh'))
    expect(call.options.cwd).toBe('/tmp/anna')
    expect(call.options.env).toEqual({
      OCTOPUS_ROOT_PATH: '/Users/test/planner',
      OCTOPUS_WORKSPACE_NAME: 'anna'
    })
  })

  /*
   * A workspace that cannot be deleted because a cleanup script is broken is a
   * worse problem than the one being cleaned up. Every way it can go wrong ends
   * the same: an answer rather than a throw.
   */
  it('reports a script that failed rather than raising', async () => {
    await writeScript('archive', 'planner', '#!/bin/sh\nexit 1\n', root)
    const failing: RunScript = () => Promise.reject(new Error('dropdb: database in use'))

    await expect(runArchiveScript('planner', values, root, failing)).resolves.toBe(
      'dropdb: database in use'
    )
  })

  // execFile can reject with something that is not an Error, and a workspace
  // must still go.
  it('reports a failure that was not an error object', async () => {
    const odd: RunScript = () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject('something')

    await expect(runArchiveScript('planner', values, root, odd)).resolves.toBe('something')
  })

  // A project that never wrote one is the normal case, not a failure.
  it('is a no-op where no script has been written', async () => {
    const missing: RunScript = () => Promise.reject(new Error('ENOENT'))

    await expect(runArchiveScript('planner', values, root, missing)).resolves.toBe('ENOENT')
  })

  it('gives the script a deadline', async () => {
    let timeout = 0
    const runner: RunScript = (_path, options) => {
      timeout = options.timeout
      return Promise.resolve()
    }

    await runArchiveScript('planner', values, root, runner)
    expect(timeout).toBeGreaterThan(0)
  })
})
