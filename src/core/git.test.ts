/**
 * These tests drive a **real** git repository in a temporary directory.
 *
 * Reason: parsing git output is the most common source of wrong assumptions.
 * A fake executor would only verify what we invented ourselves.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  anyBranchExists,
  branchExists,
  currentBranch,
  detectBaseBranch,
  extractCode,
  extractStderr,
  findRepositoryRoot,
  GitError,
  type GitExec,
  gitIn,
  hasCommits,
  OUTPUT_TOO_LARGE,
  repositoryName,
  toSlug
} from './git.js'

const run = promisify(execFile)

let dir: string
let exec: GitExec

/** Prepares a repository with a single commit on `main`. */
async function initRepo(path: string): Promise<void> {
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: path })
}

let remoteDir: string | null = null

/** Gives the repository a remote carrying a branch it has no local copy of. */
async function addRemote(): Promise<void> {
  remoteDir = await mkdtemp(join(tmpdir(), 'octopus-git-remote-'))

  await run('git', ['init', '-q', '--bare', '--initial-branch=main', remoteDir])
  await run('git', ['remote', 'add', 'origin', remoteDir], { cwd: dir })
  await run('git', ['push', '-q', 'origin', 'main'], { cwd: dir })
  await run('git', ['push', '-q', 'origin', 'main:develop'], { cwd: dir })
  await run('git', ['fetch', '-q', 'origin'], { cwd: dir })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-git-'))
  exec = gitIn(dir)
})

afterEach(async () => {
  if (remoteDir !== null) {
    await rm(remoteDir, { recursive: true, force: true })
    remoteDir = null
  }
  await rm(dir, { recursive: true, force: true })
})

describe('gitIn', () => {
  it('returns the output of a successful command', async () => {
    await initRepo(dir)
    await expect(exec(['rev-parse', '--abbrev-ref', 'HEAD'])).resolves.toContain('main')
  })

  it('throws GitError carrying stderr rather than hiding the cause', async () => {
    await initRepo(dir)
    await expect(exec(['checkout', 'no-such-branch'])).rejects.toBeInstanceOf(GitError)
  })

  it('includes both the command and the reason in the message', async () => {
    await initRepo(dir)
    const error = await exec(['checkout', 'missing']).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).message).toContain('checkout')
    expect((error as GitError).stderr.length).toBeGreaterThan(0)
  })

  it('throws GitError when git has nowhere to run', async () => {
    const missing = gitIn(join(dir, 'no-such-directory'))
    await expect(missing(['status'])).rejects.toBeInstanceOf(GitError)
  })

  it('carries the status git refused with, so a caller can tell refusals apart', async () => {
    await initRepo(dir)
    const error = await exec(['checkout', 'missing']).catch((cause: unknown) => cause)
    expect((error as GitError).code).toBe('1')
  })

  it('says so by name when the output did not fit in the buffer', async () => {
    await initRepo(dir)
    // Committed and then rewritten: `git diff` says nothing about a file it
    // has never seen, so an untracked one would produce no output to overflow.
    await writeFile(join(dir, 'wide.txt'), 'first\n', 'utf8')
    await run('git', ['add', '.'], { cwd: dir })
    await run('git', ['commit', '-q', '-m', 'wide'], { cwd: dir })
    await writeFile(join(dir, 'wide.txt'), 'x'.repeat(20_000), 'utf8')

    const tight = gitIn(dir, { maxBuffer: 1_000 })
    const error = await tight(['diff']).catch((cause: unknown) => cause)

    expect((error as GitError).code).toBe(OUTPUT_TOO_LARGE)
  })
})

describe('extractCode', () => {
  it('reads the code Node put on the failure', () => {
    expect(extractCode({ code: 'ENOENT' })).toBe('ENOENT')
  })

  it('stringifies an exit status, so one kind of value is compared', () => {
    expect(extractCode({ code: 128 })).toBe('128')
  })

  it('answers with nothing when the failure carried no code', () => {
    expect(extractCode(new Error('something else'))).toBe('')
  })
})

describe('extractStderr', () => {
  it('prefers stderr when it says something', () => {
    expect(extractStderr({ stderr: 'fatal: not a git repository\n' })).toBe(
      'fatal: not a git repository'
    )
  })

  it('falls back to the error message when stderr is blank', () => {
    const error = Object.assign(new Error('spawn ENOENT'), { stderr: '   ' })
    expect(extractStderr(error)).toBe('spawn ENOENT')
  })

  it('works when stderr is absent entirely — as happens on ENOENT', () => {
    expect(extractStderr(new Error('spawn git ENOENT'))).toBe('spawn git ENOENT')
  })
})

