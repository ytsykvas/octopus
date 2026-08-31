/**
 * Driven against real repositories with real remotes.
 *
 * A remote here is a bare repository in a temporary directory, which is enough
 * to be a genuine remote — fetches move refs, pushes land, and a deleted one
 * fails the way an unreachable one does. **No test in this file touches the
 * network**, and none can: nothing configures a remote that is not a path on
 * this disk.
 *
 * The alternative — a fake executor answering `git remote` from a table — would
 * only prove that the table was believed. What is worth being sure of is which
 * ref `worktree add` would actually be handed, and git is the only thing that
 * can say.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GitError, type GitExec, gitIn } from './git.js'
import { fetchRemote, listRemotes, parseRemotes, resolveBase } from './remotes.js'

const run = promisify(execFile)

let dir: string
const temporary: string[] = []

/** A directory that is cleaned up whatever the test does with it. */
async function scratch(prefix: string): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), prefix))
  temporary.push(made)

  return made
}

/**
 * A bare repository carrying `main` and `develop`, wired up as a remote.
 *
 * Returns its path so a test can advance it behind the checkout's back, or
 * delete it to produce a remote that cannot be reached.
 */
async function addRemote(name = 'origin'): Promise<string> {
  const remote = await scratch(`octopus-remote-${name}-`)

  await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
  await run('git', ['remote', 'add', name, remote], { cwd: dir })
  await run('git', ['push', '-q', name, 'main'], { cwd: dir })
  await run('git', ['push', '-q', name, 'main:develop'], { cwd: dir })
  await run('git', ['fetch', '-q', name], { cwd: dir })

  return remote
}

/** Puts a commit on a remote branch from somewhere else entirely. */
async function commitOnRemote(remote: string, branch: string): Promise<string> {
  const clone = await scratch('octopus-elsewhere-')

  await run('git', ['clone', '-q', '--branch', branch, remote, clone])
  await run('git', ['config', 'user.email', 'other@example.com'], { cwd: clone })
  await run('git', ['config', 'user.name', 'Other'], { cwd: clone })
  await writeFile(join(clone, 'THEIRS.md'), '# theirs\n', 'utf8')
  await run('git', ['add', '.'], { cwd: clone })
  await run('git', ['commit', '-q', '-m', 'from elsewhere'], { cwd: clone })
  await run('git', ['push', '-q', 'origin', branch], { cwd: clone })

  return (await run('git', ['rev-parse', 'HEAD'], { cwd: clone })).stdout.trim()
}

beforeEach(async () => {
  dir = await scratch('octopus-remotes-')
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: dir })
})

afterEach(async () => {
  await Promise.all(temporary.map((path) => rm(path, { recursive: true, force: true })))
  temporary.length = 0
})

describe('parseRemotes', () => {
  it('reads one name per line', () => {
    expect(parseRemotes('origin\nupstream\n')).toEqual(['origin', 'upstream'])
  })

  it('answers nothing for a repository with no remote', () => {
    expect(parseRemotes('\n')).toEqual([])
  })

  // Deterministic order is what makes a repository with several remotes resolve
  // the same way twice, and `origin` is the one every other part of the app
  // already assumes.
  it('puts origin first however git listed it', () => {
    expect(parseRemotes('alpha\norigin\nzulu\n')).toEqual(['origin', 'alpha', 'zulu'])
  })
})

describe('listRemotes', () => {
  it('answers nothing when none is configured', async () => {
    expect(await listRemotes(gitIn(dir))).toEqual([])
  })

  it('reads the configured ones', async () => {
    await addRemote()
    expect(await listRemotes(gitIn(dir))).toEqual(['origin'])
  })
})

