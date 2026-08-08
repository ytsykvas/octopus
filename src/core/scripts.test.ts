import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  PORT_VARIABLE,
  readScript,
  scriptExists,
  scriptPath,
  scriptsDirectory,
  writeScript
} from './scripts.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-scripts-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('scriptPath', () => {
  it('puts both scripts under the project', () => {
    expect(scriptPath('setup', 'planner', root)).toContain(join('planner', 'scripts', 'setup.sh'))
    expect(scriptPath('run', 'planner', root)).toContain(join('planner', 'scripts', 'run.sh'))
  })

  it('keeps projects apart', () => {
    expect(scriptPath('run', 'planner', root)).not.toBe(scriptPath('run', 'esl', root))
  })

  it('falls back to the real root when none is given', () => {
    expect(scriptPath('setup', 'planner')).toContain('.octopus')
  })
})

describe('readScript', () => {
  // A project that has never had a script is the normal state, not a failure.
  it('returns a template rather than failing when the file is absent', async () => {
    await expect(readScript('setup', 'planner', root)).resolves.toContain('#!/bin/sh')
  })

  it('tells the run template where the port comes from', async () => {
    await expect(readScript('run', 'planner', root)).resolves.toContain(PORT_VARIABLE)
  })

  it('returns what was written once it exists', async () => {
    await writeScript('setup', 'planner', 'echo hello\n', root)
    await expect(readScript('setup', 'planner', root)).resolves.toBe('echo hello\n')
  })

  it('does not confuse the two scripts', async () => {
    await writeScript('setup', 'planner', 'setup body\n', root)
    await writeScript('run', 'planner', 'run body\n', root)

    await expect(readScript('setup', 'planner', root)).resolves.toBe('setup body\n')
    await expect(readScript('run', 'planner', root)).resolves.toBe('run body\n')
  })
})

describe('writeScript', () => {
  it('creates the directory it needs', async () => {
    await writeScript('run', 'brand-new', 'x\n', root)
    await expect(readFile(scriptPath('run', 'brand-new', root), 'utf8')).resolves.toBe('x\n')
  })

  // Without the executable bit the script fails with "permission denied",
  // which says nothing about what needs doing.
  it('leaves the file executable', async () => {
    await writeScript('run', 'planner', 'x\n', root)

    const mode = (await stat(scriptPath('run', 'planner', root))).mode
    expect(mode & 0o111).not.toBe(0)
  })

  it('overwrites rather than appending', async () => {
    await writeScript('run', 'planner', 'first\n', root)
    await writeScript('run', 'planner', 'second\n', root)

    await expect(readScript('run', 'planner', root)).resolves.toBe('second\n')
  })

  it('accepts an empty script', async () => {
    await writeScript('run', 'planner', '', root)
    await expect(readScript('run', 'planner', root)).resolves.toBe('')
  })
})

describe('scriptExists', () => {
  it('is false before anything is written', async () => {
    await expect(scriptExists('setup', 'planner', root)).resolves.toBe(false)
  })

  it('is true afterwards', async () => {
    await writeScript('setup', 'planner', 'x\n', root)
    await expect(scriptExists('setup', 'planner', root)).resolves.toBe(true)
  })

  // An empty file still counts: someone deliberately saved nothing.
  it('is true for an empty script', async () => {
    await writeScript('setup', 'planner', '', root)
    await expect(scriptExists('setup', 'planner', root)).resolves.toBe(true)
  })

  it('is false when the path is a directory', async () => {
    await expect(scriptExists('run', 'nothing-here', root)).resolves.toBe(false)
  })
})

describe('scriptsDirectory', () => {
  it('points at where both scripts live, for editing outside the app', async () => {
    await writeScript('setup', 'planner', 'x\n', root)

    const dir = scriptsDirectory('planner', root)
    expect(scriptPath('setup', 'planner', root).startsWith(dir)).toBe(true)
    await expect(writeFile(join(dir, 'probe'), 'x', 'utf8')).resolves.toBeUndefined()
  })
})
