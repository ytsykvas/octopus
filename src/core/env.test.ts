import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  WORKSPACE_ENV_FILE,
  applyProjectEnv,
  projectEnvPath,
  readProjectEnv,
  writeProjectEnv
} from './env.js'

let root: string
let workspace: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-env-'))
  workspace = await mkdtemp(join(tmpdir(), 'octopus-worktree-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

describe('projectEnvPath', () => {
  it('puts the file beside the project rather than in its scripts', () => {
    expect(projectEnvPath('planner', root)).toBe(join(root, 'projects', 'planner', 'env'))
  })

  it('keeps projects apart', () => {
    expect(projectEnvPath('planner', root)).not.toBe(projectEnvPath('esl', root))
  })

  it('falls back to the real root when none is given', () => {
    expect(projectEnvPath('planner')).toContain('.octopus')
  })
})

describe('readProjectEnv', () => {
  // No template, unlike a script: an env nobody wrote has no contents to guess.
  it('is empty rather than failing when nothing has been written', async () => {
    await expect(readProjectEnv('planner', root)).resolves.toBe('')
  })

  it('returns what was written', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)
    await expect(readProjectEnv('planner', root)).resolves.toBe('API_KEY=secret\n')
  })

  it('does not confuse two projects', async () => {
    await writeProjectEnv('planner', 'FROM=planner\n', root)
    await writeProjectEnv('esl', 'FROM=esl\n', root)

    await expect(readProjectEnv('planner', root)).resolves.toBe('FROM=planner\n')
    await expect(readProjectEnv('esl', root)).resolves.toBe('FROM=esl\n')
  })
})

describe('writeProjectEnv', () => {
  it('creates the project directory on the way', async () => {
    await writeProjectEnv('never-seen', 'A=1\n', root)
    await expect(readFile(projectEnvPath('never-seen', root), 'utf8')).resolves.toBe('A=1\n')
  })

  // It holds credentials: the 0o755 a script gets would be wrong twice over.
  it('keeps the file readable by its owner alone', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)

    const mode = (await stat(projectEnvPath('planner', root))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('replaces an earlier body rather than appending to it', async () => {
    await writeProjectEnv('planner', 'A=1\n', root)
    await writeProjectEnv('planner', 'B=2\n', root)

    await expect(readProjectEnv('planner', root)).resolves.toBe('B=2\n')
  })
})

describe('applyProjectEnv', () => {
  it('writes the project env into the workspace', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)

    await expect(applyProjectEnv('planner', workspace, root)).resolves.toBe(true)
    await expect(readFile(join(workspace, WORKSPACE_ENV_FILE), 'utf8')).resolves.toBe(
      'API_KEY=secret\n'
    )
  })

  it('carries the same permissions into the workspace', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)
    await applyProjectEnv('planner', workspace, root)

    const mode = (await stat(join(workspace, WORKSPACE_ENV_FILE))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('writes nothing when the project has no env', async () => {
    await expect(applyProjectEnv('planner', workspace, root)).resolves.toBe(false)
    await expect(readFile(join(workspace, WORKSPACE_ENV_FILE), 'utf8')).rejects.toThrow()
  })

  // An empty `.env` is not neutral: some tools prefer it to their own defaults.
  it('treats a blank body as nothing to copy', async () => {
    await writeProjectEnv('planner', '   \n\n', root)

    await expect(applyProjectEnv('planner', workspace, root)).resolves.toBe(false)
    await expect(readFile(join(workspace, WORKSPACE_ENV_FILE), 'utf8')).rejects.toThrow()
  })

  it('leaves a file the workspace already has untouched', async () => {
    await writeProjectEnv('planner', 'API_KEY=project\n', root)
    await writeFile(join(workspace, WORKSPACE_ENV_FILE), 'API_KEY=edited by hand\n', 'utf8')

    await expect(applyProjectEnv('planner', workspace, root)).resolves.toBe(false)
    await expect(readFile(join(workspace, WORKSPACE_ENV_FILE), 'utf8')).resolves.toBe(
      'API_KEY=edited by hand\n'
    )
  })

  // Anything other than "already there" is a real failure: a build that starts
  // without its env fails for reasons nowhere on screen.
  it('reports a failure that is not an existing file', async () => {
    await writeProjectEnv('planner', 'API_KEY=secret\n', root)

    const readOnly = join(workspace, 'locked')
    await mkdir(readOnly)
    await chmod(readOnly, 0o500)

    await expect(applyProjectEnv('planner', readOnly, root)).rejects.toThrow()

    await chmod(readOnly, 0o700)
  })
})
