import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { type LoginShellExec, resolveLoginShellPath } from '../core/loginShell.js'

const run = promisify(execFile)

/**
 * A profile that waits for input would otherwise hold up the launch behind it,
 * and there is no user to answer it — nothing is on screen yet.
 */
const TIMEOUT_MS = 5_000

const spawnShell: LoginShellExec = async (file, args) => {
  const { stdout } = await run(file, [...args], { timeout: TIMEOUT_MS })
  return stdout
}

/**
 * Gives this process the PATH the user actually has.
 *
 * The decision of what that PATH should be belongs to `core/loginShell.ts` and
 * is pure; only the two effects live here — spawning the shell, and writing to
 * the ambient environment every child process will inherit.
 *
 * Leaves the environment untouched when the shell could not be asked, so a
 * broken profile costs the startup a few milliseconds and nothing else.
 */
export async function applyLoginShellPath(
  env: Record<string, string | undefined> = process.env,
  exec: LoginShellExec = spawnShell
): Promise<void> {
  const merged = await resolveLoginShellPath(exec, env)
  if (merged !== undefined) env.PATH = merged
}
