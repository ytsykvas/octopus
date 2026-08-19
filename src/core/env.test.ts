import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyEnvOverrides,
  projectEnvPath,
  readProjectEnv,
  WORKSPACE_ENV_FILE,
  writeProjectEnv
} from './env.js'

let root: string
let workspace: string

/** The workspace's `.env` as it stands. */
async function envFile(): Promise<string> {
  return readFile(join(workspace, WORKSPACE_ENV_FILE), 'utf8')
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-env-'))
  workspace = await mkdtemp(join(tmpdir(), 'octopus-worktree-'))
})
afterEach(async () => {
  for (const dir of [root, workspace]) await rm(dir, { recursive: true, force: true })
})

describe('projectEnvPath', () => {
  it('sits beside the project rather than in its scripts', () => {
    expect(projectEnvPath('planner', root)).toBe(join(root, 'projects', 'planner', 'env'))
  })

  it('falls back to the real root when none is given', () => {
    expect(projectEnvPath('planner')).toContain('.octopus')
  })
})

describe('readProjectEnv', () => {
  // No template: a variable nobody wrote has no value worth guessing at, and a
  // placeholder would end up in a real `.env`.
  it('is empty before anything has been written', async () => {
    await expect(readProjectEnv('planner', root)).resolves.toBe('')
  })

  it('reads back what was saved', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)
    await expect(readProjectEnv('planner', root)).resolves.toBe('API_KEY=secret\n')
  })

  it('keeps the block readable by its owner alone', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)

    const mode = (await stat(projectEnvPath('planner', root))).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('applyEnvOverrides', () => {
  // Last wins: every implementation of dotenv keeps the final definition, which
  // is the whole reason the block goes at the end rather than the start.
  it('writes the block after what was already there', async () => {
    await writeFile(join(workspace, '.env'), 'MYSQL_HOST=production\n', 'utf8')
    await writeProjectEnv('planner', 'MYSQL_HOST=dev.example\n', root)

    await expect(applyEnvOverrides('planner', workspace, root)).resolves.toBe(true)

    const contents = await envFile()
    expect(contents.indexOf('production')).toBeLessThan(contents.indexOf('dev.example'))
  })

  /*
   * The answer for a project cloned from GitHub. A fresh clone has no `.env` to
   * copy — it is gitignored, so GitHub never had it — and this is what makes
   * the workspace runnable anyway.
   */
  it('creates the file where the workspace has none', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)

    await applyEnvOverrides('planner', workspace, root)

    await expect(envFile()).resolves.toContain('API_KEY=secret')
  })

  it('replaces its own block rather than repeating it', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', workspace, root)

    await writeProjectEnv('planner', 'A=2\n', root)
    await applyEnvOverrides('planner', workspace, root)

    const contents = await envFile()
    expect(contents).toContain('A=2')
    expect(contents).not.toContain('A=1')
    expect(contents.match(/>>> octopus/g)).toHaveLength(1)
  })

  // Two markers exist for exactly this: truncating at the opening one would eat
  // whatever somebody added inside the workspace afterwards.
  it('leaves a line added below the block alone', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', workspace, root)

    await writeFile(join(workspace, '.env'), `${await envFile()}MINE=kept\n`, 'utf8')
    await applyEnvOverrides('planner', workspace, root)

    await expect(envFile()).resolves.toContain('MINE=kept')
  })

  it('takes the block away when the project stops overriding anything', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', workspace, root)

    await writeProjectEnv('planner', '   \n', root)
    await expect(applyEnvOverrides('planner', workspace, root)).resolves.toBe(true)

    const contents = await envFile()
    expect(contents).toContain('FROM=checkout')
    expect(contents).not.toContain('octopus')
  })

  it('writes nothing at all for a project that never overrode anything', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')

    await expect(applyEnvOverrides('planner', workspace, root)).resolves.toBe(false)
    await expect(envFile()).resolves.toBe('FROM=checkout\n')
  })

  // An opening marker with no closing one means the file was edited into a
  // shape we did not write; everything from it on is ours to replace.
  it('recovers from a block somebody broke open', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await writeFile(join(workspace, '.env'), 'KEEP=1\n# >>> octopus: project overrides\nA=old\n')

    await applyEnvOverrides('planner', workspace, root)

    const contents = await envFile()
    expect(contents).toContain('KEEP=1')
    expect(contents).toContain('A=1')
    expect(contents).not.toContain('A=old')
  })

  it('keeps the workspace file readable by its owner alone', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', workspace, root)

    const mode = (await stat(join(workspace, '.env'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('separates the block from a file that did not end in a newline', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout', 'utf8')
    await writeProjectEnv('planner', 'A=1\n', root)

    await applyEnvOverrides('planner', workspace, root)

    await expect(envFile()).resolves.toContain('FROM=checkout\n')
  })
})
