/**
 * Driven against a real repository, like `git.test.ts`.
 *
 * The porcelain parser is tested on strings, but everything that touches git
 * runs the real thing: worktree behaviour around branches, detached heads and
 * dirty trees is where assumptions turn out wrong.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type GitExec, gitIn } from './git.js'
import {
  addWorktree,
  changedFiles,
  deleteBranch,
  hasUncommittedChanges,
  listBranches,
  listRemoteBranches,
  listWorktrees,
  parseWorktrees,
  pruneWorktrees,
  removeWorktree,
  renameBranch
} from './worktree.js'

const run = promisify(execFile)

let dir: string
let remoteDir: string | null = null
let exec: GitExec

/**
 * Gives the repository a real remote carrying a branch it does not have
 * locally — the situation a fresh clone is usually in.
 */
async function addRemote(): Promise<void> {
  remoteDir = await mkdtemp(join(tmpdir(), 'octopus-remote-'))

  await run('git', ['init', '-q', '--bare', '--initial-branch=main', remoteDir])
  await run('git', ['remote', 'add', 'origin', remoteDir], { cwd: dir })
  await run('git', ['push', '-q', 'origin', 'main'], { cwd: dir })
  await run('git', ['push', '-q', 'origin', 'main:develop'], { cwd: dir })
  await run('git', ['fetch', '-q', 'origin'], { cwd: dir })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-worktree-'))
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: dir })
  exec = gitIn(dir)
})

afterEach(async () => {
  if (remoteDir !== null) {
    await rm(remoteDir, { recursive: true, force: true })
    remoteDir = null
  }
  await rm(dir, { recursive: true, force: true })
})

describe('parseWorktrees', () => {
  it('reads a single worktree', () => {
    const output = 'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n'
    expect(parseWorktrees(output)).toEqual([
      { path: '/repo', head: 'abc123', branch: 'main', prunable: false }
    ])
  })

  it('reads several blocks separated by blank lines', () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/wt',
      'HEAD def456',
      'branch refs/heads/feature',
      ''
    ].join('\n')

    expect(parseWorktrees(output)).toHaveLength(2)
  })

  // Our branches are `<prefix>/<name>`, so this is the normal case, not an edge one.
  it('keeps slashes in branch names', () => {
    const output = 'worktree /repo/wt\nHEAD abc\nbranch refs/heads/ytsykvas/fix-auth\n'
    expect(parseWorktrees(output)[0]?.branch).toBe('ytsykvas/fix-auth')
  })

  it('reports a detached worktree as having no branch', () => {
    const output = 'worktree /repo/wt\nHEAD abc123\ndetached\n'
    expect(parseWorktrees(output)[0]?.branch).toBeNull()
  })

  it('returns nothing for empty output', () => {
    expect(parseWorktrees('')).toEqual([])
  })

  it('reads the prunable flag, with or without a reason after it', () => {
    const bare = 'worktree /repo/wt\nHEAD abc\nbranch refs/heads/x\nprunable\n'
    const withReason =
      'worktree /repo/wt\nHEAD abc\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n'

    expect(parseWorktrees(bare)[0]?.prunable).toBe(true)
    expect(parseWorktrees(withReason)[0]?.prunable).toBe(true)
  })

  it('reports a healthy worktree as not prunable', () => {
    const out = 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n'
    expect(parseWorktrees(out)[0]?.prunable).toBe(false)
  })

  // The flag belongs to one block, not to every block after it.
  it('does not carry the flag into the next worktree', () => {
    const out = [
      'worktree /repo/gone',
      'HEAD abc',
      'branch refs/heads/x',
      'prunable',
      '',
      'worktree /repo/here',
      'HEAD def',
      'branch refs/heads/y',
      ''
    ].join('\n')

    expect(parseWorktrees(out).map((item) => item.prunable)).toEqual([true, false])
  })

  it('strips a trailing carriage return rather than folding it into a branch', () => {
    const out = 'worktree /repo\r\nHEAD abc\r\nbranch refs/heads/main\r\n'
    expect(parseWorktrees(out)[0]?.branch).toBe('main')
  })

  it('passes through a ref that is not under refs/heads', () => {
    const output = 'worktree /repo\nHEAD abc\nbranch refs/remotes/origin/main\n'
    expect(parseWorktrees(output)[0]?.branch).toBe('refs/remotes/origin/main')
  })
})

