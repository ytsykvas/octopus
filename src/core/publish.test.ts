/**
 * Driven against a real repository with a real remote, like `diff.test.ts`.
 *
 * The classification is a handful of set lookups and could be tested on
 * literals alone — and the pure half is. But the half that decides *which* git
 * commands to run, and how git pairs a rename across three different left-hand
 * sides, is exactly the kind of thing an assumption gets wrong: a bare
 * repository beside the worktree costs one line and settles it.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type GitExec, gitIn } from './git.js'
import {
  nothingToSend,
  type PublishStatus,
  publishStateOf,
  readPublishStatus,
  staleOnRemote
} from './publish.js'

const run = promisify(execFile)

let dir: string
let origin: string
let exec: GitExec

async function git(...args: string[]): Promise<void> {
  await run('git', args, { cwd: dir })
}

async function commit(message: string): Promise<void> {
  await git('add', '-A')
  await git('commit', '-q', '-m', message)
}

/** Where the branch began, which is the left-hand side the reader gets. */
async function baseCommit(): Promise<string> {
  return (await run('git', ['merge-base', 'main', 'HEAD'], { cwd: dir })).stdout.trim()
}

/** The status as `readWorkspaceDiff` asks for it, untracked files included. */
async function status(untracked: readonly string[] = []): Promise<PublishStatus> {
  return readPublishStatus(exec, { branch: 'work', baseCommit: await baseCommit(), untracked })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-publish-'))
  origin = await mkdtemp(join(tmpdir(), 'octopus-origin-'))

  await run('git', ['init', '-q', '--bare', origin])
  await git('init', '-q', '--initial-branch=main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  await git('remote', 'add', 'origin', origin)

  await writeFile(join(dir, 'a.txt'), 'one\n', 'utf8')
  await commit('first')
  await git('checkout', '-q', '-b', 'work')

  exec = gitIn(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(origin, { recursive: true, force: true })
})

describe('a branch with no copy on the remote', () => {
  it('has no remote commit, and counts everything since the base as unpushed', async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')

    const found = await status()

    expect(found.remoteCommit).toBeNull()
    expect(found.unpushedCommits).toBe(1)
  })

  it('calls a committed file committed without asking the remote about it', async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')

    expect(publishStateOf('a.txt', null, await status())).toBe('committed')
  })

  it('says nothing of it is stale, there being nothing to be stale against', async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')

    expect(staleOnRemote('a.txt', null, await status())).toBe(false)
  })

  // Nothing to send is a claim about a remote copy, and there is not one.
  it('never says the branch has nothing left to send', async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')

    expect(nothingToSend(await status())).toBe(false)
  })
})

describe('a branch that has been pushed', () => {
  beforeEach(async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')
    await git('push', '-q', '-u', 'origin', 'work')
  })

  it('finds its copy through the upstream the push set', async () => {
    const found = await status()

    expect(found.headOnBranch).toBe(true)
    expect(found.remoteCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(found.unpushedCommits).toBe(0)
  })

  it('calls a file the remote already has pushed', async () => {
    expect(publishStateOf('a.txt', null, await status())).toBe('pushed')
  })

  it('says a pushed file is not stale, whatever the remote knows of it', async () => {
    // The remote does have this path — it went out with the push — and the
    // guard is the state, not the listing. Without it every pushed file in a
    // branch would carry the warning.
    expect(staleOnRemote('a.txt', null, await status())).toBe(false)
  })

  it('says the branch has nothing left to send', async () => {
    expect(nothingToSend(await status())).toBe(true)
  })

  it('calls a file edited since the push uncommitted, and stale in the request', async () => {
    await writeFile(join(dir, 'a.txt'), 'three\n', 'utf8')

    const found = await status()

    expect(publishStateOf('a.txt', null, found)).toBe('uncommitted')
    expect(staleOnRemote('a.txt', null, found)).toBe(true)
    expect(nothingToSend(found)).toBe(false)
  })

  it('calls it committed once it is, and leaves the warning standing', async () => {
    await writeFile(join(dir, 'a.txt'), 'three\n', 'utf8')
    await commit('third')

    const found = await status()

    expect(publishStateOf('a.txt', null, found)).toBe('committed')
    expect(staleOnRemote('a.txt', null, found)).toBe(true)
  })

  it('calls a new committed file committed, with nothing stale about it', async () => {
    await writeFile(join(dir, 'b.txt'), 'new\n', 'utf8')
    await commit('third')

    const found = await status()

    expect(publishStateOf('b.txt', null, found)).toBe('committed')
    expect(staleOnRemote('b.txt', null, found)).toBe(false)
  })

  /* The case rename detection would otherwise get wrong: `--name-only` prints
     the destination, and the remote knows the file by the name it had. Without
     the `oldPath` half this reads as brand new work when it is the stalest
     thing in the branch. */
  it('keeps the warning on a file renamed after it was pushed', async () => {
    await rename(join(dir, 'a.txt'), join(dir, 'renamed.txt'))
    await commit('third')

    const found = await status()

    expect(publishStateOf('renamed.txt', 'a.txt', found)).toBe('committed')
    expect(staleOnRemote('renamed.txt', 'a.txt', found)).toBe(true)
  })

  it('calls an untracked file uncommitted, though no diff ever lists one', async () => {
    await writeFile(join(dir, 'fresh.txt'), 'new\n', 'utf8')

    const found = await status(['fresh.txt'])

    expect(publishStateOf('fresh.txt', null, found)).toBe('uncommitted')
    // And the untracked file alone is enough to say there is something to send.
    expect(nothingToSend(found)).toBe(false)
  })
})

