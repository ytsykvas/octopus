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
  /**
   * What is at fault: a key, a variable reference — or, for a line that is no
   * assignment or a marker, the whole line, which can be a pasted secret.
   */
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
  const seen = new Set<string>()

  envLines(body).forEach((read, index) => {
    const line = index + 1

    /*
     * A marker of ours, pasted in — most easily by copying a workspace's env
     * back into the box. Left in, `withoutBlock` would cut at the closing one
     * and promote the rest of the block to somebody else's content, appending a
     * fresh block below it on every run: the file grew a line each time.
     */
    if (read.kind === 'marker') {
      problems.push({ line, reason: 'marker', subject: read.text })
      return
    }
    if (read.kind === 'loose') {
      problems.push({ line, reason: 'noAssignment', subject: read.text })
      return
    }
    // A line inside a quoted value is the value's, and right as it is.
    if (read.kind === 'blank' || read.kind === 'continuation') return

    const { name } = read
    if (!read.named) {
      problems.push({ line, reason: 'badName', subject: name })
    } else if (seen.has(name)) {
      // The earlier line does nothing at all: last wins, which is the same rule
      // that puts this whole block at the end of the file.
      problems.push({ line, reason: 'duplicate', subject: name })
    }
    seen.add(name)

    for (const reference of unknownReferences(read.value)) {
      problems.push({ line, reason: 'unknownVariable', subject: reference })
    }
  })

  return problems
}

/** What one line of a block is, as every reader of one here agrees. */
type EnvLine =
  | { readonly kind: 'blank' }
  | { readonly kind: 'marker'; readonly text: string }
  /** Not an assignment at all, however it is read. */
  | { readonly kind: 'loose'; readonly text: string }
  /** A name and its value, as written. */
  | {
      readonly kind: 'assignment'
      readonly text: string
      readonly name: string
      /** Whether the name is one every parser accepts (`KEY`). */
      readonly named: boolean
      readonly value: string
      /** Whether the value opens a quote this line does not close. */
      readonly spans: boolean
    }
  /** A line inside a quoted value: the part before its closing quote, if it has one. */
  | { readonly kind: 'continuation'; readonly owner: string | null; readonly text: string }

/** A quote a value opened and has not closed yet, and the name that opened it. */
interface Opening {
  readonly quote: string
  readonly owner: string | null
}

/**
 * Each line of a block, and what it is.
 *
 * One reading for the check, the parse and the mask, so the three cannot
 * disagree about which lines are assignments — or about where a value spanning
 * several lines ends, which none of them can see from one line alone.
 */
function envLines(body: string): EnvLine[] {
  let open: Opening | null = null
  let afterKeyLine = false

  return body.split('\n').map((raw) => {
    if (open !== null) {
      const inside = readInside(raw, open)
      if (raw.includes(open.quote)) open = null
      afterKeyLine = false
      return inside
    }

    const read = readLine(raw, afterKeyLine)
    if (read.kind === 'assignment' && read.spans) {
      open = { quote: read.value.charAt(0), owner: read.named ? read.name : null }
    }
    afterKeyLine = read.kind === 'loose' && KEY_LINE.test(read.text)
    return read
  })
}

function readLine(raw: string, afterKeyLine: boolean): EnvLine {
  const text = raw.trim().replace(EXPORT, '')

  // Before the comments, which our markers would otherwise pass for.
  if (text === OPEN || text === CLOSE) return { kind: 'marker', text }
  if (text === '' || text.startsWith('#')) return { kind: 'blank' }

  const equals = text.indexOf('=')
  if (equals === -1) return { kind: 'loose', text }

  const value = text.slice(equals + 1).trim()
  if (afterKeyLine && /^=*$/.test(value)) return { kind: 'loose', text }

  const name = text.slice(0, equals).trim()
  const quote = value.charAt(0)
  return {
    kind: 'assignment',
    text,
    name,
    named: KEY.test(name),
    value,
    spans: QUOTES.includes(quote) && !value.includes(quote, 1)
  }
}

/**
 * A line while a quoted value is open.
 *
 * A marker is still a marker: `withoutBlock` cuts at one wherever it stands, so
 * inside a value it corrupts the file just the same.
 */
function readInside(raw: string, { quote, owner }: Opening): EnvLine {
  const text = raw.trim()
  if (text === OPEN || text === CLOSE) return { kind: 'marker', text }

  const closing = raw.indexOf(quote)
  return {
    kind: 'continuation',
    owner,
    text: (closing === -1 ? raw : raw.slice(0, closing)).trim()
  }
}

/**
 * A line of a key pasted without its quotes: base64 and nothing else, as long
 * as the shortest width keys are wrapped at (PEM 64, OpenSSH 70, MIME 76) comes
 * nowhere near — and longer than any typo.
 *
 * The line after one can end in padding: `…Q==` reads as the name `…Q` set to
 * `=`, and `…Q=` as one set to nothing — a piece of the key that would be
 * listed as a name. Only there: anywhere else `SEP==` and `EMPTY=` are what
 * they say.
 */
const KEY_LINE = /^[A-Za-z0-9+/]{40,}$/

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

  for (const read of envLines(body)) {
    if (read.kind !== 'assignment' || read.spans || !read.named) continue

    const value = readValue(read.value)
    if (value !== null) parsed.set(read.name, value)
  }

  return Object.fromEntries(parsed)
}

/** A text from a block that a script could print, and the name it belongs to where one does. */
export interface EnvSecret {
  readonly name: string | null
  readonly value: string
}

/**
 * Every text in a block a script could print, for masking out of what it did.
 *
 * Not `parseEnvBody`, which leaves out whatever dotenv might read differently —
 * the very values most likely to be passwords: a `$` in one, a `\`,
 * backticks, a key over several lines. They still reach the file, and
 * `cat .env` or `set -x` prints them. Nothing is left out here: each value as
 * written and as dotenv reads it, each line of a value spanning several under
 * the name that opened it, and a line that is no assignment — a pasted key, a
 * `KEY: value` — whole and under no name.
 */
export function envSecrets(body: string): EnvSecret[] {
  const secrets: EnvSecret[] = []

  for (const read of envLines(body)) {
    if (read.kind === 'blank' || read.kind === 'marker') continue
    if (read.kind === 'continuation') {
      secrets.push({ name: read.owner, value: read.text })
      continue
    }
    if (read.kind === 'loose') {
      secrets.push({ name: null, value: read.text })
      continue
    }

    const name = read.named ? read.name : null
    if (name === null) secrets.push({ name, value: read.text })

    const { value } = read
    const quote = value.charAt(0)
    if (!QUOTES.includes(quote)) {
      const comment = value.indexOf('#')
      const cut = comment === -1 ? value : value.slice(0, comment).trim()
      secrets.push({ name, value }, { name, value: cut })
      continue
    }
    if (read.spans) {
      secrets.push({ name, value: value.slice(1) })
      continue
    }

    // Both ways a `\n` is printed: as written, and as the newline dotenv makes of it.
    const inner = value.slice(1, value.indexOf(quote, 1))
    secrets.push(...[inner, ...inner.split('\\n')].map((piece) => ({ name, value: piece })))
  }

  return secrets
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
