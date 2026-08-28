import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gitIn } from './git.js'
import { GitHubError } from './github.js'
import {
  BRANCH_REQUEST_LIMIT,
  commitAndPush,
  createPullRequest,
  type GhExec,
  ghIn,
  mergePullRequest,
  NewPullRequestSchema,
  readBranchRequests,
  readPullRequest,
  readPullRequestDetail
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
  const draft = {
    title: 'Rename the thing',
    body: 'Because it was wrong.',
    draft: false,
    commitMessage: null
  }

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

  /*
   * The reported failure said only "GitHub refused it", which is the one thing
   * the user already knew. `gh` writes the reason to stderr — a request already
   * open, a base that is not there, no permission — and it used to be thrown
   * away with the error carrying it.
   */
  it('carries what gh said about refusing to open one', async () => {
    const branch = await branchWithCommit()
    const gh = (): Promise<string> =>
      Promise.reject(
        Object.assign(new Error('Command failed'), {
          stderr:
            'a pull request for branch "x" into branch "main" already exists\nUsage: gh pr create'
        })
      )

    const error = await createPullRequest({ ...draft, branch, base: 'main' }, gh, workExec()).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).code).toBe('createFailed')
    // The first line only: gh leads with the reason and follows with usage.
    expect((error as GitHubError).params.reason).toBe(
      'a pull request for branch "x" into branch "main" already exists'
    )
  })

  it('falls back to the error itself when there is no stderr to read', async () => {
    const branch = await branchWithCommit()
    const gh = (): Promise<string> => Promise.reject(new Error('gh: command not found'))

    const error = await createPullRequest({ ...draft, branch, base: 'main' }, gh, workExec()).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).params.reason).toContain('gh: command not found')
  })

  // Long enough to fill the pane and push everything else off it.
  it('cuts a reason that runs on', async () => {
    const branch = await branchWithCommit()
    const gh = (): Promise<string> =>
      Promise.reject(Object.assign(new Error('failed'), { stderr: 'x'.repeat(500) }))

    const error = await createPullRequest({ ...draft, branch, base: 'main' }, gh, workExec()).catch(
      (cause: unknown) => cause
    )

    expect((error as GitHubError).params.reason).toHaveLength(200)
  })

  /*
   * Reported, and only findable once failures started carrying gh's own words:
   *
   *   Base ref must be a branch ... No commits between origin/develop and
   *   octopus/alison
   *
   * The base is stored as git refers to it. `origin/develop` is a local name
   * for a remote-tracking ref, and GitHub has no branch by that name.
   */
  it('names the base branch the way GitHub does, not the way git does', async () => {
    const branch = await branchWithCommit()
    const { gh, calls } = fakeGh({ create: 'url' })

    await createPullRequest({ ...draft, branch, base: 'origin/main' }, gh, workExec())

    expect(calls[0]).toContain('--base')
    expect(calls[0]?.[calls[0].indexOf('--base') + 1]).toBe('main')
  })

  // Only `origin/` is a remote name. A branch really called `feature/x` keeps
  // both halves, or the request would be opened against something else.
  it('leaves a base that only looks prefixed alone', async () => {
    // A real branch whose name merely has a slash in it, so the request is
    // measured against something that exists.
    await run('git', ['branch', 'feature/x', 'main'], { cwd: join(dir, 'work') })
    const branch = await branchWithCommit()
    const { gh, calls } = fakeGh({ create: 'url' })

    await createPullRequest({ ...draft, branch, base: 'feature/x' }, gh, workExec())

    expect(calls[0]?.[calls[0].indexOf('--base') + 1]).toBe('feature/x')
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
    const parsed = NewPullRequestSchema.safeParse({
      title: 'ok',
      body: '',
      draft: false,
      commitMessage: null
    })

    expect(parsed.success).toBe(true)
  })

  /*
   * Null is how the form says "open it from what is already committed". An
   * empty string is not the same thing said differently — it is a message
   * somebody meant to type and did not, and git refuses it.
   */
  it('refuses an empty commit message while accepting no commit message at all', () => {
    const ask = (commitMessage: string | null): boolean =>
      NewPullRequestSchema.safeParse({ title: 'ok', body: '', draft: false, commitMessage }).success

    expect(ask(null)).toBe(true)
    expect(ask('')).toBe(false)
    expect(ask('Rename the thing')).toBe(true)
  })
})

