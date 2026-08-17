import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitIn } from './git.js'
import { GitHubError } from './github.js'
import {
  createPullRequest,
  type GhExec,
  ghIn,
  NewPullRequestSchema,
  readPullRequest
} from './pullRequests.js'

const run = promisify(execFile)

/**
 * A `gh` that answers from a table and records what it was asked.
 *
 * The real one talks to GitHub, which a test may not do — and the arguments are
 * most of what is worth asserting here, since a value in the wrong position is
 * how a title becomes a flag.
 */
function fakeGh(answers: Partial<Record<string, string | Error>> = {}): {
  gh: GhExec
  calls: string[][]
} {
  const calls: string[][] = []

  const gh: GhExec = (args) => {
    calls.push([...args])
    const answer = answers[args[1] ?? ''] ?? '[]'
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }

  return { gh, calls }
}

const OPEN_PR = JSON.stringify([
  { number: 7, state: 'OPEN', title: 'Rename the thing', url: 'https://github.com/o/p/pull/7' }
])

let dir: string

/**
 * A repository with a commit on a branch, and a bare one to push to.
 *
 * Real git rather than a fake: `rev-list --count` and `ls-remote` are the two
 * readings the pane acts on, and their output is the thing worth being sure of.
 */
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-pr-'))

  const origin = join(dir, 'origin.git')
  const work = join(dir, 'work')

  await run('git', ['init', '-q', '--bare', origin])
  await run('git', ['init', '-q', '--initial-branch=main', work])
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: work })
  await run('git', ['config', 'user.name', 'Test'], { cwd: work })
  await run('git', ['remote', 'add', 'origin', origin], { cwd: work })
  await writeFile(join(work, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: work })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: work })
  await run('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: work })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Puts a commit on a branch of its own and answers with the branch name. */
async function branchWithCommit(name = 'octopus/anna'): Promise<string> {
  const work = join(dir, 'work')
  await run('git', ['checkout', '-q', '-b', name], { cwd: work })
  await writeFile(join(work, 'a.txt'), 'one\n', 'utf8')
  await run('git', ['add', '.'], { cwd: work })
  await run('git', ['commit', '-q', '-m', 'work'], { cwd: work })
  return name
}

const workExec = (): ReturnType<typeof gitIn> => gitIn(join(dir, 'work'))

describe('reading a branch', () => {
  it('reports no pull request for a branch that has none', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh()

    const view = await readPullRequest(branch, 'main', gh, workExec())

    expect(view.request).toBeNull()
  })

  /*
   * `pr list` rather than `pr view`, which exits non-zero when there is no
   * pull request — indistinguishable from exiting non-zero because nobody is
   * signed in. This is the assertion that keeps the choice.
   */
  it('asks for the branch by name and takes an empty list as an answer', async () => {
    const branch = await branchWithCommit()
    const { gh, calls } = fakeGh()

    await readPullRequest(branch, 'main', gh, workExec())

    expect(calls[0]).toEqual([
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      '1',
      '--json',
      'number,state,title,url'
    ])
  })

  it('reports the pull request there is', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({ list: OPEN_PR })

    const view = await readPullRequest(branch, 'main', gh, workExec())

    expect(view.request).toEqual({
      number: 7,
      state: 'open',
      title: 'Rename the thing',
      url: 'https://github.com/o/p/pull/7'
    })
  })

  it('lowers the state `gh` shouts', async () => {
    const branch = await branchWithCommit()
    const merged = JSON.stringify([{ number: 7, state: 'MERGED', title: 't', url: 'u' }])

    const view = await readPullRequest(branch, 'main', fakeGh({ list: merged }).gh, workExec())

    expect(view.request?.state).toBe('merged')
  })

  it('counts what the branch has that the base does not', async () => {
    const branch = await branchWithCommit()

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(view.ahead).toBe(1)
  })

  // Nothing to open is the ordinary state of a branch nobody has worked in yet,
  // and the pane says so rather than offering a button that would fail.
  it('counts nothing on a branch that has not moved', async () => {
    const view = await readPullRequest('main', 'main', fakeGh().gh, workExec())

    expect(view.ahead).toBe(0)
  })

  // A base that is not there is not something the reader can act on here, and
  // `gh` gives the real message if they go ahead and try.
  it('counts nothing against a base that does not exist', async () => {
    const branch = await branchWithCommit()

    const view = await readPullRequest(branch, 'no-such-branch', fakeGh().gh, workExec())

    expect(view.ahead).toBe(0)
  })

  /*
   * `rev-list --count` answers a number, and this is the guard for the day it
   * does not. Driven with a fake git rather than a real one, since real git has
   * no way to produce it — which is the point of the guard being here at all.
   */
  it('counts nothing when git answers something that is not a number', async () => {
    const view = await readPullRequest('b', 'main', fakeGh().gh, () => Promise.resolve('plenty'))

    expect(view.ahead).toBe(0)
  })

  it('knows whether the branch is on the remote', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')

    const before = await readPullRequest(branch, 'main', fakeGh().gh, workExec())
    await run('git', ['push', '-q', '-u', 'origin', branch], { cwd: work })
    const after = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(before.pushed).toBe(false)
    expect(after.pushed).toBe(true)
  })

  // No remote at all answers "no", not an error: the pane can still say what
  // the branch is and offer to try.
  it('takes an unreachable remote as not pushed', async () => {
    const branch = await branchWithCommit()
    await run('git', ['remote', 'remove', 'origin'], { cwd: join(dir, 'work') })

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(view.pushed).toBe(false)
  })

  it('reports work that a pull request would leave behind', async () => {
    const branch = await branchWithCommit()
    await writeFile(join(dir, 'work', 'b.txt'), 'two\n', 'utf8')

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(view.dirty).toBe(true)
  })

  it('says GitHub could not be asked rather than inventing an answer', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({ list: new Error('gh: not logged in') })

    await expect(readPullRequest(branch, 'main', gh, workExec())).rejects.toMatchObject({
      code: 'notConnected'
    })
  })

  it('refuses an answer that is not JSON', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({ list: 'not json' })

    await expect(readPullRequest(branch, 'main', gh, workExec())).rejects.toMatchObject({
      code: 'listFailed'
    })
  })

  it('refuses an answer shaped like something else', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({ list: JSON.stringify([{ number: 'seven' }]) })

    await expect(readPullRequest(branch, 'main', gh, workExec())).rejects.toMatchObject({
      code: 'listFailed'
    })
  })
})