describe('listWorktrees', () => {
  it('reports the main worktree of a fresh repository', async () => {
    const list = await listWorktrees(exec)
    expect(list).toHaveLength(1)
    expect(list[0]?.branch).toBe('main')
  })

  it('includes an added worktree with its branch', async () => {
    await addWorktree(exec, join(dir, 'wt'), 'ytsykvas/task', 'main')

    const list = await listWorktrees(exec)
    expect(list).toHaveLength(2)
    expect(list.map((item) => item.branch)).toContain('ytsykvas/task')
  })
})

describe('addWorktree', () => {
  it('creates the directory and the branch', async () => {
    await addWorktree(exec, join(dir, 'wt'), 'ytsykvas/task', 'main')

    const branches = await exec(['branch', '--list', 'ytsykvas/task'])
    expect(branches.trim()).toContain('ytsykvas/task')

    const inside = gitIn(join(dir, 'wt'))
    await expect(inside(['branch', '--show-current'])).resolves.toContain('ytsykvas/task')
  })

  it('refuses a branch name that already exists', async () => {
    await addWorktree(exec, join(dir, 'one'), 'ytsykvas/task', 'main')
    await expect(addWorktree(exec, join(dir, 'two'), 'ytsykvas/task', 'main')).rejects.toThrow()
  })

  it('refuses a path that is already occupied', async () => {
    await addWorktree(exec, join(dir, 'wt'), 'ytsykvas/one', 'main')
    await expect(addWorktree(exec, join(dir, 'wt'), 'ytsykvas/two', 'main')).rejects.toThrow()
  })
})

describe('removeWorktree', () => {
  it('removes a clean worktree', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')

    await removeWorktree(exec, path)
    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
  })

  // git's refusal is the safety net that keeps unsaved work from vanishing.
  it('refuses a worktree with uncommitted changes', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')
    await writeFile(join(path, 'README.md'), 'changed\n', 'utf8')

    await expect(removeWorktree(exec, path)).rejects.toThrow()
  })

  it('removes a dirty worktree when forced', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')
    await writeFile(join(path, 'README.md'), 'changed\n', 'utf8')

    await removeWorktree(exec, path, true)
    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
  })

  it('leaves the branch behind', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')
    await removeWorktree(exec, path)

    await expect(exec(['branch', '--list', 'ytsykvas/task'])).resolves.toContain('ytsykvas/task')
  })
})

describe('deleteBranch', () => {
  it('deletes a merged branch', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')
    await removeWorktree(exec, path)

    await deleteBranch(exec, 'ytsykvas/task')
    await expect(exec(['branch', '--list', 'ytsykvas/task'])).resolves.toBe('')
  })

  it('refuses an unmerged branch without force', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')

    const inside = gitIn(path)
    await writeFile(join(path, 'new.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'work'])
    await removeWorktree(exec, path)

    await expect(deleteBranch(exec, 'ytsykvas/task')).rejects.toThrow()
  })

  it('deletes an unmerged branch when forced', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')

    const inside = gitIn(path)
    await writeFile(join(path, 'new.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'work'])
    await removeWorktree(exec, path)

    await deleteBranch(exec, 'ytsykvas/task', true)
    await expect(exec(['branch', '--list', 'ytsykvas/task'])).resolves.toBe('')
  })
})

describe('renameBranch', () => {
  it('renames a branch that is checked out in another worktree', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/anna', 'main')

    await renameBranch(exec, 'ytsykvas/anna', 'ytsykvas/fix-auth')

    const inside = gitIn(path)
    await expect(inside(['branch', '--show-current'])).resolves.toContain('ytsykvas/fix-auth')
  })

  it('leaves the worktree directory where it was', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/anna', 'main')
    await renameBranch(exec, 'ytsykvas/anna', 'ytsykvas/fix-auth')

    const list = await listWorktrees(exec)
    expect(list.some((item) => item.path.endsWith('/wt'))).toBe(true)
  })

  it('refuses to rename onto an existing branch', async () => {
    await addWorktree(exec, join(dir, 'one'), 'ytsykvas/one', 'main')
    await addWorktree(exec, join(dir, 'two'), 'ytsykvas/two', 'main')

    await expect(renameBranch(exec, 'ytsykvas/one', 'ytsykvas/two')).rejects.toThrow()
  })
})

