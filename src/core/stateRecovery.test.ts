import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvalidFileError } from './persist.js'
import { inspectStateBackup, recoveryFor, restoreStateBackup } from './stateRecovery.js'
import { addProject, EMPTY_STATE, type Project, saveState } from './store.js'

function project(id: string): Project {
  return {
    id,
    name: id,
    repoPath: `/repos/${id}`,
    baseBranch: 'main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    approvedScripts: [],
    envProfile: 'default',
    trustRepoScripts: false,
    trustRepository: false,
    preferLocal: [],
    disabledSkillDefaults: [],
    color: 'blue'
  }
}

const TWO = addProject(addProject(EMPTY_STATE, project('planner')), project('esl'))

let dir: string
let statePath: string
let backupPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-recovery-'))
  statePath = join(dir, 'state.json')
  backupPath = join(dir, 'state.json.bak')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

describe('inspectStateBackup', () => {
  it('offers nothing when there is no backup', async () => {
    await expect(inspectStateBackup(backupPath)).resolves.toEqual({ kind: 'none' })
  })

  it('offers nothing for an empty backup', async () => {
    await writeFile(backupPath, '', 'utf8')
    await expect(inspectStateBackup(backupPath)).resolves.toEqual({ kind: 'none' })
  })

  it('offers nothing for a backup that is not JSON', async () => {
    await writeFile(backupPath, '{ not json', 'utf8')
    await expect(inspectStateBackup(backupPath)).resolves.toEqual({ kind: 'none' })
  })

  it('offers nothing for a backup of the wrong shape', async () => {
    await writeFile(backupPath, JSON.stringify({ projects: 'none' }), 'utf8')
    await expect(inspectStateBackup(backupPath)).resolves.toEqual({ kind: 'none' })
  })

  it('offers a good backup, with when it was saved and how many projects it holds', async () => {
    await saveState(TWO, backupPath, `${backupPath}.tmp`, join(dir, 'unused.bak'))
    const savedAt = new Date('2026-11-19T08:30:00.000Z')
    await utimes(backupPath, savedAt, savedAt)

    await expect(inspectStateBackup(backupPath)).resolves.toEqual({
      kind: 'backup',
      savedAt,
      projects: 2
    })
  })
})

describe('recoveryFor', () => {
  beforeEach(async () => {
    await saveState(TWO, backupPath, `${backupPath}.tmp`, join(dir, 'unused.bak'))
  })

  it('offers nothing for a failure that is not a damaged file', async () => {
    await expect(recoveryFor(new Error('EACCES'), statePath, backupPath)).resolves.toEqual({
      kind: 'none'
    })
  })

  // A damaged config.json is not something a state backup can mend.
  it('offers nothing for a damaged file that is not the state', async () => {
    const error = new InvalidFileError(join(dir, 'config.json'), 'Unexpected end of JSON input')

    await expect(recoveryFor(error, statePath, backupPath)).resolves.toEqual({ kind: 'none' })
  })

  it('offers the backup for a damaged state', async () => {
    const error = new InvalidFileError(statePath, 'Unexpected end of JSON input')

    await expect(recoveryFor(error, statePath, backupPath)).resolves.toMatchObject({
      kind: 'backup',
      projects: 2
    })
  })

  it('looks in the data root when given no paths', async () => {
    vi.stubEnv('OCTOPUS_DATA_DIR', dir)
    const error = new InvalidFileError(statePath, 'Unexpected end of JSON input')

    await expect(recoveryFor(error)).resolves.toMatchObject({ kind: 'backup', projects: 2 })
  })
})

describe('restoreStateBackup', () => {
  beforeEach(async () => {
    await saveState(TWO, backupPath, `${backupPath}.tmp`, join(dir, 'unused.bak'))
    await writeFile(statePath, '{ damaged', 'utf8')
  })

  it('puts the backup in place and keeps the damaged file as evidence', async () => {
    const kept = await restoreStateBackup(
      statePath,
      backupPath,
      () => new Date('2026-11-20T10:11:12.000Z')
    )

    expect(kept).toBe(join(dir, 'state.json.broken-2026-11-20T10-11-12.000Z'))
    await expect(readFile(kept, 'utf8')).resolves.toBe('{ damaged')
    await expect(readFile(statePath, 'utf8')).resolves.toBe(await readFile(backupPath, 'utf8'))
  })

  // Written whole over the damaged file, so the backup itself stays a separate inode.
  it('leaves the backup where it was', async () => {
    await restoreStateBackup(statePath, backupPath)

    expect((await stat(statePath)).ino).not.toBe((await stat(backupPath)).ino)
    await expect(readFile(backupPath, 'utf8')).resolves.toContain('planner')
  })

  it('names the evidence by the clock when none is given', async () => {
    const kept = await restoreStateBackup(statePath, backupPath)

    expect(kept).toMatch(/state\.json\.broken-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z$/u)
  })

  // Never a moment with no state.json: a start in between would read "first run".
  it('leaves the damaged file in place when the backup cannot be read', async () => {
    await rm(backupPath)

    await expect(restoreStateBackup(statePath, backupPath)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(statePath, 'utf8')).resolves.toBe('{ damaged')
  })
})
