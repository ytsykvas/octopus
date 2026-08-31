/**
 * Driven against a real repository, like `diff.test.ts`.
 *
 * This module decides which git command to run from what git says about a
 * path, so a fake executor would be testing the guess rather than the answer.
 * The awkward cases — a file changed in a commit and again in the working
 * tree, a rename where one row covers two paths, a deletion that has to come
 * back — are exactly the ones a mock would model wrongly.
 */

import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readWorkspaceDiff } from './diff.js'
import { type GitExec, gitIn } from './git.js'
import { insideWorktree, revertFile } from './revert.js'

const run = promisify(execFile)

let dir: string
let exec: GitExec

async function commit(message: string): Promise<void> {
  await run('git', ['add', '-A'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', message], { cwd: dir })
}

/** Reverts one file of the workspace's diff, against the base every test uses. */
async function revert(path: string, oldPath: string | null = null): Promise<void> {
  await revertFile(exec, { baseBranch: 'main', root: dir, path, oldPath })
}

/** The paths the pane would draw, which is what a revert has to empty. */
async function changed(): Promise<string[]> {
  const diff = await readWorkspaceDiff(exec, { baseBranch: 'main', root: dir })
  return diff.files.map((file) => file.path)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(join(dir, path))
    return true
  } catch {
    return false
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-revert-'))
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'kept.txt'), 'one\ntwo\n', 'utf8')
  await writeFile(join(dir, 'other.txt'), 'untouched\n', 'utf8')
  await commit('first')
  await run('git', ['checkout', '-q', '-b', 'work'], { cwd: dir })
  exec = gitIn(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('insideWorktree', () => {
  it('accepts a path the diff can report', () => {
    expect(insideWorktree('src/core/revert.ts')).toBe(true)
    expect(insideWorktree('a.txt')).toBe(true)
  })

  // It becomes a git argument and, in one branch, a file to delete.
  it('refuses one that is absolute, climbs out, or is nothing at all', () => {
    expect(insideWorktree('/etc/passwd')).toBe(false)
    expect(insideWorktree('../outside.txt')).toBe(false)
    expect(insideWorktree('a/../../outside.txt')).toBe(false)
    expect(insideWorktree('')).toBe(false)
  })
})

describe('revertFile', () => {
  it('puts back a file edited in the working tree', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\nchanged\n', 'utf8')
    expect(await changed()).toEqual(['kept.txt'])

    await revert('kept.txt')

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  it('leaves every other file alone', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\nchanged\n', 'utf8')
    await writeFile(join(dir, 'other.txt'), 'also changed\n', 'utf8')

    await revert('kept.txt')

    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('also changed\n')
    expect(await changed()).toEqual(['other.txt'])
  })

  it('deletes a file nobody has added', async () => {
    await writeFile(join(dir, 'new.txt'), 'fresh\n', 'utf8')
    expect(await changed()).toEqual(['new.txt'])

    await revert('new.txt')

    expect(await exists('new.txt')).toBe(false)
    expect(await changed()).toEqual([])
  })

  it('deletes a file added and committed on the branch', async () => {
    await writeFile(join(dir, 'new.txt'), 'fresh\n', 'utf8')
    await commit('add new')
    expect(await changed()).toEqual(['new.txt'])

    await revert('new.txt')

    expect(await exists('new.txt')).toBe(false)
    expect(await changed()).toEqual([])
  })

  /*
   * The case the scope decision is about. The pane draws both halves as one
   * row, so a revert that cleared only the working tree would leave the row
   * behind and read as a button that did not work.
   */
  it('clears a commit and a working-tree edit together', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\ncommitted\n', 'utf8')
    await commit('change it')
    await writeFile(join(dir, 'kept.txt'), 'one\ncommitted\nand more\n', 'utf8')
    expect(await changed()).toEqual(['kept.txt'])

    await revert('kept.txt')

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  // The commits stand; what is written is a change that undoes them.
  it('leaves the branch history where it was', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\ncommitted\n', 'utf8')
    await commit('change it')

    await revert('kept.txt')

    const log = await exec(['log', '--oneline', 'main..HEAD'])
    expect(log).toContain('change it')
  })

  it('brings back a file the branch deleted', async () => {
    await run('git', ['rm', '-q', 'kept.txt'], { cwd: dir })
    await commit('drop it')
    expect(await changed()).toEqual(['kept.txt'])

    await revert('kept.txt')

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  it('discards a change that was staged but never committed', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\nstaged\n', 'utf8')
    await run('git', ['add', 'kept.txt'], { cwd: dir })

    await revert('kept.txt')

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  /*
   * One row in the pane, two paths on disk. Reverting only the path the row is
   * filed under would restore the old name and leave the new one in place, so
   * the file would be there twice.
   */
  it('puts both ends of a rename back', async () => {
    await run('git', ['mv', 'kept.txt', 'moved.txt'], { cwd: dir })
    await commit('rename it')

    await revert('moved.txt', 'kept.txt')

    expect(await exists('moved.txt')).toBe(false)
    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  /*
   * The order the two paths are handled in is load-bearing, and only on a
   * case-insensitive filesystem — which is the default on macOS, where this
   * runs. git's tree is case-sensitive, so `foo.ts` is absent from the base and
   * gets removed while `Foo.ts` is present and gets restored. Doing it the
   * other way round would restore the file and then delete it again, through
   * the same directory entry, and the workspace would be left without it.
   */
  it('survives a rename that changes only the case of the name', async () => {
    await run('git', ['mv', 'kept.txt', 'KEPT.txt'], { cwd: dir })
    await commit('case rename')

    await revert('KEPT.txt', 'kept.txt')

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  it('brings back a file deleted in the working tree but never committed', async () => {
    await rm(join(dir, 'kept.txt'))
    expect(await changed()).toEqual(['kept.txt'])

    await revert('kept.txt')

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\ntwo\n')
    expect(await changed()).toEqual([])
  })

  // The diff unquotes what git prints, so the path arriving here is the real
  // one — with the space and the accent in it, not git's escaped spelling.
  it('reverts a path with a space and a character outside ASCII', async () => {
    const awkward = 'дока ція.md'
    await writeFile(join(dir, awkward), 'draft\n', 'utf8')
    expect(await changed()).toEqual([awkward])

    await revert(awkward)

    expect(await exists(awkward)).toBe(false)
    expect(await changed()).toEqual([])
  })

  it('reverts a tracked path with a space in it', async () => {
    await writeFile(join(dir, 'two words.txt'), 'first\n', 'utf8')
    await commit('add it')
    await writeFile(join(dir, 'two words.txt'), 'edited\n', 'utf8')

    await revert('two words.txt')

    expect(await exists('two words.txt')).toBe(false)
    expect(await changed()).toEqual([])
  })

  it('reverts a file inside a directory the branch created', async () => {
    await run('git', ['checkout', '-q', 'main'], { cwd: dir })
    await run('git', ['checkout', '-q', 'work'], { cwd: dir })
    await run('mkdir', ['-p', join(dir, 'src', 'deep')])
    await writeFile(join(dir, 'src', 'deep', 'new.ts'), 'export {}\n', 'utf8')

    await revert('src/deep/new.ts')

    expect(await exists('src/deep/new.ts')).toBe(false)
    expect(await changed()).toEqual([])
  })

  // Tolerance is the promise: somebody deleting the file between the pane
  // being drawn and the button being pressed has arrived where the button was
  // going. `toBeUndefined` alone would hold for any call that did not throw,
  // so the state afterwards is what the assertion is about.
  it('is content when the file is already gone', async () => {
    await writeFile(join(dir, 'new.txt'), 'fresh\n', 'utf8')
    await rm(join(dir, 'new.txt'))

    await expect(revert('new.txt')).resolves.toBeUndefined()

    expect(await exists('new.txt')).toBe(false)
    expect(await changed()).toEqual([])
  })

  it('refuses a path that leaves the workspace', async () => {
    await expect(revert('../outside.txt')).rejects.toThrow(/not inside the workspace/)
  })

  it('refuses the far end of a rename when that leaves the workspace', async () => {
    await expect(revert('moved.txt', '/etc/passwd')).rejects.toThrow(/not inside the workspace/)
  })

  // Checked before anything is written: a refusal that had already deleted one
  // of the two paths would be worse than the request it turned down.
  it('writes nothing at all when one of the two paths is refused', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\nchanged\n', 'utf8')

    await expect(revert('kept.txt', '../outside.txt')).rejects.toThrow()

    expect(await readFile(join(dir, 'kept.txt'), 'utf8')).toBe('one\nchanged\n')
  })

  it('reports a base branch it cannot resolve', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\nchanged\n', 'utf8')

    await expect(
      revertFile(exec, { baseBranch: 'nothing-here', root: dir, path: 'kept.txt' })
    ).rejects.toMatchObject({ code: 'baseUnknown' })
  })

  it('takes no old path at all', async () => {
    await writeFile(join(dir, 'kept.txt'), 'one\nchanged\n', 'utf8')

    await revertFile(exec, { baseBranch: 'main', root: dir, path: 'kept.txt' })

    expect(await changed()).toEqual([])
  })
})
