import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InvalidFileError } from './persist.js'
import {
  createPrompt,
  PromptError,
  readPrompts,
  removePrompt,
  reorderPrompts,
  updatePrompt
} from './prompts.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MISSING = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-prompts-'))
  file = join(dir, 'prompts.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const draft = (
  title: string,
  forPlan = false
): { title: string; text: string; forPlan: boolean } => ({
  title,
  text: `${title} text`,
  forPlan
})

async function titles(): Promise<string[]> {
  return (await readPrompts(file)).map((prompt) => prompt.title)
}

describe('readPrompts', () => {
  it('is an empty list where there is no file yet', async () => {
    await expect(readPrompts(file)).resolves.toEqual([])
  })

  // Losing a list somebody ordered by hand without a word is worse than a
  // dialog that says the file is broken.
  it('refuses a file that is not what it should be, rather than resetting it', async () => {
    await writeFile(file, JSON.stringify({ version: 1, prompts: [{ id: 'x' }] }))

    await expect(readPrompts(file)).rejects.toBeInstanceOf(InvalidFileError)
  })
})

describe('createPrompt', () => {
  it('makes an id and defaults forPlan to false', async () => {
    const made = await createPrompt(file, { title: 'Review', text: 'Look.', forPlan: false })

    expect(made.id).toMatch(UUID)
    expect(made).toMatchObject({ title: 'Review', text: 'Look.', forPlan: false })
  })

  it('takes the id from the one it is given', async () => {
    const made = await createPrompt(file, draft('A'), () => MISSING)

    expect(made.id).toBe(MISSING)
  })

  it('puts each new one last, and makes the directory if it is not there', async () => {
    const nested = join(dir, 'projects', 'p1', 'prompts.json')
    await createPrompt(nested, draft('A'))
    await createPrompt(nested, draft('B'))

    expect((await readPrompts(nested)).map((prompt) => prompt.title)).toEqual(['A', 'B'])
  })

  it('writes the version the reader insists on', async () => {
    await createPrompt(file, draft('A'))

    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ version: 1 })
  })
})

describe('updatePrompt', () => {
  it('changes the fields and keeps the id and the place', async () => {
    const first = await createPrompt(file, draft('A'))
    await createPrompt(file, draft('B'))

    const updated = await updatePrompt(file, first.id, { title: 'A2', text: 'new', forPlan: true })

    expect(updated).toEqual({ id: first.id, title: 'A2', text: 'new', forPlan: true })
    expect(await titles()).toEqual(['A2', 'B'])
  })

  it('says which prompt is missing', async () => {
    await expect(updatePrompt(file, MISSING, draft('A'))).rejects.toMatchObject({
      code: 'promptMissing',
      params: { id: MISSING }
    })
    await expect(updatePrompt(file, MISSING, draft('A'))).rejects.toBeInstanceOf(PromptError)
  })
})

describe('removePrompt', () => {
  it('removes only its own', async () => {
    const first = await createPrompt(file, draft('A'))
    await createPrompt(file, draft('B'))

    await removePrompt(file, first.id)

    expect(await titles()).toEqual(['B'])
  })

  it('says which prompt is missing', async () => {
    await expect(removePrompt(file, MISSING)).rejects.toMatchObject({ code: 'promptMissing' })
  })
})

describe('reorderPrompts', () => {
  async function three(): Promise<[string, string, string]> {
    const a = await createPrompt(file, draft('A'))
    const b = await createPrompt(file, draft('B'))
    const c = await createPrompt(file, draft('C'))
    return [a.id, b.id, c.id]
  }

  it('puts them in the order given', async () => {
    const [a, b, c] = await three()

    await reorderPrompts(file, [c, a, b])

    expect(await titles()).toEqual(['C', 'A', 'B'])
  })

  // A list the window drew before another window added or removed a prompt is
  // still safe to apply.
  it('ignores ids that are gone and sends one it never heard of to the end', async () => {
    const [a, , c] = await three()

    await reorderPrompts(file, [MISSING, c, a])

    expect(await titles()).toEqual(['C', 'A', 'B'])
  })

  it('keeps the ones it was not told about in their old order', async () => {
    const [, , c] = await three()

    await reorderPrompts(file, [c])

    expect(await titles()).toEqual(['C', 'A', 'B'])
  })
})
