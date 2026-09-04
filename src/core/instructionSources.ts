/**
 * What a workspace offers the agent, and whether the agent will read it.
 *
 * octopus loads every settings source by default, as the CLI does, so the agent
 * arrives carrying whatever the repository and the user have written for it.
 * That is the point — and it also means nobody can say from inside the app what
 * the agent is working from.
 *
 * Two facts, kept apart on purpose. **Present** is a stat: the file is there.
 * **Loaded** is a claim about the SDK, and it depends on `settingSources`, which
 * the user can narrow to `project` or to nothing at all. Reporting the first
 * under the word "loaded" is how the panel came to be wrong in all three modes
 * at once.
 *
 * Asked about one directory, and **which** directory decides one of the rows.
 * `.claude/settings.local.json` is gitignored by Claude Code's own convention.
 * Read against a checkout, its presence says nothing about the worktree a
 * session runs in — that copy arrives only by being carried, and reporting it
 * as loaded because the checkout has one was a systematic falsehood. Read
 * against the worktree itself, presence is the whole fact: the SDK is pointed
 * at that directory and will read what is in it. `carried` is how the caller
 * says which question it is asking. `chats.ts` already writes the rule down:
 * which commands exist is a fact about a working directory and the branch
 * checked out in it.
 *
 * The first step of the skills feature, too. Once this can say what a project
 * offers, switching individual pieces on and off is a change to the list rather
 * than a new idea.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

import type { SettingSourceName } from './config.js'

/** One thing the agent may pick up, and what is true about it. */
export interface InstructionSource {
  /** Stable name, so the interface can label it in the reader's language. */
  readonly id:
    | 'projectMemory'
    | 'projectSettings'
    | 'localSettings'
    | 'userSettings'
    | 'userMemory'
    | 'commands'
    | 'userCommands'
    | 'agents'
    | 'userAgents'
    | 'skills'
    | 'mcp'
  /** Where it would be, so somebody can go and open it. */
  readonly path: string
  /** It is on disk. */
  readonly present: boolean
  /** The agent will read it — `present`, and its source is switched on. */
  readonly loaded: boolean
  /**
   * How many entries a directory holds, or null for a single file.
   *
   * A directory that exists but is empty is worth telling apart from one that
   * holds twenty commands: both are "present", and only one explains why the
   * agent knows a slash command nobody remembers writing.
   */
  readonly count: number | null
}

/**
 * Which settings source each thing comes from.
 *
 * `project` is what loads `CLAUDE.md`, and it turns out to gate
 * `.claude/commands/` too — measured, not read off the types. `.mcp.json` is
 * read from the working directory on the same footing.
 */
const SOURCE_OF = {
  projectMemory: 'project',
  projectSettings: 'project',
  commands: 'project',
  agents: 'project',
  skills: 'project',
  mcp: 'project',
  localSettings: 'local',
  userSettings: 'user',
  userMemory: 'user',
  userCommands: 'user',
  userAgents: 'user'
} as const satisfies Record<InstructionSource['id'], SettingSourceName>

/** Where the local settings sit, relative to a checkout — and to a worktree. */
const LOCAL_SETTINGS = '.claude/settings.local.json'

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * How many files a directory holds, or null where there is no directory.
 *
 * Files only: `.claude/commands/` may hold subdirectories that group commands,
 * and counting those as commands would overstate what the agent has. Skills are
 * the exception — one is a directory holding a `SKILL.md` — so they are counted
 * by directory instead.
 */
async function countIn(path: string, kind: 'files' | 'directories'): Promise<number | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => (kind === 'files' ? entry.isFile() : entry.isDirectory()))
      .length
  } catch {
    return null
  }
}

/**
 * Everything the agent working in this directory may load.
 *
 * `carried` says what `cwd` is. **`null` means it is the directory the session
 * runs in**, so a gitignored file being there is the fact and needs no further
 * evidence. An array means `cwd` is the project's checkout, and the array is
 * the carry list — the only way such a file reaches the worktree from there.
 *
 * Compared normalised, because the list is typed by hand: `./.claude/…` names
 * the same destination as `.claude/…`, is copied correctly by `join`, and
 * would otherwise be reported as a file the worktree does not have.
 *
 * `home` is a parameter for the same reason it is one in `paths.ts`: a test that
 * needed the real home directory would be testing the machine it runs on.
 */
export async function instructionSources(
  cwd: string,
  sources: readonly SettingSourceName[],
  carried: readonly string[] | null = [],
  home: string = homedir()
): Promise<InstructionSource[]> {
  const claude = join(cwd, '.claude')
  const userClaude = join(home, '.claude')

  const files = [
    { id: 'projectMemory', path: join(cwd, 'CLAUDE.md') },
    { id: 'projectSettings', path: join(claude, 'settings.json') },
    { id: 'localSettings', path: join(cwd, LOCAL_SETTINGS) },
    { id: 'mcp', path: join(cwd, '.mcp.json') },
    { id: 'userSettings', path: join(userClaude, 'settings.json') },
    { id: 'userMemory', path: join(userClaude, 'CLAUDE.md') }
  ] as const

  const directories = [
    { id: 'commands', path: join(claude, 'commands'), holds: 'files' },
    { id: 'agents', path: join(claude, 'agents'), holds: 'files' },
    { id: 'skills', path: join(claude, 'skills'), holds: 'directories' },
    { id: 'userCommands', path: join(userClaude, 'commands'), holds: 'files' },
    { id: 'userAgents', path: join(userClaude, 'agents'), holds: 'files' }
  ] as const

  const on = (id: InstructionSource['id'], present: boolean): boolean => {
    if (!present || !sources.includes(SOURCE_OF[id])) return false

    // The one row that depends on which directory was asked about. In the
    // worktree itself presence is the answer; from the checkout the file is
    // gitignored, so it reaches a workspace only by being on the carry list.
    if (id === 'localSettings' && carried !== null) {
      return carried.some((file) => normalize(file) === LOCAL_SETTINGS)
    }

    return true
  }

  return [
    ...(await Promise.all(
      files.map(async ({ id, path }) => {
        const present = await fileExists(path)
        return { id, path, present, loaded: on(id, present), count: null }
      })
    )),
    ...(await Promise.all(
      directories.map(async ({ id, path, holds }) => {
        const count = await countIn(path, holds)
        const present = count !== null
        return { id, path, present, loaded: on(id, present), count }
      })
    ))
  ]
}
