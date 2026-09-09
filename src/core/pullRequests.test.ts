import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type GitExec, gitIn } from './git.js'
import { GitHubError } from './github.js'
import {
  BRANCH_REQUEST_LIMIT,
  commitAndPush,
  pushBranch,
  createPullRequest,
  type GhExec,
  ghIn,
  closePullRequest,
  mergePullRequest,
  NewPullRequestSchema,
  readBranchRequests,
  readPullRequest,
  readPullRequestDetail,
  replyToReviewThread,
  ReplyBodySchema,
  setReviewThreadResolved,
  ThreadIdSchema
} from './pullRequests.js'

const run = promisify(execFile)

/*
 * Given to each commit rather than written into the repository by two `git
 * config` runs. `HOME` is redirected to a shared temporary directory
 * (`vitest.shared.ts`), so there is no global identity to fall back on: get this
 * wrong and the file fails outright rather than quietly.
 */
const IDENTITY = ['-c', 'user.email=test@example.com', '-c', 'user.name=Test']

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

  // The two inits have nothing to say to each other, and this fixture runs 54
  // times: every process spawned here is paid for once per test.
  await Promise.all([
    run('git', ['init', '-q', '--bare', origin]),
    run('git', ['init', '-q', '--initial-branch=main', work])
  ])
  await run('git', ['remote', 'add', 'origin', origin], { cwd: work })
  await writeFile(join(work, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: work })
  await run('git', [...IDENTITY, 'commit', '-q', '-m', 'first'], { cwd: work })
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
  await run('git', [...IDENTITY, 'commit', '-q', '-m', 'work'], { cwd: work })
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

  /*
   * A different question from `ahead`, and the pane draws a different button
   * off it: a branch fully pushed is still ahead of `main`, and one pushed once
   * and committed to since is ahead of both by different amounts.
   */
  it('counts what the remote has not got, once it has a copy at all', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['push', '-q', '-u', 'origin', branch], { cwd: work })

    const sent = await readPullRequest(branch, 'main', fakeGh().gh, workExec())
    expect(sent.ahead).toBe(1)
    expect(sent.unpushedCommits).toBe(0)

    await writeFile(join(work, 'b.txt'), 'two\n', 'utf8')
    await run('git', ['add', '.'], { cwd: work })
    await run('git', [...IDENTITY, 'commit', '-q', '-m', 'more'], { cwd: work })

    const behind = await readPullRequest(branch, 'main', fakeGh().gh, workExec())
    expect(behind.unpushedCommits).toBe(1)
  })

  // Nothing on the other end for anything to have been sent to, so everything
  // this branch has is unpushed — which is what `ahead` already counts.
  it('falls back to the count against the base where the remote has no copy', async () => {
    const branch = await branchWithCommit()

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(view.unpushedCommits).toBe(1)
  })

  /* Two answers meet on this object and only one of them is live. GitHub
     deletes the head branch on merge, octopus fetches without `--prune`, so the
     tracking ref outlives the branch — and the pane went on saying everything
     was on GitHub about a branch that was not there. */
  it('counts everything unpushed once the remote no longer has the branch', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['push', '-q', '-u', 'origin', branch], { cwd: work })

    // What the server does on merge, leaving this clone's ref behind.
    await run('git', ['--git-dir', join(dir, 'origin.git'), 'branch', '-D', branch])

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    // Both together: either alone still passes with the two left disagreeing.
    expect(view.pushed).toBe(false)
    expect(view.unpushedCommits).toBe(1)
  })

  /* This clone's refs used to answer the count, and they go stale exactly when
     the live read is right: with no tracking ref and no upstream the pane said
     one commit was waiting for a branch that was fully pushed, and pressing
     Push reported "Everything up-to-date" for ever. `ls-remote` had the commit
     all along and was answering yes or no with it. */
  it('counts against the commit the remote named, not this clone\u2019s refs', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['push', '-q', '-u', 'origin', branch], { cwd: work })

    // What a clone that never fetched this branch looks like.
    await run('git', ['branch', '--unset-upstream', branch], { cwd: work })
    await run('git', ['update-ref', '-d', `refs/remotes/origin/${branch}`], { cwd: work })

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(view.pushed).toBe(true)
    expect(view.unpushedCommits).toBe(0)
  })

  /* And where this clone has not got what the remote named — a branch pushed
     from a second checkout — the count cannot be worked out at all. Zero would
     be a confident "nothing left to push" about a branch that is ahead of us,
     which is the shape the cached refs used to produce. */
  it('says it cannot count against a commit this clone does not have', async () => {
    const branch = await branchWithCommit()
    const absent = '0'.repeat(40)
    const git: GitExec = (args) =>
      args[0] === 'ls-remote'
        ? Promise.resolve(`${absent}\trefs/heads/${branch}\n`)
        : workExec()(args)

    const view = await readPullRequest(branch, 'main', fakeGh().gh, git)

    expect(view.pushed).toBe(true)
    expect(view.unpushedCommits).toBeNull()
  })

  // The count is `<tip>..HEAD`, so with HEAD somewhere else the two ends are
  // different pieces of work — the same "cannot say" the Changes tab draws.
  it('says it cannot count while HEAD is on another branch', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['push', '-q', '-u', 'origin', branch], { cwd: work })
    await run('git', ['checkout', '-q', '-b', 'side'], { cwd: work })

    const view = await readPullRequest(branch, 'main', fakeGh().gh, workExec())

    expect(view.unpushedCommits).toBeNull()
  })

  /* `rev-list --count` answers a number, and this is the guard for the day it
     does not. A fake, because real git has no way to produce it — which is the
     point of the guard being here at all. */
  it('says it cannot count when git answers something that is not a number', async () => {
    const branch = 'octopus/anna'
    const git: GitExec = (args) => {
      if (args[0] === 'ls-remote') return Promise.resolve(`abc123\trefs/heads/${branch}\n`)
      if (args[0] === 'branch') return Promise.resolve(`${branch}\n`)
      return Promise.resolve('plenty')
    }

    const view = await readPullRequest(branch, 'main', fakeGh().gh, git)

    expect(view.unpushedCommits).toBeNull()
  })

  /* `--heads origin <name>` matches the **tail** of a ref path, and every
     workspace branch is `<prefix>/<name>` — so a branch the remote does not
     have read as pushed whenever another prefix ended in the same segment. */
  it('does not take a branch under another prefix for this one', async () => {
    const work = join(dir, 'work')
    await branchWithCommit('octopus/anna')
    await run('git', ['push', '-q', 'origin', 'octopus/anna'], { cwd: work })
    await run('git', ['checkout', '-q', '-b', 'anna'], { cwd: work })

    const view = await readPullRequest('anna', 'main', fakeGh().gh, workExec())

    expect(view.pushed).toBe(false)
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

  /*
   * The `ENOTEMPTY` that failed one full run in five for a month, as one test.
   *
   * Three `git` reads run beside the `gh` one, and the `gh` one is what refuses
   * an answer of the wrong shape. Under `Promise.all` the refusal arrived while
   * the three were still running: the assertion passed, the test ended, and the
   * `rm` in `afterEach` raced a `git` still making files inside `.git`. The
   * failure then landed in whichever test the runner tore down next, which is
   * why it was never the one that caused it.
   */
  it('waits for the reads it started when another one fails first', async () => {
    const started: string[] = []
    const finished: string[] = []

    const slowGit: GitExec = async (args) => {
      const name = args.join(' ')
      started.push(name)
      await new Promise((resolve) => setTimeout(resolve, 20))
      finished.push(name)

      return ''
    }

    const { gh } = fakeGh({ list: 'not json' })

    await expect(readPullRequest('b', 'main', gh, slowGit)).rejects.toMatchObject({
      code: 'listFailed'
    })

    expect(started.length).toBeGreaterThan(0)
    expect(finished).toHaveLength(started.length)
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

  /* First of all, and before the count below: refused after it, the reader
     would be told this branch has nothing the base does not — true of the
     branch, and no help at all to somebody standing on another one. */
  it('refuses to open one from a worktree with another branch checked out', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['checkout', '-q', '-b', 'side'], { cwd: work })
    await writeFile(join(work, 'b.txt'), 'two\n', 'utf8')
    const { gh, calls } = fakeGh()

    await expect(
      createPullRequest({ ...draft, commitMessage: 'Add b', branch, base: 'main' }, gh, workExec())
    ).rejects.toMatchObject({ code: 'headNotOnBranch', params: { branch } })

    // Refused before anything happened: `gh` was never asked, and the commit
    // that would have landed on `side` did not.
    expect(calls).toEqual([])
    const log = await run('git', ['log', '-1', '--format=%s'], { cwd: work })
    expect(log.stdout.trim()).toBe('work')
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

  /* The half that hurts. `commitAll` lands on HEAD and `pushBranch` sends a
     name, so with the two apart the work is committed onto one branch and
     another is pushed — both reporting success, and the answer sitting where
     nobody will look for it. */
  it('refuses to commit while HEAD is on another branch, and commits nothing', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['checkout', '-q', '-b', 'side'], { cwd: work })
    await writeFile(join(work, 'b.txt'), 'two\n', 'utf8')

    await expect(commitAndPush('Answer the review', branch, workExec())).rejects.toMatchObject({
      code: 'headNotOnBranch',
      params: { branch }
    })

    // Still uncommitted, which is the assertion that matters: refusing after
    // the commit would leave it on `side` for ever.
    const status = await run('git', ['status', '--porcelain'], { cwd: work })
    expect(status.stdout).toContain('b.txt')
  })

  it('refuses the same way when HEAD is on no branch at all', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['checkout', '-q', '--detach'], { cwd: work })
    await writeFile(join(work, 'b.txt'), 'two\n', 'utf8')

    await expect(commitAndPush('Answer the review', branch, workExec())).rejects.toMatchObject({
      code: 'headNotOnBranch'
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

describe('pushing what is already committed', () => {
  /*
   * The half of the pair above that was missing. Work the agent committed, or
   * the reader committed in the workspace's terminal, had no way onto the
   * request short of the terminal — the button only appeared while there was
   * something uncommitted to commit.
   */
  it('sends the branch without committing anything', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    // Left uncommitted on purpose: pushing must not sweep it up.
    await writeFile(join(work, 'loose.txt'), 'not yet\n', 'utf8')

    await pushBranch(branch, workExec())

    const remote = await run('git', ['ls-remote', '--heads', 'origin', branch], { cwd: work })
    expect(remote.stdout).toContain(branch)
    const staged = await run('git', ['status', '--porcelain'], { cwd: work })
    expect(staged.stdout).toContain('loose.txt')
  })

  it('names the branch that could not be pushed', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['remote', 'set-url', 'origin', join(dir, 'nowhere.git')], { cwd: work })

    await expect(pushBranch(branch, workExec())).rejects.toMatchObject({
      code: 'pushFailed',
      params: { branch }
    })
  })

  /* Deliberately not guarded the way committing is, and pinned so a later
     session does not "fix" it: this commits nothing and pushes the branch it
     names, which is true whatever HEAD is standing on. */
  it('still sends the branch from a worktree standing somewhere else', async () => {
    const branch = await branchWithCommit()
    const work = join(dir, 'work')
    await run('git', ['checkout', '-q', '-b', 'side'], { cwd: work })

    await pushBranch(branch, workExec())

    const remote = await run('git', ['ls-remote', '--heads', 'origin', branch], { cwd: work })
    expect(remote.stdout).toContain(branch)
  })
})

describe('merging one', () => {
  it('merges by the method it was given', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/anna"}', merge: '' })

    await mergePullRequest(7, 'squash', 'octopus/anna', gh)

    expect(calls[1]).toEqual(['pr', 'merge', '7', '--squash'])
  })

  it('has a flag for each of the three ways', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/anna"}', merge: '' })

    await mergePullRequest(7, 'merge', 'octopus/anna', gh)
    await mergePullRequest(7, 'rebase', 'octopus/anna', gh)

    expect(calls.filter((call) => call[1] === 'merge').map((call) => call[3])).toEqual([
      '--merge',
      '--rebase'
    ])
  })

  /*
   * Never `--delete-branch`, though `gh` offers it: a worktree is checked out
   * on that branch and git refuses, so the merge would report a failure the app
   * caused itself.
   */
  it('leaves the branch alone', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/anna"}', merge: '' })

    await mergePullRequest(7, 'merge', 'octopus/anna', gh)

    expect(calls[1]).not.toContain('--delete-branch')
  })

  /*
   * The guard, and the whole of it is the negative: `gh pr merge 7` resolves 7
   * against the **repository**, not against the branch the working directory is
   * on, so a number left over from another workspace would merge whatever it
   * names. Merging does not come back.
   *
   * Asserting the throw alone would pass for a guard that refused after asking
   * `gh` to merge, which is no guard at all — so the calls are what this reads.
   */
  it('refuses a number that belongs to another branch, without asking gh to merge', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/bo"}', merge: '' })

    await expect(mergePullRequest(7, 'merge', 'octopus/anna', gh)).rejects.toMatchObject({
      code: 'requestNotOnBranch',
      params: { number: '7', head: 'octopus/bo', branch: 'octopus/anna' }
    })

    expect(calls.map((call) => call[1])).toEqual(['view'])
  })

  it('refuses to close one belonging to another branch too', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/bo"}', close: '' })

    await expect(closePullRequest(7, 'octopus/anna', gh)).rejects.toMatchObject({
      code: 'requestNotOnBranch'
    })

    expect(calls.map((call) => call[1])).toEqual(['view'])
  })

  // One field, not the fourteen `readPullRequestDetail` asks for — which would
  // also cost a GraphQL round trip for threads nobody is about to read.
  it('asks GitHub only which branch the request is on', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/anna"}', merge: '' })

    await mergePullRequest(7, 'merge', 'octopus/anna', gh)

    expect(calls[0]).toEqual(['pr', 'view', '7', '--json', 'headRefName'])
  })

  // An answer of the wrong shape is refused rather than compared against
  // `undefined`, which would make every merge look like the wrong branch.
  it('refuses an answer that does not say which branch it is', async () => {
    const { gh } = fakeGh({ view: '{"headRefName":""}', merge: '' })

    await expect(mergePullRequest(7, 'merge', 'octopus/anna', gh)).rejects.toMatchObject({
      code: 'listFailed'
    })
  })

  it('says GitHub would not merge rather than swallowing it', async () => {
    const { gh } = fakeGh({
      view: '{"headRefName":"octopus/anna"}',
      merge: new Error('not mergeable')
    })

    await expect(mergePullRequest(7, 'merge', 'octopus/anna', gh)).rejects.toMatchObject({
      code: 'mergeFailed',
      params: { number: '7' }
    })
  })
})

