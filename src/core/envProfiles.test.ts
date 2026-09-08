import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PROFILE } from './envProfileNames.js'
import {
  createProfile,
  effectiveProfile,
  listProfiles,
  migrateEnvProfiles,
  readEffectiveEnv,
  readProfile,
  removeProfile,
  renameProfile,
  writeProfile
} from './envProfiles.js'
import { projectDir, projectEnv, projectEnvProfile, projectEnvsDir } from './paths.js'
import type { Project, Workspace } from './store.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-profiles-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** The single file a project used to keep, before profiles had names. */
async function givenLegacyEnv(body: string): Promise<void> {
  await mkdir(projectDir('planner', root), { recursive: true })
  await writeFile(projectEnv('planner', root), body, { encoding: 'utf8', mode: 0o600 })
}

const project = (overrides: Partial<Project> = {}): Project =>
  ({
    id: 'planner',
    name: 'planner',
    repoPath: '/repos/planner',
    baseBranch: 'main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    approvedScripts: [],
    envProfile: 'dev',
    ...overrides
  }) as Project

const workspace = (envProfile: string | null): Workspace => ({
  id: 'planner/anna',
  projectId: 'planner',
  name: 'anna',
  branch: 'ytsykvas/anna',
  path: '/ws/anna',
  status: 'idle',
  port: 3100,
  createdAt: '2026-08-07T12:00:00.000Z',
  envProfile,
  writers: {},
  notes: '',
  ownerId: null
})

