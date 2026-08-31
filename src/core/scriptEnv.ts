/**
 * The environment a workspace script runs with.
 *
 * Its own module, and deliberately importing nothing Node-only, because the
 * renderer needs the **value** — it builds the spec it hands to `terminal:create`.
 * `scripts.ts` reaches `node:fs`, `node:path` and `paths.ts`'s `node:os`, and
 * `ports.ts` opens sockets; importing a function out of either broke the window
 * at runtime while every check stayed green (§ CLAUDE.md, "the rule in the other
 * direction").
 *
 * So the names and the arithmetic live here, where nothing can drag a Node
 * built-in into the browser behind them.
 */

import type { ScriptKind } from './scripts.js'

/**
 * The three kinds, in the order they are run and shown.
 *
 * Here rather than beside `ScriptKindSchema`, which lives in a module that
 * reaches `node:fs` — the renderer needs this as a **value** and importing it
 * from there would drag `node:os` into the browser behind it. That is not
 * hypothetical: it happened, every check stayed green, and the window failed at
 * runtime (§ CLAUDE.md, "the rule in the other direction").
 */
export const SCRIPT_KINDS: readonly ScriptKind[] = ['setup', 'run', 'archive']

/** Environment variable carrying the port `run.sh` should listen on. */
export const PORT_VARIABLE = 'OCTOPUS_PORT'

/**
 * Where the project's own checkout is, and what this workspace is called.
 *
 * A script runs inside a worktree, which is a copy of the repository and not
 * the repository: anything gitignored is missing, and the path back is not
 * something a script can work out — `../../` is our own data directory, not the
 * user's code. Without these a setup script can only hard-code an absolute
 * path, which then breaks on every other machine.
 *
 * The name is what a script needs to give this workspace something of its own:
 * a database, a container, a directory. Conductor's equivalents are
 * `CONDUCTOR_ROOT_PATH` and `CONDUCTOR_WORKSPACE_NAME`.
 */
export const ROOT_VARIABLE = 'OCTOPUS_ROOT_PATH'
export const WORKSPACE_VARIABLE = 'OCTOPUS_WORKSPACE_NAME'

/** The same name in a form an identifier can hold. */
export const SLUG_VARIABLE = 'OCTOPUS_WORKSPACE_SLUG'

/**
 * How much of the name a slug keeps.
 *
 * Postgres truncates an identifier at 63 characters and does it silently, so
 * the limit has to leave room for whatever prefix a script puts in front. The
 * worked example is `new_hylab_planer_development_`, which is 29: 29 + 30 fits
 * and 29 + 40 does not.
 *
 * Cutting shorter than every consumer is the safe direction. A repository whose
 * own shell script cuts at 40 re-cuts a slug of 30 to no effect, so the two
 * agree; the other way round they disagree about a database name, and only for
 * the long names nobody tests with.
 */
export const SLUG_MAX_LENGTH = 30

/**
 * A workspace's name as something that can be part of a database name.
 *
 * `$OCTOPUS_WORKSPACE_NAME` is the label as typed — renaming only trims it — so
 * it may hold spaces, capitals and punctuation. A script can slugify what it is
 * given, but the env block is static text with no shell around it, and
 * `MYAPP_DB=myapp_development_$OCTOPUS_WORKSPACE_NAME` writes
 * `myapp_development_Fix login bug` the moment somebody renames a workspace to
 * a sentence. dotenv then reads the value up to the first space and nothing
 * says so.
 *
 * The rule is the one the shell pipelines in Conductor's own setup scripts use
 * — lowercase, every other character to `_`, truncate — so a slug built here
 * and a slug built there are the same string, and the script that creates a
 * database and the script that drops it cannot disagree.
 *
 * `toSlug` in `git.ts` is not this: it produces a git ref, keeping `-` and `.`,
 * both of which need quoting in SQL.
 *
 * The `u` flag is load-bearing. Without it a character outside the basic plane
 * is two code units and becomes two underscores.
 */
export function workspaceSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '_')
    .slice(0, SLUG_MAX_LENGTH)
}

/**
 * How many ports one workspace owns.
 *
 * One is not enough for a stack that is more than one process — a dev server,
 * an API, a mailcatcher — and a project that needs a second has nowhere to put
 * it without guessing at a number nothing is holding for it. Ten is what
 * Conductor gives, and it is enough that nobody counts.
 */
export const BLOCK = 10

/** Every port a workspace owns, its own first. */
export function blockPorts(port: number): number[] {
  return Array.from({ length: BLOCK }, (_, offset) => port + offset)
}

/**
 * Conductor's names for the same values.
 *
 * Given only to a script that came out of a repository's `.conductor/` settings,
 * because that is the vocabulary those scripts were written against. It is what
 * removes the wrapper a project used to keep in its own settings for no purpose
 * but translating one set of names into the other.
 *
 * **The workspace name is the slug**, not the label. A `.conductor` script
 * slugifies whatever it is given before naming a database with it, so handing
 * it the slug makes that a no-op — and then the name our env block writes and
 * the name their script drops are the same string, which is the whole point of
 * the slug rule matching theirs.
 *
 * `CONDUCTOR_IS_LOCAL` is deliberately absent. Scripts branch on it, its value
 * is not documented, and being wrong about a flag is worse than not setting it.
 */
export function conductorEnv(
  kind: ScriptKind,
  values: {
    readonly rootPath: string
    readonly workspaceName: string
    readonly port: number
    readonly defaultBranch: string
  }
): Record<string, string> {
  const env: Record<string, string> = {
    CONDUCTOR_ROOT_PATH: values.rootPath,
    CONDUCTOR_WORKSPACE_NAME: workspaceSlug(values.workspaceName),
    CONDUCTOR_DEFAULT_BRANCH: values.defaultBranch
  }

  // The same rule as ours: serving is the only thing a port is about.
  if (kind === 'run') env.CONDUCTOR_PORT = String(values.port)

  return env
}

/**
 * The environment a script is given.
 *
 * All three get the root and the name, in both forms; only the server gets the
 * ports, which are the one thing that is about serving rather than about the
 * workspace.
 */
export function scriptEnv(
  kind: ScriptKind,
  values: { readonly rootPath: string; readonly workspaceName: string; readonly port: number }
): Record<string, string> {
  const env: Record<string, string> = {
    [ROOT_VARIABLE]: values.rootPath,
    [WORKSPACE_VARIABLE]: values.workspaceName,
    [SLUG_VARIABLE]: workspaceSlug(values.workspaceName)
  }

  /*
   * Ten, not one, and each named rather than left to arithmetic.
   *
   * Conductor documents a range and leaves the sums to the script; a variable
   * per port is the same thing somebody can discover.
   */
  if (kind === 'run') {
    blockPorts(values.port).forEach((port, offset) => {
      env[offset === 0 ? PORT_VARIABLE : `${PORT_VARIABLE}_${String(offset)}`] = String(port)
    })
  }

  return env
}
