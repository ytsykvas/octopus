/**
 * Reading and cloning GitHub repositories through the `gh` CLI.
 *
 * Everything goes through `gh` rather than the REST API directly: it already
 * holds the user's credentials in the system keychain, so the app never has to
 * see a token (§10.9 docs/PROJECT.md).
 */

import { basename, join } from 'node:path'

import { z } from 'zod'

import { type CommandExec, defaultExec } from './accounts.js'
import { CodedError } from './codedError.js'

/** How many repositories to fetch. Beyond this the list needs a search box, not a longer page. */
export const REPOSITORY_LIMIT = 200

const RemoteRepositorySchema = z.object({
  name: z.string().min(1),
  nameWithOwner: z.string().min(1),
  description: z.string().nullable().optional(),
  isPrivate: z.boolean(),
  updatedAt: z.string(),
  /* A field of its own rather than the part of `nameWithOwner` before the
     slash: the picker groups by it, and an indexed read of a split string is
     `string | undefined` under `noUncheckedIndexedAccess` — a possibility that
     cannot happen and would still have to be answered for. */
  owner: z.object({ login: z.string().min(1) }),
  defaultBranchRef: z.object({ name: z.string() }).nullable().optional()
})

export type RemoteRepository = z.infer<typeof RemoteRepositorySchema>

/**
 * What GitHub returns, before the two fields that only decide what is offered.
 *
 * Kept off `RemoteRepository` so neither crosses IPC: they answer "should this
 * be in the list at all", which is settled here and nowhere else.
 */
const RepositoryNodeSchema = RemoteRepositorySchema.extend({
  isArchived: z.boolean(),
  viewerPermission: z.string().nullable().optional()
})

const RepositoryPageSchema = z.object({
  data: z.object({
    viewer: z.object({
      login: z.string().min(1),
      repositories: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        nodes: z.array(RepositoryNodeSchema)
      })
    })
  })
})

/** Failure that the user can act on, carrying a code the UI localises. */
export type GitHubErrorCode =
  | 'notConnected'
  | 'listFailed'
  | 'cloneFailed'
  | 'alreadyExists'
  // Opening a pull request and everything either side of it, which
  // `pullRequests.ts` does through the same `gh` and reports through this same
  // error so the renderer has one place to map.
  //
  // Half of these are git failures rather than GitHub ones, and that is not an
  // accident of where they landed: what the union answers is "something went
  // wrong on the way to or from a pull request", and a push refused and a
  // commit refused are the same kind of thing to whoever pressed the button.
  | 'noCommits'
  | 'nothingToCommit'
  | 'commitFailed'
  | 'pushFailed'
  | 'createFailed'
  | 'mergeFailed'
  | 'closeFailed'
  // Asking the agent to write the title and body is on the way to a pull
  // request too, and fails in the same place as far as the reader is concerned.
  | 'draftFailed'

export class GitHubError extends CodedError<GitHubErrorCode> {
  override readonly name = 'GitHubError'
}

/** GraphQL's own ceiling on one page, whatever `REPOSITORY_LIMIT` allows. */
const PAGE_SIZE = 100

/**
 * Permissions that allow pushing a branch.
 *
 * Which is the whole point of the list: octopus works by pushing a branch and
 * opening a pull request from it, so a repository the user can only read looks
 * like a working choice right up until the first push fails.
 */
const CAN_PUSH = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])

/**
 * Every repository the account can push to, personal and organisation alike.
 *
 * `gh repo list` cannot answer this. It lists what one owner owns, and with no
 * owner given that is the signed-in user — so an organisation's repositories
 * were unreachable through it, and no flag on that command changes it. The
 * GraphQL API is the only form that takes affiliations, and it comes through
 * the same `gh`, so the token still never leaves the keychain (§10.9).
 *
 * Both affiliation arguments are needed: `ownerAffiliations` describes the
 * owner's relation to the viewer and `affiliations` the viewer's to the
 * repository, and setting only the first returned a subset.
 */
const REPOSITORIES_QUERY = `query($first: Int!, $after: String) {
  viewer {
    login
    repositories(
      first: $first
      after: $after
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        nameWithOwner
        description
        isPrivate
        isArchived
        updatedAt
        viewerPermission
        owner { login }
        defaultBranchRef { name }
      }
    }
  }
}`

