import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { instructionPath, readInstruction, writeInstruction } from './instructions.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-instructions-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('instructionPath', () => {
  it('files the instruction under its project', () => {
    expect(instructionPath('pullRequest', 'planner', root)).toContain(
      join('planner', 'instructions', 'pull-request.md')
    )
  })

  it('keeps projects apart', () => {
    expect(instructionPath('pullRequest', 'planner', root)).not.toBe(
      instructionPath('pullRequest', 'esl', root)
    )
  })

  it('falls back to the real root when none is given', () => {
    expect(instructionPath('pullRequest', 'planner')).toContain('.octopus')
  })
})

describe('readInstruction', () => {
  // Never having written one is the normal state of a new project.
  it('returns a template rather than failing when absent', async () => {
    await expect(readInstruction('pullRequest', 'planner', root)).resolves.toContain('Pull request')
  })

  it('returns what was written once it exists', async () => {
    await writeInstruction('pullRequest', 'planner', 'Always mention the ticket.\n', root)

    await expect(readInstruction('pullRequest', 'planner', root)).resolves.toBe(
      'Always mention the ticket.\n'
    )
  })
})

describe('writeInstruction', () => {
  it('creates the directory it needs', async () => {
    await writeInstruction('pullRequest', 'brand-new', 'x\n', root)

    await expect(readFile(instructionPath('pullRequest', 'brand-new', root), 'utf8')).resolves.toBe(
      'x\n'
    )
  })

  it('overwrites rather than appending', async () => {
    await writeInstruction('pullRequest', 'planner', 'first\n', root)
    await writeInstruction('pullRequest', 'planner', 'second\n', root)

    await expect(readInstruction('pullRequest', 'planner', root)).resolves.toBe('second\n')
  })

  it('accepts an empty instruction', async () => {
    await writeInstruction('pullRequest', 'planner', '', root)
    await expect(readInstruction('pullRequest', 'planner', root)).resolves.toBe('')
  })

  // Instructions are prose for a model, not something a shell runs.
  it('does not make the file executable', async () => {
    await writeInstruction('pullRequest', 'planner', 'x\n', root)

    const { stat } = await import('node:fs/promises')
    const mode = (await stat(instructionPath('pullRequest', 'planner', root))).mode
    expect(mode & 0o111).toBe(0)
  })
})
