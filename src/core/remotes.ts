/**
 * Where a base branch's state comes from, and bringing it up to date.
 *
 * A worktree is cut from the base branch, and until this existed that meant the
 * *local copy* of it, as of whenever somebody last fetched by hand. Measured on
 * a real project: a base of `origin/develop` in a checkout that had never been
 * fetched into at all, two weeks behind. Every workspace made from it started
 * two weeks behind, and nothing said so — the cost landed at review, as
 * conflicts or as work already merged being done a second time.
 *
 * The one module in `src/core` that leaves the machine on purpose, which is why
 * the deadline and the environment live here rather than in `git.ts`. It throws
 * `GitError` and nothing else: what a failed fetch *means* is a question about
 * workspaces, and answering it here would make this module import the one that
 * imports it.
 */

import { type GitExec, type GitOptions, refExists } from './git.js'

/** What a base branch names, and where its current state comes from. */
export interface BaseRef {
  /** The remote to fetch before branching, or null when there is nothing to fetch. */
  readonly remote: string | null
  /** What `git worktree add` should start the branch from. */
  readonly ref: string
}

/**
 * How long a fetch may take before it is killed.
 *
 * The same half-minute `gh` and the archive script get. Deliberately longer
 * than the three seconds a button usually allows: a first fetch of a large
 * repository over a slow link legitimately takes ten, and giving up early would
 * refuse work that was about to succeed. The case that actually hangs — a
 * credential prompt — is handled below and fails in milliseconds, so this is
 * only ever spent on a network that is genuinely dead.
 */
export const FETCH_TIMEOUT_MS = 30_000

/**
 * What the fetch runs with.
 *
 * `GIT_TERMINAL_PROMPT=0` is the load-bearing half. git spawned from Electron
 * has no controlling terminal, so a fetch that decides to ask for a password
 * writes the prompt to a terminal that does not exist and waits — for ever,
 * behind a button with no way to cancel. Both of the repositories this was
 * built against use HTTPS remotes and one of them is private, so that is the
 * likely failure rather than the exotic one. Disabled, git fails immediately
 * and says why, which is what the user needs to read.
 *
 * It does not disturb the keychain helper, which is how a working HTTPS setup
 * actually authenticates: only the interactive fallback goes.
 *
 * `GIT_SSH_COMMAND` is deliberately **not** set. It overrides `core.sshCommand`
 * rather than adding to it, so a batch-mode flag here would silently discard a
 * configured identity file or proxy command and break fetching for whoever set
 * one. ssh without a terminal fails rather than hangs, and the deadline covers
 * what is left.
 */
export const FETCH_OPTIONS: GitOptions = {
  timeout: FETCH_TIMEOUT_MS,
  env: { GIT_TERMINAL_PROMPT: '0' }
}

/**
 * The names in `git remote`, `origin` first.
 *
 * Its own function so it can be tested on strings. The ordering is what makes a
 * repository with several remotes resolve the same way twice, and the way
 * anyone would expect: `origin` is the one a clone creates and the one every
 * other part of the app already assumes.
 */
export function parseRemotes(output: string): string[] {
  const names = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  return [
    ...names.filter((name) => name === 'origin'),
    ...names.filter((name) => name !== 'origin')
  ]
}

/** Configured remotes, `origin` first. */
export async function listRemotes(exec: GitExec): Promise<string[]> {
  return parseRemotes(await exec(['remote']))
}

/**
 * What git itself would pull into this branch, or null where nothing would.
 *
 * Answers a full remote-tracking name — `origin/main` — for a branch that
 * tracks a remote one, and a bare name for one tracking another local branch,
 * which git allows. The caller has to tell those apart, so this reports what
 * git said rather than assuming a remote.
 */
async function upstreamOf(exec: GitExec, branch: string): Promise<string | null> {
  try {
    return (
      await exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`])
    ).trim()
  } catch {
    // No upstream configured, or no such branch. Both mean the same here:
    // there is nothing git would call this branch's remote copy. This is the
    // only way the question goes unanswered — git either names one or refuses,
    // and a guard against an empty answer would be a branch no repository can
    // reach.
    return null
  }
}

/**
 * Where a base branch's state comes from. Asks nothing of the network.
 *
 * Four answers, in the order a reader would ask them:
 *
 * 1. the base is already a remote-tracking name — `origin/develop`, which is
 *    what the base-branch picker offers, since it lists remote branches;
 * 2. it is a local branch tracking a remote one, and what git would pull into
 *    it is the truthful answer even when the two are named differently;
 * 3. it is a local branch with no upstream, but a remote carries the same name
 *    — the usual state of a base produced by detection, which strips `origin/`
 *    off `origin/HEAD` and stores the bare name;
 * 4. nothing on any remote corresponds to it, so there is nothing to fetch and
 *    nothing that could be stale.
 *
 * The remote comes from `git remote` rather than from assuming `origin`. That
 * is what makes a differently-named remote work, and what stops a local branch
 * called `feature/x` being read as a remote called `feature`.
 */
export async function resolveBase(exec: GitExec, base: string): Promise<BaseRef> {
  const remotes = await listRemotes(exec)

  const owner = remotes.find((remote) => base.startsWith(`${remote}/`))
  if (owner !== undefined) return { remote: owner, ref: base }

  const upstream = await upstreamOf(exec, base)
  const tracked =
    upstream === null ? undefined : remotes.find((remote) => upstream.startsWith(`${remote}/`))

  if (upstream !== null && tracked !== undefined) return { remote: tracked, ref: upstream }

  for (const remote of remotes) {
    if (await refExists(exec, `refs/remotes/${remote}/${base}`)) {
      return { remote, ref: `${remote}/${base}` }
    }
  }

  return { remote: null, ref: base }
}

/**
 * Brings a remote's branches up to date.
 *
 * No refspec, deliberately. `git fetch origin develop` leans on git updating
 * `refs/remotes/origin/develop` as a side effect, and a repository configured
 * with a narrower fetch refspec would leave that ref untouched — the worktree
 * would then be cut from the stale ref and this whole mechanism would have
 * failed silently, in the one configuration nobody thinks to test. Naming only
 * the remote does what the repository's own refspec says, which is the only
 * definition of "up to date" that cannot be wrong.
 *
 * No `--prune` either: pruning deletes refs, and a destructive side effect does
 * not belong behind a button that says "new workspace".
 */
export async function fetchRemote(exec: GitExec, remote: string): Promise<void> {
  await exec(['fetch', remote])
}
