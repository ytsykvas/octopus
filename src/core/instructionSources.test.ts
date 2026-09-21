import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SettingSourceName } from './config.js'
import { type InstructionSource, instructionSources } from './instructionSources.js'

const ALL: SettingSourceName[] = ['user', 'project', 'local']

let repo: string
let home: string

/** One source by name, so a test names what it is asserting about. */
async function source(
  id: InstructionSource['id'],
  sources: readonly SettingSourceName[] = ALL,
  carried: readonly string[] | null = []
): Promise<InstructionSource> {
  const found = (await instructionSources(repo, sources, carried, home)).find(
    (entry) => entry.id === id
  )
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

describe('what is on disk', () => {
  // Nothing here throws: a repository with no `.claude/` at all is the ordinary
  // one, and it has to be reported rather than fail.
  it('answers for a checkout that offers nothing', async () => {
    const sources = await instructionSources(repo, ALL, [], home)

    expect(sources.every((entry) => !entry.present)).toBe(true)
    expect(sources).toHaveLength(11)
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

  it('finds the MCP servers a project declares', async () => {
    await writeFile(join(repo, '.mcp.json'), '{}', 'utf8')

    await expect(source('mcp')).resolves.toMatchObject({ present: true })
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

  // A skill is a directory holding a `SKILL.md`, so this one counts the other
  // way round — and octopus's own repository is the worked example.
  it('counts skills by their directories', async () => {
    await mkdir(join(repo, '.claude', 'skills', 'agent-sdk'), { recursive: true })
    await mkdir(join(repo, '.claude', 'skills', 'core-module'), { recursive: true })
    await writeFile(join(repo, '.claude', 'skills', 'README.md'), 'x', 'utf8')

    await expect(source('skills')).resolves.toMatchObject({ present: true, count: 2 })
  })

  it('finds the user’s own commands and subagents', async () => {
    await mkdir(join(home, '.claude', 'commands'), { recursive: true })
    await writeFile(join(home, '.claude', 'commands', 'mine.md'), 'x', 'utf8')

    await expect(source('userCommands')).resolves.toMatchObject({ present: true, count: 1 })
    await expect(source('userAgents')).resolves.toMatchObject({ present: false })
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
    const sources = await instructionSources(repo, ALL)

    expect(sources.find((entry) => entry.id === 'userSettings')?.path).toContain('.claude')
  })
})

describe('what the agent will actually read', () => {
  beforeEach(async () => {
    await writeFile(join(repo, 'CLAUDE.md'), '# rules\n', 'utf8')
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, '.claude', 'settings.json'), '{}', 'utf8')
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'settings.json'), '{}', 'utf8')
  })

  /*
   * "Present" is a stat and "loaded" is a claim about the SDK. Reporting the
   * first under the second's name is how the panel came to be wrong in all
   * three modes at once — it said "loaded" for seven rows while the agent was
   * started with `settingSources: []`.
   */
  it('reads nothing when the user has narrowed it to nothing', async () => {
    const sources = await instructionSources(repo, [], [], home)

    expect(sources.some((entry) => entry.present)).toBe(true)
    expect(sources.every((entry) => !entry.loaded)).toBe(true)
  })

  it('reads the project layer and not the user one under project-only', async () => {
    await expect(source('projectMemory', ['project'])).resolves.toMatchObject({ loaded: true })
    await expect(source('userSettings', ['project'])).resolves.toMatchObject({
      present: true,
      loaded: false
    })
  })

  it('reads both under the default', async () => {
    await expect(source('projectMemory')).resolves.toMatchObject({ loaded: true })
    await expect(source('userSettings')).resolves.toMatchObject({ loaded: true })
  })

  it('never claims to read a file that is not there', async () => {
    await expect(source('userMemory')).resolves.toMatchObject({ present: false, loaded: false })
  })

  /*
   * Asked about the checkout, this row cannot be answered by a stat. A worktree
   * holds what git tracks and this file is gitignored, so it reaches a
   * workspace only by being on the carry list — which is exactly what
   * a setup script does for it by hand.
   */
  it('reads the local settings of a checkout only when the carry list brings them', async () => {
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')

    await expect(source('localSettings')).resolves.toMatchObject({
      present: true,
      loaded: false
    })
    await expect(
      source('localSettings', ALL, ['.claude/settings.local.json'])
    ).resolves.toMatchObject({ loaded: true })
  })

  /*
   * Asked about the worktree itself, the same stat is the whole answer: the
   * session is started in that directory, so the SDK reads what is in it
   * however it got there. A workspace terminal answering "always allow" writes
   * this file, and the panel reported it unread while the agent was reading it.
   */
  it('reads the local settings a worktree actually holds, carried or not', async () => {
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')

    await expect(source('localSettings', ALL, null)).resolves.toMatchObject({
      present: true,
      loaded: true
    })
  })

  it('claims nothing about a worktree that does not hold them', async () => {
    await expect(source('localSettings', ALL, null)).resolves.toMatchObject({
      present: false,
      loaded: false
    })
  })

  /*
   * The list is typed by hand into a text box, so both spellings of the same
   * destination occur. `carryInto` copies either one correctly; only this
   * comparison could tell them apart, and it used to.
   */
  it('recognises a carry list that spells the destination with a leading dot-slash', async () => {
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')

    await expect(
      source('localSettings', ALL, ['./.claude/settings.local.json'])
    ).resolves.toMatchObject({ loaded: true })
  })

  it('still does not read them when the local source is off', async () => {
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')

    await expect(
      source('localSettings', ['project'], ['.claude/settings.local.json'])
    ).resolves.toMatchObject({ loaded: false })
  })
})
