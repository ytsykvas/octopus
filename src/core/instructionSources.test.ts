import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type InstructionSource, instructionSources } from './instructionSources.js'

let repo: string
let home: string

/** One source by name, so a test names what it is asserting about. */
async function source(id: InstructionSource['id']): Promise<InstructionSource> {
  const found = (await instructionSources(repo, home)).find((entry) => entry.id === id)
  if (!found) throw new Error(`no source ${id}`)
  return found
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'octopus-sources-repo-'))
  home = await mkdtemp(join(tmpdir(), 'octopus-sources-home-'))
})
afterEach(async () => {
  for (const dir of [repo, home]) await rm(dir, { recursive: true, force: true })
})

describe('instructionSources', () => {
  // Nothing here throws: a repository with no `.claude/` at all is the ordinary
  // one, and it has to be reported rather than fail.
  it('answers for a checkout that offers nothing', async () => {
    const sources = await instructionSources(repo, home)

    expect(sources.every((entry) => !entry.present)).toBe(true)
    expect(sources).toHaveLength(7)
  })

  it('finds the project memory the agent reads', async () => {
    await writeFile(join(repo, 'CLAUDE.md'), '# rules\n', 'utf8')

    await expect(source('projectMemory')).resolves.toMatchObject({ present: true, count: null })
  })

  // Independently, because a project may ship settings and no memory, or the
  // other way round, and the reader is trying to work out which.
  it('reports each settings file on its own', async () => {
    await mkdir(join(repo, '.claude'))
    await writeFile(join(repo, '.claude', 'settings.json'), '{}', 'utf8')

    await expect(source('projectSettings')).resolves.toMatchObject({ present: true })
    await expect(source('localSettings')).resolves.toMatchObject({ present: false })
  })

  it('looks in the home directory for the user layer', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(home, '.claude', 'CLAUDE.md'), '# mine\n', 'utf8')

    await expect(source('userMemory')).resolves.toMatchObject({ present: true })
  })

  it('says the path, so it can be opened', async () => {
    await expect(source('projectMemory')).resolves.toMatchObject({
      path: join(repo, 'CLAUDE.md')
    })
  })

  /*
   * A directory that exists but is empty is worth telling apart from one
   * holding twenty commands. Both are "present"; only one explains a slash
   * command nobody remembers writing.
   */
  it('counts what a directory holds', async () => {
    await mkdir(join(repo, '.claude', 'commands'), { recursive: true })
    await writeFile(join(repo, '.claude', 'commands', 'ship.md'), 'x', 'utf8')
    await writeFile(join(repo, '.claude', 'commands', 'check.md'), 'x', 'utf8')

    await expect(source('commands')).resolves.toMatchObject({ present: true, count: 2 })
  })

  it('separates an empty directory from a missing one', async () => {
    await mkdir(join(repo, '.claude', 'agents'), { recursive: true })

    await expect(source('agents')).resolves.toMatchObject({ present: true, count: 0 })
    await expect(source('commands')).resolves.toMatchObject({ present: false, count: null })
  })

  // `.claude/commands/` groups commands in subdirectories, and counting those
  // as commands would overstate what the agent has.
  it('counts files, not the folders that group them', async () => {
    await mkdir(join(repo, '.claude', 'commands', 'git'), { recursive: true })
    await writeFile(join(repo, '.claude', 'commands', 'ship.md'), 'x', 'utf8')

    await expect(source('commands')).resolves.toMatchObject({ count: 1 })
  })

  // A file where a directory belongs is not a directory, and must not be
  // reported as an empty one.
  it('does not mistake a file for a directory', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, '.claude', 'commands'), 'not a directory', 'utf8')

    await expect(source('commands')).resolves.toMatchObject({ present: false })
  })

  // The same in reverse: a directory named `CLAUDE.md` is not project memory.
  it('does not mistake a directory for a file', async () => {
    await mkdir(join(repo, 'CLAUDE.md'))

    await expect(source('projectMemory')).resolves.toMatchObject({ present: false })
  })

  it('falls back to the real home when none is given', async () => {
    const sources = await instructionSources(repo)

    expect(sources.find((entry) => entry.id === 'userSettings')?.path).toContain('.claude')
  })
})
