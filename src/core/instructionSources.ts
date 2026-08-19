/**
 * What a checkout and this machine offer the agent.
 *
 * octopus loads every settings source, as the CLI does, so the agent arrives
 * carrying whatever the repository and the user have written for it. That is
 * the point — and it also means nobody can say from inside the app what the
 * agent is working from.
 *
 * This answers that by looking, not by guessing: the files are read off disk
 * rather than asked of the SDK, so the list is the same whether a session is
 * running or not.
 *
 * The first step of the skills feature, too. Once this can say what a project
 * offers, switching individual pieces on and off is a change to the list rather
 * than a new idea.
 */

import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One thing the agent may pick up, and whether it is actually there. */
export interface InstructionSource {
  /** Stable name, so the interface can label it in the reader's language. */
  readonly id:
    | 'projectMemory'
    | 'projectSettings'
    | 'localSettings'
    | 'userSettings'
    | 'userMemory'
    | 'commands'
    | 'agents'
  /** Where it would be, so somebody can go and open it. */
  readonly path: string
  readonly present: boolean
  /**
   * How many entries a directory holds, or null for a single file.
   *
   * A directory that exists but is empty is worth telling apart from one that
   * holds twenty commands: both are "present", and only one explains why the
   * agent knows a slash command nobody remembers writing.
   */
  readonly count: number | null
}

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
 * and counting those as commands would overstate what the agent has.
 */
async function fileCount(path: string): Promise<number | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).length
  } catch {
    return null
  }
}

/**
 * Everything the agent working in this checkout may load.
 *
 * `home` is a parameter for the same reason it is one in `paths.ts`: a test
 * that needed the real home directory would be testing the machine it runs on.
 */
export async function instructionSources(
  repoPath: string,
  home: string = homedir()
): Promise<InstructionSource[]> {
  const claude = join(repoPath, '.claude')
  const userClaude = join(home, '.claude')

  const files = [
    { id: 'projectMemory', path: join(repoPath, 'CLAUDE.md') },
    { id: 'projectSettings', path: join(claude, 'settings.json') },
    { id: 'localSettings', path: join(claude, 'settings.local.json') },
    { id: 'userSettings', path: join(userClaude, 'settings.json') },
    { id: 'userMemory', path: join(userClaude, 'CLAUDE.md') }
  ] as const

  const directories = [
    { id: 'commands', path: join(claude, 'commands') },
    { id: 'agents', path: join(claude, 'agents') }
  ] as const

  return [
    ...(await Promise.all(
      files.map(async ({ id, path }) => ({
        id,
        path,
        present: await fileExists(path),
        count: null
      }))
    )),
    ...(await Promise.all(
      directories.map(async ({ id, path }) => {
        const count = await fileCount(path)
        return { id, path, present: count !== null, count }
      })
    ))
  ]
}
