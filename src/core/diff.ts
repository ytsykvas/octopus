/**
 * What a workspace changed, measured against the branch it started from.
 *
 * Builds on the `GitExec` from `git.ts` rather than introducing its own runner,
 * so every command still goes through `execFile` (§11.2).
 *
 * Nothing here writes: no `--intent-to-add`, no index, no stash. A review pane
 * that modified the repository it is reporting on would change the answer by
 * asking the question.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { type GitExec, GitError, OUTPUT_TOO_LARGE } from './git.js'

/** Reads a file's bytes; a parameter so tests need no filesystem. */
export type ReadBytes = (path: string) => Promise<Uint8Array>

/** A file's size, asked before its contents — the same reason a parameter. */
export type StatBytes = (path: string) => Promise<number>

/** Failures a user can act on, as opposed to git falling over (§13). */
export type DiffErrorCode = 'baseUnknown'

export class DiffError extends Error {
  constructor(
    readonly code: DiffErrorCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'DiffError'
  }
}

export type FileStatus =
  'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typeChanged' | 'untracked'

/** Why a file carries no lines, when it carries none. */
export type DiffOmission = 'none' | 'binary' | 'tooLarge'

export type DiffLineKind = 'context' | 'added' | 'removed'

export interface DiffLine {
  readonly kind: DiffLineKind
  /**
   * The line as it stands in the file, prefix removed and nothing else.
   *
   * A CRLF file keeps its carriage return here: it is part of the content, and
   * a parser that strips it is reporting a file that does not exist.
   */
  readonly text: string
  /** 1-based in the file as it was; null on an added line. */
  readonly oldNumber: number | null
  /** 1-based in the file as it is; null on a removed line. */
  readonly newNumber: number | null
  /** git's `\ No newline at end of file`, carried by the line it describes. */
  readonly noNewline: boolean
}

export interface Hunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  /** Whatever git put after the closing `@@` — usually the enclosing function. */
  readonly heading: string
  readonly lines: readonly DiffLine[]
}

export interface FileDiff {
  /** The path as it stands now; for a deletion, the path it had. */
  readonly path: string
  /** Where it came from when it moved or was copied, otherwise null. */
  readonly oldPath: string | null
  readonly status: FileStatus
  readonly added: number
  readonly removed: number
  readonly omitted: DiffOmission
  readonly hunks: readonly Hunk[]
}

export interface WorkspaceDiff {
  /** The commit everything is measured against. */
  readonly baseCommit: string
  /** The branch that commit was found from — what the header names. */
  readonly baseBranch: string
  readonly files: readonly FileDiff[]
  readonly added: number
  readonly removed: number
  /** Files whose lines were left out because the change is too big to draw. */
  readonly omittedFiles: number
}

export interface DiffLimits {
  /** Files past this many get their counts but no lines. */
  readonly maxFiles: number
  /** A single file changing more lines than this is not drawn. */
  readonly maxFileLines: number
  /** The budget across the whole diff. */
  readonly maxTotalLines: number
  /**
   * A single file weighing more than this is not drawn either.
   *
   * The ceilings above count lines, and a line has no length: a minified
   * bundle or a source map is one enormous line and passes every one of them.
   */
  readonly maxFileBytes: number
}

/**
 * Bounds chosen against what a reviewer can actually read, not against what
 * the machine can hold. A lockfile rewrite or a generated bundle passes the
 * per-file ceiling on its own; hand-written source does not come close.
 *
 * 256KB is roughly three times what 2 000 lines of hand-written source weighs,
 * so the byte ceiling only ever bites a file whose lines are long — which is
 * exactly the generated one nobody is reading line by line.
 */
export const DIFF_LIMITS: DiffLimits = {
  maxFiles: 400,
  maxFileLines: 2_000,
  maxTotalLines: 20_000,
  maxFileBytes: 256 * 1024
}

export interface ReadDiffOptions {
  readonly baseBranch: string
  /** The worktree root; untracked files are read relative to it. */
  readonly root: string
  readonly limits?: DiffLimits
  readonly readBytes?: ReadBytes
  readonly statBytes?: StatBytes
}

