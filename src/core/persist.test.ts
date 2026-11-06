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
  describeError,
  InvalidFileError,
  readJsonFile,
  writeJsonFile,
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
    await writeJsonFile(file, Schema, FALLBACK, temp)
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

  it('leaves the mode alone when none is asked for', async () => {
    const path = join(dir, 'notes.txt')
    await writeFile(path, 'first\n', { encoding: 'utf8', mode: 0o644 })

    await writeTextFile(path, 'second\n')

    await expect(modeOf(path)).resolves.toBe(0o644)
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
    await writeJsonFile(nested, Shape, { a: 'x' }, `${nested}.tmp`)

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

    await writeJsonFile(file, Shape, { a: 'fresh' }, temp)
    await expect(readJsonFile(file, Shape, { a: '' })).resolves.toEqual({ a: 'fresh' })
  })

  it('leaves no temp file behind once the write lands', async () => {
    const file = join(dir, 'f.json')
    await writeJsonFile(file, Shape, { a: 'x' }, `${file}.tmp`)

    await expect(readFile(`${file}.tmp`, 'utf8')).rejects.toThrow()
  })
})
