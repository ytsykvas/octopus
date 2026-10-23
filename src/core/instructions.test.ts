import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ARCHIVE_TIMEOUT_MS } from './archive.js'
import {
  effectiveInstruction,
  InstructionBodySchema,
  InstructionKindSchema,
  instructionPath,
  instructionTemplate,
  PUBLISHES_AFTER,
  readInstruction,
  writeInstruction
} from './instructions.js'
import { scriptEnv, SLUG_MAX_LENGTH } from './scriptEnv.js'

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

const HELP_KINDS = ['setupScripts', 'diagnoseRun'] as const

describe('the two Help asks for', () => {
  it('push nothing after the turn', () => {
    expect(PUBLISHES_AFTER.setupScripts).toBe(false)
    expect(PUBLISHES_AFTER.diagnoseRun).toBe(false)
  })

  // A template literal reads `${…}` as its own; the guard line must survive as shell.
  it('keep the shell in the setup template as written', () => {
    expect(instructionTemplate('setupScripts')).toContain(
      ': "${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"'
    )
  })

  // A line continues a paragraph when it follows a non-blank line and starts no
  // block — list item, table row, heading, fence.
  it.each(HELP_KINDS)('keep each paragraph and list item on one line: %s', (kind) => {
    const block = /^\s*(?:[-*]|\d+\.|\||#|```)/
    const lines = instructionTemplate(kind).split('\n')
    const continued = lines.filter(
      (line, index) =>
        index > 0 &&
        line.trim() !== '' &&
        !block.test(line) &&
        (lines[index - 1] ?? '').trim() !== '' &&
        !/^\s*(?:\||#|```)/.test(lines[index - 1] ?? '')
    )
    expect(continued).toEqual([])
  })

  it.each(HELP_KINDS)('never ask for a value to be written: %s', (kind) => {
    expect(instructionTemplate(kind)).toMatch(/never write a (?:value|variable's value)/i)
  })

  // A variable a script is given and the prompt never names is one no agent uses.
  it.each(HELP_KINDS)('name every variable a script is given: %s', (kind) => {
    const given = Object.keys(
      scriptEnv('run', { rootPath: '/r', workspaceName: 'w', port: 3100, profile: 'default' })
    )
    const prompt = instructionTemplate(kind)
    const named = (name: string): boolean => new RegExp(`\\$${name}(?![0-9A-Z_])`).test(prompt)

    // The ten ports are written as a range, `_1` … `_9`, so the ends stand for the middle.
    const ranged = /^OCTOPUS_PORT_[2-8]$/
    expect(given.filter((name) => !ranged.test(name) && !named(name))).toEqual([])
  })

  it.each(HELP_KINDS)('fit inside what the editor will save: %s', (kind) => {
    expect(InstructionBodySchema.safeParse(instructionTemplate(kind)).success).toBe(true)
  })

  it('give the slug and the cleanup the limits the code holds them to', () => {
    const prompt = instructionTemplate('setupScripts')
    expect(prompt).toContain(`cut to ${String(SLUG_MAX_LENGTH)} characters`)
    expect(prompt).toContain(`given ${String(ARCHIVE_TIMEOUT_MS / 1000)} seconds`)
  })

  // The cleanup runs without a shell, so a file whose guard displaced its
  // shebang fails to start at all.
  it('put the guard after the shebang', () => {
    expect(instructionTemplate('setupScripts')).toContain('is the first line after the shebang')
  })

  // Vite and Next move to the next free port when theirs is taken, and the
  // app's link then opens nothing.
  it('ask for the port to be bound exactly', () => {
    expect(instructionTemplate('setupScripts')).toMatch(/binds `\$OCTOPUS_PORT` \*\*exactly\*\*/)
  })

  // A link to the checkout's dependencies lets one branch's install rewrite
  // every other workspace's.
  it('install dependencies per worktree rather than linking the checkout', () => {
    const prompt = instructionTemplate('setupScripts')
    expect(prompt).toContain('Never link or copy `node_modules`')
    expect(prompt).not.toMatch(/linked or copied, not rebuilt/)
  })

  // The whole of how a per-workspace name reaches an app without a script
  // writing the env file.
  it('say that values in the env set may name the workspace', () => {
    expect(instructionTemplate('setupScripts')).toContain(
      '**Values in the env set may use those names.**'
    )
  })

  // The session's copy is from when it started; the facts are read now.
  it("say the session has a script's values, and the facts win", () => {
    expect(instructionTemplate('diagnoseRun')).toContain('Your own session has the same variables')
  })

  // Sent at once, the ask carries no description of the symptom.
  it('ask what the person sees when the runs look healthy', () => {
    expect(instructionTemplate('diagnoseRun')).toContain('ask what they see')
  })

  // The three cases with nothing to diagnose still send.
  it('send a workspace without scripts to the setup ask', () => {
    expect(instructionTemplate('diagnoseRun')).toContain('Help → "Set this project up to run"')
  })

  // "Not listening" is a fact about both families, so the agent need not
  // suspect the address before the port.
  it('say that both loopback addresses are asked', () => {
    expect(instructionTemplate('diagnoseRun')).toContain(
      'both loopback addresses, 127.0.0.1 and `::1`'
    )
  })

  it('keep the diagnosis to checks that change nothing', () => {
    expect(instructionTemplate('diagnoseRun')).toContain(
      'You may not kill a process, install anything, run a migration'
    )
  })

  // An edited script disables Run until it is allowed again.
  it('say that a script it changes waits to be allowed', () => {
    expect(instructionTemplate('diagnoseRun')).toContain('Run is gated again')
  })
})
