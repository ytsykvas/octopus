import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyEnvOverrides, discardIfOnlyBlock, removeEnvBlock, readWorkspaceEnv } from './env.js'
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

/**
 * What the project holds, which the caller now supplies.
 *
 * `applyEnvOverrides` used to read it; it takes the body instead, so the choice
 * of *which* set of variables a workspace runs with is made once, where the
 * project and the workspace are both in hand.
 */
let stored = ''

function given(body: string): void {
  stored = body
}

describe('applyEnvOverrides', () => {
  // Last wins: every implementation of dotenv keeps the final definition, which
  // is the whole reason the block goes at the end rather than the start.
  it('writes the block after what was already there', async () => {
    await writeFile(join(workspace, '.env'), 'MYSQL_HOST=production\n', 'utf8')
    given('MYSQL_HOST=dev.example\n')

    await expect(applyEnvOverrides(stored, values())).resolves.toBe(true)

    const contents = await envFile()
    expect(contents.indexOf('production')).toBeLessThan(contents.indexOf('dev.example'))
  })

  /*
   * The answer for a project cloned from GitHub. A fresh clone has no `.env` to
   * copy — it is gitignored, so GitHub never had it — and this is what makes
   * the workspace runnable anyway.
   */
  it('creates the file where the workspace has none', async () => {
    given('API_KEY=secret\n')

    await applyEnvOverrides(stored, values())

    await expect(envFile()).resolves.toContain('API_KEY=secret')
  })

  it('replaces its own block rather than repeating it', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    given('A=2\n')
    await applyEnvOverrides(stored, values())

    const contents = await envFile()
    expect(contents).toContain('A=2')
    expect(contents).not.toContain('A=1')
    expect(contents.match(/>>> octopus/g)).toHaveLength(1)
  })

  // Two markers exist for exactly this: truncating at the opening one would eat
  // whatever somebody added inside the workspace afterwards.
  it('leaves a line added below the block alone', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    await writeFile(join(workspace, '.env'), `${await envFile()}MINE=kept\n`, 'utf8')
    await applyEnvOverrides(stored, values())

    await expect(envFile()).resolves.toContain('MINE=kept')
  })

  it('takes the block away when the project stops overriding anything', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    given('   \n')
    await expect(applyEnvOverrides(stored, values())).resolves.toBe(true)

    const contents = await envFile()
    expect(contents).toContain('FROM=checkout')
    expect(contents).not.toContain('octopus')
  })

  // Emptied and holding nothing else: the file goes, or `carryInto` would
  // refuse to write over it for ever after.
  it('removes a file the block was all of', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    given('')
    await applyEnvOverrides(stored, values())

    await expect(stat(join(workspace, '.env'))).rejects.toThrow()
  })

  it('writes nothing at all for a project that never overrode anything', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')

    await expect(applyEnvOverrides(stored, values())).resolves.toBe(false)
    await expect(envFile()).resolves.toBe('FROM=checkout\n')
  })

  // An opening marker with no closing one means the file was edited into a
  // shape we did not write; everything from it on is ours to replace.
  it('recovers from a block somebody broke open', async () => {
    given('A=1\n')
    await writeFile(join(workspace, '.env'), 'KEEP=1\n# >>> octopus: project overrides\nA=old\n')

    await applyEnvOverrides(stored, values())

    const contents = await envFile()
    expect(contents).toContain('KEEP=1')
    expect(contents).toContain('A=1')
    expect(contents).not.toContain('A=old')
  })

  it('writes the port the workspace actually holds, not the text', async () => {
    given('URL=http://localhost:$OCTOPUS_PORT\n')

    await applyEnvOverrides(stored, values())

    await expect(envFile()).resolves.toContain('URL=http://localhost:3100')
  })

  // Substituted on the way in, never in the stored block: the port can move
  // between runs, and a stored number would be yesterday's.
  it('follows the port when it moves', async () => {
    given('URL=http://localhost:$OCTOPUS_PORT\n')
    await applyEnvOverrides(stored, values())

    await applyEnvOverrides(stored, { ...values(), port: 3200 })

    const contents = await envFile()
    expect(contents).toContain('URL=http://localhost:3200')
    expect(contents).not.toContain('3100')
  })

  it('keeps the workspace file readable by its owner alone', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    const mode = (await stat(join(workspace, '.env'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  /*
   * The ordinary case, and the one the test above misses. A workspace's `.env`
   * is usually carried in from the checkout, where it is as readable as any
   * other file — and appending credentials to it must not leave it that way.
   */
  it('closes a file that was carried in readable by everybody', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', { encoding: 'utf8', mode: 0o644 })
    given('A=1\n')

    await applyEnvOverrides(stored, values())

    const mode = (await stat(join(workspace, '.env'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  // It is written inside a git worktree, where anything left over is an
  // untracked file somebody has to explain.
  it('leaves no temporary file in the workspace', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    await expect(stat(join(workspace, '.env.tmp'))).rejects.toThrow()
  })

  it('closes the file it empties, too', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', { encoding: 'utf8', mode: 0o644 })
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    given('')
    await applyEnvOverrides(stored, values())

    const mode = (await stat(join(workspace, '.env'))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('separates the block from a file that did not end in a newline', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout', 'utf8')
    given('A=1\n')

    await applyEnvOverrides(stored, values())

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
    given('A=1\n')
    await applyEnvOverrides(stored, values())

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

describe('discardIfOnlyBlock', () => {
  /*
   * The deadlock this breaks: `carryInto` never writes over a file the worktree
   * has, so a file holding only our own block kept the real one out for ever.
   * Removing it is safe because the block is written again moments later.
   */
  it('removes a file that is nothing but our block', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    await expect(discardIfOnlyBlock(workspace, '.env')).resolves.toBe(true)
    await expect(stat(join(workspace, '.env'))).rejects.toThrow()
  })

  it('keeps a file with a line of somebody else\u2019s in it', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())
    await writeFile(join(workspace, '.env'), `MINE=1\n${await envFile()}`, 'utf8')

    await expect(discardIfOnlyBlock(workspace, '.env')).resolves.toBe(false)
    await expect(envFile()).resolves.toContain('MINE=1')
  })

  it('keeps a file that holds no block at all', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')

    await expect(discardIfOnlyBlock(workspace, '.env')).resolves.toBe(false)
    await expect(envFile()).resolves.toBe('FROM=checkout\n')
  })

  it('says no where there is no file', async () => {
    await expect(discardIfOnlyBlock(workspace, '.env')).resolves.toBe(false)
  })

  it('reads whichever file the project named', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, { ...values(), envFile: '.env.local' })

    await expect(discardIfOnlyBlock(workspace, '.env.local')).resolves.toBe(true)
  })
})

describe('a block whose body carries our own markers', () => {
  // The file grew by a line on every prepare, without bound.
  it('does not grow the file run after run', async () => {
    given('A=1\n# >>> octopus: project overrides\nB=2\n# <<< octopus\n')

    await applyEnvOverrides(stored, values())
    const once = await envFile()
    await applyEnvOverrides(stored, values())
    await applyEnvOverrides(stored, values())

    await expect(envFile()).resolves.toBe(once)
  })

  it('keeps exactly one block, holding both variables', async () => {
    given('A=1\n# <<< octopus\nB=2\n')
    await applyEnvOverrides(stored, values())

    const contents = await envFile()
    expect(contents.match(/<<< octopus/g)).toHaveLength(1)
    expect(contents).toContain('A=1')
    expect(contents).toContain('B=2')
  })
})

describe('removeEnvBlock', () => {
  /*
   * For the file a project used to name. `applyEnvOverrides` only ever touches
   * the one named now, so changing the setting left a live block —
   * credentials, and a port frozen at the moment of the switch — in a file the
   * stack very likely still reads.
   */
  it('takes the block out and leaves the rest', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    await expect(removeEnvBlock(workspace, '.env')).resolves.toBe(true)

    const contents = await envFile()
    expect(contents).toBe('FROM=checkout\n')
  })

  // An empty file is still a file, and `carryInto` would refuse to write over
  // it — the same reason `applyEnvOverrides` removes one.
  it('removes a file the block was all of', async () => {
    given('A=1\n')
    await applyEnvOverrides(stored, values())

    await expect(removeEnvBlock(workspace, '.env')).resolves.toBe(true)
    await expect(stat(join(workspace, '.env'))).rejects.toThrow()
  })

  it('leaves a file with no block of ours alone', async () => {
    await writeFile(join(workspace, '.env'), 'FROM=checkout\n', 'utf8')

    await expect(removeEnvBlock(workspace, '.env')).resolves.toBe(false)
    await expect(envFile()).resolves.toBe('FROM=checkout\n')
  })

  it('says no where there is no file', async () => {
    await expect(removeEnvBlock(workspace, '.env.local')).resolves.toBe(false)
  })
})