/** What is left of the ceilings, as the files are taken in turn. */
interface Budget {
  readonly files: number
  readonly lines: number
}

/** How much of a file git reads before deciding it is binary. */
const BINARY_SNIFF_BYTES = 8_000

/** Lines of context either side of a change, stated rather than inherited. */
const CONTEXT_LINES = 3

/**
 * Options every diff invocation carries, and what each one prevents.
 *
 * `--no-ext-diff` and `--no-textconv`: a `diff.external` or a textconv filter
 * in the user's config would replace git's output with another program's, and
 * run that program. `--no-color`: `color.ui = always` otherwise puts ANSI
 * escapes through the parser. `--find-renames`: a moved file is one entry
 * rather than a deletion beside an addition.
 */
const DIFF_FLAGS = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--find-renames',
  // Pinned, because `diff.mnemonicPrefix` in a user's config renames these to
  // `c/` and `w/`. Every path would then fail to match the listing it is paired
  // with, and every file in the pane would draw empty — a total failure with
  // nothing on screen to say why.
  '--src-prefix=a/',
  '--dst-prefix=b/'
] as const

/**
 * Paths arrive raw rather than octal-escaped.
 *
 * `-z` covers the machine-readable outputs, but the unified diff has no such
 * option, and without this a Cyrillic filename reaches the parser as `\320\243`.
 */
const RAW_PATHS = ['-c', 'core.quotePath=false'] as const

/*
 * A read from inside a walk that has already checked its bounds.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly absent, and
 * one place saying what absence means beats a guard at each of a dozen reads —
 * the same trade `changeSummary.ts` makes, for the same reason. Ignored for
 * coverage rather than tested: no input reaches the fallback, and a test that
 * pretended otherwise would assert against a state the walk cannot be in.
 */
/* v8 ignore next 2 */
const at = (values: readonly string[], index: number): string => values[index] ?? ''

/**
 * Whether bytes look binary by git's own rule: a NUL early in the file.
 *
 * Matching git matters more than being right in the abstract. A file git calls
 * binary produces `Binary files … differ` and no lines, so anything reading the
 * two differently would draw a file the diff never described.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, BINARY_SNIFF_BYTES)
  for (let index = 0; index < end; index++) {
    if (bytes[index] === 0) return true
  }
  return false
}

/**
 * Undoes git's C-style quoting of a path.
 *
 * With `core.quotePath=false` only what git must escape stays quoted — a quote,
 * a backslash, a control character — but those names are legal and do occur.
 * A value that is not quoted is returned untouched.
 */
export function unquotePath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"') || value.length < 2) return value

  const body = value.slice(1, -1)
  let result = ''

  // Read with `charAt` rather than by index: it answers with an empty string
  // past the end, which is exactly what a truncated escape should contribute,
  // and saves a fallback on every read that no input reaches.
  for (let index = 0; index < body.length; index++) {
    if (body.charAt(index) !== '\\') {
      result += body.charAt(index)
      continue
    }

    const next = body.charAt(index + 1)
    index++

    // Three octal digits are how git writes a byte it will not print. Anything
    // else after a backslash is the single character it escapes.
    if (next >= '0' && next <= '7') {
      const octal = next + body.charAt(index + 1) + body.charAt(index + 2)
      index += 2
      result += String.fromCharCode(Number.parseInt(octal, 8))
      continue
    }

    result += ESCAPES[next] ?? next
  }

  // The octal escapes above are bytes of UTF-8, not code points, so a
  // multi-byte character arrives as its bytes and has to be put back together.
  return decodeBytes(result)
}

const ESCAPES: Readonly<Record<string, string>> = {
  a: '',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v'
}

/**
 * Reads a string of raw bytes back as UTF-8.
 *
 * Only characters above 0x7f can have come from an octal escape, so a name with
 * none of them is already what it should be and is left alone — which is also
 * what keeps a legitimate `é` typed directly into a filename from being
 * re-decoded into rubbish.
 */
