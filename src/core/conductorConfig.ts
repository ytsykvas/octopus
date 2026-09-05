/**
 * A repository's Conductor configuration, as far as octopus can use it.
 *
 * Conductor is the tool octopus is modelled on, and a repository already set up
 * for it carries much of what a project here needs: the three scripts, and
 * prose for some of the actions the pull request pane offers. A checkout that
 * has one should not have to be configured twice.
 *
 * **Its `file_include_globs` is read and shown, never followed.** Feeding it to
 * `carryInto` is ruled out by a decision already written down —
 * `docs/repo-config.md` keeps the carry list deliberately not live, and copying
 * paths a `git pull` can change into a worktree is the class of thing
 * `repoSource.ts` argues must be shown and approved — and its patterns could
 * not be followed anyway, since `carryInto` hands each entry to `copyFile`. So
 * what this parse is for is telling the reader what the repository declares,
 * beside the list that decides what actually travels.
 *
 * **This module reads; it never writes.** Export still goes to `.octopus/`
 * alone (`repoConfig.ts`), so the promise in `SECURITY.md` about where this app
 * writes inside a checkout is unchanged.
 *
 * Nothing here executes anything either. A script in Conductor's settings is a
 * **command line**, so what comes back is a string — and what turns a string
 * into a running process is `repoSource.ts`, behind an approval.
 */

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

import type { InstructionKind } from './instructions.js'
import { RepoConfigError, assertUnlinkedPath } from './repoConfig.js'
import type { ScriptKind } from './scripts.js'
import { shellQuote } from './terminal.js'

/** The directory a repository keeps its Conductor settings in. */
export const CONDUCTOR_DIR = '.conductor'

/**
 * Where the settings may live, most specific first.
 *
 * The two TOML files are a layer of their own: Conductor merges the machine's
 * `settings.local.toml` over the committed `settings.toml`, and any TOML beats
 * the legacy JSON entirely. Reading the local file is right for a tool that is
 * itself installed on one machine — it is the answer to "what does this
 * checkout do **here**".
 */
const TOML_FILES = [
  join(CONDUCTOR_DIR, 'settings.toml'),
  join(CONDUCTOR_DIR, 'settings.local.toml')
] as const
const JSON_FILES = [join(CONDUCTOR_DIR, 'settings.json'), 'conductor.json'] as const

/** How much of one file is read, so a large one cannot hold the app up. */
const MAX_BYTES = 256 * 1024

/**
 * Conductor's prompts, under the names octopus gives the same jobs.
 *
 * Four of the seven. The rest have no counterpart, which is not a gap to fill:
 * an instruction nobody wrote falls back to its own template.
 *
 * **`general` is deliberately absent.** octopus adds nothing to the system
 * prompt (§12.3 of docs/PROJECT.md), and a `general` prompt is exactly that —
 * importing it would make the app start doing silently what it says it does
 * not. A repository that wants the agent to know something puts it in
 * `CLAUDE.md`, which octopus loads through the ordinary settings sources.
 */
const PROMPT_KINDS: Readonly<Record<string, InstructionKind>> = {
  code_review: 'review',
  create_pr: 'pullRequest',
  fix_errors: 'fixChecks',
  resolve_merge_conflicts: 'resolveConflicts'
}

/**
 * One entry of `[scripts.run.<id>]`.
 *
 * `.loose()`, like everything below: Conductor ships often, and a key this
 * build has never heard of is not a reason to refuse the ones it understands.
 */
const RunEntrySchema = z
  .object({
    command: z.string().max(8_000).optional(),
    args: z.array(z.string().max(4_000)).max(64).optional(),
    options: z
      .object({ cwd: z.string().max(1_000).optional() })
      .loose()
      .optional(),
    default: z.boolean().optional(),
    available_in: z.union([z.string(), z.array(z.string()).max(8)]).optional()
  })
  .loose()

type RunEntry = z.infer<typeof RunEntrySchema>

const SettingsSchema = z
  .object({
    scripts: z
      .object({
        setup: z.string().max(8_000).optional(),
        archive: z.string().max(8_000).optional(),
        run: z.union([z.string().max(8_000), z.record(z.string(), RunEntrySchema)]).optional()
      })
      .loose()
      .optional(),
    file_include_globs: z.string().max(8_000).optional(),
    prompts: z.record(z.string(), z.string().max(16_000)).optional()
  })
  .loose()

/** A script Conductor names, as a command line for a shell. */
export interface ConductorScript {
  readonly command: string
  /** The `[scripts.run.<id>]` it came from, when it was a named one. */
  readonly name: string | null
  /**
   * The settings file this came from, relative to the checkout.
   *
   * Per script rather than one for the whole config, because the merge is
   * per top-level key: a `settings.local.toml` holding only `[git]` leaves the
   * scripts to `settings.toml`, and naming the local file as their source
   * would be wrong in the direction that misleads — the reader would look for
   * a script in a file that does not mention one.
   */
  readonly path: string
}