describe('findRepositoryRoot', () => {
  it('returns null when git answers with an empty path', async () => {
    const silent: GitExec = () => Promise.resolve('  \n')
    await expect(findRepositoryRoot(silent)).resolves.toBeNull()
  })

  it('finds the repository root', async () => {
    await initRepo(dir)
    const root = await findRepositoryRoot(exec)
    expect(root).toBeTruthy()
    expect(root?.endsWith(dir.split('/').pop() ?? '')).toBe(true)
  })

  it('returns the root even when a subdirectory was given', async () => {
    await initRepo(dir)
    const sub = join(dir, 'src', 'nested')
    await run('mkdir', ['-p', sub])
    const fromRoot = await findRepositoryRoot(exec)
    const fromSub = await findRepositoryRoot(gitIn(sub))
    expect(fromSub).toBe(fromRoot)
  })

  it('returns null for a directory outside any repository', async () => {
    await expect(findRepositoryRoot(exec)).resolves.toBeNull()
  })
})

describe('hasCommits', () => {
  it('recognises a repository with a commit', async () => {
    await initRepo(dir)
    await expect(hasCommits(exec)).resolves.toBe(true)
  })

  it('rejects an empty repository, which cannot host a worktree', async () => {
    await run('git', ['init', '-q'], { cwd: dir })
    await expect(hasCommits(exec)).resolves.toBe(false)
  })
})

describe('currentBranch', () => {
  it('returns the checked-out branch', async () => {
    await initRepo(dir)
    await expect(currentBranch(exec)).resolves.toBe('main')
  })

  it('returns null on a detached HEAD', async () => {
    await initRepo(dir)
    const sha = (await exec(['rev-parse', 'HEAD'])).trim()
    await exec(['checkout', '-q', sha])
    await expect(currentBranch(exec)).resolves.toBeNull()
  })
})

describe('branchExists', () => {
  it('finds an existing branch', async () => {
    await initRepo(dir)
    await expect(branchExists(exec, 'main')).resolves.toBe(true)
  })

  it('does not find a missing one', async () => {
    await initRepo(dir)
    await expect(branchExists(exec, 'missing')).resolves.toBe(false)
  })

  // A remote-tracking branch is not a local one, and detectBaseBranch relies
  // on the distinction when it probes for main/master/develop.
  it('does not count a remote-tracking branch', async () => {
    await initRepo(dir)
    await addRemote()
    await expect(branchExists(exec, 'origin/develop')).resolves.toBe(false)
  })
})

describe('anyBranchExists', () => {
  it('finds a local branch', async () => {
    await initRepo(dir)
    await expect(anyBranchExists(exec, 'main')).resolves.toBe(true)
  })

  // A project's base branch may be remote-tracking, which is exactly what
  // `worktree add` accepts and what a fresh clone mostly has.
  it('finds a remote-tracking branch', async () => {
    await initRepo(dir)
    await addRemote()
    await expect(anyBranchExists(exec, 'origin/develop')).resolves.toBe(true)
  })

  it('does not find a name that is neither', async () => {
    await initRepo(dir)
    await expect(anyBranchExists(exec, 'origin/nothing')).resolves.toBe(false)
  })

  // Resolving a bare name would match a tag too, which is not a branch and
  // would drift the moment the tag is moved.
  it('does not accept a tag', async () => {
    await initRepo(dir)
    await run('git', ['tag', 'v1'], { cwd: dir })

    await expect(anyBranchExists(exec, 'v1')).resolves.toBe(false)
  })
})

