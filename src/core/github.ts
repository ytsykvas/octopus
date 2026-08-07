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

/** How many repositories to fetch. Beyond this the list needs a search box, not a longer page. */
export const REPOSITORY_LIMIT = 200

const RemoteRepositorySchema = z.object({
  name: z.string().min(1),
  nameWithOwner: z.string().min(1),
  description: z.string().nullable().optional(),
  isPrivate: z.boolean(),
  updatedAt: z.string(),
  defaultBranchRef: z.object({ name: z.string() }).nullable().optional()
})

export type RemoteRepository = z.infer<typeof RemoteRepositorySchema>

/** Failure that the user can act on, carrying a code the UI localises. */
export type GitHubErrorCode = 'notConnected' | 'listFailed' | 'cloneFailed' | 'alreadyExists'

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

/**
 * Lists the signed-in user's repositories, most recently updated first.
 *
 * Archived repositories are excluded: they cannot receive work, so offering
 * them would only be noise.
 */
export async function listRepositories(
  exec: CommandExec = defaultExec,
  limit: number = REPOSITORY_LIMIT
): Promise<RemoteRepository[]> {
  let raw: string
  try {
    raw = await exec('gh', [
      'repo',
      'list',
      '--no-archived',
      '--limit',
      String(limit),
      '--json',
      'name,nameWithOwner,description,isPrivate,updatedAt,defaultBranchRef'
    ])
  } catch {
    throw new GitHubError('notConnected', {}, 'Could not read repositories from GitHub.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unreadable response.')
  }

  const result = z.array(RemoteRepositorySchema).safeParse(parsed)
  if (!result.success) {
    throw new GitHubError('listFailed', {}, 'GitHub returned an unexpected response.')
  }

  return result.data.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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