/*
 * The three listings have three different left-hand sides, so git may pair a
 * rename in one and not in another. Where it does not, the file appears under
 * its **source** name — and asking only the destination let it fall through to
 * `pushed` while an uncommitted deletion of the source sat in the worktree.
 * With every file `pushed`, the pane then said everything was on GitHub.
 */
describe('a rename the listings pair differently', () => {
  it('follows the source name rather than reading as already pushed', async () => {
    const body = Array.from({ length: 200 }, (_, line) => `line ${String(line)}\n`).join('')
    await writeFile(join(dir, 'big.txt'), body, 'utf8')
    await commit('a file worth pairing')
    await git('checkout', '-q', 'main')
    await git('merge', '-q', 'work')
    await git('checkout', '-q', 'work')

    // A near-copy committed and pushed, then the original deleted here.
    await writeFile(join(dir, 'copy.txt'), `${body}one more\n`, 'utf8')
    await commit('copy it')
    await git('push', '-q', '-u', 'origin', 'work')
    await rm(join(dir, 'big.txt'))

    const found = await status()

    // git pairs the deletion with the addition from the merge base, so the
    // pane draws one row: path copy.txt, oldPath big.txt.
    expect(publishStateOf('copy.txt', 'big.txt', found)).toBe('uncommitted')
    expect(nothingToSend(found)).toBe(false)
  })
})

/*
 * What the request shows is the three-dot range GitHub builds it from. Measured
 * two-dot, everything the base gained since the push differs from the older
 * pushed copy purely because that copy is older — so a reviewer was warned that
 * the request showed an older version of a file the request does not contain.
 */
describe('a base that has moved on under the branch', () => {
  it('does not call a file stale because the base changed it after the push', async () => {
    await writeFile(join(dir, 'f.txt'), 'branch work\n', 'utf8')
    await commit('the branch changes f')
    await git('push', '-q', '-u', 'origin', 'work')

    await git('checkout', '-q', 'main')
    await writeFile(join(dir, 'g.txt'), 'base work\n', 'utf8')
    await commit('the base changes g')
    await git('checkout', '-q', 'work')
    await git('merge', '-q', '--no-edit', 'main')

    // Touched here for the first time, so it is in the diff at all.
    await writeFile(join(dir, 'g.txt'), 'and now the branch too\n', 'utf8')

    const found = await status()

    expect(publishStateOf('g.txt', null, found)).toBe('uncommitted')
    expect(staleOnRemote('g.txt', null, found)).toBe(false)
    // While the file the branch really did push an older version of still says so.
    await writeFile(join(dir, 'f.txt'), 'edited again\n', 'utf8')
    expect(staleOnRemote('f.txt', null, await status())).toBe(true)
  })

  /* Unrelated histories have no fork point, and `git diff a...b` is fatal
     across them — this read is inside an `allOf` with nothing to catch it, so
     the answer is to say nothing about the remote rather than to take the whole
     diff read down with it. Reached through an upstream, which is the only way
     in: the tracking fallback refuses a ref the base is not an ancestor of, and
     nothing is an ancestor across two unrelated roots. */
  it('says nothing about the remote where the two share no history', async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')

    await git('checkout', '-q', '--orphan', 'unrelated')
    await writeFile(join(dir, 'elsewhere.txt'), 'nothing in common\n', 'utf8')
    await commit('an unrelated root')
    await git('push', '-q', 'origin', 'unrelated')
    await git('checkout', '-q', 'work')
    await git('branch', '--set-upstream-to=origin/unrelated', 'work')

    const found = await status()

    expect(found.remoteCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(found.onRemote.size).toBe(0)
  })
})

