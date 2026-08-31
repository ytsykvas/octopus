/**
 * A project's variables, in named sets.
 *
 * One block of overrides was enough while a project had one environment. It is
 * not: the worked example is a checkout whose `.env` carries a dev section and
 * a production section and switches between them by commenting one out. octopus
 * writes its block **last**, so whichever it holds is the one that wins — and a
 * copy taken while the file was on production quietly pointed every workspace
 * at production, past a setup script written specifically to prevent that.
 *
 * So a project keeps several sets, one is its default, and a workspace may sit
 * on another. Which is also the half of the arrangement a repository can never
 * supply: these are credentials, they stay on this machine, and that is what
 * makes "the repository decides what runs, the machine decides what it runs
 * against" true rather than aspirational.
 *
 * The text of a block — checking it, filling in `$OCTOPUS_*` — is `envBlock.ts`.
 * Writing it into a workspace is `env.ts`. This module is the files.
 */

import { readdir, readFile, rename, rm } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'

import { z } from 'zod'

import { projectEnv, projectEnvProfile, projectEnvsDir } from './paths.js'
import { writeTextFile } from './persist.js'
import type { Project, Workspace } from './store.js'
import type { ProjectId } from './types.js'

/**
 * The name a project's first set of variables is given.
 *
 * Chosen so `ProjectSchema.envProfile` can default to it: a project record
 * written before profiles existed then reads back pointing at exactly the file
 * the migration created, and no record needs migrating at all.
 */
export const DEFAULT_PROFILE = 'default'

/**
 * What a profile may be called.
 *
 * It becomes a filename, so this is a boundary rather than a label. Lowercase
 * is part of it because macOS filesystems are case-insensitive by default:
 * `Prod` and `prod` would be one file under two names in `state.json`, and
 * whichever the app wrote last would be what both resolved to.
 */
export const ProfileNameSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/u)

/** They carry credentials, so they are readable by their owner and nobody else. */
const MODE = 0o600

/**
 * And the directory too.
 *
 * At `0755` the *names* are world-readable, and "prod" is information about
 * this machine even when its contents are not.
 */
const DIR_MODE = 0o700

export type EnvProfileCode = 'envProfileExists' | 'envProfileName' | 'envProfileMissing'

export class EnvProfileError extends Error {
  constructor(
    readonly code: EnvProfileCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'EnvProfileError'
  }
}

/** Refuses a name that could not be a file in that directory. */
function assertName(name: string): void {
  if (!ProfileNameSchema.safeParse(name).success) {
    throw new EnvProfileError('envProfileName', { name }, `${name} is not a profile name.`)
  }
}

/**
 * Gives a project the `envs/` directory, moving its single `env` file into it.
 *
 * The directory **is** the version marker — its presence is what says the move
 * has happened — so no field is added to any record for this.
 *
 * `rename` rather than read-and-write. It is atomic within one filesystem, so
 * this credential file is never briefly absent and never briefly duplicated;
 * copy-and-leave would park a second `0600` file of stale secrets on disk that
 * nothing in the app ever mentions again.
 *
 * Answers with whether it did anything, which is what a test asks.
 */
export async function migrateEnvProfiles(projectId: ProjectId, root?: string): Promise<boolean> {
  const directory = projectEnvsDir(projectId, root)

  try {
    await readdir(directory)
    return false
  } catch {
    // Not there yet, which is the whole of what this function is for.
  }

  await mkdir(directory, { recursive: true, mode: DIR_MODE })

  try {
    await rename(projectEnv(projectId, root), profilePath(projectId, DEFAULT_PROFILE, root))
  } catch {
    // A project that never wrote any variables has none to move.
  }

  return true
}

function profilePath(projectId: ProjectId, name: string, root?: string): string {
  return projectEnvProfile(projectId, name, root)
}

/**
 * The names a project has, sorted.
 *
 * Filtered by the schema rather than listed raw: `writeTextFile` writes its
 * temporary file as a sibling, so a crash between write and rename leaves a
 * `prod.tmp` in here — and a name with a `.` in it is not one this accepts.
 */
export async function listProfiles(projectId: ProjectId, root?: string): Promise<string[]> {
  try {
    const entries = await readdir(projectEnvsDir(projectId, root))
    return entries.filter((entry) => ProfileNameSchema.safeParse(entry).success).sort()
  } catch {
    return []
  }
}

/**
 * One profile's body, or an empty string where there is none.
 *
 * The same contract the single file had: no template, because a variable
 * nobody wrote has no value worth guessing at and a placeholder would end up in
 * a real `.env`.
 */
export async function readProfile(
  projectId: ProjectId,
  name: string,
  root?: string
): Promise<string> {
  try {
    return await readFile(profilePath(projectId, name, root), 'utf8')
  } catch {
    return ''
  }
}

export async function writeProfile(
  projectId: ProjectId,
  name: string,
  contents: string,
  root?: string
): Promise<void> {
  assertName(name)
  await mkdir(projectEnvsDir(projectId, root), { recursive: true, mode: DIR_MODE })
  await writeTextFile(profilePath(projectId, name, root), contents, MODE)
}

/**
 * Adds a profile, empty or copied from another.
 *
 * One path for both, so the mode and the write live in one place rather than in
 * two that could drift.
 */
export async function createProfile(
  projectId: ProjectId,
  name: string,
  from: string | null,
  root?: string
): Promise<void> {
  assertName(name)

  if ((await listProfiles(projectId, root)).includes(name)) {
    throw new EnvProfileError('envProfileExists', { name }, `${name} already exists.`)
  }

  await writeProfile(
    projectId,
    name,
    from === null ? '' : await readProfile(projectId, from, root),
    root
  )
}

export async function renameProfile(
  projectId: ProjectId,
  from: string,
  to: string,
  root?: string
): Promise<void> {
  assertName(to)
  const existing = await listProfiles(projectId, root)

  if (!existing.includes(from)) {
    throw new EnvProfileError('envProfileMissing', { name: from }, `${from} does not exist.`)
  }
  if (existing.includes(to)) {
    throw new EnvProfileError('envProfileExists', { name: to }, `${to} already exists.`)
  }

  await rename(profilePath(projectId, from, root), profilePath(projectId, to, root))
}

export async function removeProfile(
  projectId: ProjectId,
  name: string,
  root?: string
): Promise<void> {
  assertName(name)
  await rm(profilePath(projectId, name, root), { force: true })
}

/**
 * Which profile a workspace runs with.
 *
 * `null` on a workspace means "follow the project", and it is a third state
 * rather than a copy of the project's value at creation — a copy would silently
 * stop following a project that later moved, with no way to say "follow" again.
 */
export function effectiveProfile(project: Project, workspace: Workspace): string {
  return workspace.envProfile ?? project.envProfile
}

/**
 * The variables that workspace would be written, or none.
 *
 * A profile whose file has gone resolves to nothing — deliberately **not** to
 * the project's default. A workspace pinned to `prod` whose file vanished would
 * otherwise silently receive `dev`, and quietly running against the wrong
 * environment is the failure this whole module exists to prevent. An empty
 * block fails the run loudly, on a variable the app never wrote.
 */
export async function readEffectiveEnv(
  project: Project,
  workspace: Workspace,
  root?: string
): Promise<string> {
  return readProfile(project.id, effectiveProfile(project, workspace), root)
}