describe('migrateEnvProfiles', () => {
  it("moves the project's single file into the directory, keeping its mode", async () => {
    await givenLegacyEnv('API_KEY=secret\n')

    await expect(migrateEnvProfiles('planner', root)).resolves.toBe(true)

    // Moved, not copied: a second file of stale credentials that nothing ever
    // mentions again is worse than the risk this avoids.
    await expect(stat(projectEnv('planner', root))).rejects.toThrow()
    await expect(readProfile('planner', DEFAULT_PROFILE, root)).resolves.toBe('API_KEY=secret\n')

    const mode = (await stat(projectEnvProfile('planner', DEFAULT_PROFILE, root))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('gives the directory to a project that never wrote a variable', async () => {
    await mkdir(projectDir('planner', root), { recursive: true })

    await expect(migrateEnvProfiles('planner', root)).resolves.toBe(true)
    await expect(readdir(projectEnvsDir('planner', root))).resolves.toEqual([])
  })

  it('keeps the names of its own sets out of a listing', async () => {
    // "prod" is information about this machine even when its contents are not.
    await givenLegacyEnv('A=1\n')
    await migrateEnvProfiles('planner', root)

    const mode = (await stat(projectEnvsDir('planner', root))).mode & 0o777
    expect(mode).toBe(0o700)
  })

  it('does nothing the second time, because the directory is the marker', async () => {
    await givenLegacyEnv('A=1\n')
    await migrateEnvProfiles('planner', root)
    await writeProfile('planner', DEFAULT_PROFILE, 'A=2\n', root)

    await expect(migrateEnvProfiles('planner', root)).resolves.toBe(false)
    await expect(readProfile('planner', DEFAULT_PROFILE, root)).resolves.toBe('A=2\n')
  })
})

describe('listProfiles', () => {
  it('has nothing to list for a project with no directory', async () => {
    await expect(listProfiles('planner', root)).resolves.toEqual([])
  })

  it('sorts what it finds and ignores what is not a name', async () => {
    /*
     * `writeTextFile` writes its temporary file as a sibling, so a crash
     * between write and rename leaves `prod.tmp` in here — and a name with a
     * dot in it is not one this accepts.
     */
    await writeProfile('planner', 'prod', 'A=1\n', root)
    await writeProfile('planner', 'dev', 'A=1\n', root)
    await writeFile(join(projectEnvsDir('planner', root), 'prod.tmp'), 'half', 'utf8')
    await writeFile(join(projectEnvsDir('planner', root), '.DS_Store'), '', 'utf8')

    await expect(listProfiles('planner', root)).resolves.toEqual(['dev', 'prod'])
  })
})

describe('readProfile and writeProfile', () => {
  it('answers with nothing for a set that was never written', async () => {
    // No template, unlike a script: a variable nobody wrote has no value worth
    // guessing at, and a placeholder would end up in a real `.env`.
    await expect(readProfile('planner', 'dev', root)).resolves.toBe('')
  })

  it('writes so that only its owner can read it', async () => {
    await writeProfile('planner', 'dev', 'API_KEY=secret\n', root)

    const mode = (await stat(projectEnvProfile('planner', 'dev', root))).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('refuses a name that could not be a file in that directory', async () => {
    for (const name of ['../escape', 'a/b', 'Prod', '', '.hidden']) {
      await expect(writeProfile('planner', name, 'A=1\n', root)).rejects.toMatchObject({
        code: 'envProfileName'
      })
    }
  })

  it('refuses an uppercase name, which macOS would treat as the same file', async () => {
    // `Prod` and `prod` would be one file under two names in `state.json`.
    await expect(createProfile('planner', 'Prod', null, root)).rejects.toMatchObject({
      code: 'envProfileName'
    })
  })
})

describe('createProfile', () => {
  it('adds an empty one', async () => {
    await createProfile('planner', 'dev', null, root)

    await expect(listProfiles('planner', root)).resolves.toEqual(['dev'])
    await expect(readProfile('planner', 'dev', root)).resolves.toBe('')
  })

  it('copies another when asked, body and mode', async () => {
    await writeProfile('planner', 'dev', 'MYSQL_DATABASE=xibodb\n', root)

    await createProfile('planner', 'prod', 'dev', root)

    await expect(readProfile('planner', 'prod', root)).resolves.toBe('MYSQL_DATABASE=xibodb\n')
    expect((await stat(projectEnvProfile('planner', 'prod', root))).mode & 0o777).toBe(0o600)
  })

  it('refuses a name already taken rather than writing over it', async () => {
    await writeProfile('planner', 'dev', 'A=1\n', root)

    await expect(createProfile('planner', 'dev', null, root)).rejects.toMatchObject({
      code: 'envProfileExists'
    })
  })
})

describe('renameProfile', () => {
  it('renames the file', async () => {
    await writeProfile('planner', 'dev', 'A=1\n', root)

    await renameProfile('planner', 'dev', 'staging', root)

    await expect(listProfiles('planner', root)).resolves.toEqual(['staging'])
    await expect(readProfile('planner', 'staging', root)).resolves.toBe('A=1\n')
  })

  it('refuses to rename one that is not there', async () => {
    await expect(renameProfile('planner', 'dev', 'staging', root)).rejects.toMatchObject({
      code: 'envProfileMissing'
    })
  })

  it('refuses to rename over another', async () => {
    await writeProfile('planner', 'dev', 'A=1\n', root)
    await writeProfile('planner', 'prod', 'A=2\n', root)

    await expect(renameProfile('planner', 'dev', 'prod', root)).rejects.toMatchObject({
      code: 'envProfileExists'
    })
  })

  it('refuses a new name that could not be a file', async () => {
    await writeProfile('planner', 'dev', 'A=1\n', root)

    await expect(renameProfile('planner', 'dev', '../out', root)).rejects.toMatchObject({
      code: 'envProfileName'
    })
  })
})

describe('removeProfile', () => {
  it('deletes it', async () => {
    await writeProfile('planner', 'dev', 'A=1\n', root)

    await removeProfile('planner', 'dev', root)

    await expect(listProfiles('planner', root)).resolves.toEqual([])
  })

  it('is content with one that is already gone', async () => {
    await expect(removeProfile('planner', 'dev', root)).resolves.toBeUndefined()
  })

  it('refuses a name that could not be a file', async () => {
    await expect(removeProfile('planner', 'a/b', root)).rejects.toMatchObject({
      code: 'envProfileName'
    })
  })
})

describe('effectiveProfile', () => {
  it('follows the project when the workspace has not been moved', () => {
    expect(effectiveProfile(project(), workspace(null))).toBe('dev')
  })

  it('lets a workspace sit on one of its own', () => {
    expect(effectiveProfile(project(), workspace('prod'))).toBe('prod')
  })
})

describe('readEffectiveEnv', () => {
  it('reads what that workspace would be written', async () => {
    await writeProfile('planner', 'dev', 'A=dev\n', root)
    await writeProfile('planner', 'prod', 'A=prod\n', root)

    await expect(readEffectiveEnv(project(), workspace(null), root)).resolves.toBe('A=dev\n')
    await expect(readEffectiveEnv(project(), workspace('prod'), root)).resolves.toBe('A=prod\n')
  })

  it('answers with nothing when the set has gone, never with the default', async () => {
    /*
     * The failure this whole module exists to prevent. A workspace pinned to
     * `prod` whose file vanished must not quietly receive `dev`; an empty block
     * fails the run loudly, on a variable the app never wrote.
     */
    await writeProfile('planner', 'dev', 'A=dev\n', root)

    await expect(readEffectiveEnv(project(), workspace('prod'), root)).resolves.toBe('')
  })
})
