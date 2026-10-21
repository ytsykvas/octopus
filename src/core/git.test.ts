/**
 * These tests drive a **real** git repository in a temporary directory.
 *
 * Reason: parsing git output is the most common source of wrong assumptions.
 * A fake executor would only verify what we invented ourselves.
 */

import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  type GitOptions,
  hasCommits,
  ignoredAmong,
  isIgnored,
  OUTPUT_TOO_LARGE,
  repositoryName,
  resolveRef,
  toSlug,
  reasonFrom,
  upstreamOf,
  withIndexCopy
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

  // The deadline exists for the fetch, which is the one command that leaves the
  // machine. Every other caller runs without one, so both arms are real.
  it('runs a command normally when given a deadline it does not reach', async () => {
    await initRepo(dir)
    const deadlined = gitIn(dir, { timeout: 10_000 })

    await expect(deadlined(['rev-parse', '--abbrev-ref', 'HEAD'])).resolves.toContain('main')
  })

  /*
   * That the environment reaches git is what makes `GIT_TERMINAL_PROMPT=0` a
   * fact rather than a hope — and that variable is the only thing standing
   * between a fetch over HTTPS and a prompt written to a terminal that does not
   * exist. Asserted through a variable whose effect git will state out loud.
   */
  it('adds the given environment to the one git inherits', async () => {
    await initRepo(dir)
    const named = gitIn(dir, { env: { GIT_AUTHOR_NAME: 'Fetcher' } })

    await expect(named(['var', 'GIT_AUTHOR_IDENT'])).resolves.toContain('Fetcher')
  })

  it('leaves the inherited environment alone when given none', async () => {
    await initRepo(dir)
    await expect(exec(['var', 'GIT_AUTHOR_IDENT'])).resolves.toContain('test@example.com')
  })
})

