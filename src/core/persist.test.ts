import {
  chmod,
  type FileHandle,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { z } from 'zod'

import {
  codeOf,
  describeError,
  InvalidFileError,
  isDiskFull,
  isNotDirectory,
  keepBackup,
  readJsonFile,
  writeJsonFile,
  writeNewFile,
  writeTextFile
} from './persist.js'

const Schema = z.object({
  name: z.string(),
  count: z.number().int()
})

type Value = z.infer<typeof Schema>

const FALLBACK: Value = { name: 'default', count: 0 }

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-persist-'))
  file = join(dir, 'data.json')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

async function temporaries(): Promise<string[]> {
  return (await readdir(dir)).filter((entry) => entry.endsWith('.tmp'))
}

// `FileHandle` is not exported as a value, so its prototype is reachable only through an
// instance: a probe opened and removed before the code under test runs.
async function spyOnSync(): Promise<MockInstance<FileHandle['sync']>> {
  const probe = await open(join(dir, 'probe'), 'w')
  const prototype: unknown = Object.getPrototypeOf(probe)
  await probe.close()
  await rm(join(dir, 'probe'))
  return vi.spyOn(prototype as FileHandle, 'sync')
}

describe('describeError', () => {
  it('takes the message from a real error', () => {
    expect(describeError(new Error('git not found'))).toBe('git not found')
  })

  it('stringifies non-errors — JavaScript lets you throw anything', () => {
    expect(describeError('plain string')).toBe('plain string')
    expect(describeError(42)).toBe('42')
    expect(describeError(null)).toBe('null')
  })
})

describe('codeOf', () => {
  it('reads the code a failure carries', () => {
    expect(codeOf(Object.assign(new Error('x'), { code: 'EEXIST' }))).toBe('EEXIST')
  })

  it('answers with nothing for what carries no code', () => {
    expect(codeOf(new Error('x'))).toBeUndefined()
    expect(codeOf('EEXIST')).toBeUndefined()
    expect(codeOf(null)).toBeUndefined()
  })
})

describe('isDiskFull', () => {
  const failure = (code: string): Error => Object.assign(new Error(code), { code })

  it('recognises a full disk and a used-up quota', () => {
    expect(isDiskFull(failure('ENOSPC'))).toBe(true)
    expect(isDiskFull(failure('EDQUOT'))).toBe(true)
  })

  it('leaves every other failure alone', () => {
    expect(isDiskFull(failure('ENOENT'))).toBe(false)
    expect(isDiskFull(new Error('ENOSPC'))).toBe(false)
    expect(isDiskFull('ENOSPC')).toBe(false)
    expect(isDiskFull(null)).toBe(false)
  })
})

describe('isNotDirectory', () => {
  const failure = (code: string): Error => Object.assign(new Error(code), { code })

  it('recognises a file met where a folder had to be', () => {
    expect(isNotDirectory(failure('ENOTDIR'))).toBe(true)
  })

  it('leaves every other failure alone', () => {
    expect(isNotDirectory(failure('ENOENT'))).toBe(false)
    expect(isNotDirectory(new Error('ENOTDIR'))).toBe(false)
    expect(isNotDirectory('ENOTDIR')).toBe(false)
    expect(isNotDirectory(null)).toBe(false)
  })
})

describe('readJsonFile', () => {
  it('returns the fallback when the file does not exist yet — a normal first run', async () => {
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual(FALLBACK)
  })

  it('reads back a stored value', async () => {
    await writeFile(file, JSON.stringify({ name: 'kyiv', count: 3 }), 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({ name: 'kyiv', count: 3 })
  })

  it('throws on malformed JSON instead of silently resetting state', async () => {
    await writeFile(file, '{ not json', 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('throws when the structure does not match the schema', async () => {
    await writeFile(file, JSON.stringify({ name: 'kyiv', count: 'not a number' }), 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('reports which file is broken', async () => {
    await writeFile(file, 'corrupt', 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).rejects.toMatchObject({ filePath: file })
  })

  it('propagates other filesystem errors rather than treating them as a missing file', async () => {
    // A directory instead of a file yields EISDIR, which must not become a fallback.
    await expect(readJsonFile(dir, Schema, FALLBACK)).rejects.not.toBeInstanceOf(InvalidFileError)
  })
})

describe('writeJsonFile', () => {
  it('writes a value that reads back', async () => {
    await writeJsonFile(file, Schema, { name: 'lviv', count: 7 })
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({ name: 'lviv', count: 7 })
  })

  it('creates the directory when it is missing', async () => {
    const nested = join(dir, 'a', 'b', 'data.json')
    await writeJsonFile(nested, Schema, FALLBACK)
    await expect(readJsonFile(nested, Schema, FALLBACK)).resolves.toEqual(FALLBACK)
  })

  it('leaves no temporary file behind after a successful write', async () => {
    await writeJsonFile(file, Schema, FALLBACK)
    await expect(readFile(`${file}.tmp`, 'utf8')).rejects.toThrow()
  })

  it('refuses to write a value that fails the schema', async () => {
    const broken = { name: 'kyiv', count: 1.5 }
    await expect(writeJsonFile(file, Schema, broken)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('leaves the existing file untouched when the new value is invalid', async () => {
    await writeJsonFile(file, Schema, { name: 'previous', count: 1 })
    const broken = { name: 'kyiv', count: 1.5 }
    await expect(writeJsonFile(file, Schema, broken)).rejects.toBeInstanceOf(InvalidFileError)
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({
      name: 'previous',
      count: 1
    })
  })

  it('accepts a custom temporary path', async () => {
    const temp = join(dir, 'custom.tmp')
    await writeJsonFile(file, Schema, FALLBACK, { tempPath: temp })
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual(FALLBACK)
  })

  it('ends the file with a newline, keeping it git-friendly', async () => {
    await writeJsonFile(file, Schema, FALLBACK)
    await expect(readFile(file, 'utf8')).resolves.toMatch(/\n$/)
  })

  // A directory at the target lets the write succeed and the rename fail.
  it('takes its temporary file with it when the rename fails', async () => {
    await mkdir(file)
    await writeFile(join(file, 'inside'), 'x', 'utf8')

    await expect(writeJsonFile(file, Schema, FALLBACK)).rejects.toThrow()
    expect(await temporaries()).toEqual([])
  })

  it('does not follow a link left at its temporary path', async () => {
    const outside = join(dir, 'outside.json')
    await writeFile(outside, 'KEEP', 'utf8')
    await symlink(outside, `${file}.tmp`)

    await writeJsonFile(file, Schema, { name: 'lviv', count: 7 })

    await expect(readFile(outside, 'utf8')).resolves.toBe('KEEP')
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({ name: 'lviv', count: 7 })
  })

  it('syncs the contents before it renames', async () => {
    const sync = await spyOnSync()

    await writeJsonFile(file, Schema, FALLBACK)

    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous version as the backup', async () => {
    const backup = `${file}.bak`
    await writeJsonFile(file, Schema, { name: 'first', count: 1 }, { backupPath: backup })
    await writeJsonFile(file, Schema, { name: 'second', count: 2 }, { backupPath: backup })

    await expect(readJsonFile(backup, Schema, FALLBACK)).resolves.toEqual({
      name: 'first',
      count: 1
    })
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({
      name: 'second',
      count: 2
    })
  })

  it('writes no backup on the first write', async () => {
    const backup = `${file}.bak`
    await writeJsonFile(file, Schema, FALLBACK, { backupPath: backup })

    await expect(stat(backup)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes no backup unless asked', async () => {
    await writeJsonFile(file, Schema, { name: 'first', count: 1 })
    await writeJsonFile(file, Schema, { name: 'second', count: 2 })

    expect((await readdir(dir)).sort()).toEqual(['data.json'])
  })

  // The new contents never land when the old ones could not be kept.
  it('leaves the file as it was when the backup fails', async () => {
    await writeJsonFile(file, Schema, { name: 'first', count: 1 })
    // A directory where the backup goes: a file cannot be renamed over it.
    const backup = join(dir, 'taken')
    await mkdir(backup)

    await expect(
      writeJsonFile(file, Schema, { name: 'second', count: 2 }, { backupPath: backup })
    ).rejects.toThrow()
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({
      name: 'first',
      count: 1
    })
    expect(await temporaries()).toEqual([])
  })

  it('writes on when the backup fails and onBackupFailed takes it', async () => {
    await writeJsonFile(file, Schema, { name: 'first', count: 1 })
    const backup = join(dir, 'taken')
    await mkdir(backup)
    const failures: unknown[] = []

    await writeJsonFile(
      file,
      Schema,
      { name: 'second', count: 2 },
      { backupPath: backup, onBackupFailed: (error) => failures.push(error) }
    )

    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({
      name: 'second',
      count: 2
    })
    expect(failures).toHaveLength(1)
    expect((await stat(backup)).isDirectory()).toBe(true)
  })
})

describe('keepBackup', () => {
  /** A link that fails with `code`. */
  function refusing(code: string): () => Promise<void> {
    return () => Promise.reject(Object.assign(new Error(code), { code }))
  }

  it('uses a real hard link by default', async () => {
    await writeFile(file, 'old', 'utf8')
    await keepBackup(file, `${file}.bak`)

    expect((await stat(`${file}.bak`)).ino).toBe((await stat(file)).ino)
  })

  it('replaces a backup already there', async () => {
    await writeFile(file, 'old', 'utf8')
    await writeFile(`${file}.bak`, 'older', 'utf8')

    await keepBackup(file, `${file}.bak`)

    await expect(readFile(`${file}.bak`, 'utf8')).resolves.toBe('old')
  })

  it.each(['ENOTSUP', 'EPERM'])(
    'copies when the filesystem refuses a link with %s',
    async (code) => {
      await writeFile(file, 'old', 'utf8')
      await keepBackup(file, `${file}.bak`, refusing(code))

      await expect(readFile(`${file}.bak`, 'utf8')).resolves.toBe('old')
      expect((await stat(`${file}.bak`)).ino).not.toBe((await stat(file)).ino)
    }
  )

  it('rethrows any other failure', async () => {
    await writeFile(file, 'old', 'utf8')

    await expect(keepBackup(file, `${file}.bak`, refusing('EIO'))).rejects.toMatchObject({
      code: 'EIO'
    })
  })

  // The old one goes only as the new one takes its name.
  it('keeps the previous backup when a new one cannot be made', async () => {
    await writeFile(file, 'old', 'utf8')
    await writeFile(`${file}.bak`, 'older', 'utf8')

    await expect(keepBackup(file, `${file}.bak`, refusing('EIO'))).rejects.toMatchObject({
      code: 'EIO'
    })

    await expect(readFile(`${file}.bak`, 'utf8')).resolves.toBe('older')
    expect(await temporaries()).toEqual([])
  })

  it('clears a temporary backup a crash left behind', async () => {
    await writeFile(file, 'old', 'utf8')
    await writeFile(`${file}.bak.tmp`, 'left by a crash', 'utf8')

    await keepBackup(file, `${file}.bak`)

    await expect(readFile(`${file}.bak`, 'utf8')).resolves.toBe('old')
    expect(await temporaries()).toEqual([])
  })

  it('rethrows a failure that carries no code', async () => {
    await writeFile(file, 'old', 'utf8')

    await expect(
      keepBackup(file, `${file}.bak`, () => Promise.reject(new Error('odd')))
    ).rejects.toThrow('odd')
  })

  it('does nothing when there is nothing yet to keep', async () => {
    await keepBackup(file, `${file}.bak`)

    await expect(stat(`${file}.bak`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('writeNewFile', () => {
  it('writes the bytes it is given', async () => {
    const path = join(dir, 'paste.png')
    await writeNewFile(path, Uint8Array.from([137, 80, 78, 71]))

    expect([...(await readFile(path))]).toEqual([137, 80, 78, 71])
  })

  // A fresh name, never a replacement: landing on a file means two names
  // collided, and the one already there is somebody's.
  it('refuses a path that already holds a file', async () => {
    const path = join(dir, 'paste.png')
    await writeFile(path, 'first')

    await expect(writeNewFile(path, Uint8Array.from([1]))).rejects.toMatchObject({
      code: 'EEXIST'
    })
    await expect(readFile(path, 'utf8')).resolves.toBe('first')
  })

  it('creates the directory it needs', async () => {
    const path = join(dir, 'attachments', 'paste.png')
    await writeNewFile(path, Uint8Array.from([1]))

    expect([...(await readFile(path))]).toEqual([1])
  })
})

describe('writeTextFile', () => {
  let umask: number

  // Pinned: the mode tests prove nothing under umask 000 and fail under 027.
  beforeEach(() => {
    umask = process.umask(0o022)
  })

  afterEach(() => {
    process.umask(umask)
  })

  /** The mode of a path, as the three digits anybody reads. */
  async function modeOf(path: string): Promise<number> {
    return (await stat(path)).mode & 0o777
  }

  it('writes contents that read back', async () => {
    const path = join(dir, '.env')
    await writeTextFile(path, 'A=1\n')

    await expect(readFile(path, 'utf8')).resolves.toBe('A=1\n')
  })

  it('creates the directory when it is missing', async () => {
    const nested = join(dir, 'a', 'b', '.env')
    await writeTextFile(nested, 'A=1\n')

    await expect(readFile(nested, 'utf8')).resolves.toBe('A=1\n')
  })

  it('gives a new file the mode it was asked for', async () => {
    const path = join(dir, '.env')
    await writeTextFile(path, 'A=1\n', 0o600)

    await expect(modeOf(path)).resolves.toBe(0o600)
  })

  /*
   * The defect this exists for. `writeFile`'s `mode` option reaches `open(2)`,
   * where it is ignored unless the call creates the file — so appending
   * credentials to a file copied in from somewhere else left it as permissive
   * as the copy was.
   */
  it('resets the mode of a file that already exists', async () => {
    const path = join(dir, '.env')
    await writeFile(path, 'FROM=checkout\n', { encoding: 'utf8', mode: 0o644 })

    await writeTextFile(path, 'A=1\n', 0o600)

    await expect(modeOf(path)).resolves.toBe(0o600)
  })

  // The mode handed to `open(2)` loses whatever the umask clears; the one set
  // on the descriptor afterwards does not.
  it('gives the mode in full, whatever the umask would clear', async () => {
    const path = join(dir, 'shared.txt')
    await writeTextFile(path, 'A=1\n', 0o666)

    await expect(modeOf(path)).resolves.toBe(0o666)
  })

  // 0o600 rather than what the umask gives anyway, or a replacement that dropped it would pass.
  it('keeps the mode of the file it replaces when none is asked for', async () => {
    const path = join(dir, 'notes.txt')
    await writeFile(path, 'first\n', { encoding: 'utf8', mode: 0o600 })

    await writeTextFile(path, 'second\n')

    await expect(modeOf(path)).resolves.toBe(0o600)
  })

  it('gives a new file 0o666 less the umask when no mode is asked for', async () => {
    const path = join(dir, 'notes.txt')
    await writeTextFile(path, 'first\n')

    await expect(modeOf(path)).resolves.toBe(0o666 & ~0o022)
  })

  it('drops setuid from the mode it keeps', async () => {
    const path = join(dir, 'tool')
    await writeFile(path, 'first\n', 'utf8')
    await chmod(path, 0o4755)

    await writeTextFile(path, 'second\n')

    expect((await stat(path)).mode & 0o7777).toBe(0o755)
  })

  it('leaves no temporary file behind after a successful write', async () => {
    const path = join(dir, '.env')
    await writeTextFile(path, 'A=1\n')

    expect(await temporaries()).toEqual([])
  })

  /*
   * These land in a git worktree, where a leftover temporary file is an untracked
   * file somebody has to explain. A directory at the target is the honest way
   * to fail after the temporary file exists: the write succeeds, the rename
   * cannot.
   */
  it('takes its temporary file with it when the rename fails', async () => {
    const path = join(dir, '.env')
    await mkdir(path)
    await writeFile(join(path, 'inside'), 'x', 'utf8')

    await expect(writeTextFile(path, 'A=1\n')).rejects.toThrow()
    expect(await temporaries()).toEqual([])
  })

  // The guarantee the module claims: the old version or the new one, never a
  // mix — and never nothing at all.
  it('leaves the old contents in place when the write fails', async () => {
    const closed = join(dir, 'closed')
    await mkdir(closed)
    const path = join(closed, '.env')
    await writeFile(path, 'FROM=checkout\n', 'utf8')
    await chmod(closed, 0o500)

    try {
      await expect(writeTextFile(path, 'A=1\n')).rejects.toThrow()
      await expect(readFile(path, 'utf8')).resolves.toBe('FROM=checkout\n')
    } finally {
      // Or the directory could not be cleaned up after the test.
      await chmod(closed, 0o700)
    }
  })

  it('does not follow a link planted at the temporary path', async () => {
    const outside = join(dir, 'outside.txt')
    await writeFile(outside, 'KEEP', { encoding: 'utf8', mode: 0o644 })
    const path = join(dir, '.env')
    await symlink(outside, `${path}.tmp`)

    await writeTextFile(path, 'A=1\n', 0o600)

    await expect(readFile(outside, 'utf8')).resolves.toBe('KEEP')
    await expect(modeOf(outside)).resolves.toBe(0o644)
    expect((await lstat(path)).isSymbolicLink()).toBe(false)
    await expect(readFile(path, 'utf8')).resolves.toBe('A=1\n')
  })

  it('refuses rather than writes through a link at the exact temporary name', async () => {
    const outside = join(dir, 'outside.txt')
    await writeFile(outside, 'KEEP', 'utf8')
    const path = join(dir, '.env')
    await symlink(outside, `${path}.fixed.tmp`)

    await expect(writeTextFile(path, 'A=1\n', 0o600, () => 'fixed')).rejects.toMatchObject({
      code: 'EEXIST'
    })

    await expect(readFile(outside, 'utf8')).resolves.toBe('KEEP')
    expect((await lstat(`${path}.fixed.tmp`)).isSymbolicLink()).toBe(true)
  })

  it('syncs the contents before it renames', async () => {
    const sync = await spyOnSync()

    await writeTextFile(join(dir, '.env'), 'A=1\n')

    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('keeps the old file when the contents cannot be synced', async () => {
    const path = join(dir, '.env')
    await writeFile(path, 'old\n', 'utf8')
    const sync = await spyOnSync()
    sync.mockRejectedValueOnce(new Error('EIO'))

    await expect(writeTextFile(path, 'new\n')).rejects.toThrow('EIO')

    await expect(readFile(path, 'utf8')).resolves.toBe('old\n')
    expect(await temporaries()).toEqual([])
  })

  it('reports the failure rather than the cleanup that failed after it', async () => {
    const path = join(dir, '.env')
    const temp = `${path}.fixed.tmp`
    const sync = await spyOnSync()
    // A directory where the temporary file was makes the cleanup `rm` throw too.
    sync.mockImplementationOnce(async () => {
      await rm(temp)
      await mkdir(temp)
      throw new Error('EIO')
    })

    await expect(writeTextFile(path, 'A=1\n', undefined, () => 'fixed')).rejects.toThrow('EIO')
  })
})

describe('surviving a bad file', () => {
  const Shape = z.object({ a: z.string() })

  it('creates missing parent directories rather than failing', async () => {
    const nested = join(dir, 'deep', 'nested', 'f.json')
    await writeJsonFile(nested, Shape, { a: 'x' }, { tempPath: `${nested}.tmp` })

    await expect(readJsonFile(nested, Shape, { a: '' })).resolves.toEqual({ a: 'x' })
  })

  it('rejects valid JSON of the wrong shape instead of trusting it', async () => {
    const file = join(dir, 'shape.json')
    await writeFile(file, JSON.stringify({ a: 42 }), 'utf8')

    await expect(readJsonFile(file, Shape, { a: '' })).rejects.toThrow(InvalidFileError)
  })

  it('rejects an empty file rather than reading it as absent', async () => {
    const file = join(dir, 'empty.json')
    await writeFile(file, '', 'utf8')

    await expect(readJsonFile(file, Shape, { a: '' })).rejects.toThrow(InvalidFileError)
  })

  // A crash between writing the temp file and renaming it leaves the temp
  // behind; the next write has to be able to proceed regardless.
  it('overwrites a temp file left by an interrupted write', async () => {
    const file = join(dir, 'f.json')
    const temp = `${file}.tmp`
    await writeFile(temp, 'garbage from last time', 'utf8')

    await writeJsonFile(file, Shape, { a: 'fresh' }, { tempPath: temp })
    await expect(readJsonFile(file, Shape, { a: '' })).resolves.toEqual({ a: 'fresh' })
  })

  it('leaves no temp file behind once the write lands', async () => {
    const file = join(dir, 'f.json')
    await writeJsonFile(file, Shape, { a: 'x' }, { tempPath: `${file}.tmp` })

    await expect(readFile(`${file}.tmp`, 'utf8')).rejects.toThrow()
  })
})