describe('committing on the way to opening one', () => {
  const draft = { title: 'Rename the thing', body: '', draft: false }

  /** Leaves a file nobody has added, which is work a request would not carry. */
  async function leaveUncommittedWork(): Promise<void> {
    await writeFile(join(dir, 'work', 'b.txt'), 'two\n', 'utf8')
  }

  /*
   * The whole reason the field exists. A workspace whose only work is
   * uncommitted is zero commits ahead of its base, so checking that first would
   * refuse exactly the request this is meant to open.
   */
  it('opens a request for work that was uncommitted a moment ago', async () => {
    const work = join(dir, 'work')
    await run('git', ['checkout', '-q', '-b', 'octopus/anna'], { cwd: work })
    await leaveUncommittedWork()
    const { gh } = fakeGh({ create: 'https://github.com/o/p/pull/7\n' })

    const url = await createPullRequest(
      { ...draft, commitMessage: 'Add b', branch: 'octopus/anna', base: 'main' },
      gh,
      workExec()
    )

    expect(url).toBe('https://github.com/o/p/pull/7')
    const log = await run('git', ['log', '-1', '--format=%s'], { cwd: work })
    expect(log.stdout.trim()).toBe('Add b')
  })

  it('says there is nothing to commit rather than letting git say it', async () => {
    const branch = await branchWithCommit()

    await expect(
      createPullRequest(
        { ...draft, commitMessage: 'Nothing', branch, base: 'main' },
        fakeGh().gh,
        workExec()
      )
    ).rejects.toMatchObject({ code: 'nothingToCommit' })
  })

  it('says the commit itself failed when git refuses it', async () => {
    const work = join(dir, 'work')
    await run('git', ['checkout', '-q', '-b', 'octopus/anna'], { cwd: work })
    await leaveUncommittedWork()
    // The lock a crashed git leaves behind, which is the ordinary way a commit
    // is refused on a real machine — and unlike a missing identity, it cannot
    // be satisfied from a global config the test does not control.
    await writeFile(join(work, '.git', 'index.lock'), '', 'utf8')

    await expect(
      createPullRequest(
        { ...draft, commitMessage: 'Add b', branch: 'octopus/anna', base: 'main' },
        fakeGh().gh,
        workExec()
      )
    ).rejects.toMatchObject({ code: 'commitFailed' })
  })
})

describe('committing an answer onto a request that exists', () => {
  /*
   * What closes the loop: the agent answers a review, and without this the only
   * way to get that answer onto the request is the terminal.
   */
  it('commits everything here and pushes the branch', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await writeFile(join(work, 'b.txt'), 'two\n', 'utf8')

    await commitAndPush('Answer the review', branch, workExec())

    const log = await run('git', ['log', '-1', '--format=%s'], { cwd: work })
    expect(log.stdout.trim()).toBe('Answer the review')
    const remote = await run('git', ['ls-remote', '--heads', 'origin', branch], { cwd: work })
    expect(remote.stdout).toContain(branch)
  })

  it('says there is nothing to commit rather than letting git say it', async () => {
    const branch = await branchWithCommit()

    await expect(commitAndPush('Nothing', branch, workExec())).rejects.toMatchObject({
      code: 'nothingToCommit'
    })
  })

  it('names the branch that could not be pushed', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await writeFile(join(work, 'b.txt'), 'two\n', 'utf8')
    await run('git', ['remote', 'set-url', 'origin', join(dir, 'nowhere.git')], { cwd: work })

    await expect(commitAndPush('Answer the review', branch, workExec())).rejects.toMatchObject({
      code: 'pushFailed',
      params: { branch }
    })
  })
})

describe('merging one', () => {
  it('merges by the method it was given', async () => {
    const { gh, calls } = fakeGh({ merge: '' })

    await mergePullRequest(7, 'squash', gh)

    expect(calls[0]).toEqual(['pr', 'merge', '7', '--squash'])
  })

  it('has a flag for each of the three ways', async () => {
    const { gh, calls } = fakeGh({ merge: '' })

    await mergePullRequest(7, 'merge', gh)
    await mergePullRequest(7, 'rebase', gh)

    expect(calls.map((call) => call[3])).toEqual(['--merge', '--rebase'])
  })

  /*
   * Never `--delete-branch`, though `gh` offers it: a worktree is checked out
   * on that branch and git refuses, so the merge would report a failure the app
   * caused itself.
   */
  it('leaves the branch alone', async () => {
    const { gh, calls } = fakeGh({ merge: '' })

    await mergePullRequest(7, 'merge', gh)

    expect(calls[0]).not.toContain('--delete-branch')
  })

  it('says GitHub would not merge rather than swallowing it', async () => {
    const { gh } = fakeGh({ merge: new Error('not mergeable') })

    await expect(mergePullRequest(7, 'merge', gh)).rejects.toMatchObject({
      code: 'mergeFailed',
      params: { number: '7' }
    })
  })
})

