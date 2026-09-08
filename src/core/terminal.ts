/**
 * Terminal session descriptions.
 *
 * The pseudo-terminals themselves live in `main/` — they are process
 * resources, like windows. What stays here is the pure part: what to run,
 * where, and with which environment, so those decisions are testable without
 * spawning anything (§11.1 docs/PROJECT.md).
 */

import { join } from 'node:path'

import { z } from 'zod'

/** Identifies a live terminal session. */
export type TerminalId = string

/**
 * What a session is for, in the words a reader would use.
 *
 * The three script kinds are the project's own; `shell` is the workspace's
 * terminal tab; `auth` is the sign-in flow in Settings, which belongs to no
 * workspace at all.
 */
export const TerminalPurposeSchema = z.enum(['shell', 'setup', 'run', 'archive', 'auth'])
export type TerminalPurpose = z.infer<typeof TerminalPurposeSchema>

/**
 * Whose session this is.
 *
 * Chosen by the renderer and kept beside the pty, because `main` cannot work it
 * out: a spec is a working directory and an argv, and neither says which
 * workspace's tab asked for it or what the reader would call it.
 *
 * The reason it exists is that nothing could **see** what was running. A pty
 * nobody claims keeps a shell alive, holds a port, and for a dev server goes on
 * writing to a file nobody reads — and the symptom that reaches the user is
 * somebody else's tool saying "a server is already running". A list with no
 * names on it would say a number and nothing else.
 */
export const TerminalOwnerSchema = z.object({
  /** Null for a session that belongs to no workspace, which is the sign-in one. */
  workspaceId: z.string().nullable().default(null),
  purpose: TerminalPurposeSchema.default('shell')
})
export type TerminalOwner = z.infer<typeof TerminalOwnerSchema>

export const TerminalSpecSchema = z.object({
  /**
   * Whose session it is, for the list that says what is still running.
   *
   * Defaulted rather than required, so a caller that has nothing useful to say
   * about ownership still starts a session — an unnamed one on the list is a
   * worse answer than no session, and a refusal here would be the worst of the
   * three.
   */
  owner: TerminalOwnerSchema.default({ workspaceId: null, purpose: 'shell' }),
  /** Working directory for the shell. */
  cwd: z.string().min(1),
  /**
   * Command to run instead of an interactive shell.
   * Empty means a plain shell session.
   */
  command: z.array(z.string()).default([]),
  /**
   * A command line to run instead of `command`, when there is one.
   *
   * The two are not the same thing and cannot be. `command` is an argv and is
   * quoted on the way to the shell, because a script's path contains a project
   * id taken from a repository's directory name. A command line is the
   * opposite: it comes from a repository's own settings, where
   * `-p $CONDUCTOR_PORT` means what a shell would make of it, and quoting it
   * would turn the whole line into the name of a program.
   *
   * So this is deliberately **not** quoted, and nothing may put it here that a
   * person has not read and approved — `repoSource.ts` is where that is
   * arranged.
   */
  commandLine: z.string().max(8_000).default(''),
  cols: z.number().int().min(1).max(1000).default(80),
  rows: z.number().int().min(1).max(1000).default(24),
  /**
   * Extra environment for the session.
   *
   * How `run.sh` learns its port. Passed as environment rather than as an
   * argument so the script can be run by hand outside the app and behave the
   * same, with `OCTOPUS_PORT=3123 ./run.sh`.
   */
  env: z.record(z.string(), z.string()).default({})
})

export type TerminalSpec = z.infer<typeof TerminalSpecSchema>

/**
 * One live session, as a list of them draws it.
 *
 * The owner and nothing else of the spec: a list exists so somebody can see
 * what is still running and end it, and the argv is neither their question nor
 * theirs to read — a command line comes from a repository's own settings and
 * putting it on a Settings row would be showing somebody a string a checkout
 * chose.
 */
export interface TerminalSession {
  readonly id: TerminalId
  readonly owner: TerminalOwner
}

/** Data flowing from a session to the UI. */
export interface TerminalOutput {
  readonly id: TerminalId
  readonly data: string
}

/** A session ended; `exitCode` is null when it was killed by a signal. */
export interface TerminalExit {
  readonly id: TerminalId
  readonly exitCode: number | null
}

/**
 * Shell to run.
 *
 * `$SHELL` is what the user actually configured; the fallback matters for
 * environments that do not set it, such as some launchd contexts.
 */
export function resolveShell(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  // A blank SHELL counts as missing, which `??` would not catch.
  const configured = env.SHELL?.trim()
  return configured !== undefined && configured.length > 0 ? configured : '/bin/zsh'
}

/**
 * Expands a leading `~` into the home directory.
 *
 * The shell does this expansion, not the operating system, so a `~` handed to
 * a process as its working directory simply fails to resolve — the session
 * dies immediately with a non-zero exit code and no obvious explanation.
 */
export function resolveCwd(cwd: string, home: string): string {
  if (cwd === '~') return home
  if (cwd.startsWith('~/')) return join(home, cwd.slice(2))
  return cwd
}

/**
 * Wraps one argument so a shell reads it as a single literal word.
 *
 * Single quotes disable every expansion a shell performs, which is the whole
 * point; a single quote inside the value is the one thing they cannot contain,
 * so it is closed, escaped and reopened.
 */
export function shellQuote(argument: string): string {
  return `'${argument.replaceAll("'", "'\\''")}'`
}

/**
 * Turns a spec into the argv a pseudo-terminal should run.
 *
 * A command is executed through the login shell rather than directly, so the
 * user's PATH and shell configuration apply — `gh` and `claude` are usually
 * installed somewhere only the shell profile knows about.
 *
 * Each argument is quoted rather than joined with spaces. The path of a script
 * contains a project id, which comes from a repository's directory name, and
 * `toSlug` lets `;`, `$(`, `|` and `&` through — it only strips what git
 * forbids in a ref. A repository cloned from GitHub brings that name with it,
 * so an unquoted join would run whatever its author put there.
 *
 * `-i` (interactive) is deliberate: both auth flows prompt for input.
 */
export function buildTerminalArgv(spec: TerminalSpec): readonly string[] {
  // A command line first: it is the more specific of the two, and a spec
  // carrying both would otherwise run the argv and drop it in silence.
  if (spec.commandLine !== '') return ['-i', '-c', spec.commandLine]
  if (spec.command.length === 0) return []
  return ['-i', '-c', spec.command.map(shellQuote).join(' ')]
}

/**
 * Environment for a session.
 *
 * `TERM` tells programs which escape sequences the emulator understands;
 * without it many tools fall back to unformatted output or misbehave.
 */
export function buildTerminalEnv(
  base: Readonly<Record<string, string | undefined>> = process.env,
  extra: Readonly<Record<string, string>> = {}
): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) env[key] = value
  }

  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'

  // Applied last: a script's own variables are the specific instruction, and
  // an inherited value of the same name is the general one.
  return { ...env, ...extra }
}
