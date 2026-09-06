/**
 * Single source of truth for every on-disk path.
 *
 * No hardcoded `~/Library` or `/Users/...` — everything goes through
 * `path.join`, so the same build works on macOS and Linux (§11.2).
 *
 * Each function takes its base directory as a parameter with a sensible
 * default, which makes the module testable without mocking the filesystem.
 */

import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, sep } from 'node:path'

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
/**
 * Where an image pasted into the composer is written.
 *
 * The one attachment octopus has to store. A file dragged in or chosen from
 * disk keeps its own path and is never copied — the message carries the path,
 * and copying would put a second copy of somebody's file somewhere they did not
 * put it. A pasted image has no path to carry, because macOS puts a picture on
 * the clipboard rather than a file, so this is where it becomes one.
 *
 * Under `~/.octopus` rather than in a temporary directory, and that is what
 * makes it worth handing to a session as a root: it is ours, it is stable for
 * the life of the app, and a screenshot the agent is about to be asked about
 * should not vanish because the system tidied `/tmp` mid-conversation.
 */
export function attachmentsDir(root: string = rootDir()): string {
  return join(root, 'attachments')
}

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
 * A project's env overrides, before they were named.
 *
 * One file, and the only one there could be. `envProfiles.ts` moves it to
 * `envs/default` the first time it sees it; nothing else refers to this any
 * more, and it stays only so that migration has something to name.
 */
export function projectEnv(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'env')
}

/**
 * Where a project keeps its named sets of variables.
 *
 * `env` rather than `.env` in the names inside it: within our own directory
 * there is nothing to hide from a listing, and a dotfile only makes it harder
 * to find by hand.
 */
export function projectEnvsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'envs')
}

/** One named set, the filename coming from the module that owns the naming. */
export function projectEnvProfile(
  projectId: ProjectId,
  file: string,
  root: string = rootDir()
): string {
  return join(projectEnvsDir(projectId, root), file)
}

/** Directory holding a project's instruction files for the agent. */
export function projectInstructionsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'instructions')
}

/**
 * One of a project's instruction files, named by the caller.
 *
 * The filename comes from `instructions.ts` rather than living here as a
 * function per kind. There are seven of them and each has two scopes, and
 * fourteen near-identical one-line functions is a list to keep in step rather
 * than a boundary — while the map over there is a `Record<InstructionKind,
 * string>`, so a kind without a home is a compile error.
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
 * The directory holding the skills every project of this installation gets.
 *
 * Handed to a session as an extra working-directory root, which is why it is a
 * root with a `.claude/skills` inside it rather than a directory of skills:
 * that is the shape the agent discovers skills in, and discovering them that
 * way is what puts them under the same switch as the checkout's own.
 *
 * A local plugin was the obvious answer and is the wrong one, measured against
 * a live session: a plugin's skills load, and `skillOverrides` does not touch
 * them under any spelling of the key. See `docs/core.md`.
 */
export function globalSkillsRoot(root: string = rootDir()): string {
  return join(root, 'skills')
}

/** The same, for the skills only one project gets. */
export function projectSkillsRoot(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'skills')
}

/** Where the skills themselves sit inside such a root. */
export function skillsDirOf(skillRoot: string): string {
  return join(skillRoot, '.claude', 'skills')
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

/**
 * Whether a path may be joined to a worktree and stay inside it.
 *
 * Relative, and not climbing out with `..`. Three modules asked this and each
 * spelled it itself — the carry list over every destination it reads, the env
 * file on its way into a project, and the revert path arriving from the
 * renderer. Each was correct, and none of them could be fixed once: a Windows
 * drive letter or a normalisation case `normalize` treats differently would
 * have landed in one of three places with nothing pointing at the other two.
 *
 * Lexical only, and deliberately so — it answers about a string, not about a
 * filesystem. `unlinkedInside` is the question to ask before writing.
 *
 * What the three callers do with the answer is still their own: the carry list
 * drops the line, `updateProject` refuses, and `RevertPathSchema` rejects at the
 * boundary. The rule is shared; the reaction to it is not.
 */
export function insideWorktree(path: string): boolean {
  if (path === '') return false
  return !isAbsolute(path) && !normalize(path).startsWith('..')
}

/**
 * Whether a path can be joined to a root without a link redirecting it.
 *
 * `insideWorktree` answers about a string; this answers about the filesystem
 * under it, and the two are not the same question. A checkout can track a
 * symlinked directory — `config -> ../shared` is ordinary in a monorepo — and a
 * worktree materialises it verbatim, so `config/master.key` passes the textual
 * rule and still resolves outside the worktree.
 *
 * Every segment, not only the last, and that distinction is the whole of the
 * guarantee: `lstat` does not follow the final component but does follow the
 * ones before it, so checking the file alone leaves a symlinked directory free
 * to redirect the write. `repoConfig.ts` learned this the same way and says so
 * above `assertUnlinkedPath`.
 *
 * An absent segment answers true. The destination is usually a file that does
 * not exist yet, and nothing that is not there can redirect anything.
 */
export async function unlinkedInside(root: string, path: string): Promise<boolean> {
  let walked = root

  for (const segment of path.split(sep)) {
    walked = join(walked, segment)

    try {
      if ((await lstat(walked)).isSymbolicLink()) return false
    } catch {
      return true
    }
  }

  return true
}

/**
 * Whether a path that exists resolves to somewhere under the root.
 *
 * The third question in this family, and the only one that follows links rather
 * than refusing them. `insideWorktree` answers about a string and
 * `unlinkedInside` refuses a link outright — which is right before a *write*,
 * where a link is a redirection nobody asked for, and wrong before a *read* of
 * something already committed: `hooks/format.sh -> ../../tools/format.sh` is an
 * ordinary shape in a monorepo, and the file it names is in the worktree, so
 * reading it shows the worktree's own bytes.
 *
 * Both ends are resolved, because the root can itself be reached through a link
 * — `/var` is `/private/var` on macOS, so comparing an unresolved root against a
 * resolved target answers false for every path under it.
 *
 * The separator is appended before the prefix test. Without it a sibling named
 * `<root>-next-door` reads as being inside `<root>`.
 *
 * Absent answers **false**, the opposite of `unlinkedInside`. There the
 * destination is a file about to be created and nothing that is not there can
 * redirect anything; here there is nothing to read, and a link pointing at
 * nothing is one that cannot be vouched for.
 */
export async function resolvesInside(root: string, path: string): Promise<boolean> {
  try {
    const real = await realpath(root)
    const resolved = await realpath(join(root, path))

    return resolved === real || resolved.startsWith(real + sep)
  } catch {
    return false
  }
}
