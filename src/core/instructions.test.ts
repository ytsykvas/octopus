import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  effectiveInstruction,
  InstructionKindSchema,
  instructionPath,
  readInstruction,
  writeInstruction
} from './instructions.js'

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
    expect(instructionPath('pullRequest', null)).toContain('.octopus')
  })

  /*
   * Totality is the compiler's job — a kind without a file does not build. What
   * it cannot see is two kinds pointing at one file, which reads as one
   * instruction being edited from two places and overwriting itself. Line
   * coverage would not notice either: indexing a record is one line however
   * many keys it has, so this iterates the enum rather than sampling it.
   */
  it('gives every kind a file of its own, at both scopes', () => {
    const kinds = InstructionKindSchema.options

    for (const scope of [null, 'planner'] as const) {
      const paths = kinds.map((kind) => instructionPath(kind, scope, root))

      expect(new Set(paths).size).toBe(kinds.length)
    }
  })

  it('has something written for every kind to start from', async () => {
    for (const kind of InstructionKindSchema.options) {
      // Not merely present: an empty template is how a project says it adds
      // nothing, and a kind that started that way could never say it.
      await expect(readInstruction(kind, 'planner', root)).resolves.not.toBe('')
    }
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

describe('the instruction that applies', () => {
  /*
   * The chain exists so a project can say something different, and the
   * installation can say something at all. Each rung is a separate test because
   * a fallback that skips one is invisible until the day it matters.
   */
  it("prefers the project's own over the installation's", async () => {
    await writeInstruction('pullRequest', null, 'Global rules.', root)
    await writeInstruction('pullRequest', 'planner', 'Project rules.', root)

    expect(await effectiveInstruction('pullRequest', 'planner', root)).toBe('Project rules.')
  })

  it("uses the installation's where a project has written none", async () => {
    await writeInstruction('pullRequest', null, 'Global rules.', root)

    expect(await effectiveInstruction('pullRequest', 'planner', root)).toBe('Global rules.')
  })

  it('falls back to the template when neither has been written', async () => {
    expect(await effectiveInstruction('pullRequest', 'planner', root)).toContain('Pull request')
  })

  /*
   * Emptying a project's instruction is a decision — this project adds nothing —
   * and falling through to the global one there would make that decision
   * impossible to express. Which is why the chain is built on "is there a file"
   * rather than on "is there any text".
   */
  it('takes an empty project instruction as a decision, not as an absence', async () => {
    await writeInstruction('pullRequest', null, 'Global rules.', root)
    await writeInstruction('pullRequest', 'planner', '', root)

    expect(await effectiveInstruction('pullRequest', 'planner', root)).toBe('')
  })

  it('keeps one project out of another', async () => {
    await writeInstruction('pullRequest', 'planner', 'Planner rules.', root)

    expect(await effectiveInstruction('pullRequest', 'other', root)).toContain('Pull request')
  })
})

describe('the installation-wide instruction', () => {
  it('lives beside the projects rather than inside one', () => {
    expect(instructionPath('pullRequest', null, root)).toBe(
      join(root, 'instructions', 'pull-request.md')
    )
  })

  it('reads back as a template until it is written', async () => {
    expect(await readInstruction('pullRequest', null, root)).toContain('Pull request')

    await writeInstruction('pullRequest', null, 'Say why.', root)

    expect(await readInstruction('pullRequest', null, root)).toBe('Say why.')
  })
})
