import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { diagnosticLog } from './diagnostics.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-diagnostics-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('the diagnostic log', () => {
  it('writes the stack of an error with the time, and echoes the same line', async () => {
    const file = join(dir, 'main.log')
    const echoed: string[] = []
    const thrown = new Error('boom')

    diagnosticLog(
      file,
      (line) => echoed.push(line),
      () => 'T'
    )(thrown)

    expect(echoed).toEqual([`T ${thrown.stack ?? ''}`])
    await expect(readFile(file, 'utf8')).resolves.toBe(`T ${thrown.stack ?? ''}\n`)
  })

  it('writes the message of an error that carries no stack', async () => {
    const file = join(dir, 'main.log')
    const thrown = new Error('boom')
    delete thrown.stack

    diagnosticLog(
      file,
      () => undefined,
      () => 'T'
    )(thrown)

    await expect(readFile(file, 'utf8')).resolves.toBe('T boom\n')
  })

  it('writes what was thrown when it is not an error', async () => {
    const file = join(dir, 'main.log')

    diagnosticLog(
      file,
      () => undefined,
      () => 'T'
    )('plain')

    await expect(readFile(file, 'utf8')).resolves.toBe('T plain\n')
  })

  it('makes its folder', async () => {
    const file = join(dir, 'logs', 'main.log')

    diagnosticLog(
      file,
      () => undefined,
      () => 'T'
    )('first')

    await expect(readFile(file, 'utf8')).resolves.toBe('T first\n')
  })

  it('keeps the last megabyte of a longer log when opened, from a whole line', async () => {
    const file = join(dir, 'main.log')
    const lines = Array.from({ length: 150_000 }, (_, index) => `line ${String(index)}\n`)
    await writeFile(file, lines.join(''), 'utf8')

    diagnosticLog(file, () => undefined)

    const kept = await readFile(file, 'utf8')
    expect((await stat(file)).size).toBeLessThanOrEqual(1024 * 1024)
    expect(kept).toMatch(/^line \d+\n/)
    expect(kept.endsWith('line 149999\n')).toBe(true)
  })

  it('leaves a log under a megabyte as it is', async () => {
    const file = join(dir, 'main.log')
    await writeFile(file, 'old\n', 'utf8')

    diagnosticLog(file, () => undefined)

    await expect(readFile(file, 'utf8')).resolves.toBe('old\n')
  })

  it('outlives a log it cannot write, and still echoes', async () => {
    const file = join(dir, 'taken')
    await mkdir(file)
    const echoed: string[] = []

    expect(() => {
      diagnosticLog(
        file,
        (line) => echoed.push(line),
        () => 'T'
      )('lost')
    }).not.toThrow()
    expect(echoed).toEqual(['T lost'])
  })

  it('echoes to the console and stamps the time by default', () => {
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    diagnosticLog(join(dir, 'main.log'))('seen')

    expect(console_).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.* seen$/))
  })
})
