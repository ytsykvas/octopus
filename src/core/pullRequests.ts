/**
 * A workspace's branch as a pull request, through the `gh` CLI.
 *
 * Everything goes through `gh` rather than the REST API directly, for the same
 * reason `github.ts` does: it already holds the user's credentials in the system
 * keychain, so the app never has to see a token (§10.9 docs/PROJECT.md).
 *
 * Both commands take their executor as a parameter. The pair matters — reading
 * asks `gh` about the remote and git about the working tree, and creating
 * pushes with git before it asks `gh` for anything at all.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { z } from 'zod'

import { GitHubError } from './github.js'
import type { GitExec } from './git.js'
import {
  type PullRequestState,
  RemoteStateSchema,
  toPullRequestState
} from './pullRequestShapes.js'
import { hasUncommittedChanges } from './worktree.js'

const run = promisify(execFile)

/** `gh` in a particular directory, which is how it finds the repository. */
export type GhExec = (args: readonly string[]) => Promise<string>

export function ghIn(cwd: string): GhExec {
  return async (args) => {
    const { stdout } = await run('gh', [...args], { cwd, timeout: 30_000 })
    return stdout
  }
}

/** One that exists, and therefore has all four of these rather than some. */
export interface PullRequest {
  readonly number: number
  readonly state: PullRequestState
  readonly title: string
  readonly url: string
}

export interface PullRequestView {
  /**
   * The pull request there is, or null where there is none.
   *
   * One nullable object rather than four nullable fields beside a state. A
   * number without a request and a request without a number were both spellable
   * that way, and the pane had to answer for combinations `gh` never sends.
   */
  readonly request: PullRequest | null
  /** Whether the branch is on the remote — what creating one has to do first. */
  readonly pushed: boolean
  /** Uncommitted work, which a pull request would not carry. */
  readonly dirty: boolean
  /** Commits this branch has that the base does not; zero means nothing to open. */
  readonly ahead: number
}

/**
 * What `gh` reports, narrowed to what the pane draws.
 *
 * `state` arrives shouting — `OPEN`, `MERGED`, `CLOSED` — and is lowered here so
 * nothing downstream has to remember that.
 */
const RemotePullRequestSchema = z.object({
  number: z.number().int(),
  state: RemoteStateSchema,
  title: z.string(),
  url: z.string()
})

/**
 * The pull request for a branch, or the absence of one.
 *
 * `pr list --head` rather than `pr view`: `view` exits non-zero when there is no
 * pull request, which is indistinguishable from exiting non-zero because nobody
 * is signed in or the remote is not GitHub. `list` answers `[]` for the first
 * and fails only for the rest, so an ordinary branch does not have to be told
 * apart from a broken setup by reading stderr.
 */
export async function readPullRequest(
  branch: string,
  base: string,
  gh: GhExec,
  git: GitExec
): Promise<PullRequestView> {
  const [remote, dirty, pushed, ahead] = await Promise.all([
    listPullRequests(branch, gh),
    hasUncommittedChanges(git),
    isPushed(branch, git),
    countAhead(branch, base, git)
  ])

  // The newest, when a branch has been opened and closed and opened again:
  // `gh` lists most recent first, and the current one is what the pane is about.
  const current = remote[0]

  return {
    request:
      current === undefined
        ? null
        : {
            number: current.number,
            state: toPullRequestState(current.state),
            title: current.title,
            url: current.url
          },
    pushed,
    dirty,
    ahead
  }
}

async function listPullRequests(
  branch: string,
  gh: GhExec
): Promise<z.infer<typeof RemotePullRequestSchema>[]> {
  let raw: string
  try {
    raw = await gh([
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
  } catch {
    throw new GitHubError('notConnected', {}, 'Could not ask GitHub about this branch.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unreadable response.')
  }

  const result = z.array(RemotePullRequestSchema).safeParse(parsed)
  if (!result.success) {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unexpected response.')
  }

  return result.data
}

/**
 * Whether the remote has this branch.
 *
 * `ls-remote` asks the remote rather than reading what was last fetched, which
 * is the question worth asking: a branch pushed from another machine is on the
 * remote and absent from this clone's refs.
 */
async function isPushed(branch: string, git: GitExec): Promise<boolean> {
  try {
    return (await git(['ls-remote', '--heads', 'origin', branch])).trim() !== ''
  } catch {
    // No remote, no network, no permission — none of which is an answer of
    // "yes", and none of which should stop the pane drawing what it does know.
    return false
  }
}

/** How far the branch is ahead of its base; zero means there is nothing to open. */
async function countAhead(branch: string, base: string, git: GitExec): Promise<number> {
  try {
    const raw = await git(['rev-list', '--count', `${base}..${branch}`])
    const count = Number(raw.trim())
    return Number.isInteger(count) ? count : 0
  } catch {
    // An unknown base — a branch deleted upstream, a project pointed at a name
    // that no longer exists — is not something the reader can act on here, and
    // `gh` gives the real message if they go ahead and try.
    return 0
  }
}

/**
 * What the renderer may ask for, validated at the boundary.
 *
 * Bounded because both strings become arguments to `gh`: a title is a line and
 * a description is a page, and anything past that is a paste that belongs in
 * the branch rather than in the request that opens it.
 */
export const NewPullRequestSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000),
  draft: z.boolean()
})

export type PullRequestDraft = z.infer<typeof NewPullRequestSchema>

/** The draft, plus the two facts the service knows and the renderer does not. */
export interface NewPullRequest extends PullRequestDraft {
  readonly branch: string
  readonly base: string
}

/**
 * Pushes the branch if it needs it, then opens the pull request.
 *
 * Every value goes as an argument and none is interpolated: a title beginning
 * with a dash is a title, not a flag, and both of these are typed by the user.
 *
 * Returns the URL `gh` printed, which is what the pane offers to open.
 */
export async function createPullRequest(
  request: NewPullRequest,
  gh: GhExec,
  git: GitExec
): Promise<string> {
  if ((await countAhead(request.branch, request.base, git)) === 0) {
    throw new GitHubError(
      'noCommits',
      { base: request.base },
      'This branch has nothing the base branch does not.'
    )
  }

  try {
    // `-u` as well as pushing: `gh` reads the upstream to know what to open the
    // request from, and a branch pushed without one is a branch it cannot find.
    await git(['push', '-u', 'origin', request.branch])
  } catch {
    throw new GitHubError('pushFailed', { branch: request.branch }, 'Could not push the branch.')
  }

  let raw: string
  try {
    raw = await gh([
      'pr',
      'create',
      '--base',
      request.base,
      '--head',
      request.branch,
      '--title',
      request.title,
      '--body',
      request.body,
      ...(request.draft ? ['--draft'] : [])
    ])
  } catch {
    throw new GitHubError('createFailed', {}, 'Could not open the pull request.')
  }

  // `gh` prints the URL and nothing else worth keeping. Trimmed rather than
  // parsed: there is no `--json` on `pr create`.
  return raw.trim()
}