/*
 * A branch with a remote-tracking ref and no upstream, which is what a push
 * typed in the workspace's own terminal can leave behind.
 *
 * The upstream is unset explicitly rather than by pushing without `-u`: git
 * sets one anyway under `push.autoSetupRemote`, so a test written that way took
 * the upstream path on the machines that have it set and proved nothing about
 * the fallback it is named after.
 */
describe('a branch with a tracking ref and no upstream', () => {
  it('falls back to the remote-tracking ref', async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')
    await git('push', '-q', '-u', 'origin', 'work')
    await git('branch', '--unset-upstream', 'work')

    const found = await status()

    expect(found.remoteCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(publishStateOf('a.txt', null, found)).toBe('pushed')
  })
})

/*
 * Workspace names are recycled, the local branch goes when a workspace is
 * removed, and nothing prunes `refs/remotes/origin/<name>` — so a dead ref
 * outlives the work that pushed it and the next workspace of that name
 * inherits it. Measured: three commits to push where there was one, somebody
 * else's files carrying the stale warning, and Push reviving a merged branch.
 */
describe('a remote-tracking ref left over from an earlier workspace', () => {
  beforeEach(async () => {
    await writeFile(join(dir, 'theirs.txt'), 'earlier work\n', 'utf8')
    await commit('the first workspace of this name')
    await git('push', '-q', 'origin', 'work')

    // The workspace is removed: `git branch -D`, and the tracking ref stays.
    await git('checkout', '-q', 'main')
    await writeFile(join(dir, 'moved-on.txt'), 'the base moves\n', 'utf8')
    await commit('the base moves on')
    await git('branch', '-q', '-D', 'work')

    // A new workspace draws the same name, from where the base is now.
    await git('checkout', '-q', '-b', 'work')
    await writeFile(join(dir, 'mine.txt'), 'later work\n', 'utf8')
    await commit('the second workspace of this name')
  })

  it('refuses a ref the branch could not have been pushed from', async () => {
    const found = await status()

    expect(found.remoteCommit).toBeNull()
    // One commit of its own, not three counted from somebody else's tip.
    expect(found.unpushedCommits).toBe(1)
  })
})

/*
 * Every read here is anchored on HEAD while the branch arrives as a name, and
 * the workspace's terminal is a shipped tab where `git checkout` is one command.
 * Apart, `work`'s copy on the remote was compared against a `side` that never
 * had one, and the answer was reported as where this workspace stands.
 */
describe('a worktree standing on another branch', () => {
  beforeEach(async () => {
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')
    await git('push', '-q', '-u', 'origin', 'work')
    await git('checkout', '-q', '-b', 'side')
  })

  it('makes no claim about the remote copy', async () => {
    await writeFile(join(dir, 'a.txt'), 'three\n', 'utf8')
    await commit('on side')

    const found = await status()

    expect(found.headOnBranch).toBe(false)
    expect(found.remoteCommit).toBeNull()
    expect(found.onRemote.size).toBe(0)
    expect(found.beyondRemote.size).toBe(0)
  })

  /* The file has to be one the pushed copy already matches, or it lands in
     `beyondRemote` either way and the answer holds with the guard reverted. */
  it('leaves every file short of pushed, there being no copy to match', async () => {
    await writeFile(join(dir, 'b.txt'), 'new here\n', 'utf8')
    await commit('on side')

    expect(publishStateOf('a.txt', null, await status())).toBe('committed')
  })

  it('never says everything is sent while HEAD is elsewhere', async () => {
    expect(nothingToSend(await status())).toBe(false)
  })

  // What `git checkout <sha>` in the terminal leaves, and the case
  // `currentBranch` answers null for.
  it('says the same for a HEAD that is on no branch at all', async () => {
    await git('checkout', '-q', '--detach')

    const found = await status()

    expect(found.headOnBranch).toBe(false)
    expect(found.remoteCommit).toBeNull()
  })
})

