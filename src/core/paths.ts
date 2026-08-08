/**
 * Single source of truth for every on-disk path.
 *
 * No hardcoded `~/Library` or `/Users/...` — everything goes through
 * `path.join`, so the same build works on macOS and Linux (§11.2).
 *
 * Each function takes its base directory as a parameter with a sensible
 * default, which makes the module testable without mocking the filesystem.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId, WorkspaceId } from './types.js'

const ROOT_DIR_NAME = '.octopus'

/** Application data root: `~/.octopus`. */
export function rootDir(home: string = homedir()): string {
  return join(home, ROOT_DIR_NAME)
}

/** Global settings: `~/.octopus/config.json`. */
export function configFile(root: string = rootDir()): string {
  return join(root, 'config.json')
}

/** Workspace state: `~/.octopus/state.json`. */
export function stateFile(root: string = rootDir()): string {
  return join(root, 'state.json')
}

/**
 * Temporary file used for atomic state writes.
 * Content is written here, then renamed, so a crash cannot leave a
 * truncated `state.json` behind (§11.2).
 */
export function stateTempFile(root: string = rootDir()): string {
  return join(root, 'state.json.tmp')
}

/** Project metadata directory: `~/.octopus/projects/<projectId>`. */
export function projectDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(root, 'projects', projectId)
}

/** Directory holding a project's scripts. */
export function projectScriptsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'scripts')
}

/** Directory holding a project's instruction files for the agent. */
export function projectInstructionsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'instructions')
}

/** How the agent should write a pull request description for this project. */
export function pullRequestInstruction(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectInstructionsDir(projectId, root), 'pull-request.md')
}

/** Script run right after `git worktree add`. */
export function setupScript(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectScriptsDir(projectId, root), 'setup.sh')
}

/** Script that starts the dev server; receives `$OCTOPUS_PORT`. */
export function runScript(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectScriptsDir(projectId, root), 'run.sh')
}

/** Directory holding every workspace of a project. */
export function workspacesDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(root, 'workspaces', projectId)
}

/** A single workspace directory — also the root of its git worktree. */
export function workspacePath(
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  root: string = rootDir()
): string {
  return join(workspacesDir(projectId, root), workspaceId)
}