/**
 * One path a repository declares under `file_include_globs`.
 *
 * `pattern` is the honest half. `carryInto` copies literal paths, so a glob
 * added to the carry list names a file that does not exist — and whatever draws
 * this has to say so rather than implying the entry would be honoured.
 */
export interface DeclaredFile {
  readonly glob: string
  readonly pattern: boolean
}

/** Anything in a glob that `copyFile` cannot be given as a filename. */
const GLOB_CHARACTERS = /[*?[\]{}]/u

/** What octopus can use out of a repository's Conductor settings. */
export interface ConductorConfig {
  /**
   * Which file the prompts came from; empty when there are none.
   *
   * An empty string rather than `null` because the only reader asks for it
   * *having found a prompt*, where it is always a path — a nullable field would
   * be an arm nothing could reach.
   */
  readonly promptsPath: string
  readonly scripts: Readonly<Partial<Record<ScriptKind, ConductorScript>>>
  readonly prompts: Readonly<Partial<Record<InstructionKind, string>>>
  /** What the repository says its workspaces need, in declaration order. */
  readonly files: readonly DeclaredFile[]
  /** Which file declared them; empty when none did, as `promptsPath` is. */
  readonly filesPath: string
}

/**
 * The command line a named run entry stands for.
 *
 * Conductor does not shell-parse this form — `command` and `args` are an argv —
 * so each part is quoted on the way into a line that a shell will parse. The
 * string form is the opposite and is passed through untouched: it is already a
 * command line, and quoting it would turn `-p $CONDUCTOR_PORT` into the literal
 * name of a program.
 *
 * `exec` because the runner stops a script by ending its terminal, and a shell
 * waiting on a child is one more process for the signal to travel through.
 */
function entryCommand(entry: RunEntry): string | null {
  if (entry.command === undefined || entry.command === '') return null

  const parts = [entry.command, ...(entry.args ?? [])].map(shellQuote).join(' ')
  const cwd = entry.options?.cwd

  return cwd === undefined || cwd === ''
    ? `exec ${parts}`
    : `cd ${shellQuote(cwd)} && exec ${parts}`
}

/** Whether an entry is one this machine could run at all. */
function runsLocally(entry: RunEntry): boolean {
  const where = entry.available_in
  if (where === undefined) return true

  return typeof where === 'string' ? where === 'local' : where.includes('local')
}

/**
 * Which of several named run entries is the one to offer.
 *
 * octopus has one server script, so one has to be picked, and the rule is
 * Conductor's own reading of its fields: the one marked `default`, else the
 * first that this machine could run at all, else simply the first.
 *
 * The rest are **dropped**, and that is worth saying rather than leaving to be
 * discovered: this used to answer with them, and a comment here said they were
 * "written into the script as comments" — which nothing did. A list nobody
 * reads is not a way of telling anybody anything, so it went. Showing them is a
 * feature with a surface to design, and `docs/tasks/` holds it.
 */ function chooseRun(entries: Record<string, RunEntry>, path: string): ConductorScript | null {
  // The command is worked out once, here, and carried: asking again below left
  // a `null` arm that nothing could reach.
  const named = Object.entries(entries).flatMap(([name, entry]) => {
    const command = entryCommand(entry)
    return command === null ? [] : [{ name, entry, command }]
  })

  const pick =
    named.find(({ entry }) => entry.default === true) ??
    named.find(({ entry }) => runsLocally(entry)) ??
    named[0]

  if (pick === undefined) return null

  return { command: pick.command, name: pick.name, path }
}

/** A file that contributed, and which top-level keys it supplied. */
interface Layer {
  readonly path: string
  readonly value: Record<string, unknown>
}

/**
 * The settings a repository holds, or null when it holds none.
 *
 * Every path is checked segment by segment before it is opened: a symlinked
 * `.conductor` would otherwise present a file from outside the checkout under a
 * path inside it, which is the same guarantee `repoConfig.ts` keeps for
 * `.octopus/`.
 */
export async function readConductorConfig(repoPath: string): Promise<ConductorConfig | null> {
  const toml = await readLayers(repoPath, TOML_FILES, (text) => parseToml(text))
  const layers =
    toml.length > 0
      ? toml
      : await readLayers(repoPath, JSON_FILES, (text) => JSON.parse(text) as unknown)

  return layers.length === 0 ? null : normalise(layers)
}

/**
 * Reads a list of candidates, in order, and answers with the ones that exist.
 *
 * The merge itself is left to `normalise`, which needs to know not just the
 * winning value of each top-level key but **which file supplied it** — the
 * answer to "where does this script come from", asked of a checkout whose
 * machine-local file may set nothing but `[git]`.
 */