describe('changedFiles', () => {
  it('is empty in a clean repository', async () => {
    await expect(changedFiles(exec)).resolves.toEqual([])
    await expect(hasUncommittedChanges(exec)).resolves.toBe(false)
  })

  it('counts modified files', async () => {
    await writeFile(join(dir, 'README.md'), 'changed\n', 'utf8')

    await expect(changedFiles(exec)).resolves.toHaveLength(1)
    await expect(hasUncommittedChanges(exec)).resolves.toBe(true)
  })

  // Untracked work disappears with the worktree just as surely as modified work.
  it('counts untracked files too', async () => {
    await writeFile(join(dir, 'new.txt'), 'work\n', 'utf8')
    await expect(hasUncommittedChanges(exec)).resolves.toBe(true)
  })

  it('counts staged files', async () => {
    await writeFile(join(dir, 'new.txt'), 'work\n', 'utf8')
    await exec(['add', '.'])
    await expect(changedFiles(exec)).resolves.toHaveLength(1)
  })
})

describe('listBranches', () => {
  it('lists local branches by short name', async () => {
    await expect(listBranches(exec)).resolves.toEqual(['main'])
  })

  // The short name keeps the slashes our `<prefix>/<name>` scheme produces —
  // stripping them would make every branch look unclaimed.
  it('keeps slashes in branch names', async () => {
    await addWorktree(exec, join(dir, 'wt'), 'ytsykvas/fix-auth', 'main')
    await expect(listBranches(exec)).resolves.toContain('ytsykvas/fix-auth')
  })

  it('lists local branches only, never remote ones', async () => {
    await addRemote()
    await expect(listBranches(exec)).resolves.toEqual(['main'])
  })
})

describe('listRemoteBranches', () => {
  it('lists tracking branches, including ones with no local copy', async () => {
    await addRemote()

    const branches = await listRemoteBranches(exec)
    expect(branches).toContain('origin/develop')
    expect(branches).toContain('origin/main')
  })

  it('returns nothing for a repository with no remote', async () => {
    await expect(listRemoteBranches(exec)).resolves.toEqual([])
  })

  // origin/HEAD is a pointer at whatever the remote calls default, not a
  // branch — choosing it would mean choosing a name that moves. Its short form
  // is bare `origin`, so an assertion against 'origin/HEAD' passes while the
  // list is still wrong.
  it('never offers the remote head pointer', async () => {
    await addRemote()
    await run('git', ['remote', 'set-head', 'origin', 'main'], { cwd: dir })

    const branches = await listRemoteBranches(exec)
    expect(branches).not.toContain('origin')
    expect(branches).not.toContain('origin/HEAD')
    expect(branches).toContain('origin/main')
  })
})

describe('pruneWorktrees', () => {
  it('clears the record of a directory that was removed by hand', async () => {
    const path = join(dir, 'wt')
    await addWorktree(exec, path, 'ytsykvas/task', 'main')
    await rm(path, { recursive: true, force: true })

    // git still lists it until told to prune.
    await pruneWorktrees(exec)
    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
  })
})