describe('closing one', () => {
  it('closes by number', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/anna"}', close: '' })

    await closePullRequest(7, 'octopus/anna', gh)

    expect(calls[1]).toEqual(['pr', 'close', '7'])
  })

  /*
   * Never `--delete-branch`, for the reason merging does not: a worktree is
   * checked out on it. What happens to a workspace's branch is decided when
   * the workspace is removed, by somebody who was shown what it costs.
   */
  it('leaves the branch alone', async () => {
    const { gh, calls } = fakeGh({ view: '{"headRefName":"octopus/anna"}', close: '' })

    await closePullRequest(7, 'octopus/anna', gh)

    expect(calls[1]).not.toContain('--delete-branch')
  })

  it('carries what gh said about refusing', async () => {
    const { gh } = fakeGh({
      view: '{"headRefName":"octopus/anna"}',
      close: Object.assign(new Error('failed'), { stderr: 'could not close: already merged' })
    })

    await expect(closePullRequest(7, 'octopus/anna', gh)).rejects.toMatchObject({
      code: 'closeFailed',
      params: { number: '7', reason: 'could not close: already merged' }
    })
  })
})

describe('answering one review thread', () => {
  const THREAD = 'PRRT_kwDODKw3uc5bqLtn'

  it('sends the reply to the thread it belongs to', async () => {
    const { gh, calls } = fakeGh({ graphql: '{}' })

    await replyToReviewThread(THREAD, 'Left as it is because the caller owns it.', gh)

    const [args = []] = calls
    expect(args.join(' ')).toContain('addPullRequestReviewThreadReply')
    expect(args).toContain(`id=${THREAD}`)
    expect(args).toContain('body=Left as it is because the caller owns it.')
  })

  /*
   * `-f` and not `-F` for both.
   *
   * `-F` reads a leading `@` as a file to send and a bare number as a number,
   * and a review answer is regularly one of those: `@olena` is how a reviewer
   * is addressed on GitHub, and `42` is an answer to "how many?".
   */
  it('sends the body as a plain string, so an @mention is not read as a file', async () => {
    const { gh, calls } = fakeGh({ graphql: '{}' })

    await replyToReviewThread(THREAD, '@olena 42', gh)

    const [args = []] = calls
    const at = args.indexOf('body=@olena 42')
    expect(args[at - 1]).toBe('-f')
  })

  it('refuses an empty reply without asking GitHub', async () => {
    const { gh, calls } = fakeGh({ graphql: '{}' })

    await expect(replyToReviewThread(THREAD, '   ', gh)).rejects.toMatchObject({
      code: 'replyFailed'
    })
    expect(calls).toEqual([])
  })

  it('carries what gh said about refusing a reply', async () => {
    const { gh } = fakeGh({
      graphql: Object.assign(new Error('failed'), { stderr: 'Could not resolve to a node' })
    })

    await expect(replyToReviewThread(THREAD, 'Fixed.', gh)).rejects.toMatchObject({
      code: 'replyFailed',
      params: { reason: 'Could not resolve to a node' }
    })
  })

  it('settles a thread', async () => {
    const { gh, calls } = fakeGh({ graphql: '{}' })

    await setReviewThreadResolved(THREAD, true, gh)

    const [args = []] = calls
    expect(args.join(' ')).toContain('resolveReviewThread(')
    expect(args).toContain(`id=${THREAD}`)
  })

  /*
   * Both directions, and the second is not decoration: resolving is one click
   * to undo on GitHub, and a pane that can do a thing but not undo it sends the
   * reader to the browser for the half it kept.
   */
  it('puts a settled thread back', async () => {
    const { gh, calls } = fakeGh({ graphql: '{}' })

    await setReviewThreadResolved(THREAD, false, gh)

    expect((calls[0] ?? []).join(' ')).toContain('unresolveReviewThread(')
  })

  it('carries what gh said about refusing to change a thread', async () => {
    const { gh } = fakeGh({
      graphql: Object.assign(new Error('failed'), { stderr: 'Resource not accessible' })
    })

    await expect(setReviewThreadResolved(THREAD, true, gh)).rejects.toMatchObject({
      code: 'resolveFailed',
      params: { reason: 'Resource not accessible' }
    })
  })

  /* Both become arguments to `gh`, and the renderer having read them from us is
     not a reason to believe them coming back (§11.3). */
  it('accepts a node id and refuses anything that is not one', () => {
    expect(ThreadIdSchema.safeParse(THREAD).success).toBe(true)
    expect(ThreadIdSchema.safeParse('PRRT_1;rm -rf /').success).toBe(false)
    expect(ThreadIdSchema.safeParse('').success).toBe(false)
    expect(ThreadIdSchema.safeParse('a'.repeat(201)).success).toBe(false)
  })

  it('bounds a reply the way GitHub bounds a comment', () => {
    expect(ReplyBodySchema.safeParse('').success).toBe(false)
    expect(ReplyBodySchema.safeParse('a'.repeat(65_536)).success).toBe(true)
    expect(ReplyBodySchema.safeParse('a'.repeat(65_537)).success).toBe(false)
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

  /*
   * Both halves named, and the second is the one that was only asserted to
   * throw *something*. A `gh` that exits zero with well-formed JSON of the
   * wrong shape used to raise a bare `ZodError`, which no class the bridge
   * translates recognises — so the serialised issue array reached the pane
   * whose whole job is explaining GitHub, in English, in one paragraph.
   */
  it('tells an unreadable answer from an unexpected one', async () => {
    const unreadable = fakeGh({ view: 'not json at all' })
    await expect(readPullRequestDetail(7, unreadable.gh)).rejects.toMatchObject({
      code: 'listFailed'
    })

    const unexpected = fakeGh({ view: JSON.stringify({ state: 'OPEN' }) })
    await expect(readPullRequestDetail(7, unexpected.gh)).rejects.toMatchObject({
      code: 'listFailed'
    })
  })

  it('reports a threads reply it cannot read, and one shaped like something else', async () => {
    const unreadable = fakeGh({ view: VIEW, graphql: 'html, not json' })
    await expect(readPullRequestDetail(7, unreadable.gh)).rejects.toMatchObject({
      code: 'listFailed'
    })

    const unexpected = fakeGh({ view: VIEW, graphql: JSON.stringify({ data: { node: 42 } }) })
    await expect(readPullRequestDetail(7, unexpected.gh)).rejects.toMatchObject({
      code: 'listFailed'
    })
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

    const answer = await readBranchRequests(gh)

    expect(answer.requests).toEqual([
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

  it('reports an answer it cannot read, and one shaped like something else', async () => {
    const unreadable = fakeGh({ list: 'not json' })
    await expect(readBranchRequests(unreadable.gh)).rejects.toMatchObject({ code: 'listFailed' })

    const unexpected = fakeGh({ list: JSON.stringify({ pullRequests: [] }) })
    await expect(readBranchRequests(unexpected.gh)).rejects.toMatchObject({ code: 'listFailed' })
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

describe('whether the branch list was all of them', () => {
  /*
   * `gh` is asked for the hundred most recent requests of the whole repository,
   * so a workspace whose request is older is simply not in the answer — and
   * absent reads exactly like "has none". The caller has to be able to tell the
   * two apart, or it says the wrong thing with complete confidence.
   */
  it('says so when the answer came back full', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({
      list: JSON.stringify([
        { headRefName: branch, number: 7, state: 'OPEN', url: 'https://e.test/7' },
        { headRefName: 'other', number: 8, state: 'OPEN', url: 'https://e.test/8' }
      ])
    })

    await expect(readBranchRequests(gh, 2)).resolves.toMatchObject({ capped: true })
  })

  it('says nothing of the sort when it came back short', async () => {
    const branch = await branchWithCommit()
    const { gh } = fakeGh({
      list: JSON.stringify([
        { headRefName: branch, number: 7, state: 'OPEN', url: 'https://e.test/7' }
      ])
    })

    const answer = await readBranchRequests(gh, 2)

    expect(answer.capped).toBe(false)
    expect(answer.requests).toHaveLength(1)
  })

  /*
   * Decided at the read rather than by measuring what survives: the filtering
   * below drops requests this list has no use for, and a count taken after it
   * would call a full answer short whenever it dropped one.
   */
  it('counts what GitHub answered, not what came through the filtering', async () => {
    const { gh } = fakeGh({
      list: JSON.stringify([
        { headRefName: 'a', number: 7, state: 'OPEN', url: 'https://e.test/7' },
        { headRefName: 'a', number: 8, state: 'CLOSED', url: 'https://e.test/8' }
      ])
    })

    const answer = await readBranchRequests(gh, 2)

    expect(answer.requests).toHaveLength(1)
    expect(answer.capped).toBe(true)
  })
})
