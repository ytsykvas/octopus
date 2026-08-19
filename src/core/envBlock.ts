/**
 * The overrides block as text: read, checked and filled in.
 *
 * Its own module and importing nothing Node-only, because the renderer needs
 * the **values** — it checks a block as it is typed, and a round trip per
 * keystroke to validate pure text would be absurd. `env.ts` reads and writes
 * files, so importing the checker from there drags `node:os` into the browser
 * behind it, which passes every check and breaks the window (§ CLAUDE.md, "the
 * rule in the other direction").
 */

import { scriptEnv } from './scriptEnv.js'

/**
 * The file the block goes into where a project has not said otherwise.
 *
 * `.env` is what most stacks read; the ones that do not — Vite wants
 * `.env.local` — say so per project, which is why this is a default rather
 * than a constant everything joins to.
 */
export const DEFAULT_ENV_FILE = '.env'

/**
 * What wraps the block once it is in somebody's `.env`.
 *
 * Two markers rather than one so a rewrite replaces only what we wrote. With a
 * single opening marker the tidiest implementation is to truncate there — and
 * that eats any line somebody added inside the workspace afterwards.
 */
export const OPEN = '# >>> octopus: project overrides'
export const CLOSE = '# <<< octopus'

/** What a workspace the block is being written for is worth knowing about. */
export interface WorkspaceValues {
  readonly path: string
  /** Which file to write, relative to the worktree. */
  readonly envFile: string
  readonly rootPath: string
  readonly workspaceName: string
  readonly port: number
}

/**
 * A `$NAME` or `${NAME}` in the block, where the name is one of ours.
 *
 * **Ours only.** A value in an env file is frequently a password, and a
 * password frequently contains a `$`; substituting every `$word` would corrupt
 * one silently, which is the worst way to lose an afternoon. An unrecognised
 * name is left exactly as it was typed.
 */
const BRACED = /\$\{(OCTOPUS_[A-Z0-9_]+)\}/g
const BARE = /\$(OCTOPUS_[A-Z0-9_]+)/g

/**
 * The block with our names replaced by this workspace's values.
 *
 * The block is one text for the whole project, and the port is the one thing
 * that differs per workspace — so a value that has to name the port could not
 * be written at all without this. `KEYCLOAK_REDIRECT_URI` is the worked
 * example: hard-code 3000 in it and single sign-on works in one workspace and
 * nowhere else.
 *
 * The names are the ones the scripts already get, so there is one vocabulary
 * rather than two.
 *
 * Substituted **on the way into the workspace**, never in the stored block:
 * the port can move between runs, and a stored number would be yesterday's.
 */
export function substituteEnv(body: string, values: WorkspaceValues): string {
  const table = scriptEnv('run', values)
  const swap = (whole: string, name: string): string => table[name] ?? whole

  // Braced first, so `${OCTOPUS_PORT}` is not left holding stray braces. What
  // survives that pass keeps its braces and so cannot match the bare form.
  return body.replace(BRACED, swap).replace(BARE, swap)
}

/** What is wrong with one line of a block, and where. */
export interface EnvProblem {
  /** 1-based, so it matches what the editor shows. */
  readonly line: number
  readonly reason: 'noAssignment' | 'badName' | 'duplicate' | 'unknownVariable'
  /** The name at fault where there is one — a key, or a variable reference. */
  readonly subject: string
}

/** What a key may look like, which is what every parser of these files agrees on. */
const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `export KEY=value` is accepted by dotenv, so it is not a mistake here. */
const EXPORT = /^export\s+/

/**
 * What is wrong with a block, line by line.
 *
 * **Warnings, not a refusal.** The file is read by somebody else's parser and
 * ours cannot be the authority on what that one accepts; refusing to save would
 * make a wrong guess here into a wall. Saying so and writing it anyway is the
 * honest shape.
 *
 * The four worth catching are the four that fail silently — a line that is not
 * an assignment at all does nothing, a key no parser accepts does nothing, a
 * key written twice keeps only the last one, and a mistyped `$OCTOPUS_…` is
 * left as literal text where a number was meant.
 */
export function checkEnvBody(body: string): EnvProblem[] {
  const problems: EnvProblem[] = []
  const seen = new Map<string, number>()

  body.split('\n').forEach((raw, index) => {
    const line = index + 1
    const text = raw.trim().replace(EXPORT, '')
    if (text === '' || text.startsWith('#')) return

    const equals = text.indexOf('=')
    if (equals === -1) {
      problems.push({ line, reason: 'noAssignment', subject: text })
      return
    }

    const name = text.slice(0, equals).trim()
    if (!KEY.test(name)) {
      problems.push({ line, reason: 'badName', subject: name })
    } else if (seen.has(name)) {
      // The earlier line does nothing at all: last wins, which is the same rule
      // that puts this whole block at the end of the file.
      problems.push({ line, reason: 'duplicate', subject: name })
    }
    seen.set(name, line)

    for (const reference of unknownReferences(text.slice(equals + 1))) {
      problems.push({ line, reason: 'unknownVariable', subject: reference })
    }
  })

  return problems
}

/**
 * The `$OCTOPUS_…` names in a value that are not ours to replace.
 *
 * A typo here is invisible: nothing fails, the literal text reaches the file,
 * and the app sees a URL with `$OCTOPUS_PORTT` in it.
 */
function unknownReferences(value: string): string[] {
  // The values do not matter, only which names exist.
  const known = scriptEnv('run', { rootPath: '', workspaceName: '', port: 0 })

  const found: string[] = []
  const collect = (whole: string, name: string): string => {
    if (!(name in known)) found.push(name)
    return whole
  }

  // The same two passes the substitution makes, for its side effect alone —
  // which is the point: what is checked here and what is replaced there cannot
  // drift into disagreeing about what counts as a reference.
  value.replace(BRACED, collect).replace(BARE, collect)

  return found
}

/**
 * The file with any block we wrote taken out, and its trailing blank lines.
 *
 * Anything outside the markers is somebody else's and comes back untouched,
 * including whatever sits below the block.
 */
export function withoutBlock(contents: string): string {
  const open = contents.indexOf(OPEN)
  if (open === -1) return contents

  const close = contents.indexOf(CLOSE, open)
  // An opening marker with no closing one means the file was edited into a
  // shape we did not write. Everything from it on is ours to replace; there is
  // nothing else to do that does not risk keeping half a block.
  const after = close === -1 ? contents.length : close + CLOSE.length

  return (contents.slice(0, open) + contents.slice(after)).replace(/\n{3,}$/, '\n')
}
