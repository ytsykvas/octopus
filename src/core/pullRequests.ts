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
import { countAhead, type GitExec } from './git.js'
import {
  type BranchRequest,
  BranchListSchema,
  DetailPayloadSchema,
  type PullRequestDetail,
  type PullRequestState,
  RemoteStateSchema,
  ThreadsPayloadSchema,
  toBranchRequests,
  toPullRequestDetail,
  toPullRequestState
} from './pullRequestShapes.js'
import { commitAll, hasUncommittedChanges } from './worktree.js'

const run = promisify(execFile)

/** `gh` in a particular directory, which is how it finds the repository. */
export type GhExec = (args: readonly string[]) => Promise<string>

export function ghIn(cwd: string): GhExec {
  return async (args) => {
    const { stdout } = await run('gh', [...args], { cwd, timeout: 30_000 })
    return stdout
  }
}

/**
 * What the tool said, short enough to put in a sentence.
 *
 * These failures used to be reported as "GitHub refused it" and nothing else:
 * `gh` writes a precise reason to stderr — a request already open for this
 * branch, a base that does not exist there, no permission to push — and every
 * one of them was thrown away with the error carrying it. The user was left
 * with a refusal and no way to act on it, and so was anybody they asked.
 *
 * The first line only. `gh` leads with the reason and follows with usage.
 */
function reasonFrom(error: unknown): string {
  const stderr =
    typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''

  // Trimmed before the cut, so a leading blank line cannot become the answer.
  const said = (stderr.trim() === '' ? String(error) : stderr).trim()
  const breaks = said.indexOf('\n')

  return (breaks === -1 ? said : said.slice(0, breaks)).trim().slice(0, 200)
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
  /**
   * What the request would be opened against.
   *
   * Carried because the pane names it — "no commits that `main` does not" — and
   * the branch is the only half of that sentence it had. The name went into the
   * message as an empty string for as long as the message existed.
   */
  readonly base: string
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
    countAhead(git, base, branch)
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
    ahead,
    base
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
  draft: z.boolean(),
  /**
   * Commit everything first, under this message — or null to open the request
   * from what is already committed.
   *
   * Null rather than an empty string, because an empty commit message is a
   * thing somebody could mean to type and git refuses it. A subject line and a
   * body is what the bound allows for; past that it is a description, and there
   * is a field for one directly below.
   */
  commitMessage: z.string().min(1).max(2_000).nullable()
})

export type PullRequestDraft = z.infer<typeof NewPullRequestSchema>

/** The draft, plus the two facts the service knows and the renderer does not. */
export interface NewPullRequest extends PullRequestDraft {
  readonly branch: string
  readonly base: string
}

/**
 * Commits what is uncommitted where asked, pushes the branch, opens the request.
 *
 * Every value goes as an argument and none is interpolated: a title beginning
 * with a dash is a title, not a flag, and all three of these are typed by the
 * user.
 *
 * Returns the URL `gh` printed, which is what the pane offers to open.
 */
export async function createPullRequest(
  request: NewPullRequest,
  gh: GhExec,
  git: GitExec
): Promise<string> {
  // Before the count below, not after it: a workspace whose only work is
  // uncommitted is zero commits ahead until this lands, and checking first
  // would refuse exactly the request this field exists to open.
  if (request.commitMessage !== null) await commit(request.commitMessage, git)

  if ((await countAhead(git, request.base, request.branch)) === 0) {
    throw new GitHubError(
      'noCommits',
      { base: request.base },
      'This branch has nothing the base branch does not.'
    )
  }

  await push(request.branch, git)

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
  } catch (error) {
    throw new GitHubError(
      'createFailed',
      { reason: reasonFrom(error) },
      'Could not open the pull request.'
    )
  }

  // `gh` prints the URL and nothing else worth keeping. Trimmed rather than
  // parsed: there is no `--json` on `pr create`.
  return raw.trim()
}

/**
 * Sends the branch to the remote.
 *
 * `-u` as well as pushing: `gh` reads the upstream to know what to open a
 * request from, and a branch pushed without one is a branch it cannot find.
 */
async function push(branch: string, git: GitExec): Promise<void> {
  try {
    await git(['push', '-u', 'origin', branch])
  } catch (error) {
    throw new GitHubError(
      'pushFailed',
      { branch, reason: reasonFrom(error) },
      'Could not push the branch.'
    )
  }
}

/**
 * Commits everything here and sends it to the remote.
 *
 * What closes the loop for a request that already exists: the agent answers a
 * review, and without this the only way to get that answer onto the request is
 * the terminal.
 *
 * The same two steps `createPullRequest` takes, in the same order and reporting
 * the same codes — which is why they are functions rather than inline there.
 */
export async function commitAndPush(message: string, branch: string, git: GitExec): Promise<void> {
  await commit(message, git)
  await push(branch, git)
}

/**
 * Everything in the worktree, as one commit.
 *
 * The policy `commitAll` deliberately does not hold. Asked to commit nothing,
 * git fails with a message about the index that says nothing to whoever typed a
 * message into a field — so the state is checked first and answered for itself.
 */
