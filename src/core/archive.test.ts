import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ARCHIVE_OUTPUT_TAIL_BYTES,
  type RunScript,
  runArchiveScript,
  spawnInGroup,
  type SpawnInGroupDeps
} from './archive.js'
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

/*
 * The runner itself, on a real `/bin/sh`: what is being decided — which
 * process a deadline reaches, which event ends the wait — is the operating
 * system's to answer, and a fake would only restate the assumption.
 */
describe('spawnInGroup', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopus-archive-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** Writes an executable script into the directory and answers its path. */
  async function script(body: string, mode = 0o755): Promise<string> {
    const path = join(dir, 'archive.sh')
    await writeFile(path, `#!/bin/sh\n${body}\n`, { mode })
    return path
  }

  /** Whether a process is still there; signal 0 asks without sending anything. */
  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  async function pidIn(name: string): Promise<number> {
    return Number((await readFile(join(dir, name), 'utf8')).trim())
  }

  // `execFile` stops at 1 MiB and reports a script that cleaned up fine as failed.
  it('succeeds however much the script writes', async () => {
    const file = await script('yes | head -c 3000000; yes | head -c 3000000 >&2; exit 0')

    await expect(
      spawnInGroup(file, { cwd: dir, env: {}, timeout: 10_000 })
    ).resolves.toBeUndefined()
  })

  it('reports the script and the end of stderr when it fails', async () => {
    const file = await script('echo nope >&2; exit 3')

    await expect(spawnInGroup(file, { cwd: dir, env: {}, timeout: 10_000 })).rejects.toThrow(
      `Command failed: ${file}\nnope`
    )
  })

  it('keeps only the end of a long stderr', async () => {
    const file = await script('yes x | head -c 200000 >&2; echo last >&2; exit 1')

    const error: unknown = await spawnInGroup(file, { cwd: dir, env: {}, timeout: 10_000 }).catch(
      (failure: unknown) => failure
    )

    expect(error).toBeInstanceOf(Error)
    const message = error instanceof Error ? error.message : ''
    expect(message.endsWith('\nlast')).toBe(true)
    expect(message.length).toBeLessThan(ARCHIVE_OUTPUT_TAIL_BYTES + file.length + 100)
  })

  it('hands the script its environment over the process’s own', async () => {
    const file = await script('test "$OCTOPUS_WORKSPACE_SLUG" = anna && test -n "$PATH"')

    await expect(
      spawnInGroup(file, { cwd: dir, env: { OCTOPUS_WORKSPACE_SLUG: 'anna' }, timeout: 10_000 })
    ).resolves.toBeUndefined()
  })

  // `docker compose` and `psql` outlive a SIGTERM sent to the script alone.
  it('stops the whole group at the deadline', async () => {
    const file = await script('sleep 30 & echo $! > child.pid; wait')

    await expect(spawnInGroup(file, { cwd: dir, env: {}, timeout: 200 })).rejects.toThrow(
      `Command failed: ${file} (timed out after 0.2 s)`
    )
    const child = await pidIn('child.pid')
    await vi.waitFor(() => {
      expect(alive(child)).toBe(false)
    })
  })

  it('kills a group that ignores the polite signal', async () => {
    // An ignored signal stays ignored across exec, so `sleep` ignores it too.
    const file = await script("trap '' TERM; sleep 30 & echo $! > child.pid; wait")

    await expect(
      spawnInGroup(file, { cwd: dir, env: {}, timeout: 200 }, { graceMs: 50 })
    ).rejects.toThrow('timed out')
    const child = await pidIn('child.pid')
    await vi.waitFor(() => {
      expect(alive(child)).toBe(false)
    })
  })

  it('tolerates a group that is gone before it is signalled', async () => {
    const file = await script('sleep 30')
    const kill = (pid: number, signal?: string | number): true => {
      process.kill(pid, signal)
      throw new Error('ESRCH')
    }

    await expect(
      spawnInGroup(file, { cwd: dir, env: {}, timeout: 100 }, { kill, graceMs: 50 })
    ).rejects.toThrow('timed out')
  })

  // `close` would wait for every holder of the pipe, a backgrounded grandchild included.
  it('finishes when the script exits even if a grandchild holds its output', async () => {
    const file = await script('(sleep 5 >&2 & echo $! > grand.pid); exit 0')
    const started = Date.now()

    try {
      await expect(
        spawnInGroup(file, { cwd: dir, env: {}, timeout: 10_000 })
      ).resolves.toBeUndefined()
      expect(Date.now() - started).toBeLessThan(2_000)
    } finally {
      process.kill(await pidIn('grand.pid'), 'SIGKILL')
    }
  })

  it('says the directory was gone rather than blaming the script', async () => {
    const file = await script('exit 0')
    const spawn = vi.fn()
    const gone = join(dir, 'anna')

    await expect(
      spawnInGroup(file, { cwd: gone, env: {}, timeout: 10_000 }, { spawn })
    ).rejects.toThrow(
      `The workspace directory ${gone} was already gone, so archive.sh did not run.`
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('passes on a directory it cannot look at', async () => {
    const file = await script('exit 0')
    const spawn = vi.fn()

    await expect(
      spawnInGroup(file, { cwd: join(file, 'inside'), env: {}, timeout: 10_000 }, { spawn })
    ).rejects.toMatchObject({ code: 'ENOTDIR' })
    expect(spawn).not.toHaveBeenCalled()
  })

  // Node may or may not send `exit` after `error`; the first one is the answer.
  it('answers once when a failure to start is followed by an exit', async () => {
    const file = await script('exit 0')
    const child = Object.assign(new EventEmitter(), { pid: 1, stderr: new PassThrough() })
    const spawn = (() => {
      setImmediate(() => {
        child.emit('error', new Error('spawn failed'))
        child.emit('exit', 1, null)
      })
      return child
    }) as unknown as NonNullable<SpawnInGroupDeps['spawn']>

    await expect(
      spawnInGroup(file, { cwd: dir, env: {}, timeout: 10_000 }, { spawn })
    ).rejects.toThrow('spawn failed')
  })

  it('passes on a script that cannot be started', async () => {
    const file = await script('exit 0', 0o644)

    await expect(spawnInGroup(file, { cwd: dir, env: {}, timeout: 10_000 })).rejects.toMatchObject({
      code: 'EACCES'
    })
  })

  it('is what runs the cleanup when no runner is given', async () => {
    const gone = join(dir, 'anna')

    await expect(runArchiveScript(ownScript, { ...values, path: gone })).resolves.toBe(
      `The workspace directory ${gone} was already gone, so archive.sh did not run.`
    )
  })
})
