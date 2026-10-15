import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InstructionKindSchema, instructionTemplate, writeInstruction } from './instructions.js'
import { ScriptKindSchema, scriptTemplate, writeScript } from './scripts.js'
import {
  SOURCE_INSTRUCTION_KINDS,
  SOURCE_SCRIPT_KINDS,
  type SourceItemId,
  type SourceView
} from './sourceItems.js'
import { readSources } from './sources.js'

let cwd: string
let root: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'octopus-worktree-'))
  root = await mkdtemp(join(tmpdir(), 'octopus-data-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
})

async function put(relative: string, contents: string): Promise<void> {
  const path = join(cwd, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

async function sourceOf(
  id: SourceItemId,
  preferLocal: readonly SourceItemId[] = []
): Promise<SourceView | undefined> {
  return (await readSources(cwd, { id: 'planner', preferLocal }, root)).find(
    (view) => view.id === id
  )
}

/*
 * The window imports these lists as values, so they live in a module that
 * reaches nothing Node-only — written again rather than imported. This is what
 * keeps the copies honest.
 */
describe('the lists the window imports', () => {
  it('names every script kind the core knows', () => {
    expect([...SOURCE_SCRIPT_KINDS].sort()).toEqual([...ScriptKindSchema.options].sort())
  })

  it('names every instruction kind the core knows', () => {
    expect([...SOURCE_INSTRUCTION_KINDS].sort()).toEqual([...InstructionKindSchema.options].sort())
  })
})

describe('readSources', () => {
  it('lists every script and every instruction, once', async () => {
    const views = await readSources(cwd, { id: 'planner', preferLocal: [] }, root)

    expect(views.map((view) => view.id)).toHaveLength(10)
    expect(new Set(views.map((view) => view.id)).size).toBe(10)
  })

  describe('a script', () => {
    // Nothing runs from a template; it is only where an editor starts.
    it('applies nothing when nobody wrote one', async () => {
      await expect(sourceOf('script.setup')).resolves.toEqual({
        id: 'script.setup',
        layers: [{ layer: 'template', from: null, body: scriptTemplate('setup') }],
        effective: null,
        preferLocal: false
      })
    })

    it("is the repository's when the checkout carries one, with the project's beside it", async () => {
      await put('.octopus/scripts/run.sh', 'repo\n')
      await writeScript('run', 'planner', 'mine\n', root)

      const view = await sourceOf('script.run')

      expect(view?.layers.map((layer) => [layer.layer, layer.body])).toEqual([
        ['repository', 'repo\n'],
        ['project', 'mine\n'],
        ['template', scriptTemplate('run')]
      ])
      expect(view?.layers[0]?.from).toBe('.octopus/scripts/run.sh')
      expect(view?.effective).toBe('repository')
    })

    it("is the project's once the user chose their own", async () => {
      await put('.octopus/scripts/run.sh', 'repo\n')
      await writeScript('run', 'planner', 'mine\n', root)

      await expect(sourceOf('script.run', ['script.run'])).resolves.toMatchObject({
        effective: 'project',
        preferLocal: true
      })
    })

    it('applies nothing when the user chose their own and wrote none', async () => {
      await put('.octopus/scripts/run.sh', 'repo\n')

      await expect(sourceOf('script.run', ['script.run'])).resolves.toMatchObject({
        effective: null
      })
    })
  })

  describe('an instruction', () => {
    it('falls back to the template when nobody wrote one', async () => {
      await expect(sourceOf('instruction.review')).resolves.toMatchObject({
        layers: [{ layer: 'template', from: null, body: instructionTemplate('review') }],
        effective: 'template'
      })
    })

    it('shows every layer nearest first, and the nearest is in effect', async () => {
      await put('.octopus/instructions/review.md', 'repo')
      await writeInstruction('review', 'planner', 'project', root)
      await writeInstruction('review', null, 'global', root)

      const view = await sourceOf('instruction.review')

      expect(view?.layers.map((layer) => layer.layer)).toEqual([
        'repository',
        'project',
        'global',
        'template'
      ])
      expect(view?.effective).toBe('repository')
    })

    it("skips the repository's when the user chose their own", async () => {
      await put('.octopus/instructions/review.md', 'repo')
      await writeInstruction('review', null, 'global', root)

      await expect(sourceOf('instruction.review', ['instruction.review'])).resolves.toMatchObject({
        effective: 'global'
      })
    })

    // An empty file is how a layer says "nothing extra here".
    it('counts an empty file as an answer', async () => {
      await writeInstruction('review', 'planner', '', root)
      await writeInstruction('review', null, 'global', root)

      await expect(sourceOf('instruction.review')).resolves.toMatchObject({ effective: 'project' })
    })
  })
})
