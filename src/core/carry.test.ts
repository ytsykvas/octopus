import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  carriedFiles,
  carryInto,
  carryListForExport,
  carryPath,
  readCarryList,
  writeCarryList
} from './carry.js'

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

describe('carriedFiles', () => {
  it('drops comments and blank lines', () => {
    expect(carriedFiles('# a note\n\n.env\n  config/master.key  \n')).toEqual([
      { path: '.env', from: null },
      { path: 'config/master.key', from: null }
    ])
  })

  /*
   * The list is typed by hand into a text box, and a path that reaches outside
   * the checkout is a mistake rather than an instruction. Dropped rather than
   * refused: one bad line should not stop the rest of a workspace being made.
   */
  it('drops anything that reaches outside the checkout', () => {
    expect(carriedFiles('/etc/passwd\n../../secrets\n.env\n')).toEqual([
      { path: '.env', from: null }
    ])
  })

  it('reads the source after the first equals sign', () => {
    expect(carriedFiles('.env = ~/work/planner/.env\n')).toEqual([
      { path: '.env', from: '~/work/planner/.env' }
    ])
  })

  it('splits on the first equals only, because a path may contain one', () => {
    expect(carriedFiles('.env = /tmp/a=b/.env\n')).toEqual([
      { path: '.env', from: '/tmp/a=b/.env' }
    ])
  })

  /*
   * The rule that matters: the source says what is READ and never where
   * anything lands. Widen the filter to the source and an absolute one would
   * start deciding the destination.
   */
  it('checks the destination alone, not the source', () => {
    expect(carriedFiles('../out = /tmp/x\n.env = /etc/passwd\n')).toEqual([
      { path: '.env', from: '/etc/passwd' }
    ])
  })

  it('treats a half-written line as having no source, or no line at all', () => {
    expect(carriedFiles('.env =\n= /tmp/x\n')).toEqual([{ path: '.env', from: null }])
  })
})

describe('carryListForExport', () => {
  /*
   * `.octopus/carry` is committed and cloned by everybody. A source is a fact
   * about one laptop, and a path written into a repository should be assumed
   * readable for ever.
   */
  it('takes the sources out, keeping the files and the comments', () => {
    expect(carryListForExport('# a note\n\n.env = ~/work/planner/.env\nconfig/master.key\n')).toBe(
      '# a note\n\n.env\nconfig/master.key\n'
    )
  })

  it('leaves a list with no sources exactly as it is', () => {
    expect(carryListForExport('.env\nconfig/master.key\n')).toBe('.env\nconfig/master.key\n')
  })

  it('keeps a comment that happens to contain an equals sign', () => {
    expect(carryListForExport('# KEY=value lives here\n')).toBe('# KEY=value lives here\n')
  })

  // A list nobody has written is still not a setting worth committing.
  it('answers with nothing for a list that was never written', () => {
    expect(carryListForExport(null)).toBeNull()
  })
})