describe('opening one', () => {
  const draft = { title: 'Rename the thing', body: 'Because it was wrong.', draft: false }

  it('pushes the branch and opens the request', async () => {
    const branch = await branchWithCommit()
    const { gh, calls } = fakeGh({ create: 'https://github.com/o/p/pull/7\n' })

    const url = await createPullRequest({ ...draft, branch, base: 'main' }, gh, workExec())

    expect(url).toBe('https://github.com/o/p/pull/7')
    expect(calls[0]).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      'Rename the thing',
      '--body',
      'Because it was wrong.'
    ])
    // Pushed for real: `gh` reads the upstream to know what to open from.
    const remote = await run('git', ['ls-remote', '--heads', 'origin', branch], {
      cwd: join(dir, 'work')
    })
    expect(remote.stdout).toContain(branch)
  })

  it('opens a draft when asked for one', async () => {
    const branch = await branchWithCommit()
    const { gh, calls } = fakeGh({ create: 'url' })

    await createPullRequest({ ...draft, draft: true, branch, base: 'main' }, gh, workExec())

    expect(calls[0]).toContain('--draft')
  })

  /*
   * The title and the body are typed by a person, and a person may well begin a
   * title with a dash. Every value goes as its own argument, so `gh` reads it
   * as a title rather than as a flag it does not have.
   */
  it('sends a title that looks like a flag as a title', async () => {
    const branch = await branchWithCommit()
    const { gh, calls } = fakeGh({ create: 'url' })

    await createPullRequest(
      { ...draft, title: '--force a rename', branch, base: 'main' },
      gh,
      workExec()
    )

    expect(calls[0]?.[calls[0].indexOf('--title') + 1]).toBe('--force a rename')
  })

  it('refuses a branch with nothing the base does not have', async () => {
    const { gh, calls } = fakeGh()

    await expect(
      createPullRequest({ ...draft, branch: 'main', base: 'main' }, gh, workExec())
    ).rejects.toMatchObject({ code: 'noCommits', params: { base: 'main' } })

    // Nothing was pushed and nothing was asked of GitHub.
    expect(calls).toEqual([])
  })

  it('says which branch could not be pushed', async () => {
    const branch = await branchWithCommit()
    await run('git', ['remote', 'set-url', 'origin', join(dir, 'nowhere.git')], {
      cwd: join(dir, 'work')
    })

    await expect(
      createPullRequest({ ...draft, branch, base: 'main' }, fakeGh().gh, workExec())
    ).rejects.toMatchObject({ code: 'pushFailed', params: { branch } })
  })

  it('says GitHub refused it rather than swallowing that', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({ create: new Error('gh: a pull request already exists') })

    await expect(
      createPullRequest({ ...draft, branch, base: 'main' }, gh, workExec())
    ).rejects.toBeInstanceOf(GitHubError)
  })
})

describe('what the renderer may ask for', () => {
  it('refuses a request with no title', () => {
    expect(NewPullRequestSchema.safeParse({ title: '', body: '', draft: false }).success).toBe(
      false
    )
  })

  it('refuses a description longer than a description', () => {
    const parsed = NewPullRequestSchema.safeParse({
      title: 'ok',
      body: 'x'.repeat(20_001),
      draft: false
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts an empty description, which is an ordinary thing to leave out', () => {
    expect(NewPullRequestSchema.safeParse({ title: 'ok', body: '', draft: false }).success).toBe(
      true
    )
  })
})

describe('gh in a directory', () => {
  /*
   * The default executor, which every other test here replaces.
   *
   * `--version` rather than anything real: it needs `gh` installed and nothing
   * else — no account, no network, no repository — which is as close to free as
   * covering the one line that spawns a process gets.
   */
  it('runs where it was pointed', async () => {
    const gh = ghIn(join(dir, 'work'))

    await expect(gh(['--version'])).resolves.toContain('gh version')
  })

  it('fails rather than answering when the command does not', async () => {
    const gh = ghIn(join(dir, 'work'))

    await expect(gh(['not-a-command'])).rejects.toBeDefined()
  })
})

describe('the state map', () => {
  it('has an answer for every state gh reports', async () => {
    const branch = await branchWithCommit()

    for (const [shouted, quiet] of [
      ['OPEN', 'open'],
      ['MERGED', 'merged'],
      ['CLOSED', 'closed']
    ] as const) {
      const answer = JSON.stringify([{ number: 1, state: shouted, title: 't', url: 'u' }])
      const view = await readPullRequest(branch, 'main', fakeGh({ list: answer }).gh, workExec())

      expect(view.request?.state).toBe(quiet)
    }
  })
})