/*
 * git answering emptily is not git failing, and `merge-base` does it for a
 * revision it cannot resolve. Driven with a fake, since a real repository has
 * no way to produce it — which is the point of the guard being here at all.
 */
describe('a fork point git will not place', () => {
  it('says nothing about what the remote changed', async () => {
    const fake: GitExec = (args) => {
      if (args[0] === 'branch') return Promise.resolve('work\n')
      if (args.includes('--verify')) return Promise.resolve('remote01\n')
      if (args[0] === 'remote') return Promise.resolve('origin\n')
      // Including `merge-base`, which is the one this is about.
      return Promise.resolve('')
    }

    const found = await readPublishStatus(fake, {
      branch: 'work',
      baseCommit: 'base01',
      untracked: []
    })

    expect(found.remoteCommit).toBe('remote01')
    expect(found.onRemote.size).toBe(0)
  })
})

describe('a repository with no remote at all', () => {
  it('says so, rather than leaving it to look like a branch nobody pushed', async () => {
    await git('remote', 'remove', 'origin')
    await writeFile(join(dir, 'a.txt'), 'two\n', 'utf8')
    await commit('second')

    const found = await status()

    expect(found.hasRemote).toBe(false)
    expect(found.remoteCommit).toBeNull()
  })

  it('reports a remote that exists, so the two nulls stay tellable apart', async () => {
    expect((await status()).hasRemote).toBe(true)
  })
})

/*
 * The classification on its own, against statuses written out by hand. The
 * repository above proves the reads; these prove the questions, including the
 * combinations git will not produce to order.
 */
describe('the classification', () => {
  function given(overrides: Partial<PublishStatus> = {}): PublishStatus {
    return {
      remoteCommit: 'remote01',
      hasRemote: true,
      headOnBranch: true,
      unpushedCommits: 0,
      onRemote: new Set(),
      beyondRemote: new Set(),
      beyondHead: new Set(),
      ...overrides
    }
  }

  it('puts a file differing from HEAD on the first rung, whatever else is true', () => {
    const status = given({ beyondHead: new Set(['a.txt']), beyondRemote: new Set(['a.txt']) })

    expect(publishStateOf('a.txt', null, status)).toBe('uncommitted')
  })

  it('puts a file the remote lacks on the second', () => {
    expect(publishStateOf('a.txt', null, given({ beyondRemote: new Set(['a.txt']) }))).toBe(
      'committed'
    )
  })

  it('puts a file the remote matches on the third', () => {
    expect(publishStateOf('a.txt', null, given())).toBe('pushed')
  })

  it('follows a moved file under its old name on either rung', () => {
    const uncommitted = given({ beyondHead: new Set(['was.txt']) })
    const committed = given({ beyondRemote: new Set(['was.txt']) })

    expect(publishStateOf('now.txt', 'was.txt', uncommitted)).toBe('uncommitted')
    expect(publishStateOf('now.txt', 'was.txt', committed)).toBe('committed')
  })

  it('warns about an unpushed file the remote has an older version of', () => {
    const status = given({ beyondRemote: new Set(['a.txt']), onRemote: new Set(['a.txt']) })

    expect(staleOnRemote('a.txt', null, status)).toBe(true)
  })

  it('says nothing about an unpushed file the remote has never seen', () => {
    expect(staleOnRemote('a.txt', null, given({ beyondRemote: new Set(['a.txt']) }))).toBe(false)
  })

  it('holds nothing left to send only when all three reads are silent', () => {
    expect(nothingToSend(given())).toBe(true)
    expect(nothingToSend(given({ unpushedCommits: 1 }))).toBe(false)
    expect(nothingToSend(given({ beyondRemote: new Set(['a.txt']) }))).toBe(false)
    expect(nothingToSend(given({ beyondHead: new Set(['a.txt']) }))).toBe(false)
    expect(nothingToSend(given({ remoteCommit: null }))).toBe(false)
  })
})
