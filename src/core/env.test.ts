import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyEnvOverrides,
  projectEnvPath,
  readProjectEnv,
  readWorkspaceEnv,
  writeProjectEnv
} from './env.js'
import type { WorkspaceValues } from './envBlock.js'

let root: string
let workspace: string

/** The values a workspace stands for while the block is written. */
function values(): WorkspaceValues {
  return {
    path: workspace,
    envFile: '.env',
    rootPath: '/Users/test/planner',
    workspaceName: 'anna',
    port: 3100
  }
}

/** The workspace's `.env` as it stands. */
async function envFile(): Promise<string> {
  return readFile(join(workspace, '.env'), 'utf8')
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

    await expect(applyEnvOverrides('planner', values(), root)).resolves.toBe(true)

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

    await applyEnvOverrides('planner', values(), root)

    await expect(envFile()).resolves.toContain('API_KEY=secret')
  })

  it('replaces its own block rather than repeating it', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', values(), root)

    await writeProjectEnv('planner', 'A=2\n', root)
    await applyEnvOverrides('planner', values(), root)

    const contents = await envFile()
    expect(contents).toContain('A=2')
    expect(contents).not.toContain('A=1')
    expect(contents.match(/>>> octopus/g)).toHaveLength(1)
  })

  // Two markers exist for exactly this: truncating at the opening one would eat
  // whatever somebody added inside the workspace afterwards.
  it('leaves a line added below the block alone', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', values(), root)

    await writeFile(join(workspace, '.env'), `${await envFile()}MINE=kept\n`, 'utf8')
    await applyEnvOverrides('planner', values(), root)

    await expect(envFile()).resolves.toContain('MINE=kept')
  })

  it('takes the block away when the project stops overriding anything', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', values(), root)

    await writeProjectEnv('planner', '   \n', root)
    await expect(applyEnvOverrides('planner', values(), root)).resolves.toBe(true)

    const contents = await envFile()
    expect(contents).toContain('FROM=checkout')
    expect(contents).not.toContain('octopus')
  })

  it('writes nothing at all for a project that never overrode anything', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')

    await expect(applyEnvOverrides('planner', values(), root)).resolves.toBe(false)
    await expect(envFile()).resolves.toBe('FROM=checkout\n')
  })

  // An opening marker with no closing one means the file was edited into a
  // shape we did not write; everything from it on is ours to replace.
  it('recovers from a block somebody broke open', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await writeFile(join(workspace, '.env'), 'KEEP=1\n# >>> octopus: project overrides\nA=old\n')

    await applyEnvOverrides('planner', values(), root)

    const contents = await envFile()
    expect(contents).toContain('KEEP=1')
    expect(contents).toContain('A=1')
    expect(contents).not.toContain('A=old')
  })

  it('writes the port the workspace actually holds, not the text', async () => {
    await writeProjectEnv('planner', 'URL=http://localhost:$OCTOPUS_PORT\n', root)

    await applyEnvOverrides('planner', values(), root)

    await expect(envFile()).resolves.toContain('URL=http://localhost:3100')
  })

  // Substituted on the way in, never in the stored block: the port can move
  // between runs, and a stored number would be yesterday's.
  it('follows the port when it moves', async () => {
    await writeProjectEnv('planner', 'URL=http://localhost:$OCTOPUS_PORT\n', root)
    await applyEnvOverrides('planner', values(), root)

    await applyEnvOverrides('planner', { ...values(), port: 3200 }, root)

    const contents = await envFile()
    expect(contents).toContain('URL=http://localhost:3200')
    expect(contents).not.toContain('3100')
  })

  it('keeps the workspace file readable by its owner alone', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', values(), root)

    const mode = (await stat(join(workspace, '.env'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('separates the block from a file that did not end in a newline', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout', 'utf8')
    await writeProjectEnv('planner', 'A=1\n', root)

    await applyEnvOverrides('planner', values(), root)

    await expect(envFile()).resolves.toContain('FROM=checkout\n')
  })
})

describe('readWorkspaceEnv', () => {
  /*
   * The file itself, never a reconstruction from the project's block: what the
   * scripts read includes the carried lines, a hand edit made inside the
   * worktree and the port as it was actually settled.
   */
  it('is the file as it stands, block and all', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')
    await writeProjectEnv('planner', 'A=1\n', root)
    await applyEnvOverrides('planner', values(), root)

    const contents = await readWorkspaceEnv(workspace, '.env')

    expect(contents).toContain('FROM=checkout')
    expect(contents).toContain('A=1')
  })

  it('reads whichever file the project named', async () => {
    await writeFile(join(workspace, '.env.local'), 'A=1\n', 'utf8')

    await expect(readWorkspaceEnv(workspace, '.env.local')).resolves.toBe('A=1\n')
  })

  // The ordinary state of a workspace whose project adds nothing, and the
  // caller says so rather than showing an empty box.
  it('answers with nothing where there is no file', async () => {
    await expect(readWorkspaceEnv(workspace, '.env')).resolves.toBeNull()
  })
})
