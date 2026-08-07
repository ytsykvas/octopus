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

const FALLBACK: Value = { name: 'типове', count: 0 }

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
  it('бере повідомлення зі справжньої помилки', () => {
    expect(describeError(new Error('git не знайдено'))).toBe('git не знайдено')
  })

  it('приводить до рядка те, що помилкою не є — кинути в JS можна будь-що', () => {
    expect(describeError('просто рядок')).toBe('просто рядок')
    expect(describeError(42)).toBe('42')
    expect(describeError(null)).toBe('null')
  })
})

describe('readJsonFile', () => {
  it('повертає типове значення, якщо файлу ще немає — це нормальний перший запуск', async () => {
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual(FALLBACK)
  })

  it('читає збережене значення', async () => {
    await writeFile(file, JSON.stringify({ name: 'kyiv', count: 3 }), 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({ name: 'kyiv', count: 3 })
  })

  it('кидає помилку на пошкодженому JSON, а не мовчки скидає стан', async () => {
    await writeFile(file, '{ це не json', 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('кидає помилку, коли структура не відповідає схемі', async () => {
    await writeFile(file, JSON.stringify({ name: 'kyiv', count: 'не число' }), 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('повідомляє шлях до проблемного файлу', async () => {
    await writeFile(file, 'зіпсовано', 'utf8')
    await expect(readJsonFile(file, Schema, FALLBACK)).rejects.toMatchObject({ filePath: file })
  })

  it('прокидає інші помилки файлової системи, а не видає їх за відсутній файл', async () => {
    // Тека замість файлу: читання дає EISDIR, і це не має перетворитися на fallback.
    await expect(readJsonFile(dir, Schema, FALLBACK)).rejects.not.toBeInstanceOf(InvalidFileError)
  })
})

describe('writeJsonFile', () => {
  it('записує значення, яке потім читається назад', async () => {
    await writeJsonFile(file, Schema, { name: 'lviv', count: 7 })
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({ name: 'lviv', count: 7 })
  })

  it('створює теку, якщо її ще немає', async () => {
    const nested = join(dir, 'a', 'b', 'data.json')
    await writeJsonFile(nested, Schema, FALLBACK)
    await expect(readJsonFile(nested, Schema, FALLBACK)).resolves.toEqual(FALLBACK)
  })

  it('не лишає тимчасового файлу після успішного запису', async () => {
    await writeJsonFile(file, Schema, FALLBACK)
    await expect(readFile(`${file}.tmp`, 'utf8')).rejects.toThrow()
  })

  it('відмовляється записувати значення, що не проходить схему', async () => {
    const broken = { name: 'kyiv', count: 1.5 }
    await expect(writeJsonFile(file, Schema, broken)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('не чіпає наявний файл, якщо нове значення невалідне', async () => {
    await writeJsonFile(file, Schema, { name: 'було', count: 1 })
    const broken = { name: 'kyiv', count: 1.5 }
    await expect(writeJsonFile(file, Schema, broken)).rejects.toBeInstanceOf(InvalidFileError)
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual({ name: 'було', count: 1 })
  })

  it('приймає власний шлях тимчасового файлу', async () => {
    const temp = join(dir, 'custom.tmp')
    await writeJsonFile(file, Schema, FALLBACK, temp)
    await expect(readJsonFile(file, Schema, FALLBACK)).resolves.toEqual(FALLBACK)
  })

  it('записує з переносом рядка в кінці — файл лишається зручним для git', async () => {
    await writeJsonFile(file, Schema, FALLBACK)
    await expect(readFile(file, 'utf8')).resolves.toMatch(/\n$/)
  })
})