async function commit(message: string, git: GitExec): Promise<void> {
  if (!(await hasUncommittedChanges(git))) {
    throw new GitHubError('nothingToCommit', {}, 'There is nothing here to commit.')
  }

  try {
    await commitAll(git, message)
  } catch (error) {
    throw new GitHubError(
      'commitFailed',
      { reason: reasonFrom(error) },
      'Could not commit the changes.'
    )
  }
}

/**
 * A pull request's number, as the renderer may send it back.
 *
 * The renderer read it from us, which is not a reason to believe it: it becomes
 * an argument to `gh`, and types are gone by the time it crosses the boundary.
 */
export const PullRequestNumberSchema = z.number().int().positive()

/** A commit message on its own, bounded like the one inside a request draft. */
export const CommitMessageSchema = z.string().min(1).max(2_000)

/** How the commits land on the base branch. */
export const MergeMethodSchema = z.enum(['merge', 'squash', 'rebase'])
export type MergeMethod = z.infer<typeof MergeMethodSchema>

const MERGE_FLAGS: Record<MergeMethod, string> = {
  merge: '--merge',
  squash: '--squash',
  rebase: '--rebase'
}

/**
 * Merges the request.
 *
 * No `--delete-branch`, though `gh` offers it: a worktree is checked out on
 * that branch, so git refuses to delete it and the merge reports a failure the
 * app caused itself. Removing the workspace is how the branch goes.
 *
 * Answers with nothing, and that is deliberate rather than lazy: `gh` enables
 * auto-merge instead of merging when required checks have not passed, so a
 * zero exit is not proof of a merge. The caller reads the request again, which
 * is also what turns a refusal we cannot name into a visible reason.
 */
export async function mergePullRequest(
  number: number,
  method: MergeMethod,
  gh: GhExec
): Promise<void> {
  try {
    await gh(['pr', 'merge', String(number), MERGE_FLAGS[method]])
  } catch (error) {
    throw new GitHubError(
      'mergeFailed',
      { number: String(number), reason: reasonFrom(error) },
      'GitHub would not merge the pull request.'
    )
  }
}

/** The fields `gh pr view` is asked for; named once because the list is long. */
const DETAIL_FIELDS = [
  'id',
  'state',
  'title',
  'url',
  'isDraft',
  'mergeable',
  'mergeStateStatus',
  'reviewDecision',
  'statusCheckRollup',
  'comments',
  'reviews'
].join(',')

/**
 * The review threads, by the request's own node id.
 *
 * By node id rather than by owner and repository, which GraphQL would otherwise
 * need and nothing here knows: `gh` substitutes `{owner}` and `{repo}` for REST
 * paths but not inside a query, and working them out from the URL would be one
 * more thing to get wrong for an enterprise host.
 *
 * REST would give the same comments in one fewer step and without the id, but
 * not `isResolved` — and a thread somebody has already settled, shown as an
 * open remark, is how a reviewer's finished work gets handed to the agent again.
 */
const THREADS_QUERY = `query($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      reviewThreads(first: 50) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 20) {
            nodes { id body url createdAt author { login } diffHunk path line }
          }
        }
      }
    }
  }
}`

/**
 * Everything about one request that the branch's own state does not say.
 *
 * Two calls rather than one, and not `gh pr checks` for the first of them: that
 * command exits `8` while a check is pending and non-zero when one has failed,
 * and `ghIn` rejects on a non-zero exit — so the state the pane most needs to
 * draw would arrive as a thrown error rather than as an answer.
 */
export async function readPullRequestDetail(
  number: number,
  gh: GhExec
): Promise<PullRequestDetail> {
  const view = DetailPayloadSchema.parse(
    parsed(await asked(() => gh(['pr', 'view', String(number), '--json', DETAIL_FIELDS])))
  )

  const threads = ThreadsPayloadSchema.parse(
    parsed(
      await asked(() =>
        gh(['api', 'graphql', '-f', `query=${THREADS_QUERY}`, '-F', `id=${view.id}`])
      )
    )
  )

  return toPullRequestDetail(view, threads)
}

/**
 * How many requests to read for a project at once.
 *
 * A cap rather than pagination, for the same reason `REPOSITORY_LIMIT` is one:
 * past this the answer needs a search box rather than a longer page. What it
 * costs is a mark beside a workspace whose request is older than the hundred
 * most recent in the repository.
 */
export const BRANCH_REQUEST_LIMIT = 100

/**
 * Every branch of the repository that has a request, in one call.
 *
 * One call for the whole project rather than one per workspace. The mark is
 * wanted on every row of the list at once, and a read per row would be a
 * network call per row every time the list refreshed.
 */
export async function readBranchRequests(
  gh: GhExec,
  limit: number = BRANCH_REQUEST_LIMIT
): Promise<BranchRequest[]> {
  const payload = BranchListSchema.parse(
    parsed(
      await asked(() =>
        gh([
          'pr',
          'list',
          '--state',
          'all',
          '--limit',
          String(limit),
          '--json',
          'headRefName,number,state,url,statusCheckRollup'
        ])
      )
    )
  )

  return toBranchRequests(payload)
}

/** `gh` refusing to answer, which is a different failure from an odd answer. */
async function asked(run: () => Promise<string>): Promise<string> {
  try {
    return await run()
  } catch {
    throw new GitHubError('notConnected', {}, 'Could not ask GitHub about this pull request.')
  }
}

/** An answer that is not JSON, which no schema can be blamed for. */
function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unreadable response.')
  }
}
