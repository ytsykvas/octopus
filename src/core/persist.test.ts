import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { describeError, InvalidFileError, readJsonFile, writeJsonFile } from './persist.js'

const Schema = z.object({
  name: z.string(),
  count: z.number().int()
})

type Value = z.infer<typeof Schema>

const FALLBACK: Value = { name: 'default', count: 0 }

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maestro-persist-'))
  file = join(dir, 'data.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

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
})
