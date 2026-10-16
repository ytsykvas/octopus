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

import { scriptEnv, type ScriptValues } from './scriptEnv.js'

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
export interface WorkspaceValues extends ScriptValues {
  readonly path: string
  /** Which file to write, relative to the worktree. */
  readonly envFile: string
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
/**
 * The body with any marker line of ours taken out.
 *
 * Belt to `checkEnvBody`'s braces: the warning is advisory and the block is
 * written anyway, so the thing that would corrupt the file has to be removed
 * rather than merely mentioned.
 */
export function withoutMarkers(body: string): string {
  return body
    .split('\n')
    .filter((line) => line.trim() !== OPEN && line.trim() !== CLOSE)
    .join('\n')
}

export function substituteEnv(body: string, values: ScriptValues): string {
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
  readonly reason: 'noAssignment' | 'badName' | 'duplicate' | 'unknownVariable' | 'marker'
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

    /*
     * A marker of ours, pasted in — most easily by copying a workspace's env
     * back into the box. Left in, `withoutBlock` would cut at the closing one
     * and promote the rest of the block to somebody else's content, appending a
     * fresh block below it on every run: the file grew a line each time.
     *
     * Checked before the comment skip, which is what let it through.
     */
    if (text === OPEN || text === CLOSE) {
      problems.push({ line, reason: 'marker', subject: text })
      return
    }

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
 * A block as the name-to-value table a script's environment is built from.
 *
 * The scripts are given the variables themselves, not only the file they were
 * written into: a build that pulls a dump wants `$DUMP_URL`, and asking every
 * script to source `.env` first — with whatever quoting its shell disagrees
 * with dotenv about — is a step each one would get wrong differently.
 *
 * **Only what reads the same here as in dotenv.** The server starts with these
 * already in its environment, and dotenv, Vite and Ruby's `Dotenv.load` all
 * leave a variable that is already there alone — so a value read differently
 * here would beat the right one in the file. What is certain is kept: `export`
 * allowed, a value in matching quotes taken between them, an unquoted value cut
 * at its first `#` (both the Node and the Ruby dotenv do that), the last of a
 * repeated name winning. What is not is **left out**, and still reaches the file
 * untouched, where the app reads it correctly:
 *
 * - a quote that does not close on its line — a multi-line value, a PEM key —
 *   and every line up to the one that closes it, which would otherwise be read
 *   as assignments of their own (a base64 line ending `==` passes `KEY`);
 * - a backtick-quoted value, and text after a closing quote;
 * - a `\` in double quotes, where dotenv turns `\n` into a newline;
 * - a `$` outside single quotes once our own names are filled in, where
 *   dotenv-expand and the Ruby dotenv expand another variable.
 *
 * A `Map` on the way, because `__proto__` passes `KEY` and assigning it to a
 * plain object sets the prototype instead of a variable.
 */
export function parseEnvBody(body: string): Record<string, string> {
  const parsed = new Map<string, string>()
  // The quote a multi-line value opened and has not closed yet.
  let open: string | null = null

  for (const raw of body.split('\n')) {
    if (open !== null) {
      if (raw.includes(open)) open = null
      continue
    }

    const text = raw.trim().replace(EXPORT, '')
    // Our markers start with `#`, so they go with the comments.
    if (text === '' || text.startsWith('#')) continue

    const equals = text.indexOf('=')
    if (equals === -1) continue

    const value = text.slice(equals + 1).trim()
    const quote = value.charAt(0)
    // Before the name is judged: a line that opens a value spanning several
    // has to be followed to its end whatever its name is.
    if (QUOTES.includes(quote) && !value.includes(quote, 1)) {
      open = quote
      continue
    }

    const name = text.slice(0, equals).trim()
    const read = readValue(value)
    if (KEY.test(name) && read !== null) parsed.set(name, read)
  }

  return Object.fromEntries(parsed)
}

/** The quotes dotenv lets a value span lines in. */
const QUOTES = ['"', "'", '`']

/** One single-line value as dotenv reads it, or null where that is not certain. */
function readValue(value: string): string | null {
  const quote = value.charAt(0)

  if (QUOTES.includes(quote)) {
    const closing = value.indexOf(quote, 1)
    const inner = value.slice(1, closing)
    const after = value.slice(closing + 1).trim()

    if (quote === '`' || (after !== '' && !after.startsWith('#'))) return null
    if (quote === '"' && (inner.includes('\\') || inner.includes('$'))) return null
    return inner
  }

  const comment = value.indexOf('#')
  const plain = (comment === -1 ? value : value.slice(0, comment)).trim()
  return plain.includes('$') ? null : plain
}

/**
 * The `$OCTOPUS_…` names in a value that are not ours to replace.
 *
 * A typo here is invisible: nothing fails, the literal text reaches the file,
 * and the app sees a URL with `$OCTOPUS_PORTT` in it.
 */
function unknownReferences(value: string): string[] {
  // The values do not matter, only which names exist.
  const known = scriptEnv('run', { rootPath: '', workspaceName: '', port: 0, profile: '' })

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