describe('reasonFrom', () => {
  it('takes the first line, which is where git puts the reason', () => {
    expect(reasonFrom({ stderr: 'fatal: could not read Username\nhint: try this\n' })).toBe(
      'fatal: could not read Username'
    )
  })

  it('keeps a single-line reason whole', () => {
    expect(reasonFrom({ stderr: 'fatal: repository not found' })).toBe(
      'fatal: repository not found'
    )
  })

  // A sentence, not a paragraph: this ends up inside a message in the UI.
  it('caps a reason that runs on', () => {
    expect(reasonFrom({ stderr: 'x'.repeat(500) })).toHaveLength(200)
  })

  // Not every failure carries stderr — a command that never ran carries only a
  // message, and saying nothing would be worse than saying that.
  it('falls back to what the error itself says', () => {
    expect(reasonFrom(new Error('spawn git ENOENT'))).toContain('ENOENT')
  })

  /* The message, not the whole `Error`. `pullRequests.ts` kept a second copy of
     this function that fell back to `String(error)` instead, so every `gh`
     failure with no stderr — the ordinary shape of "gh is not installed" —
     reached the user with an `Error: ` glued to the front of it. */
  it('reports the message without the class name in front of it', () => {
    expect(reasonFrom(new Error('spawn gh ENOENT'))).toBe('spawn gh ENOENT')
  })

  // Whitespace is not a reason: a stderr of blank lines falls back the same way
  // an absent one does, rather than answering with an empty sentence.
  it('falls back where stderr holds nothing but whitespace', () => {
    expect(reasonFrom(Object.assign(new Error('gone wrong'), { stderr: '  \n ' }))).toBe(
      'gone wrong'
    )
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

describe('resolveRef', () => {
  it('answers with the commit a ref names', async () => {
    await initRepo(dir)

    const commit = await resolveRef(exec, 'refs/heads/main')

    expect(commit).toMatch(/^[0-9a-f]{40}$/u)
  })

  it('answers null for a ref that does not exist', async () => {
    await initRepo(dir)
    await expect(resolveRef(exec, 'refs/heads/missing')).resolves.toBeNull()
  })

  /* `@{upstream}` on a branch that has none exits non-zero with a message
     rather than answering emptily, and `publish.ts` leans on both spellings of
     "no" arriving as the same null. */
  it('answers null for an upstream that was never set', async () => {
    await initRepo(dir)
    await expect(resolveRef(exec, 'main@{upstream}')).resolves.toBeNull()
  })
})

describe('upstreamOf', () => {
  it('answers null for a branch that tracks nothing', async () => {
    await initRepo(dir)
    await expect(upstreamOf(exec, 'main')).resolves.toBeNull()
  })

  it('names the remote-tracking branch a branch tracks', async () => {
    await initRepo(dir)
    await run('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir })
    await run('git', ['remote', 'add', 'origin', dir], { cwd: dir })
    await run('git', ['branch', '--set-upstream-to=origin/main', 'main'], { cwd: dir })

    await expect(upstreamOf(exec, 'main')).resolves.toBe('origin/main')
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
    expect(repositoryName('/Users/test/projects/planner')).toBe('planner')
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

describe('isIgnored', () => {
  /*
   * Asked about the env file, which octopus writes into every worktree. A
   * project whose `.gitignore` does not cover it gets a file full of
   * credentials in `git status`, where the agent may commit it like anything
   * else.
   */
  it('says yes to a path the repository ignores', async () => {
    await initRepo(dir)
    await writeFile(join(dir, '.gitignore'), '.env\n', 'utf8')

    await expect(isIgnored(exec, '.env')).resolves.toBe(true)
  })

  it('says no to a path nothing ignores', async () => {
    await initRepo(dir)

    await expect(isIgnored(exec, '.env')).resolves.toBe(false)
  })

  // The worse case of the two, and it answers the same way: a tracked env file
  // is already in the history.
  it('says no to a path the repository tracks', async () => {
    await initRepo(dir)
    await writeFile(join(dir, '.env'), 'A=1\n', 'utf8')
    await exec(['add', '.env'])
    await exec(['commit', '-q', '-m', 'env'])
    await writeFile(join(dir, '.gitignore'), '.env\n', 'utf8')

    await expect(isIgnored(exec, '.env')).resolves.toBe(false)
  })

  // Exit 1 is an answer; anything else is git failing, and swallowing it would
  // report "not ignored" about a question that was never asked.
  it('lets a real failure through', async () => {
    await expect(isIgnored(gitIn('/nowhere-at-all'), '.env')).rejects.toThrow(GitError)
  })
})

describe('ignoredAmong', () => {
  it('answers for every path in one call, ignored and not', async () => {
    await initRepo(dir)
    await writeFile(join(dir, '.gitignore'), '.env\n*.key\n', 'utf8')

    await expect(ignoredAmong(exec, ['.env', 'notes.txt', 'config/master.key'])).resolves.toEqual(
      new Set(['.env', 'config/master.key'])
    )
  })

  // Exit 1, which is git's way of saying it.
  it('answers with nothing when none is ignored', async () => {
    await initRepo(dir)

    await expect(ignoredAmong(exec, ['.env'])).resolves.toEqual(new Set())
  })

  it('asks git nothing about no paths', async () => {
    await expect(ignoredAmong(gitIn('/nowhere-at-all'), [])).resolves.toEqual(new Set())
  })

  /*
   * Pathspec magic. Asked bare, `:(top).env` is read as `.env` at the top and
   * answers "ignored" — while the file that would be copied is the literal
   * `:(top).env`, which nothing ignores. `./` makes git read the name as it is.
   */
  it('reads a name with pathspec magic as the file it names', async () => {
    await initRepo(dir)
    await writeFile(join(dir, '.gitignore'), '.env\n', 'utf8')

    await expect(ignoredAmong(exec, [':(top).env', ':!x'])).resolves.toEqual(new Set())
  })

  // Printed quoted, so it cannot be matched back to what was asked; such a
  // path is answered as not ignored rather than guessed at.
  it('answers no for a name git would print quoted', async () => {
    await initRepo(dir)
    await writeFile(join(dir, '.gitignore'), '*.key\n', 'utf8')

    await expect(ignoredAmong(exec, ['a"b.key', 'ключ.key'])).resolves.toEqual(
      new Set(['ключ.key'])
    )
  })

  // A path beyond a tracked symlink makes git refuse the whole call.
  it('lets a real failure through', async () => {
    await initRepo(dir)
    await symlink(tmpdir(), join(dir, 'link'))
    await exec(['add', 'link'])
    await exec(['commit', '-q', '-m', 'link'])

    await expect(ignoredAmong(exec, ['link/a.key'])).rejects.toThrow(GitError)
  })
})

/*
 * A `git diff` against the working tree refreshes the index for a file whose
 * times moved and whose content did not, and writes it back under
 * `index.lock` — `--no-optional-locks` or not. A `git add` beside it then
 * fails. Reads given a copy refresh the copy instead.
 */
describe('withIndexCopy', () => {
  async function indexStamp(): Promise<string> {
    const info = await stat(join(dir, '.git', 'index'))
    return `${String(info.ino)}:${String(info.mtimeMs)}`
  }

  /** `gitIn`, noting the index file each executor was pointed at. */
  function noting(): { make: typeof gitIn; copies: (string | undefined)[] } {
    const copies: (string | undefined)[] = []
    const make = (cwd: string, options: GitOptions = {}): GitExec => {
      copies.push(options.env?.GIT_INDEX_FILE)
      return gitIn(cwd, options)
    }
    return { make, copies }
  }

  beforeEach(async () => {
    await initRepo(dir)
  })

  it('reads the index as it stands, staged changes included', async () => {
    await writeFile(join(dir, 'staged.txt'), 'staged\n', 'utf8')
    await run('git', ['add', 'staged.txt'], { cwd: dir })

    const staged = await withIndexCopy(dir, gitIn, (copy) =>
      copy(['diff', '--cached', '--name-only'])
    )

    expect(staged.trim()).toBe('staged.txt')
  })

  it('leaves the real index alone while git refreshes', async () => {
    const later = new Date(Date.now() + 60_000)
    await utimes(join(dir, 'README.md'), later, later)
    const before = await indexStamp()

    const changed = await withIndexCopy(dir, gitIn, (copy) => copy(['diff', '--name-only', 'HEAD']))

    expect(changed).toBe('')
    expect(await indexStamp()).toBe(before)
  })

  it('leaves no copy behind', async () => {
    const { make, copies } = noting()

    await withIndexCopy(dir, make, (copy) => copy(['diff', '--name-only', 'HEAD']))

    const copy = copies.find((path) => path !== undefined)
    if (copy === undefined) throw new Error('the read was not given a copy')
    // The directory, not only the file: removing the copy alone would leave
    // a directory behind on every read.
    await expect(access(dirname(copy))).rejects.toThrow()
  })

  // The read's own failure is the one reported, and the copy still goes.
  it('leaves no copy behind when the read fails', async () => {
    const { make, copies } = noting()
    const failure = new Error('the read gave up')

    await expect(withIndexCopy(dir, make, () => Promise.reject(failure))).rejects.toBe(failure)

    const copy = copies.find((path) => path !== undefined)
    if (copy === undefined) throw new Error('the read was not given a copy')
    await expect(access(dirname(copy))).rejects.toThrow()
  })

  // Read against a copy that is not there, git would call every tracked file
  // deleted — a wrong answer that looks like a right one.
  it('fails rather than read a worktree with no index', async () => {
    await rm(join(dir, '.git', 'index'))

    await expect(withIndexCopy(dir, gitIn, (copy) => copy(['ls-files']))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  /*
   * git trusts an entry by its stat only when it is older than the index file.
   * A copy stamped with the time it was made trusted an edit of the same size
   * made in the same second as the last index write, and the edit never
   * showed — in the pane or in the pull request's draft.
   */
  it('sees an edit made in the same second as the last index write', async () => {
    await run('git', ['config', 'core.trustctime', 'false'], { cwd: dir })
    const file = join(dir, 'README.md')
    const index = join(dir, '.git', 'index')
    const then = new Date('2020-01-01T00:00:00Z')
    await utimes(file, then, then)
    await run('git', ['update-index', '--refresh'], { cwd: dir })
    await writeFile(file, '# best\n', 'utf8')
    await utimes(file, then, then)
    await utimes(index, then, then)

    const changed = await withIndexCopy(dir, gitIn, (copy) => copy(['diff', '--name-only', 'HEAD']))

    expect(changed.trim()).toBe('README.md')
  })
})