function decodeBytes(value: string): string {
  // Read as UTF-16 code units on purpose: each one holds a single byte here,
  // and splitting by code point would recombine what has not been decoded yet.
  const bytes = new Uint8Array(value.length)
  let raw = false

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code > 0x7f) raw = true
    bytes[index] = code & 0xff
  }

  return raw ? new TextDecoder().decode(bytes) : value
}

/** One file's line counts as `--numstat` reports them. */
export interface NumstatEntry {
  readonly path: string
  readonly oldPath: string | null
  readonly added: number
  readonly removed: number
  readonly binary: boolean
}

/**
 * Parses `git diff --numstat -z`.
 *
 * Records are NUL-terminated, which is the whole point of `-z`: a path with a
 * space, a quote or a newline arrives intact and unquoted. An ordinary record
 * is `added\tremoved\tpath`; a rename leaves the path field **empty** and
 * follows with two more records, the old path and the new one. A binary file
 * reports `-` for both counts.
 */
export function parseNumstat(output: string): NumstatEntry[] {
  const fields = output.split('\0')
  const entries: NumstatEntry[] = []

  for (let index = 0; index < fields.length; index++) {
    const field = at(fields, index)

    // Split at the first two tabs only. A path may contain tabs of its own —
    // `-z` is what lets it arrive unescaped — and splitting on every tab would
    // truncate the name at the first one.
    const firstTab = field.indexOf('\t')
    const secondTab = firstTab === -1 ? -1 : field.indexOf('\t', firstTab + 1)
    if (secondTab === -1) continue

    const addedText = field.slice(0, firstTab)
    const removedText = field.slice(firstTab + 1, secondTab)
    const pathText = field.slice(secondTab + 1)
    const binary = addedText === '-' || removedText === '-'

    // An empty path field is git saying "the two records after this one".
    let path = pathText
    let oldPath: string | null = null
    if (path === '') {
      oldPath = at(fields, index + 1)
      path = at(fields, index + 2)
      index += 2
    }

    entries.push({
      path,
      oldPath,
      added: binary ? 0 : Number.parseInt(addedText, 10),
      removed: binary ? 0 : Number.parseInt(removedText, 10),
      binary
    })
  }

  return entries
}

/** One file's status as `--name-status` reports it. */
export interface NameStatusEntry {
  readonly path: string
  readonly oldPath: string | null
  readonly status: FileStatus
}

const STATUS_LETTERS: Readonly<Record<string, FileStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typeChanged'
}

/**
 * Parses `git diff --name-status -z`.
 *
 * The status is its own NUL-terminated field, so `R100` and `M` are read the
 * same way; `R` and `C` carry a similarity score and are followed by two paths
 * rather than one.
 */
export function parseNameStatus(output: string): NameStatusEntry[] {
  const fields = output.split('\0').filter((field) => field !== '')
  const entries: NameStatusEntry[] = []

  for (let index = 0; index < fields.length; index++) {
    const letter = at(fields, index).charAt(0)
    // A letter we do not know still consumes its path. `U` for an unmerged file
    // is the one that occurs, and skipping the record would leave the walk one
    // field out of step — reading every path that follows as a status and
    // losing the rest of the list, which is far worse than one imprecise word.
    const status = STATUS_LETTERS[letter] ?? 'modified'

    const moved = status === 'renamed' || status === 'copied'
    const first = at(fields, index + 1)
    const second = moved ? at(fields, index + 2) : ''
    index += moved ? 2 : 1

    entries.push({
      path: moved ? second : first,
      oldPath: moved ? first : null,
      status
    })
  }

  return entries
}

