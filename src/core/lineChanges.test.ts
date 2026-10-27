import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DiffError } from './diff.js'
import { type GitExec, gitIn } from './git.js'
import { type LineChanges, parseLineChanges, readLineChanges } from './lineChanges.js'

const run = promisify(execFile)

let dir: string
let exec: GitExec

async function commit(message: string): Promise<void> {
  await run('git', ['add', '-A'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', message], { cwd: dir })
}

const write = (name: string, text: string): Promise<void> =>
  writeFile(join(dir, name), text, 'utf8')

const read = (name: string, baseBranch = 'main'): Promise<LineChanges> =>
  readLineChanges(exec, { baseBranch, path: name, absolute: join(dir, name) })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-lines-'))
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await write('a.txt', 'one\ntwo\nthree\nfour\n')
  await commit('first')
  await run('git', ['checkout', '-q', '-b', 'work'], { cwd: dir })
  exec = gitIn(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Only the headers matter to the parser; the lines under them are what `-U0` prints anyway. */
const diff = (...headers: string[]): string =>
  ['diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f', ...headers].join('\n')

describe('parseLineChanges', () => {
  it('says nothing for an empty diff', () => {
    expect(parseLineChanges('')).toEqual({ added: [], modified: [], removedAfter: [] })
  })

  it('reads a pure addition as added lines', () => {
    expect(parseLineChanges(diff('@@ -4,0 +5,3 @@'))).toEqual({
      added: [{ start: 5, end: 7 }],
      modified: [],
      removedAfter: []
    })
  })

  it('reads a hunk that replaces lines as modified, whatever its length on either side', () => {
    expect(parseLineChanges(diff('@@ -2,2 +2,3 @@'))).toEqual({
      added: [],
      modified: [{ start: 2, end: 4 }],
      removedAfter: []
    })
  })

  it('reads a pure deletion as the line it follows', () => {
    expect(parseLineChanges(diff('@@ -6,2 +5,0 @@'))).toEqual({
      added: [],
      modified: [],
      removedAfter: [5]
    })
  })

  it('puts a deletion above the first line at zero', () => {
    expect(parseLineChanges(diff('@@ -1,2 +0,0 @@'))).toEqual({
      added: [],
      modified: [],
      removedAfter: [0]
    })
  })

  it('takes a missing count as one line, on either side', () => {
    expect(parseLineChanges(diff('@@ -3 +3 @@'))).toEqual({
      added: [],
      modified: [{ start: 3, end: 3 }],
      removedAfter: []
    })
    expect(parseLineChanges(diff('@@ -3,0 +4 @@')).added).toEqual([{ start: 4, end: 4 }])
    expect(parseLineChanges(diff('@@ -4 +3,0 @@')).removedAfter).toEqual([3])
  })

  it('keeps every hunk, in the order git printed them', () => {
    expect(
      parseLineChanges(diff('@@ -1 +1,2 @@', '+x', '@@ -9,0 +10 @@', '@@ -20 +20,0 @@'))
    ).toEqual({
      added: [{ start: 10, end: 10 }],
      modified: [{ start: 1, end: 2 }],
      removedAfter: [20]
    })
  })

  it('ignores a combined-diff or heading line that is not a hunk header', () => {
    expect(parseLineChanges(diff('@@@ -1,2 -1,2 +1,2 @@@', '+@@ -1 +1 @@ in text'))).toEqual({
      added: [],
      modified: [],
      removedAfter: []
    })
  })

  it('reads a header that carries a function heading after it', () => {
    expect(parseLineChanges(diff('@@ -7,0 +8,2 @@ function open() {')).added).toEqual([
      { start: 8, end: 9 }
    ])
  })
})

describe('readLineChanges', () => {
  it('says nothing for a file the branch has not touched', async () => {
    expect(await read('a.txt')).toEqual({ added: [], modified: [], removedAfter: [] })
  })

  it('marks an edit that is not committed', async () => {
    await write('a.txt', 'one\nTWO\nthree\nfour\n')

    expect(await read('a.txt')).toEqual({
      added: [],
      modified: [{ start: 2, end: 2 }],
      removedAfter: []
    })
  })

  it('keeps marking what is committed, since the base is where the branch began', async () => {
    await write('a.txt', 'one\ntwo\nthree\nfour\nfive\n')
    await commit('add five')

    expect(await read('a.txt')).toEqual({
      added: [{ start: 5, end: 5 }],
      modified: [],
      removedAfter: []
    })
  })

  it('marks the gap a deletion left', async () => {
    await write('a.txt', 'one\nthree\nfour\n')

    expect(await read('a.txt')).toEqual({ added: [], modified: [], removedAfter: [1] })
  })

  it('marks a new file that is staged but not committed', async () => {
    await write('b.txt', 'x\ny\n')
    await run('git', ['add', 'b.txt'], { cwd: dir })

    expect(await read('b.txt')).toEqual({
      added: [{ start: 1, end: 2 }],
      modified: [],
      removedAfter: []
    })
  })

  it('marks an untracked file whole, which git prints no diff for', async () => {
    await write('b.txt', 'x\ny\nz')

    expect(await read('b.txt')).toEqual({
      added: [{ start: 1, end: 3 }],
      modified: [],
      removedAfter: []
    })
  })

  it('counts a final newline as ending a line rather than starting one', async () => {
    await write('b.txt', 'x\ny\n')

    expect((await read('b.txt')).added).toEqual([{ start: 1, end: 2 }])
  })

  it('has nothing to mark in an untracked file with nothing in it', async () => {
    await write('b.txt', '')

    expect(await read('b.txt')).toEqual({ added: [], modified: [], removedAfter: [] })
  })

  it('takes the path literally, so a name with a glob in it matches only itself', async () => {
    await write('a*.txt', 'x\n')
    await commit('glob')
    // Measured from here, so both files are edits and a glob would take both.
    await run('git', ['branch', 'mark'], { cwd: dir })
    await write('a*.txt', 'y\n')
    await write('a.txt', 'one\nTWO\nthree\nfour\n')

    expect(await read('a*.txt', 'mark')).toEqual({
      added: [],
      modified: [{ start: 1, end: 1 }],
      removedAfter: []
    })
  })

  it('says why when the branch cannot be traced to its base', async () => {
    await expect(read('a.txt', 'nowhere')).rejects.toBeInstanceOf(DiffError)
  })
})