describe('resolveBase', () => {
  /*
   * The project added from a local folder that was never pushed. There is
   * nothing to fetch and nothing that could be stale, and the whole point is
   * that this is not an error of any kind.
   */
  it('has nothing to fetch when the repository has no remote', async () => {
    expect(await resolveBase(gitIn(dir), 'main')).toEqual({ remote: null, ref: 'main' })
  })

  // The shape the base-branch picker produces: it lists remote branches, so a
  // project set up through it holds `origin/develop` and no local `develop`.
  it('takes a remote-tracking base as it stands', async () => {
    await addRemote()

    expect(await resolveBase(gitIn(dir), 'origin/develop')).toEqual({
      remote: 'origin',
      ref: 'origin/develop'
    })
  })

  // The shape detection produces: it strips `origin/` off `origin/HEAD` and
  // stores the bare name, so the base is local and a fetch would not move it.
  it('follows a local base to the branch it tracks', async () => {
    await addRemote()
    await run('git', ['branch', '--set-upstream-to=origin/main', 'main'], { cwd: dir })

    expect(await resolveBase(gitIn(dir), 'main')).toEqual({
      remote: 'origin',
      ref: 'origin/main'
    })
  })

  it('falls back to the remote copy of the same name when nothing is tracked', async () => {
    await addRemote()
    await run('git', ['branch', 'develop'], { cwd: dir })

    expect(await resolveBase(gitIn(dir), 'develop')).toEqual({
      remote: 'origin',
      ref: 'origin/develop'
    })
  })

  it('leaves a purely local branch alone even with a remote configured', async () => {
    await addRemote()
    await run('git', ['branch', 'topic'], { cwd: dir })

    expect(await resolveBase(gitIn(dir), 'topic')).toEqual({ remote: null, ref: 'topic' })
  })

  /*
   * git lets a branch track another **local** branch, and `@{upstream}` then
   * answers a bare name. Read as a remote-tracking one it would name a remote
   * called `main`, and the fetch would fail on a remote that does not exist.
   */
  it('does not mistake a locally tracked branch for a remote one', async () => {
    await addRemote()
    await run('git', ['branch', '--track', 'topic', 'main'], { cwd: dir })

    expect(await resolveBase(gitIn(dir), 'topic')).toEqual({ remote: null, ref: 'topic' })
  })

  it('works with a remote that is not called origin', async () => {
    await addRemote('upstream')

    expect(await resolveBase(gitIn(dir), 'main')).toEqual({
      remote: 'upstream',
      ref: 'upstream/main'
    })
  })

  // A local branch named `feature/x` must not be read as a remote called
  // `feature` — the match is against the configured remotes, not the slash.
  it('does not read a slash in a branch name as a remote', async () => {
    await addRemote()
    await run('git', ['branch', 'feature/x'], { cwd: dir })

    expect(await resolveBase(gitIn(dir), 'feature/x')).toEqual({
      remote: null,
      ref: 'feature/x'
    })
  })
})

describe('fetchRemote', () => {
  it('brings the tracking ref up to date', async () => {
    const remote = await addRemote()
    const before = (await run('git', ['rev-parse', 'origin/develop'], { cwd: dir })).stdout.trim()

    const landed = await commitOnRemote(remote, 'develop')
    await fetchRemote(gitIn(dir), 'origin')

    const after = (await run('git', ['rev-parse', 'origin/develop'], { cwd: dir })).stdout.trim()
    expect(after).not.toBe(before)
    expect(after).toBe(landed)
  })

  // The unreachable remote, without a network: a bare repository that existed
  // when the refs were written and is gone by the time git goes looking.
  it('fails when the remote is not there', async () => {
    const remote = await addRemote()
    await rm(remote, { recursive: true, force: true })

    await expect(fetchRemote(gitIn(dir), 'origin')).rejects.toBeInstanceOf(GitError)
  })

  it('names only the remote, so the repository decides what a fetch means', async () => {
    const asked: string[][] = []
    const recording: GitExec = (args) => {
      asked.push([...args])
      return Promise.resolve('')
    }

    await fetchRemote(recording, 'origin')
    expect(asked).toEqual([['fetch', 'origin']])
  })
})
