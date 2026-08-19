/**
 * Adding a repository as a project.
 *
 * A layer above `git.ts` and `store.ts`: validates that a directory is
 * usable and assembles the project record. Persisting it is the caller's job.
 */

import {
  anyBranchExists,
  detectBaseBranch,
  findRepositoryRoot,
  type GitExec,
  gitIn,
  hasCommits,
  repositoryName,
  toSlug
} from './git.js'
import { DEFAULT_ENV_FILE } from './envBlock.js'
import { nextProjectColor } from './colors.js'
import type { Project, State } from './store.js'

/**
 * Machine-readable reason a directory was rejected.
 *
 * The UI translates these into localised messages; the English `message`
 * on the error stays as a fallback for logs (§10 i18n).
 */
export type ProjectValidationCode =
  | 'notARepository'
  | 'emptyRepository'
  | 'noBaseBranch'
  | 'duplicateProject'
  /** The chosen base branch is not in the repository. */
  | 'branchMissing'

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
    branchPrefix,
    color: nextProjectColor(state.projects.map((project) => project.color)),
    envFile: DEFAULT_ENV_FILE,
    // Nothing has been read yet, which is exactly what an empty list says.
    approvedSettings: []
  }
}

/**
 * Checks that a branch a project is about to be based on actually exists.
 *
 * The UI picks from a list read when its dialog opened, and the repository is
 * used from outside meanwhile — a branch can be deleted in a terminal in the
 * seconds between. Storing a name git does not know would surface much later,
 * as a `worktree add` failure that says nothing about project settings.
 */
export async function assertBranchExists(exec: GitExec, branch: string): Promise<void> {
  if (await anyBranchExists(exec, branch)) return

  throw new ProjectValidationError(
    'branchMissing',
    { branch },
    `Branch ${branch} no longer exists in this repository.`
  )
}

/**
 * Branches most likely to be the one wanted, in the order they should appear.
 *
 * Matched against the last segment so `origin/main` counts as `main`.
 */
const PREFERRED_BASE_BRANCHES = ['main', 'master', 'develop']

/**
 * Orders branches for the base-branch picker.
 *
 * A real repository's remote list is mostly automated noise — dependabot
 * pushes a branch per dependency — and the one branch anyone actually bases
 * work on would otherwise sit somewhere in the middle of it, alphabetically.
 */
export function orderBaseBranches(branches: readonly string[]): string[] {
  const rank = (branch: string): number => {
    const found = PREFERRED_BASE_BRANCHES.findIndex(
      (name) => branch === name || branch.endsWith(`/${name}`)
    )
    return found === -1 ? PREFERRED_BASE_BRANCHES.length : found
  }

  return [...branches].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}
