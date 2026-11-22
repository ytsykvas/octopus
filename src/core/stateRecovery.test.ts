import { rmSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InvalidFileError } from './persist.js'
import {
  inspectStateBackup,
  openWithRecovery,
  recoveryFor,
  restoreStateBackup
} from './stateRecovery.js'
import { addProject, EMPTY_STATE, loadState, saveState } from './store.js'
import { makeProject } from './test/projects.js'

const TWO = addProject(addProject(EMPTY_STATE, makeProject('planner')), makeProject('esl'))

let dir: string
let statePath: string
let backupPath: string

/** A backup holding two projects, written the way a save writes one. */
async function writeGoodBackup(): Promise<void> {
  await saveState(TWO, backupPath)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-recovery-'))
  statePath = join(dir, 'state.json')
  backupPath = join(dir, 'state.json.bak')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('inspectStateBackup', () => {
  it.each([
    ['there is no backup', null],
    ['the backup is empty', ''],
    ['the backup is not JSON', '{ not json'],
    ['the backup is of the wrong shape', JSON.stringify({ projects: 'none' })]
  ])('offers nothing when %s', async (_case, contents) => {
    if (contents !== null) await writeFile(backupPath, contents, 'utf8')
    await expect(inspectStateBackup(backupPath)).resolves.toBeNull()
  })

  it('offers a good backup, with when it was saved and how many projects it holds', async () => {
    await writeGoodBackup()
    const savedAt = new Date('2026-11-19T08:30:00.000Z')
    await utimes(backupPath, savedAt, savedAt)

    await expect(inspectStateBackup(backupPath)).resolves.toEqual({ savedAt, projects: 2 })
  })
})

describe('recoveryFor', () => {
  beforeEach(async () => {
    await writeGoodBackup()
  })

  it('offers nothing for a failure that is not a damaged file', async () => {
    await expect(recoveryFor(new Error('EACCES'), statePath)).resolves.toBeNull()
  })

  // A damaged config.json is not something a state backup can mend.
  it('offers nothing for a damaged file that is not the state', async () => {
    const error = new InvalidFileError(join(dir, 'config.json'), 'Unexpected end of JSON input')

    await expect(recoveryFor(error, statePath)).resolves.toBeNull()
  })

  it('offers the backup for a damaged state', async () => {
    const error = new InvalidFileError(statePath, 'Unexpected end of JSON input')

    await expect(recoveryFor(error, statePath)).resolves.toMatchObject({ projects: 2 })
  })
})

describe('restoreStateBackup', () => {
  beforeEach(async () => {
    await writeGoodBackup()
    await writeFile(statePath, '{ damaged', 'utf8')
  })

  it('puts the backup in place and keeps the damaged file as evidence', async () => {
    await restoreStateBackup(statePath, () => new Date('2026-11-20T10:11:12.000Z'))

    await expect(
      readFile(join(dir, 'state.json.broken-2026-11-20T10-11-12-000Z'), 'utf8')
    ).resolves.toBe('{ damaged')
    await expect(readFile(statePath, 'utf8')).resolves.toBe(await readFile(backupPath, 'utf8'))
  })

  // Written whole over the damaged file, so the backup itself stays a separate inode.
  it('leaves the backup where it was', async () => {
    await restoreStateBackup(statePath)

    expect((await stat(statePath)).ino).not.toBe((await stat(backupPath)).ino)
    await expect(readFile(backupPath, 'utf8')).resolves.toContain('planner')
  })

  it('names the evidence by the clock when none is given', async () => {
    await restoreStateBackup(statePath)

    expect((await readdir(dir)).filter((name) => name.startsWith('state.json.broken-'))).toEqual([
      expect.stringMatching(/^state\.json\.broken-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/u)
    ])
  })

  // Never a moment with no state.json: a start in between would read "first run".
  it('leaves the damaged file in place when the backup cannot be read', async () => {
    await rm(backupPath)

    await expect(restoreStateBackup(statePath)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(readFile(statePath, 'utf8')).resolves.toBe('{ damaged')
  })
})

describe('openWithRecovery', () => {
  const damaged = (): InvalidFileError =>
    new InvalidFileError(statePath, 'Unexpected end of JSON input')

  beforeEach(async () => {
    await writeGoodBackup()
    await writeFile(statePath, '{ damaged', 'utf8')
  })

  it('opens at once when nothing is wrong', async () => {
    const ask = vi.fn(() => true)

    await expect(openWithRecovery(() => Promise.resolve('open'), ask, statePath)).resolves.toBe(
      'open'
    )
    expect(ask).not.toHaveBeenCalled()
  })

  it('passes on a failure no backup can mend', async () => {
    const failure = new Error('EACCES')

    await expect(openWithRecovery(() => Promise.reject(failure), vi.fn(), statePath)).rejects.toBe(
      failure
    )
  })

  // The user chose to quit: there is nothing more to say about it.
  it('answers with nothing, and restores nothing, when the user declines', async () => {
    await expect(
      openWithRecovery(
        () => Promise.reject(damaged()),
        () => false,
        statePath
      )
    ).resolves.toBeNull()
    await expect(readFile(statePath, 'utf8')).resolves.toBe('{ damaged')
  })

  it('restores the backup and opens again when the user agrees', async () => {
    const open = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(damaged())
      .mockResolvedValueOnce('reopened')

    await expect(openWithRecovery(open, () => true, statePath)).resolves.toBe('reopened')
    await expect(readFile(statePath, 'utf8')).resolves.toBe(await readFile(backupPath, 'utf8'))
  })

  it('says both failures when the restore fails as well', async () => {
    const ask = (): boolean => {
      rmSync(backupPath)
      return true
    }

    await expect(openWithRecovery(() => Promise.reject(damaged()), ask, statePath)).rejects.toThrow(
      /Unexpected end of JSON input[\s\S]*Restoring the backup failed as well/u
    )
  })

  // Through a real second save and a real read, so the path the reader throws with is the one asked about.
  it('restores what a second save kept, once the state no longer reads', async () => {
    const ONE = addProject(EMPTY_STATE, makeProject('planner'))
    await saveState(ONE, statePath)
    await saveState(TWO, statePath)
    await writeFile(statePath, '{ damaged', 'utf8')

    await expect(
      openWithRecovery(
        () => loadState(statePath),
        () => true,
        statePath
      )
    ).resolves.toEqual(ONE)
  })
})
