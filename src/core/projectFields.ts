/**
 * The two project fields a repository's `.octopus/project.json` decides live:
 * the base branch and the env file.
 *
 * The rest of that file — name, icon, colour — is how one person tells their
 * projects apart, so it is taken once when a project is added and is theirs
 * after that. These two are facts about the repository: which branch work is
 * cut from and reviewed against, and which file its stack reads its variables
 * from. A team that changes either changes it for everybody, and a clone made
 * yesterday should not go on branching from the old one.
 *
 * Read from the **checkout**, never from a worktree: a feature branch carrying
 * its own `project.json` could otherwise point its own pull request at a base
 * of its choosing.
 *
 * And each is checked before it is believed, because neither came from the
 * app's own pickers:
 *
 * - a base branch the checkout does not have would surface much later as a
 *   `worktree add` failure that says nothing about settings;
 * - the env file is where octopus writes credentials, so one that git would
 *   commit — a tracked `config/app.yml`, say — would publish them. Only a file
 *   git ignores is taken; otherwise the project's own stands, and the window
 *   says why.
 */

import { anyBranchExists, type GitExec, isIgnored } from './git.js'
import { insideWorktree } from './paths.js'
import type { RepoProject } from './repoConfig.js'
import type { SourceWarning } from './sourceItems.js'

/** Why a field the repository states is not the one in effect. */
export type FieldWarning = SourceWarning

/** One field, as it stands. */
export interface FieldSource {
  /** The value in effect. */
  readonly value: string
  readonly layer: 'repository' | 'project'
  /** What the repository states, or null where it states nothing. */
  readonly repository: string | null
  /** The project's own value, which is always there. */
  readonly project: string
  readonly warning: FieldWarning | null
}

export interface ProjectFields {
  readonly baseBranch: FieldSource
  readonly envFile: FieldSource
}

/** What the resolution needs to know about the project. */
export interface FieldsOf {
  readonly baseBranch: string
  readonly envFile: string
  /** Whether the user chose their own over the repository's, per field. */
  readonly preferBaseBranch: boolean
  readonly preferEnvFile: boolean
  /**
   * Whether the repository is trusted (`trustRepository`).
   *
   * Both fields decide things the user did not write — which branch work is
   * cut from, and where credentials are written — so a repository's word is
   * taken only once it is believed, as its scripts and hooks are. Until then
   * the project's own stand and the window shows the repository's as waiting.
   */
  readonly trusted: boolean
}

function own(
  project: string,
  repository: string | null,
  warning: FieldWarning | null
): FieldSource {
  return { value: project, layer: 'project', repository, project, warning }
}

async function baseBranchOf(
  stated: string | undefined,
  project: FieldsOf,
  exec: GitExec,
  unreadable: boolean
): Promise<FieldSource> {
  if (stated === undefined || project.preferBaseBranch) {
    return own(project.baseBranch, stated ?? null, unreadable ? 'projectFileUnreadable' : null)
  }

  if (!project.trusted) return own(project.baseBranch, stated, 'repositoryNotTrusted')

  if (!(await anyBranchExists(exec, stated))) {
    return own(project.baseBranch, stated, 'baseBranchMissing')
  }

  return {
    value: stated,
    layer: 'repository',
    repository: stated,
    project: project.baseBranch,
    warning: null
  }
}

async function envFileOf(
  stated: string | undefined,
  project: FieldsOf,
  exec: GitExec,
  unreadable: boolean
): Promise<FieldSource> {
  if (stated === undefined || project.preferEnvFile) {
    return own(project.envFile, stated ?? null, unreadable ? 'projectFileUnreadable' : null)
  }

  if (!project.trusted) return own(project.envFile, stated, 'repositoryNotTrusted')

  if (!insideWorktree(stated)) return own(project.envFile, stated, 'envFileOutside')
  if (!(await isIgnored(exec, stated))) return own(project.envFile, stated, 'envFileNotIgnored')

  return {
    value: stated,
    layer: 'repository',
    repository: stated,
    project: project.envFile,
    warning: null
  }
}

/**
 * What the checkout states, or nothing, or that it could not be read.
 *
 * `stated` is `'unreadable'` for a `project.json` that could not be read —
 * malformed, or behind a link — which is not the same as a repository stating
 * nothing: the project's own values stand either way, but the window says why.
 */
export type Stated = RepoProject | null | 'unreadable'

function unpack(stated: Stated): { readonly fields: RepoProject; readonly unreadable: boolean } {
  return {
    fields: stated === null || stated === 'unreadable' ? {} : stated,
    unreadable: stated === 'unreadable'
  }
}

/*
 * Each field on its own as well as both together, because each costs git a
 * question the other does not need — a branch lookup for the base, a
 * `check-ignore` for the env file — and most readers want one: the base to
 * diff against, the env file to write into. Asking for both on every read put
 * a `check-ignore` on every base resolution, twice a turn.
 */

/** The base branch in effect. */
export function resolveBaseBranch(
  stated: Stated,
  project: FieldsOf,
  exec: GitExec
): Promise<FieldSource> {
  const { fields, unreadable } = unpack(stated)
  return baseBranchOf(fields.baseBranch, project, exec, unreadable)
}

/** The env file in effect. */
export function resolveEnvFile(
  stated: Stated,
  project: FieldsOf,
  exec: GitExec
): Promise<FieldSource> {
  const { fields, unreadable } = unpack(stated)
  return envFileOf(fields.envFile, project, exec, unreadable)
}

/** Both fields, from what the checkout states and what the project holds. */
export async function resolveProjectFields(
  stated: Stated,
  project: FieldsOf,
  exec: GitExec
): Promise<ProjectFields> {
  const [baseBranch, envFile] = await Promise.all([
    resolveBaseBranch(stated, project, exec),
    resolveEnvFile(stated, project, exec)
  ])

  return { baseBranch, envFile }
}
