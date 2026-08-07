/**
 * Adding a repository as a project.
 *
 * A layer above `git.ts` and `store.ts`: validates that a directory is
 * usable and assembles the project record. Persisting it is the caller's job.
 */

import {
  detectBaseBranch,
  findRepositoryRoot,
  type GitExec,
  gitIn,
  hasCommits,
  repositoryName,
  toSlug
} from './git.js'
import type { Project, State } from './store.js'

/**
 * Machine-readable reason a directory was rejected.
 *
 * The UI translates these into localised messages; the English `message`
 * on the error stays as a fallback for logs (§10 i18n).
 */
export type ProjectValidationCode =
  'notARepository' | 'emptyRepository' | 'noBaseBranch' | 'duplicateProject'

/** A directory cannot be used as a project, with a reason the user can act on. */
export class ProjectValidationError extends Error {
  constructor(
    readonly code: ProjectValidationCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'ProjectValidationError'
  }
}

export interface RepositoryInfo {
  /** Repository root — may differ from the directory the user picked. */
  readonly root: string
  readonly name: string
  readonly baseBranch: string
}

/**
 * Validates a directory and collects repository details.
 *
 * Throws {@link ProjectValidationError} with a reason rather than returning
 * null: the user needs to know **why** the directory was rejected.
 */
export async function inspectRepository(
  path: string,
  makeExec: (cwd: string) => GitExec = gitIn
): Promise<RepositoryInfo> {
  const exec = makeExec(path)

  const root = await findRepositoryRoot(exec)
  if (!root) {
    throw new ProjectValidationError('notARepository', { path }, `${path} is not a git repository.`)
  }

  const rootExec = makeExec(root)

  if (!(await hasCommits(rootExec))) {
    throw new ProjectValidationError(
      'emptyRepository',
      { path: root },
      `${root} has no commits yet. A worktree cannot be created without one.`
    )
  }

  const baseBranch = await detectBaseBranch(rootExec)
  if (!baseBranch) {
    throw new ProjectValidationError(
      'noBaseBranch',
      { path: root },
      `Could not determine a base branch in ${root}.`
    )
  }

  return { root, name: repositoryName(root), baseBranch }
}

/**
 * Picks a free project identifier.
 *
 * Two repositories may share a name (e.g. `app` in different directories),
 * so a numeric suffix is appended to a taken slug.
 */
export function uniqueProjectId(baseSlug: string, taken: readonly string[]): string {
  if (!taken.includes(baseSlug)) return baseSlug

  for (let suffix = 2; ; suffix++) {
    const candidate = `${baseSlug}-${String(suffix)}`
    if (!taken.includes(candidate)) return candidate
  }
}

/**
 * Assembles a project record from a directory.
 *
 * Does not mutate state — it only prepares the value for `addProject`.
 */
export async function createProject(
  path: string,
  branchPrefix: string,
  state: State,
  makeExec: (cwd: string) => GitExec = gitIn
): Promise<Project> {
  const info = await inspectRepository(path, makeExec)

  const duplicate = state.projects.find((project) => project.repoPath === info.root)
  if (duplicate) {
    throw new ProjectValidationError(
      'duplicateProject',
      { name: duplicate.name },
      `This repository is already added as project "${duplicate.name}".`
    )
  }

  const taken = state.projects.map((project) => project.id)

  return {
    id: uniqueProjectId(toSlug(info.name), taken),
    name: info.name,
    repoPath: info.root,
    baseBranch: info.baseBranch,
    branchPrefix
  }
}