/**
 * Repositories the signed-in account can push to, grouped owner by owner.
 *
 * Archived ones are excluded: they cannot receive work, so offering them would
 * only be noise. So are ones the account can only read — see `CAN_PUSH`.
 */
export async function listRepositories(
  exec: CommandExec = defaultExec,
  limit: number = REPOSITORY_LIMIT
): Promise<RemoteRepository[]> {
  const nodes: z.infer<typeof RepositoryNodeSchema>[] = []
  let login = ''
  let cursor: string | null = null

  // Paged rather than asked for in one go: GraphQL caps a page at 100 and the
  // limit above it is 200. The cap is the loop's stopping condition, not the
  // page size.
  while (nodes.length < limit) {
    const page = await readPage(exec, Math.min(PAGE_SIZE, limit - nodes.length), cursor)

    login = page.data.viewer.login
    nodes.push(...page.data.viewer.repositories.nodes)

    const { hasNextPage, endCursor } = page.data.viewer.repositories.pageInfo
    if (!hasNextPage || endCursor === null) break
    cursor = endCursor
  }

  const offered = nodes.filter(
    (node) => !node.isArchived && CAN_PUSH.has(node.viewerPermission ?? '')
  )

  // A bare `parse` deliberately, unlike the ones `pullRequests.ts` had to
  // convert: nothing external reaches this. Every node here came through
  // `RepositoryPageSchema`, which validates them against a schema extending
  // this one, so all this does is drop the two fields the page carries and a
  // repository does not. It cannot fail on an answer from GitHub.
  return sortByOwner(offered, login).map((node) => RemoteRepositorySchema.parse(node))
}

/** One page of the query, validated. */
async function readPage(
  exec: CommandExec,
  first: number,
  cursor: string | null
): Promise<z.infer<typeof RepositoryPageSchema>> {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${REPOSITORIES_QUERY}`,
    '-F',
    `first=${String(first)}`
  ]
  if (cursor !== null) args.push('-F', `after=${cursor}`)

  let raw: string
  try {
    raw = await exec('gh', args)
  } catch {
    throw new GitHubError('notConnected', {}, 'Could not read repositories from GitHub.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unreadable response.')
  }

  const result = RepositoryPageSchema.safeParse(parsed)
  if (!result.success) {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unexpected response.')
  }

  return result.data
}

/**
 * Your own repositories first, then each organisation alphabetically.
 *
 * Only the owner is compared. The query already returns most recently updated
 * first and `sort` is stable, so ranking by owner alone keeps that order inside
 * every group — which is what makes each one read like the list used to.
 */
function sortByOwner<T extends { owner: { login: string } }>(
  repositories: readonly T[],
  login: string
): T[] {
  const others = [...new Set(repositories.map((item) => item.owner.login))]
    .filter((owner) => owner !== login)
    .sort((a, b) => a.localeCompare(b))

  const rank = (owner: string): number => (owner === login ? -1 : others.indexOf(owner))

  return [...repositories].sort((a, b) => rank(a.owner.login) - rank(b.owner.login))
}

/**
 * Where a repository will land once cloned.
 *
 * Only the repository's own name is used, never the value supplied by the
 * caller: `nameWithOwner` reaches a filesystem path, and a crafted name could
 * otherwise escape the destination directory.
 */
export function clonePath(repository: RemoteRepository, destination: string): string {
  return join(destination, basename(repository.name))
}

/**
 * Clones a repository into `destination`.
 *
 * Returns the directory it landed in, ready to be added as a project.
 */
export async function cloneRepository(
  repository: RemoteRepository,
  destination: string,
  exec: CommandExec = defaultExec,
  exists: (path: string) => Promise<boolean> = pathExists
): Promise<string> {
  const target = clonePath(repository, destination)

  if (await exists(target)) {
    throw new GitHubError(
      'alreadyExists',
      { path: target },
      `${target} already exists. Add it from disk instead, or choose another directory.`
    )
  }

  try {
    await exec('gh', ['repo', 'clone', repository.nameWithOwner, target])
  } catch {
    throw new GitHubError(
      'cloneFailed',
      { repository: repository.nameWithOwner },
      `Could not clone ${repository.nameWithOwner}.`
    )
  }

  return target
}

async function pathExists(path: string): Promise<boolean> {
  const { access } = await import('node:fs/promises')
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