describe('detectBaseBranch', () => {
  it('prefers origin default branch when configured', async () => {
    await initRepo(dir)
    await exec(['branch', 'unconventional'])
    await exec(['remote', 'add', 'origin', 'https://example.com/repo.git'])
    await exec(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/unconventional'])

    await expect(detectBaseBranch(exec)).resolves.toBe('unconventional')
  })

  it('falls back to main without an origin', async () => {
    await initRepo(dir)
    await expect(detectBaseBranch(exec)).resolves.toBe('main')
  })

  it('recognises master in older repositories', async () => {
    await run('git', ['init', '-q', '--initial-branch=master'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
    await exec(['add', '.'])
    await exec(['commit', '-q', '-m', 'first'])

    await expect(detectBaseBranch(exec)).resolves.toBe('master')
  })

  it('recognises develop when no other common branch exists', async () => {
    await run('git', ['init', '-q', '--initial-branch=develop'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
    await exec(['add', '.'])
    await exec(['commit', '-q', '-m', 'first'])

    await expect(detectBaseBranch(exec)).resolves.toBe('develop')
  })

  it('falls back to the current branch for unconventional naming', async () => {
    await run('git', ['init', '-q', '--initial-branch=trunk'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
    await exec(['add', '.'])
    await exec(['commit', '-q', '-m', 'first'])

    await expect(detectBaseBranch(exec)).resolves.toBe('trunk')
  })

  it('ignores an empty origin/HEAD answer and keeps looking', async () => {
    const odd: GitExec = (args) => {
      if (args[0] === 'symbolic-ref') return Promise.resolve('origin/\n')
      if (args[0] === 'rev-parse') return Promise.reject(new Error('no such branch'))
      if (args[0] === 'branch') return Promise.resolve('fallback\n')
      return Promise.resolve('')
    }

    await expect(detectBaseBranch(odd)).resolves.toBe('fallback')
  })

  it('returns null when there is nothing to infer from', async () => {
    await initRepo(dir)
    await exec(['branch', '-m', 'main', 'trunk'])
    const sha = (await exec(['rev-parse', 'HEAD'])).trim()
    await exec(['checkout', '-q', sha])

    await expect(detectBaseBranch(exec)).resolves.toBeNull()
  })
})

describe('repositoryName', () => {
  it('takes the last path segment', () => {
    expect(repositoryName('/Users/tsykvas/projects/planner')).toBe('planner')
  })

  it('is not confused by a nested path', () => {
    expect(repositoryName('/repos/esl')).toBe('esl')
  })
})

describe('toSlug', () => {
  it('leaves already-valid names untouched', () => {
    expect(toSlug('planner')).toBe('planner')
    expect(toSlug('my-app_v2')).toBe('my-app_v2')
  })

  it('lowercases', () => {
    expect(toSlug('MyApp')).toBe('myapp')
  })

  it('preserves non-Latin scripts — git accepts UTF-8 in branch names', () => {
    expect(toSlug('Δοκιμή')).toBe('δοκιμή')
    expect(toSlug('日本語 プロジェクト')).toBe('日本語-プロジェクト')
  })

  it('replaces whitespace and characters git forbids', () => {
    expect(toSlug('Family Shopping')).toBe('family-shopping')
    expect(toSlug('a:b?c*d')).toBe('a-b-c-d')
    expect(toSlug('a[b]c')).toBe('a-b-c')
    expect(toSlug('a~b^c')).toBe('a-b-c')
  })

  it('trims edge dots and dashes, which git rejects in refs', () => {
    expect(toSlug('--name--')).toBe('name')
    expect(toSlug('.hidden.')).toBe('hidden')
  })

  it('collapses repeated dashes and dots', () => {
    expect(toSlug('a   b')).toBe('a-b')
    expect(toSlug('a..b')).toBe('a.b')
  })

  it('drops the .lock suffix that git reserves', () => {
    expect(toSlug('branch.lock')).toBe('branch')
  })

  it('strips control characters', () => {
    expect(toSlug('ab')).toBe('ab')
  })

  it('falls back to a usable name when nothing valid remains', () => {
    expect(toSlug('~~~')).toBe('project')
    expect(toSlug('')).toBe('project')
  })
})

describe('toSlug produces something git will accept as a branch', () => {
  // git rejects a good deal: `.lock` endings, `..`, leading dashes, control
  // characters, and its own special tokens. A slug that slips through becomes
  // a workspace that cannot be created at all, and the failure surfaces far
  // from the name that caused it.
  const HOSTILE = [
    'feature.lock',
    '.hidden',
    'trailing.',
    'a..b',
    '-leading-dash',
    'has space',
    'tilde~1',
    'caret^2',
    'colon:name',
    'question?',
    'star*',
    'bracket[1]',
    'back\\slash',
    'at@{sign}',
    'emoji 🎉 name',
    'CAPS',
    '...',
    '@',
    'ім’я з апострофом'
  ]

  for (const input of HOSTILE) {
    it(`turns ${JSON.stringify(input)} into a usable branch name`, async () => {
      await initRepo(dir)
      const branch = `ytsykvas/${toSlug(input)}`

      await exec(['branch', branch])
      await expect(exec(['branch', '--list', branch])).resolves.toContain(branch)
    })
  }
})