/** A file's block in a unified diff: its path, and the lines under it. */
export interface ParsedFile {
  readonly path: string
  readonly binary: boolean
  readonly hunks: readonly Hunk[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/**
 * Parses a unified diff into its files and their hunks.
 *
 * Pure, and kept apart from the command that produces it — the same split as
 * `parseWorktrees`, and for the same reason: the awkward cases are pinned by
 * tests on strings rather than by contriving a repository that emits them.
 *
 * A hunk ends when its header's own counts are spent, not when a line stops
 * looking like content. That is what lets a removed line reading `--- a/x` or an
 * empty context line be content rather than the start of the next file.
 */
export function parseUnifiedDiff(output: string): ParsedFile[] {
  const lines = output.split('\n')
  const files: ParsedFile[] = []

  let path: string | null = null
  let binary = false
  let hunks: Hunk[] = []

  const flush = (): void => {
    if (path !== null) files.push({ path, binary, hunks })
    path = null
    binary = false
    hunks = []
  }

  for (let index = 0; index < lines.length; index++) {
    const line = at(lines, index)

    if (line.startsWith('diff --git ')) {
      flush()
      path = pathFromGitHeader(line)
      continue
    }

    if (path === null) continue

    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      binary = true
      continue
    }

    // The header lines are the only place a path is stated unambiguously for a
    // rename, and the only correction available when `diff --git` could not be
    // split — see `pathFromGitHeader`.
    if (line.startsWith('rename to ')) {
      path = unquotePath(line.slice('rename to '.length))
      continue
    }

    if (line.startsWith('+++ ') && !line.startsWith('+++ /dev/null')) {
      path = stripPrefix(unquotePath(trimTrailingTab(line.slice('+++ '.length))))
      continue
    }

    const header = HUNK_HEADER.exec(line)
    if (!header) continue

    const [, oldStartText = '0', oldCountText, newStartText = '0', newCountText, heading = ''] =
      header

    const oldLines = oldCountText === undefined ? 1 : Number.parseInt(oldCountText, 10)
    const newLines = newCountText === undefined ? 1 : Number.parseInt(newCountText, 10)

    const consumed = readHunkLines(lines, index + 1, {
      oldStart: Number.parseInt(oldStartText, 10),
      newStart: Number.parseInt(newStartText, 10),
      oldLines,
      newLines
    })

    hunks.push({
      oldStart: Number.parseInt(oldStartText, 10),
      oldLines,
      newStart: Number.parseInt(newStartText, 10),
      newLines,
      heading,
      lines: consumed.lines
    })

    index = consumed.next - 1
  }

  flush()
  return files
}

interface HunkRange {
  readonly oldStart: number
  readonly newStart: number
  readonly oldLines: number
  readonly newLines: number
}

/**
 * Reads a hunk's lines, stopping when the header's counts are spent.
 *
 * `\ No newline at end of file` belongs to the line above it and is not a line
 * of its own — content lines always carry a prefix, so a leading backslash
 * cannot be anything else.
 */
function readHunkLines(
  lines: readonly string[],
  start: number,
  range: HunkRange
): { lines: DiffLine[]; next: number } {
  const collected: DiffLine[] = []
  let oldNumber = range.oldStart
  let newNumber = range.newStart
  let oldLeft = range.oldLines
  let newLeft = range.newLines
  let index = start

  while (index < lines.length && (oldLeft > 0 || newLeft > 0)) {
    const line = at(lines, index)
    index++

    if (line.startsWith('\\')) {
      markNoNewline(collected)
      continue
    }

    const sign = line.charAt(0)
    const text = line.slice(1)

    if (sign === '+') {
      collected.push({ kind: 'added', text, oldNumber: null, newNumber, noNewline: false })
      newNumber++
      newLeft--
      continue
    }

    if (sign === '-') {
      collected.push({ kind: 'removed', text, oldNumber, newNumber: null, noNewline: false })
      oldNumber++
      oldLeft--
      continue
    }

    // A context line, including the empty one git writes as a lone space.
    collected.push({ kind: 'context', text, oldNumber, newNumber, noNewline: false })
    oldNumber++
    newNumber++
    oldLeft--
    newLeft--
  }

  // The marker for the final line arrives after the counts are spent, so it is
  // outside the loop that reads them. Missing it would report every file that
  // ends without a newline as ending with one.
  if (at(lines, index).startsWith('\\')) {
    markNoNewline(collected)
    index++
  }

  return { lines: collected, next: index }
}

/**
 * Records that the line just read ends without a newline.
 *
 * Nothing happens when there is no such line: the marker can only describe
 * something already collected, and a hunk that opens with one is describing
 * nothing.
 */
function markNoNewline(collected: DiffLine[]): void {
  const last = collected.at(-1)
  if (last) collected.splice(collected.length - 1, 1, { ...last, noNewline: true })
}

/**
 * The path a `diff --git` line names, as far as that line can say it.
 *
 * It cannot always: `a/x b/y` splits on a space, and both names may contain
 * spaces themselves, so the split is a guess whenever the two differ. A quoted
 * pair is unambiguous, and every other case is corrected a few lines later by
 * `+++` or `rename to`. This exists so a block is opened at all — the path is
 * settled by the time the block is flushed.
 */
function pathFromGitHeader(line: string): string {
  const rest = line.slice('diff --git '.length)

  if (rest.startsWith('"')) {
    const end = findQuoteEnd(rest)
    return stripPrefix(unquotePath(rest.slice(end + 1).trim()))
  }

  const half = Math.floor(rest.length / 2)
  return stripPrefix(rest.slice(half + 1))
}

/** Index of the quote closing the one at position 0, skipping escaped quotes. */
function findQuoteEnd(value: string): number {
  for (let index = 1; index < value.length; index++) {
    if (value[index] === '\\') {
      index++
      continue
    }
    if (value[index] === '"') return index
  }
  return value.length - 1
}

/**
 * Drops the `a/` or `b/` git puts in front of a path.
 *
 * Only the two prefixes git actually writes are removed. Cutting two characters
 * unconditionally would eat the start of a path whose diff was produced without
 * them.
 */
function stripPrefix(value: string): string {
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value
}

/**
 * Removes the tab git appends to a `---`/`+++` path that contains a space.
 *
 * Safe to do unconditionally: a real tab in a filename forces git to quote the
 * whole name, so an unquoted path never ends with one.
 */
function trimTrailingTab(value: string): string {
  return value.endsWith('\t') ? value.slice(0, -1) : value
}

/**
 * Turns a file nobody has added yet into a diff of its own.
 *
 * git cannot do this for us: `git diff` does not see untracked files at all,
 * `--intent-to-add` would write to the index the agent is also using, and
 * `--no-index` exits non-zero by design, which `gitIn` reports as a failure and
 * whose output would be thrown away with it. The content is entirely additions,
 * so there is nothing to compute — only to describe.
 */
export function untrackedHunk(contents: string): Hunk | null {
  if (contents === '') return null

  const raw = contents.split('\n')
  const endsWithNewline = raw.at(-1) === ''
  const texts = endsWithNewline ? raw.slice(0, -1) : raw

  const lines: DiffLine[] = texts.map((text, offset) => ({
    kind: 'added' as const,
    text,
    oldNumber: null,
    newNumber: offset + 1,
    noNewline: false
  }))

  const last = lines.at(-1)
  if (last && !endsWithNewline) lines.splice(lines.length - 1, 1, { ...last, noNewline: true })

  return {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    heading: '',
    lines
  }
}

/**
 * Everything a workspace changed since it left its base branch.
 *
 * The left-hand side is the merge base, resolved here rather than left to
 * `git diff base...HEAD`: the three-dot form compares two *commits*, so it
 * cannot see the working tree, and a workspace's uncommitted work is most of
 * what there is to review. Diffing against the merge base directly gives the
 * same starting point and includes committed, staged and unstaged work at once
 * — while still leaving out whatever landed on the base branch after the fork,
 * which a plain two-dot diff would wrongly report as this workspace's doing.
 */
export async function readWorkspaceDiff(
  exec: GitExec,
  options: ReadDiffOptions
): Promise<WorkspaceDiff> {
  const limits = options.limits ?? DIFF_LIMITS
  const readBytes = options.readBytes ?? ((path) => readFile(path))
  const statBytes = options.statBytes ?? (async (path) => (await stat(path)).size)

  const baseCommit = await mergeBase(exec, options.baseBranch)

  const [numstat, nameStatus, untracked] = await Promise.all([
    exec([...RAW_PATHS, 'diff', '--numstat', '-z', ...DIFF_FLAGS, baseCommit]),
    exec([...RAW_PATHS, 'diff', '--name-status', '-z', ...DIFF_FLAGS, baseCommit]),
    exec(['ls-files', '--others', '--exclude-standard', '-z'])
  ])

  const tracked = trackedFiles(parseNumstat(numstat), parseNameStatus(nameStatus))

  // Tracked files are chosen first because git has already counted them, and
  // what they leave of the budget is what the untracked ones have to spend —
  // which is the only way the two kinds share one ceiling rather than each
  // having its own.
  const { drawable, left } = chooseDrawable(tracked, limits, {
    files: limits.maxFiles,
    lines: limits.maxTotalLines
  })

  const untrackedFiles = await readUntrackedFiles(splitNul(untracked), left, {
    root: options.root,
    limits,
    readBytes,
    statBytes
  })

  const files = [...markOmitted(tracked, drawable), ...untrackedFiles]

  // Counted before anything is marked, which is the only count that says
  // anything: after marking, every tracked file not being drawn reads as too
  // large, so the two numbers agree whatever was left out and git is asked for
  // the whole diff — including the files the ceilings exist to leave out.
  const candidates = tracked.filter((file) => file.omitted === 'none').length

  // Only the hunks depend on there being something to ask git for. What was
  // left out is said either way, or the one case where every file is too large
  // is the case that explains nothing.
  const withHunks =
    drawable.length === 0
      ? files
      : await attachHunks(exec, files, {
          baseCommit,
          drawable,
          everything: drawable.length === candidates,
          limits
        })

  return {
    baseCommit,
    baseBranch: options.baseBranch,
    files: withHunks,
    added: withHunks.reduce((total, file) => total + file.added, 0),
    removed: withHunks.reduce((total, file) => total + file.removed, 0),
    omittedFiles: withHunks.filter((file) => file.omitted === 'tooLarge').length
  }
}

/**
 * The commit the workspace's branch grew out of.
 *
 * A failure here is not git falling over — it is a base branch that has been
 * deleted, renamed, or was never fetched into this worktree. The user can fix
 * that in the project's settings, so it gets a code rather than raw stderr.
 */
async function mergeBase(exec: GitExec, baseBranch: string): Promise<string> {
  try {
    const out = (await exec(['merge-base', baseBranch, 'HEAD'])).trim()
    if (out !== '') return out
  } catch {
    // Falls through to the same answer: we cannot say where this branch began.
  }

  throw new DiffError(
    'baseUnknown',
    { branch: baseBranch },
    `cannot find where the workspace branched from ${baseBranch}`
  )
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((value) => value !== '')
}

/** Joins what `--numstat` counted to what `--name-status` called it. */
function trackedFiles(
  counts: readonly NumstatEntry[],
  statuses: readonly NameStatusEntry[]
): FileDiff[] {
  const byPath = new Map(statuses.map((entry) => [entry.path, entry]))

  return counts.map((entry) => {
    const status = byPath.get(entry.path)

    return {
      path: entry.path,
      oldPath: entry.oldPath,
      // `--numstat` knows the counts and `--name-status` knows the kind; only
      // the pair says both. A file in one and not the other is not something
      // git produces, and `modified` is the honest reading if it ever does.
      status: status?.status ?? 'modified',
      added: entry.added,
      removed: entry.removed,
      omitted: entry.binary ? ('binary' as const) : ('none' as const),
      hunks: []
    }
  })
}

/** What reading an untracked file needs, gathered so the walk stays readable. */
interface UntrackedContext {
  readonly root: string
  readonly limits: DiffLimits
  readonly readBytes: ReadBytes
  readonly statBytes: StatBytes
}

/**
 * Untracked files, as far as the budget the tracked ones left over reaches.
 *
 * One at a time rather than `Promise.all` over the whole listing: a workspace
 * whose build output is not ignored has git list every file in it here, and
 * reading them at once holds all of them in memory before a single line has
 * been counted. The budget then stops the walk long before the listing ends,
 * so the sequential reads are bounded by `maxFiles` rather than by the tree.
 */
async function readUntrackedFiles(
  paths: readonly string[],
  budget: Budget,
  context: UntrackedContext
): Promise<FileDiff[]> {
  const files: FileDiff[] = []
  let left = budget

  for (const path of paths) {
    const file = await readUntracked(path, left, context)
    if (file.omitted === 'none') {
      left = { files: left.files - 1, lines: left.lines - file.added }
    }
    files.push(file)
  }

  return files
}

async function readUntracked(
  path: string,
  left: Budget,
  { root, limits, readBytes, statBytes }: UntrackedContext
): Promise<FileDiff> {
  const base = {
    path,
    oldPath: null,
    status: 'untracked' as const,
    hunks: []
  }

  const undrawn = { ...base, added: 0, removed: 0, omitted: 'tooLarge' as const }

  // Named and marked without being opened. Reading the rest of the listing
  // would buy an exact count to put beside "too large to draw", and cost the
  // whole tree to produce it.
  if (left.files <= 0 || left.lines <= 0) return undrawn

  const full = join(root, path)
  let bytes: Uint8Array

  try {
    // Measured before it is read, which is the only order that bounds
    // anything: by the time the size is known from the contents, the contents
    // are already in memory.
    if ((await statBytes(full)) > limits.maxFileBytes) return undrawn
    bytes = await readBytes(full)
  } catch {
    // Listed a moment ago and gone now, or unreadable. It is still a change the
    // reviewer should see named, so it is reported with nothing to draw.
    return { ...base, added: 0, removed: 0, omitted: 'binary' }
  }

  if (looksBinary(bytes)) return { ...base, added: 0, removed: 0, omitted: 'binary' }

  const hunk = untrackedHunk(new TextDecoder().decode(bytes))
  const added = hunk?.lines.length ?? 0

  // The count is exact here whatever happens next: the file has been read, so
  // saying it is too large to draw costs nothing in honesty.
  if (added > limits.maxFileLines || added > left.lines) {
    return { ...base, added, removed: 0, omitted: 'tooLarge' }
  }

  return {
    ...base,
    added,
    removed: 0,
    omitted: 'none',
    hunks: hunk ? [hunk] : []
  }
}

/**
 * Which files are worth asking git to draw.
 *
 * The counts are already known and always exact, so the summary never depends
 * on this — only how much of it is drawn does. Files are taken in the order git
 * listed them until the budget is spent, and what did not fit says so rather
 * than quietly appearing unchanged.
 */
function chooseDrawable(
  files: readonly FileDiff[],
  limits: DiffLimits,
  budget: Budget
): { drawable: FileDiff[]; left: Budget } {
  const drawable: FileDiff[] = []
  let left = budget

  for (const file of files) {
    if (file.omitted !== 'none' || file.status === 'untracked') continue

    const size = file.added + file.removed
    if (size > limits.maxFileLines || left.files <= 0 || size > left.lines) continue

    left = { files: left.files - 1, lines: left.lines - size }
    drawable.push(file)
  }

  return { drawable, left }
}

/** What the hunk-carrying diff has to know, beyond the files it is describing. */
interface DrawRequest {
  readonly baseCommit: string
  readonly drawable: readonly FileDiff[]
  /** Whether every file git would write out is one we asked for. */
  readonly everything: boolean
  readonly limits: DiffLimits
}

/**
 * Runs the diff that carries lines, and hands each file its own.
 *
 * The pathspec is dropped when everything is being drawn — the common case, and
 * one fewer place for a path to be mangled on its way into an argument list.
 * `:(literal)` disables globbing for the rest: a file genuinely named `x[1].ts`
 * is otherwise a pattern that matches something else, or nothing.
 */
async function attachHunks(
  exec: GitExec,
  files: readonly FileDiff[],
  { baseCommit, drawable, everything, limits }: DrawRequest
): Promise<FileDiff[]> {
  // A rename is two paths, and asking for one of them loses the pairing: git
  // matches a deletion to an addition only among the paths it was given, so
  // with the new path alone it sees a file appearing from nowhere and draws
  // the whole of it as additions — under a header that still says the file
  // moved and changed one line.
  const pathspec = everything
    ? []
    : [
        '--',
        ...drawable.flatMap((file) =>
          file.oldPath === null
            ? [`:(literal)${file.path}`]
            : [`:(literal)${file.path}`, `:(literal)${file.oldPath}`]
        )
      ]

  const asked = new Set(drawable.map((file) => file.path))
  let output: string

  try {
    output = await exec([
      ...RAW_PATHS,
      // The one lever git gives us over a diff measured in bytes: past this
      // many, a file is reported as binary instead of having its content
      // written out. It goes only on this call — `--numstat` under the same
      // setting answers `-` for those files, and the counts must stay exact.
      '-c',
      `core.bigFileThreshold=${String(limits.maxFileBytes)}`,
      'diff',
      ...DIFF_FLAGS,
      `-U${String(CONTEXT_LINES)}`,
      baseCommit,
      ...pathspec
    ])
  } catch (error) {
    // Enough files just under the per-file ceiling still add up to more than
    // the buffer holds. Only that failure is caught: a diff nobody can draw is
    // a pane full of files saying so, but git refusing is still an error, and
    // catching both would turn every one of them into an empty review.
    if (!(error instanceof GitError) || error.code !== OUTPUT_TOO_LARGE) throw error

    return files.map((file) =>
      asked.has(file.path) ? { ...file, omitted: 'tooLarge' as const } : file
    )
  }

  const parsed = collectHunks(parseUnifiedDiff(output))

  return files.map((file) => {
    const block = parsed.get(file.path)
    // A file with no block of its own is a rename with nothing else changed,
    // which has no lines by construction rather than by omission. A file we
    // did not ask about is one git described only because the whole diff was
    // asked for at once, and it has already said what it is.
    if (!block || !asked.has(file.path)) return file

    // Asked for as text and answered as binary: `bigFileThreshold` is what
    // that means here, and the file is past it rather than actually binary.
    return block.binary
      ? { ...file, omitted: 'tooLarge' as const, hunks: [] }
      : { ...file, hunks: block.hunks }
  })
}

/** What git wrote about one path, gathered from however many blocks it took. */
interface CollectedFile {
  binary: boolean
  readonly hunks: Hunk[]
}

/**
 * Gathers the hunks git printed for each path.
 *
 * Blocks are joined rather than replaced, because one path can have two of
 * them: git renders a change of type — a file replaced by a symlink, or by a
 * submodule — as a `deleted file mode` block carrying the removals followed by
 * a `new file mode` block carrying the additions, both under the same name.
 * Keeping the last would draw half the change under a header whose counts
 * describe both halves.
 */
function collectHunks(blocks: readonly ParsedFile[]): Map<string, CollectedFile> {
  const byPath = new Map<string, CollectedFile>()

  for (const block of blocks) {
    const gathered = byPath.get(block.path)
    if (gathered) {
      gathered.hunks.push(...block.hunks)
      // Either half being binary is the whole file being undrawable: the other
      // half's lines describe a change the pane could only show part of.
      gathered.binary ||= block.binary
    } else {
      byPath.set(block.path, { binary: block.binary, hunks: [...block.hunks] })
    }
  }

  return byPath
}

/**
 * Says which files were left undrawn, whether or not anything else was.
 *
 * An untracked file is never in `drawable` — it is drawn from its own contents
 * rather than from git — so it is not what this is about.
 */
function markOmitted(files: readonly FileDiff[], drawable: readonly FileDiff[]): FileDiff[] {
  const asked = new Set(drawable.map((file) => file.path))

  return files.map((file) =>
    asked.has(file.path) || file.omitted !== 'none' || file.status === 'untracked'
      ? file
      : { ...file, omitted: 'tooLarge' as const }
  )
}
