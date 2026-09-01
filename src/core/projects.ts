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
import { rm } from 'node:fs/promises'
import { basename, dirname, normalize } from 'node:path'

import { DEFAULT_ENV_FILE } from './envBlock.js'
import { DEFAULT_PROFILE } from './envProfiles.js'
import { projectDir, projectsDir } from './paths.js'
import { nextProjectColor } from './colors.js'
import type { Project, State } from './store.js'
import type { ProjectId } from './types.js'

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
  /** An id that would name a directory outside `~/.octopus/projects`. */
  | 'projectPathEscapes'

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
    // Nothing has been read yet, which is exactly what an empty list says —
    // for what the agent may load, and for what the Run button may execute.
    approvedSettings: [],
    approvedScripts: [],
    // The set the migration gives the old single file, so a project that has
    // never had one still names something it could write.
    envProfile: DEFAULT_PROFILE,
    // A repository is read before it is believed, until somebody says otherwise.
    trustRepoScripts: false
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

/**
 * Deletes everything a project kept on this machine.
 *
 * Its scripts, its carry list, its instructions, its skills and its env
 * overrides — the last of which are credentials. Left behind, they are
 * invisible to the app and silently inherited by the next project that happens
 * to take the same id.
 *
 * The id reaches this from `state.json`, which is a file somebody can edit, and
 * this is a recursive delete. So the path it builds is checked against the one
 * it is allowed to build: anything that normalises elsewhere is refused rather
 * than followed. `paths.ts` cannot hold this — it is pure, synchronous and
 * asserted as strings, and an `rm -rf` is none of those.
 */
export async function removeProjectData(projectId: ProjectId, root?: string): Promise<void> {
  const directory = normalize(projectDir(projectId, root))

  /*
   * Compared against the **shape** the path must have, not against the same
   * expression built twice — which is what this was at first, and a check that
   * compares a value with itself passes for `../..` as happily as for a name.
   */
  if (dirname(directory) !== normalize(projectsDir(root)) || basename(directory) !== projectId) {
    throw new ProjectValidationError(
      'projectPathEscapes',
      { id: projectId },
      `${projectId} is not a project id.`
    )
  }

  await rm(directory, { recursive: true, force: true })
}
