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
  defaultBranch: 'develop'
}

/** A script of the project's own, which is what the old arrangement always was. */
const ownScript: ResolvedScript = {
  kind: 'archive',
  source: 'project',
  from: '/data/projects/planner/scripts/archive.sh',
  run: { type: 'file', path: '/data/projects/planner/scripts/archive.sh' },
  contents: '#!/bin/sh\n'
}

/** One out of a repository's Conductor settings, which is a command line. */
const conductorScript: ResolvedScript = {
  kind: 'archive',
  source: 'repoConductor',
  from: '.conductor/settings.toml',
  run: { type: 'command', command: 'bash .conductor/archive.sh' },
  contents: 'bash .conductor/archive.sh'
}

/** Captures one invocation without spawning anything. */
function recorder(): {
  readonly runner: RunScript
  readonly seen: { file: string; args: readonly string[]; options: Parameters<RunScript>[2] }[]
} {
  const seen: { file: string; args: readonly string[]; options: Parameters<RunScript>[2] }[] = []
  return {
    seen,
    runner: (file, args, options) => {
      seen.push({ file, args, options })
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
    expect(call?.args).toEqual([])
    expect(call?.options.cwd).toBe('/tmp/anna')
    // No port among them, though one was passed: `scriptEnv` gives the ports to
    // the server script alone, and cleanup is not serving.
    expect(call?.options.env).toEqual({
      OCTOPUS_ROOT_PATH: '/Users/test/planner',
      OCTOPUS_WORKSPACE_NAME: 'Fix login bug',
      OCTOPUS_WORKSPACE_SLUG: 'fix_login_bug'
    })
  })

  it('hands a command line to a shell rather than trying to execute it', async () => {
    const { runner, seen } = recorder()

    await runArchiveScript(conductorScript, values, runner)

    const [call] = seen
    expect(call?.args).toEqual(['-c', 'bash .conductor/archive.sh'])
    expect(call?.file).not.toBe('bash .conductor/archive.sh')
  })

  it("gives a Conductor script Conductor's names, with the slug as the workspace", async () => {
    /*
     * The whole reason a project no longer keeps a wrapper script whose only
     * job was this translation. The slug rather than the label, so the name
     * their script drops and the name our env block wrote are one string.
     */
    const { runner, seen } = recorder()

    await runArchiveScript(conductorScript, values, runner)

    expect(seen[0]?.options.env).toMatchObject({
      CONDUCTOR_ROOT_PATH: '/Users/test/planner',
      CONDUCTOR_WORKSPACE_NAME: 'fix_login_bug',
      CONDUCTOR_DEFAULT_BRANCH: 'develop'
    })
    // Cleanup is not serving, so it gets no port under either vocabulary.
    expect(seen[0]?.options.env).not.toHaveProperty('CONDUCTOR_PORT')
  })

  it("keeps Conductor's names away from a script that is not one", async () => {
    const { runner, seen } = recorder()

    await runArchiveScript(ownScript, values, runner)

    expect(seen[0]?.options.env).not.toHaveProperty('CONDUCTOR_ROOT_PATH')
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
