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
 * The environment a script is given.
 *
 * Both get the root and the name; only the server gets the ports, which are the
 * one thing that is about serving rather than about the workspace.
 */
export function scriptEnv(
  kind: ScriptKind,
  values: { readonly rootPath: string; readonly workspaceName: string; readonly port: number }
): Record<string, string> {
  const env: Record<string, string> = {
    [ROOT_VARIABLE]: values.rootPath,
    [WORKSPACE_VARIABLE]: values.workspaceName
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
