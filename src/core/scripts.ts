/**
 * Per-project shell scripts (§12.2).
 *
 * Two of them: `setup.sh` prepares a workspace — installing dependencies and
 * whatever else a fresh checkout needs — and `run.sh` starts the dev server,
 * receiving the workspace's port as `$OCTOPUS_PORT`.
 *
 * Copying the env is deliberately not among them any more: `env.ts` writes it
 * into every workspace that lacks one, which is what made the first line of
 * nearly every setup script unnecessary.
 *
 * They are plain shell files on disk rather than a string in the config. A
 * build step grows conditionals and loops soon enough, and a text field is a
 * poor place to keep one; a file can also be run, read and edited outside the
 * app, which is the point of not owning the workflow (§4).
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { projectScript, projectScriptsDir } from './paths.js'
import { PORT_VARIABLE, ROOT_VARIABLE, WORKSPACE_VARIABLE } from './scriptEnv.js'
import type { ProjectId } from './types.js'

export const ScriptKindSchema = z.enum(['setup', 'run', 'archive'])
export type ScriptKind = z.infer<typeof ScriptKindSchema>

/**
 * A script body as accepted from the renderer.
 *
 * Bounded because it lands in an executable file: there is no legitimate
 * setup script measured in megabytes, and a size limit is cheaper than
 * discovering the disk filled up.
 */
export const ScriptBodySchema = z.string().max(64_000)

/**
 * Starting point for a script that has never been written.
 *
 * A comment rather than an empty file: the first thing anyone needs to know is
 * which directory it runs in and, for the server, where the port comes from.
 */
const TEMPLATES: Record<ScriptKind, string> = {
  setup: `#!/bin/sh
# Runs in a new workspace directory, once its worktree exists.
# Use it for whatever a fresh checkout needs before work can start.
#
# $${ROOT_VARIABLE} is the project's own checkout — where anything gitignored
# still lives — and $${WORKSPACE_VARIABLE} is this workspace's name, for
# giving it a database or a directory of its own.

# npm install
# createdb "myapp_$${WORKSPACE_VARIABLE}"
`,
  archive: `#!/bin/sh
# Runs when this workspace is removed, in its directory, while it still exists.
#
# Use it to take back whatever the setup script gave out — a database, a
# container, a directory named after the workspace. Nothing here can stop the
# removal: a workspace you cannot delete is worse than one that left something
# behind.

# dropdb --if-exists "myapp_$${WORKSPACE_VARIABLE}"
`,
  run: `#!/bin/sh
# Starts the dev server for this workspace.
# $${PORT_VARIABLE} is set for you — each workspace gets its own port, so
# several can run at once. Nine more come with it, $${PORT_VARIABLE}_1 through
# $${PORT_VARIABLE}_9, for whatever else this stack needs to listen on.

# npm run dev -- --port "$${PORT_VARIABLE}"
`
}

/**
 * What each script is called on disk.
 *
 * Exported because a project may also carry these three in its repository,
 * under `.octopus/scripts/`, and the copy there has to be the same file. One
 * list, so the two places cannot drift into disagreeing about a name.
 */
export const SCRIPT_FILES: Record<ScriptKind, string> = {
  setup: 'setup.sh',
  run: 'run.sh',
  archive: 'archive.sh'
}

export function scriptPath(kind: ScriptKind, projectId: ProjectId, root?: string): string {
  return projectScript(projectId, SCRIPT_FILES[kind], root)
}

/**
 * A script's contents, or the template when it does not exist yet.
 *
 * A missing script is the normal state of a new project, not a failure, so it
 * reads as an editable starting point rather than an error.
 */
export async function readScript(
  kind: ScriptKind,
  projectId: ProjectId,
  root?: string
): Promise<string> {
  try {
    return await readFile(scriptPath(kind, projectId, root), 'utf8')
  } catch {
    return TEMPLATES[kind]
  }
}

/**
 * Writes a script and makes it executable.
 *
 * The executable bit matters: the script is run directly, and a file saved
 * without it fails with "permission denied" — a message that says nothing
 * about what actually needs doing.
 */
export async function writeScript(
  kind: ScriptKind,
  projectId: ProjectId,
  contents: string,
  root?: string
): Promise<void> {
  const path = scriptPath(kind, projectId, root)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
  await chmod(path, 0o755)
}

/** Whether a script has been written for this project. */
export async function scriptExists(
  kind: ScriptKind,
  projectId: ProjectId,
  root?: string
): Promise<boolean> {
  try {
    await readFile(scriptPath(kind, projectId, root), 'utf8')
    return true
  } catch {
    return false
  }
}

/** Directory holding both scripts — shown so they can be edited outside too. */
export function scriptsDirectory(projectId: ProjectId, root?: string): string {
  return projectScriptsDir(projectId, root)
}
