import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitIn } from './git.js'
import { type FieldsOf, resolveProjectFields } from './projectFields.js'

const run = promisify(execFile)

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'octopus-fields-'))
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: repo })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  await run('git', ['config', 'user.name', 'Test'], { cwd: repo })
  await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
  await run('git', ['add', '.'], { cwd: repo })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: repo })
  await run('git', ['branch', 'develop'], { cwd: repo })
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

const OWN: FieldsOf = {
  baseBranch: 'main',
  envFile: '.env',
  preferBaseBranch: false,
  preferEnvFile: false
}

function resolve(
  stated: Parameters<typeof resolveProjectFields>[0],
  project: FieldsOf = OWN
): ReturnType<typeof resolveProjectFields> {
  return resolveProjectFields(stated, project, gitIn(repo))
}

describe('resolveProjectFields', () => {
  it("keeps the project's own where the repository states nothing", async () => {
    await expect(resolve(null)).resolves.toEqual({
      baseBranch: {
        value: 'main',
        layer: 'project',
        repository: null,
        project: 'main',
        warning: null
      },
      envFile: { value: '.env', layer: 'project', repository: null, project: '.env', warning: null }
    })
  })

  it("takes the repository's base branch when the checkout has it", async () => {
    await expect(resolve({ baseBranch: 'develop' })).resolves.toMatchObject({
      baseBranch: { value: 'develop', layer: 'repository', repository: 'develop', project: 'main' }
    })
  })

  // Otherwise the failure surfaces much later as a `worktree add` that says
  // nothing about settings.
  it("keeps the project's own base branch when the checkout lacks the stated one", async () => {
    await expect(resolve({ baseBranch: 'release' })).resolves.toMatchObject({
      baseBranch: { value: 'main', layer: 'project', warning: 'baseBranchMissing' }
    })
  })

  it("takes the repository's env file when git ignores it", async () => {
    await expect(resolve({ envFile: '.env.local' })).resolves.toMatchObject({
      envFile: { value: '.env.local', layer: 'repository' }
    })
  })

  /*
   * Credentials are written into this file. One git would commit — a tracked
   * config, say — would publish them, so the repository cannot name it.
   */
  it('refuses an env file git would commit', async () => {
    await expect(resolve({ envFile: 'config/app.yml' })).resolves.toMatchObject({
      envFile: { value: '.env', layer: 'project', warning: 'envFileNotIgnored' }
    })
  })

  it('refuses an env file outside the worktree', async () => {
    await expect(resolve({ envFile: '../elsewhere/.env' })).resolves.toMatchObject({
      envFile: { value: '.env', layer: 'project', warning: 'envFileOutside' }
    })
  })

  it("keeps the user's own when they chose it, with the repository's shown beside it", async () => {
    await expect(
      resolve(
        { baseBranch: 'develop', envFile: '.env.local' },
        { ...OWN, preferBaseBranch: true, preferEnvFile: true }
      )
    ).resolves.toEqual({
      baseBranch: {
        value: 'main',
        layer: 'project',
        repository: 'develop',
        project: 'main',
        warning: null
      },
      envFile: {
        value: '.env',
        layer: 'project',
        repository: '.env.local',
        project: '.env',
        warning: null
      }
    })
  })

  // A file that is there and cannot be believed is not a repository stating
  // nothing, and the window says which.
  it('says when the project file could not be read', async () => {
    await expect(resolve('unreadable')).resolves.toMatchObject({
      baseBranch: { value: 'main', repository: null, warning: 'projectFileUnreadable' },
      envFile: { value: '.env', repository: null, warning: 'projectFileUnreadable' }
    })
  })
})