async function readLayers(
  repoPath: string,
  candidates: readonly string[],
  parse: (text: string) => unknown
): Promise<Layer[]> {
  const layers: Layer[] = []

  for (const candidate of candidates) {
    const text = await readCandidate(repoPath, candidate)
    if (text === null) continue

    let parsed: unknown
    try {
      parsed = parse(text)
    } catch (error) {
      throw new RepoConfigError(
        'repoConfigMalformed',
        { path: candidate },
        `${candidate} could not be parsed: ${String(error)}`
      )
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new RepoConfigError(
        'repoConfigMalformed',
        { path: candidate },
        `${candidate} does not describe settings.`
      )
    }

    layers.push({ path: candidate, value: parsed as Record<string, unknown> })
  }

  return layers
}

/** One candidate's text, or null when it is not there. */
async function readCandidate(repoPath: string, relative: string): Promise<string | null> {
  await assertUnlinkedPath(repoPath, relative)
  const path = join(repoPath, relative)

  /*
   * Asked before the read, not after it.
   *
   * The size is refused so that a large file cannot hold the app up — and
   * measuring it from the string meant the whole thing was in memory before
   * anybody objected, which is the opposite of the promise. `stat` costs one
   * syscall and answers first.
   */
  try {
    if ((await stat(path)).size > MAX_BYTES) {
      throw new RepoConfigError(
        'repoConfigTooLarge',
        { path: relative },
        `${relative} is too large to read.`
      )
    }

    return await readFile(path, 'utf8')
  } catch (error) {
    // A refusal is an answer; anything else here means the file is not there —
    // the ordinary case — or went between the two calls, which is the same
    // thing from where this stands.
    if (error instanceof RepoConfigError) throw error
    return null
  }
}

/**
 * The last layer to define a top-level key, and the file it was in.
 *
 * Shallow and per key, which is what Conductor documents: a local file naming
 * one script replaces the whole `scripts` table and leaves the prompts alone.
 */
function winner(layers: readonly Layer[], key: string): Layer | null {
  let found: Layer | null = null
  for (const layer of layers) if (key in layer.value) found = layer

  return found
}

/** The validated files turned into what the rest of the app asks for. */
/**
 * The globs a repository declares, one per line.
 *
 * Conductor writes this as one string with newlines in it, and comments in it
 * the way the carry list has them — so it is split the same way
 * `carriedFiles` splits its own, and for the same reason.
 */
function declaredFiles(raw: string | undefined): DeclaredFile[] {
  return (raw ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((glob) => ({ glob, pattern: GLOB_CHARACTERS.test(glob) }))
}

function normalise(layers: readonly Layer[]): ConductorConfig {
  const parsed = layers.map((layer) => {
    const result = SettingsSchema.safeParse(layer.value)
    if (!result.success) {
      throw new RepoConfigError(
        'repoConfigMalformed',
        { path: layer.path },
        `${layer.path} does not describe settings: ${result.error.message}`
      )
    }

    return { path: layer.path, value: result.data }
  })

  const scriptsLayer = winner(layers, 'scripts')
  const raw = parsed.find((layer) => layer.path === scriptsLayer?.path)?.value.scripts
  const from = scriptsLayer?.path ?? ''

  const scripts: Partial<Record<ScriptKind, ConductorScript>> = {}
  if (raw?.setup !== undefined && raw.setup !== '') {
    scripts.setup = { command: raw.setup, name: null, path: from }
  }
  if (raw?.archive !== undefined && raw.archive !== '') {
    scripts.archive = { command: raw.archive, name: null, path: from }
  }

  if (typeof raw?.run === 'string') {
    if (raw.run !== '') scripts.run = { command: raw.run, name: null, path: from }
  } else if (raw?.run !== undefined) {
    const chosen = chooseRun(raw.run, from)
    if (chosen !== null) scripts.run = chosen
  }

  const promptsLayer = winner(layers, 'prompts')
  const rawPrompts = parsed.find((layer) => layer.path === promptsLayer?.path)?.value.prompts ?? {}

  const prompts: Partial<Record<InstructionKind, string>> = {}
  for (const [name, body] of Object.entries(rawPrompts)) {
    const kind = PROMPT_KINDS[name]
    if (kind !== undefined && body.trim() !== '') prompts[kind] = body
  }

  const filesLayer = winner(layers, 'file_include_globs')
  const files = declaredFiles(
    parsed.find((layer) => layer.path === filesLayer?.path)?.value.file_include_globs
  )

  return {
    promptsPath: promptsLayer !== null && Object.keys(prompts).length > 0 ? promptsLayer.path : '',
    scripts,
    prompts,
    files,
    filesPath: filesLayer !== null && files.length > 0 ? filesLayer.path : ''
  }
}
