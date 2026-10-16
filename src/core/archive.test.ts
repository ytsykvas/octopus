import { describe, expect, it } from 'vitest'

import { type RunScript, runArchiveScript } from './archive.js'
import type { ResolvedScript } from './repoSource.js'

const values = {
  rootPath: '/Users/test/planner',
  // Capitalised and spaced on purpose: the slug is what a cleanup script has to
  // name a database with, and the raw label is what it must not be.
  workspaceName: 'Fix login bug',
  path: '/tmp/anna',
  port: 3100,
  profile: 'prod',
  variables: { DUMP_URL: 's3://prod/latest.sql' }
}

/** A script of the project's own, which is what the old arrangement always was. */
const ownScript: ResolvedScript = {
  kind: 'archive',
  source: 'project',
  from: '/data/projects/planner/scripts/archive.sh',
  path: '/data/projects/planner/scripts/archive.sh',
  contents: '#!/bin/sh\n'
}

/** Captures one invocation without spawning anything. */
function recorder(): {
  readonly runner: RunScript
  readonly seen: { file: string; options: Parameters<RunScript>[1] }[]
} {
  const seen: { file: string; options: Parameters<RunScript>[1] }[] = []
  return {
    seen,
    runner: (file, options) => {
      seen.push({ file, options })
      return Promise.resolve()
    }
  }
}

describe('runArchiveScript', () => {
  it('does nothing at all when no script is supplied', async () => {
    const { runner, seen } = recorder()

    await expect(runArchiveScript(null, values, runner)).resolves.toBeNull()
    expect(seen).toEqual([])
  })

  it('executes a file in the workspace, with the workspace environment', async () => {
    const { runner, seen } = recorder()

    await expect(runArchiveScript(ownScript, values, runner)).resolves.toBeNull()

    const [call] = seen
    expect(call?.file).toBe('/data/projects/planner/scripts/archive.sh')
    expect(call?.options.cwd).toBe('/tmp/anna')
    // No port among them, though one was passed: `scriptEnv` gives the ports to
    // the server script alone, and cleanup is not serving.
    expect(call?.options.env).toEqual({
      DUMP_URL: 's3://prod/latest.sql',
      OCTOPUS_ROOT_PATH: '/Users/test/planner',
      OCTOPUS_WORKSPACE_NAME: 'Fix login bug',
      OCTOPUS_WORKSPACE_SLUG: 'fix_login_bug',
      OCTOPUS_ENV_PROFILE: 'prod'
    })
  })

  it('lets none of the set\u2019s variables replace one of ours', async () => {
    // The cleanup drops what the build made; a set that named the checkout
    // would point it at somebody else's.
    const { runner, seen } = recorder()

    await runArchiveScript(
      ownScript,
      { ...values, variables: { OCTOPUS_ROOT_PATH: '/elsewhere', OCTOPUS_ENV_PROFILE: 'dev' } },
      runner
    )

    expect(seen[0]?.options.env).toMatchObject({
      OCTOPUS_ROOT_PATH: '/Users/test/planner',
      OCTOPUS_ENV_PROFILE: 'prod'
    })
  })

  /*
   * A workspace that cannot be deleted because a cleanup script is broken is a
   * worse problem than the one being cleaned up. Every way it can go wrong ends
   * the same: a message for the caller, and the removal continues.
   */
  it('answers with the failure rather than throwing it', async () => {
    const failing: RunScript = () => Promise.reject(new Error('dropdb: no such database'))

    await expect(runArchiveScript(ownScript, values, failing)).resolves.toBe(
      'dropdb: no such database'
    )
  })

  it('answers with something readable when what failed was not an error', async () => {
    // execFile can reject with something that is not an Error, and a workspace
    // must still go.
    const odd: RunScript = () =>
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      Promise.reject('something')

    await expect(runArchiveScript(ownScript, values, odd)).resolves.toBe('something')
  })

  it('gives the script a deadline', async () => {
    const { runner, seen } = recorder()

    await runArchiveScript(ownScript, values, runner)
    expect(seen[0]?.options.timeout).toBeGreaterThan(0)
  })
})
