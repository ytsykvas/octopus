import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { carriedPaths, carryInto, carryPath, readCarryList, writeCarryList } from './carry.js'

let root: string
let repo: string
let workspace: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-carry-'))
  repo = await mkdtemp(join(tmpdir(), 'octopus-repo-'))
  workspace = await mkdtemp(join(tmpdir(), 'octopus-worktree-'))
})
afterEach(async () => {
  for (const dir of [root, repo, workspace]) await rm(dir, { recursive: true, force: true })
})

describe('carryPath', () => {
  it('puts the list beside the project rather than in its scripts', () => {
    expect(carryPath('planner', root)).toBe(join(root, 'projects', 'planner', 'carry'))
  })

  it('falls back to the real root when none is given', () => {
    expect(carryPath('planner')).toContain('.octopus')
  })
})

describe('readCarryList', () => {
  // The file almost every project needs and the one nobody expects to have to
  // ask for.
  it('starts from a list naming the env', async () => {
    await expect(readCarryList('planner', root)).resolves.toContain('.env')
  })

  it('returns what was written', async () => {
    await writeCarryList('planner', 'config/master.key\n', root)
    await expect(readCarryList('planner', root)).resolves.toBe('config/master.key\n')
  })

  it('creates the project directory on the way', async () => {
    await writeCarryList('never-seen', '.env\n', root)
    await expect(readFile(carryPath('never-seen', root), 'utf8')).resolves.toBe('.env\n')
  })
})

describe('carriedPaths', () => {
  it('drops comments and blank lines', () => {
    expect(carriedPaths('# a note\n\n.env\n  config/master.key  \n')).toEqual([
      '.env',
      'config/master.key'
    ])
  })

  /*
   * The list is typed by hand into a text box, and a path that reaches outside
   * the checkout is a mistake rather than an instruction. Dropped rather than
   * refused: one bad line should not stop the rest of a workspace being made.
   */
  it('drops anything that reaches outside the checkout', () => {
    expect(carriedPaths('/etc/passwd\n../../secrets\n.env\n')).toEqual(['.env'])
  })
})

describe('carryInto', () => {
  it('copies what the list names', async () => {
    await writeFile(join(repo, '.env'), 'API_KEY=secret\n', 'utf8')
    await writeCarryList('planner', '.env\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual(['.env'])
    await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe('API_KEY=secret\n')
  })

  // `config/master.key` is the case this was written for, and its directory
  // exists in the worktree only because git tracks something else in it.
  it('makes the directories a nested path needs', async () => {
    await mkdir(join(repo, 'config'), { recursive: true })
    await writeFile(join(repo, 'config', 'master.key'), 'abc123\n', 'utf8')
    await writeCarryList('planner', 'config/master.key\n', root)

    await carryInto('planner', repo, workspace, root)

    await expect(readFile(join(workspace, 'config', 'master.key'), 'utf8')).resolves.toBe(
      'abc123\n'
    )
  })

  it('never writes over a file the workspace already has', async () => {
    await writeFile(join(repo, '.env'), 'FROM=checkout\n', 'utf8')
    await writeFile(join(workspace, '.env'), 'FROM=hand\n', 'utf8')
    await writeCarryList('planner', '.env\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual([])
    await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe('FROM=hand\n')
  })

  // A list is written once and a project's needs change; a path that has gone
  // is not a reason to fail the workspace.
  it('passes over a file the checkout does not have', async () => {
    await writeFile(join(repo, '.env'), 'A=1\n', 'utf8')
    await writeCarryList('planner', 'gone.txt\n.env\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual(['.env'])
  })

  it('carries nothing for a list that names nothing', async () => {
    await writeCarryList('planner', '# only a comment\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual([])
  })
})