describe('carryInto', () => {
  it('copies what the list names', async () => {
    await writeFile(join(repo, '.env'), 'API_KEY=secret\n', 'utf8')
    await writeCarryList('planner', '.env\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual({
      written: ['.env'],
      missing: []
    })
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

  /*
   * Lexical containment is not containment. A checkout can track a symlinked
   * directory — `config -> ../shared` is ordinary in a monorepo — and a
   * worktree materialises it verbatim, so a destination that passes the textual
   * rule still resolves outside. What travels here is credentials.
   *
   * The line is dropped rather than refused, like every other bad line: an
   * exception would reach the rollback in `createWorkspaceIn` and take the
   * whole worktree with it.
   */
  it('writes nothing through a symlinked directory, and carries the rest', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'octopus-outside-'))
    await symlink(outside, join(workspace, 'config'))
    await mkdir(join(repo, 'config'), { recursive: true })
    await writeFile(join(repo, 'config', 'master.key'), 'abc123\n', 'utf8')
    await writeFile(join(repo, '.env'), 'FROM=checkout\n', 'utf8')
    await writeCarryList('planner', 'config/master.key\n.env\n', root)

    const report = await carryInto('planner', repo, workspace, root)

    // Named rather than dropped in silence. The reason differs from a source
    // that is not there, but the sentence the reader needs is the same one.
    expect(report).toEqual({ written: ['.env'], missing: ['config/master.key'] })
    await expect(readFile(join(outside, 'master.key'), 'utf8')).rejects.toThrow()
    await rm(outside, { recursive: true, force: true })
  })

  /*
   * And reports it as neither written nor missing. `COPYFILE_EXCL` throws
   * `EEXIST` here, which is the success of a second run rather than a failure —
   * a report that named this file would train the reader to ignore the line
   * that matters.
   */
  it('never writes over a file the workspace already has', async () => {
    await writeFile(join(repo, '.env'), 'FROM=checkout\n', 'utf8')
    await writeFile(join(workspace, '.env'), 'FROM=hand\n', 'utf8')
    await writeCarryList('planner', '.env\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual({
      written: [],
      missing: []
    })
    await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe('FROM=hand\n')
  })

  /*
   * A list is written once and a project's needs change, so a path that has
   * gone is not a reason to fail the workspace — but it is a reason to say so.
   * Swallowed, it is how a workspace comes up unable to run and the first
   * complaint arrives from a script reading a variable nobody wrote.
   */
  it('carries the rest and names the file the checkout does not have', async () => {
    await writeFile(join(repo, '.env'), 'A=1\n', 'utf8')
    await writeCarryList('planner', 'gone.txt\n.env\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual({
      written: ['.env'],
      missing: ['gone.txt']
    })
  })

  // The same for a named source: a copy that has moved fails exactly as
  // quietly as one that was never there, which is what this reports.
  it('names a source that is not where the line says it is', async () => {
    await writeCarryList('planner', `.env = ${join(repo, 'nowhere', '.env')}\n`, root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual({
      written: [],
      missing: ['.env']
    })
  })

  /*
   * The failure this whole feature exists for. planner was re-added by cloning
   * it from GitHub, and a fresh clone has no `.env` and no `config/master.key`
   * at all — they are gitignored, so GitHub never had them. The real ones were
   * on the same disk the whole time, in another checkout, and there was no way
   * to say so; the workspace came up empty and silent.
   */
  it('copies from the source when the checkout has no such file', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'octopus-other-'))
    try {
      await writeFile(join(elsewhere, '.env'), 'API_KEY=from-the-other-checkout\n', 'utf8')
      await writeCarryList('planner', `.env = ${join(elsewhere, '.env')}\n`, root)

      // Nothing is written into `repo`: it stands for the fresh clone.
      await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual({
        written: ['.env'],
        missing: []
      })

      await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe(
        'API_KEY=from-the-other-checkout\n'
      )
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('prefers the source over a file the checkout does have', async () => {
    // The line says where the file comes from, and that is where it comes from.
    // No precedence table, and nothing to be surprised by.
    const elsewhere = await mkdtemp(join(tmpdir(), 'octopus-other-'))
    try {
      await writeFile(join(repo, '.env'), 'API_KEY=stale\n', 'utf8')
      await writeFile(join(elsewhere, '.env'), 'API_KEY=wanted\n', 'utf8')
      await writeCarryList('planner', `.env = ${join(elsewhere, '.env')}\n`, root)

      await carryInto('planner', repo, workspace, root)

      await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe('API_KEY=wanted\n')
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('resolves a relative source against the checkout', async () => {
    // Which is what a bare path already means, so it is one rule spelled three
    // ways rather than an error nobody would read.
    await mkdir(join(repo, 'secrets'), { recursive: true })
    await writeFile(join(repo, 'secrets', 'env.local'), 'API_KEY=nested\n', 'utf8')
    await writeCarryList('planner', '.env = secrets/env.local\n', root)

    await carryInto('planner', repo, workspace, root)

    await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe('API_KEY=nested\n')
  })

  it('expands a leading ~ to the home directory', async () => {
    // `HOME` is a scratch directory for the whole suite (vitest.shared.ts), so
    // this writes nowhere near a real one.
    const home = homedir()
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'carried.env'), 'API_KEY=from-home\n', 'utf8')

    try {
      await writeCarryList('planner', '.env = ~/carried.env\n', root)

      await carryInto('planner', repo, workspace, root)

      await expect(readFile(join(workspace, '.env'), 'utf8')).resolves.toBe('API_KEY=from-home\n')
    } finally {
      await rm(join(home, 'carried.env'), { force: true })
    }
  })

  it('carries nothing for a list that names nothing', async () => {
    await writeCarryList('planner', '# only a comment\n', root)

    await expect(carryInto('planner', repo, workspace, root)).resolves.toEqual({
      written: [],
      missing: []
    })
  })
})
