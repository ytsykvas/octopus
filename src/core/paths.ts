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

import type { ChatId, ProjectId, WorkspaceId } from './types.js'

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

/** Where every project's own directory sits: `~/.octopus/projects`. */
export function projectsDir(root: string = rootDir()): string {
  return join(root, 'projects')
}

/** Project metadata directory: `~/.octopus/projects/<projectId>`. */
export function projectDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectsDir(root), projectId)
}

/** Directory holding a project's scripts. */
export function projectScriptsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'scripts')
}

/**
 * The list of files a project carries into every new workspace.
 *
 * Beside the env it replaces: a worktree holds what git tracks and nothing
 * else, and this is how the rest gets there.
 */
export function projectCarry(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'carry')
}

/**
 * A project's env overrides, written last into every workspace's `.env`.
 *
 * `env` rather than `.env`: inside our own directory there is nothing to hide
 * from a listing, and a dotfile only makes it harder to find by hand.
 */
export function projectEnv(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'env')
}

/** Directory holding a project's instruction files for the agent. */
export function projectInstructionsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'instructions')
}

/**
 * One of a project's instruction files, named by the caller.
 *
 * The filename comes from `instructions.ts` rather than living here as a
 * function per kind. There are five of them and each has two scopes, and ten
 * near-identical one-line functions is a list to keep in step rather than a
 * boundary — while the map over there is a `Record<InstructionKind, string>`,
 * so a sixth kind without a home is a compile error.
 */
export function projectInstruction(
  projectId: ProjectId,
  file: string,
  root: string = rootDir()
): string {
  return join(projectInstructionsDir(projectId, root), file)
}

/**
 * The same instructions, for every project that has not written its own.
 *
 * Beside the projects rather than inside one: it belongs to the installation,
 * and a copy under `projects/` would be a project called nothing.
 */
export function globalInstructionsDir(root: string = rootDir()): string {
  return join(root, 'instructions')
}

export function globalInstruction(file: string, root: string = rootDir()): string {
  return join(globalInstructionsDir(root), file)
}

/**
 * One of a project's scripts, named by the caller.
 *
 * A function per kind used to live here, each holding its own filename. The
 * names then had to be repeated wherever else a script is written — the
 * repository copy needs the same three — and a name is a fact about the kind,
 * which `scripts.ts` owns. So this takes the filename, exactly as
 * `projectInstruction` above does, and `SCRIPT_FILES` is the single list.
 */
export function projectScript(
  projectId: ProjectId,
  file: string,
  root: string = rootDir()
): string {
  return join(projectScriptsDir(projectId, root), file)
}

/** Directory holding every chat transcript. */
export function chatsDir(root: string = rootDir()): string {
  return join(root, 'chats')
}

/**
 * One chat's transcript: `~/.octopus/chats/<chatId>.jsonl`.
 *
 * Flat rather than nested under the project, because a chat outlives the
 * workspace name it started under — renaming a workspace would otherwise
 * either move the file or leave it filed under a name nothing refers to.
 */
export function chatTranscript(chatId: ChatId, root: string = rootDir()): string {
  return join(chatsDir(root), `${chatId}.jsonl`)
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