describe('reading one request in full', () => {
  /** What `gh pr view --json …` answers for a request nobody has touched. */
  const VIEW = JSON.stringify({
    id: 'PR_kwDODKw3uc8AAAABATwpjg',
    state: 'OPEN',
    title: 'Rename the thing',
    url: 'https://github.com/o/p/pull/7',
    isDraft: false,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: '',
    statusCheckRollup: [],
    comments: [],
    reviews: []
  })

  const THREADS = JSON.stringify({ data: { node: { reviewThreads: { nodes: [] } } } })

  it('asks for the fields the pane draws, and for the threads by node id', async () => {
    const { gh, calls } = fakeGh({ view: VIEW, graphql: THREADS })

    const detail = await readPullRequestDetail(7, gh)

    expect(detail).toMatchObject({
      state: 'open',
      title: 'Rename the thing',
      mergeable: 'mergeable'
    })

    expect(calls[0]?.slice(0, 3)).toEqual(['pr', 'view', '7'])
    expect(calls[0]?.[4]).toContain('statusCheckRollup')
    // The id from the first answer, so nothing has to work out the owner and
    // the repository to ask GraphQL a question.
    expect(calls[1]).toContain('-F')
    expect(calls[1]).toContain('id=PR_kwDODKw3uc8AAAABATwpjg')
  })

  /*
   * Not `gh pr checks`, which would otherwise be the obvious source: it exits
   * `8` while a check is pending, and `ghIn` rejects on a non-zero exit — so
   * the state the pane most needs to draw would arrive as a thrown error.
   */
  it('reads the checks from a command that exits zero', async () => {
    const { gh, calls } = fakeGh({ view: VIEW, graphql: THREADS })

    await readPullRequestDetail(7, gh)

    expect(calls.map((call) => call[1])).not.toContain('checks')
  })

  it('says GitHub could not be asked when it refuses', async () => {
    const { gh } = fakeGh({ view: new Error('gh: not logged in') })

    await expect(readPullRequestDetail(7, gh)).rejects.toMatchObject({ code: 'notConnected' })
  })

  it('tells an unreadable answer from an unexpected one', async () => {
    const unreadable = fakeGh({ view: 'not json at all' })
    await expect(readPullRequestDetail(7, unreadable.gh)).rejects.toMatchObject({
      code: 'listFailed'
    })

    const unexpected = fakeGh({ view: JSON.stringify({ state: 'OPEN' }) })
    await expect(readPullRequestDetail(7, unexpected.gh)).rejects.toBeDefined()
  })

  it('reports a threads reply it cannot read', async () => {
    const { gh } = fakeGh({ view: VIEW, graphql: 'html, not json' })

    await expect(readPullRequestDetail(7, gh)).rejects.toMatchObject({ code: 'listFailed' })
  })
})

describe('every branch of a project at once', () => {
  const LIST = JSON.stringify([
    {
      headRefName: 'octopus/anna',
      number: 7,
      state: 'OPEN',
      url: 'https://github.com/o/p/pull/7',
      statusCheckRollup: []
    }
  ])

  /*
   * One call for the whole repository rather than one per workspace: the mark
   * is wanted on every row of the list at once, and a read per row would be a
   * network call per row every time the list refreshed.
   */
  it('asks once for every branch, not once per branch', async () => {
    const { gh, calls } = fakeGh({ list: LIST })

    const requests = await readBranchRequests(gh)

    expect(requests).toEqual([
      {
        branch: 'octopus/anna',
        number: 7,
        state: 'open',
        checks: 'none',
        url: 'https://github.com/o/p/pull/7'
      }
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('--head')
    expect(calls[0]?.[calls[0].indexOf('--limit') + 1]).toBe(String(BRANCH_REQUEST_LIMIT))
  })

  it('takes a smaller limit when one is given', async () => {
    const { gh, calls } = fakeGh({ list: LIST })

    await readBranchRequests(gh, 5)

    expect(calls[0]?.[calls[0].indexOf('--limit') + 1]).toBe('5')
  })

  it('says GitHub could not be asked when it refuses', async () => {
    const { gh } = fakeGh({ list: new Error('gh: no remote') })

    await expect(readBranchRequests(gh)).rejects.toMatchObject({ code: 'notConnected' })
  })

  it('reports an answer it cannot read', async () => {
    const { gh } = fakeGh({ list: 'not json' })

    await expect(readBranchRequests(gh)).rejects.toMatchObject({ code: 'listFailed' })
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
