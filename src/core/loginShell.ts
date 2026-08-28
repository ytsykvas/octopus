/**
 * The PATH the user actually has, as opposed to the one a GUI application is
 * given.
 *
 * Launched from Finder, the app inherits launchd's environment, where PATH is
 * roughly `/usr/bin:/bin:/usr/sbin:/sbin`. Homebrew, mise, nvm and every other
 * way `git`, `gh` and `claude` get installed live somewhere only the login
 * shell's profile knows about. Nothing here matters when the app is started
 * from a terminal, which is exactly why it is easy to ship broken: development
 * inherits the right PATH and never sees the problem.
 *
 * The embedded terminal is unaffected — it runs commands through the login
 * shell on purpose (`terminal.ts`). So without this the app can report GitHub
 * as disconnected while its own terminal runs `gh` perfectly well.
 */

import { resolveShell } from './terminal.js'

/** Runs a command and returns its standard output. */
export type LoginShellExec = (file: string, args: readonly string[]) => Promise<string>

/**
 * Wraps the value so it can be found in output that contains anything else.
 *
 * Profiles print things — version managers announce themselves, `fortune` is
 * still out there — and an interactive shell adds whatever the prompt emits.
 * Taking the last line would be a guess; a delimiter is not.
 */
const MARKER = '__OCTOPUS_PATH__'

/**
 * Argv that makes a shell report its PATH.
 *
 * `-l` loads the login profile and `-i` the interactive one, because the two
 * differ and tools install into either: zsh reads `.zprofile` for the first
 * and `.zshrc` for the second, and Homebrew's own instructions write to
 * `.zprofile` while nvm and mise write to `.zshrc`.
 *
 * The command is a constant and the value is expanded by the shell itself
 * rather than interpolated into the string, so nothing user-controlled is
 * being quoted here.
 */
export function loginShellPathArgv(): readonly string[] {
  return ['-ilc', `printf '%s%s%s' '${MARKER}' "$PATH" '${MARKER}'`]
}

/** Pulls the delimited value out of whatever else the profile printed. */
export function extractPath(output: string): string | undefined {
  const opening = output.indexOf(MARKER)
  if (opening === -1) return undefined

  const start = opening + MARKER.length
  const closing = output.indexOf(MARKER, start)
  if (closing === -1) return undefined

  const value = output.slice(start, closing).trim()
  return value.length > 0 ? value : undefined
}

/**
 * The shell's PATH first, then anything inherited that it did not mention.
 *
 * Merged rather than replaced: Electron and launchd contribute entries the
 * shell has never heard of, and dropping them would trade one class of missing
 * binary for another. Order matters — the shell's own entries win, so a user
 * who put a version manager ahead of `/usr/bin` keeps that decision.
 */
export function mergePath(shellPath: string, inherited: string | undefined): string {
  const seen = new Set<string>()
  const merged: string[] = []

  for (const entry of [...shellPath.split(':'), ...(inherited ?? '').split(':')]) {
    const trimmed = entry.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
  }

  return merged.join(':')
}

/**
 * Asks the login shell for its PATH and merges it with the current one.
 *
 * Returns `undefined` when the shell could not be asked or answered with
 * nothing recognisable. A profile that exits non-zero, hangs or prints garbage
 * is a bad reason to refuse to start: the app still runs, and the worst case is
 * the behaviour it already had.
 */
export async function resolveLoginShellPath(
  exec: LoginShellExec,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<string | undefined> {
  let output: string
  try {
    output = await exec(resolveShell(env), loginShellPathArgv())
  } catch {
    return undefined
  }

  const discovered = extractPath(output)
  if (discovered === undefined) return undefined

  return mergePath(discovered, env.PATH)
}
