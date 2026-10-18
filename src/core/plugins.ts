/**
 * Claude Code's plugins, read and changed through Claude Code's own CLI.
 *
 * The SDK can reload plugins but not install them: `Query` has
 * `reloadPlugins()` and nothing that writes. What does write is
 * `claude plugin … --json`, and that is the documented contract — so octopus
 * runs it rather than editing `settings.json` and `installed_plugins.json`
 * itself. Those files carry trust digests, scope rules and a cache layout that
 * are Claude Code's invariants to keep, and a second writer would be one more
 * way to break them.
 *
 * The CLI is the bundled one (`agentBinary`), so a plugin is installed by the
 * same version that will load it. Both read and write the same `~/.claude`.
 *
 * Every write prints **one JSON result line, last on stdout**, and a refusal
 * prints it too while exiting 1 — so stdout is the answer whatever the exit
 * code says. The listings print a whole JSON document instead. Both shapes are
 * another program's output and are read with `looseObject`, so a field added
 * upstream costs nothing.
 *
 * Nothing here reloads a running conversation; that is the service's job, after
 * a write has landed.
 */

import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { z } from 'zod'

import { agentBinary } from './agentBinary.js'
import { CodedError } from './codedError.js'

/** Machine-readable reason a plugin action failed; the renderer localises it. */
export type PluginErrorCode =
  | 'pluginCliUnavailable'
  | 'pluginTimedOut'
  | 'pluginActionFailed'
  | 'pluginOutputUnreadable'
  | 'pluginNotInstalled'
  | 'pluginProjectMissing'

/** A plugin could not be listed, installed or changed, with the CLI's reason. */
export class PluginError extends CodedError<PluginErrorCode> {
  override readonly name = 'PluginError'
}

/**
 * Where a plugin is switched on. `user` is every project on this machine, and
 * the only scope octopus installs into — the same default `/plugin` uses.
 */
export type PluginScope = 'user' | 'project' | 'local'

/**
 * The project a `project` or `local` install belongs to. It becomes the CLI's
 * working directory, which is how the CLI is told the project, so a relative
 * one would mean wherever the app happens to stand.
 */
const ProjectPathSchema = z.string().max(4096).refine(isAbsolute)

/**
 * Where one write lands, as one value rather than a scope and a path beside it.
 *
 * Apart, `project` with no path was a valid pair — and the CLI, run from home
 * for want of one, then edited the user's own settings. Together the type has
 * no such state, and `user` cannot be handed a path to stand in.
 */
export const PluginTargetSchema = z.union([
  z.object({ scope: z.literal('user') }),
  z.object({ scope: z.literal('project'), projectPath: ProjectPathSchema }),
  z.object({ scope: z.literal('local'), projectPath: ProjectPathSchema })
])
export type PluginTarget = z.infer<typeof PluginTargetSchema>

/**
 * A name as it may reach the CLI as an argument: starting with a letter or
 * digit, so it cannot be read as a flag.
 */
const ARGUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * A plugin id as it may reach the CLI: `name@marketplace`, both halves held to
 * {@link ARGUMENT_NAME}. Every one of the 3,820 ids `--available` listed fits.
 */
export const PluginIdSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/)

/** The digest the CLI reported for a command a person has now read. */
export const CommandDigestSchema = z.string().regex(/^[0-9a-f]{64}$/)

/** The marketplace Claude Code's own `/plugin` offers first. */
const OFFICIAL_MARKETPLACE = 'claude-plugins-official'
const OFFICIAL_SOURCE = 'anthropics/claude-plugins-official'

/** What a plugin brings, for the chips on its row and its card. */
export type PluginComponent = 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp' | 'lsp'

/** One installed plugin, as a row needs it. */
export interface InstalledPlugin {
  /** `name@marketplace`, which is what every command takes. */
  readonly id: string
  readonly name: string
  readonly marketplace: string
  readonly version: string | null
  /**
   * As the CLI reports it, not narrowed to {@link PluginScope}: a plugin put
   * in place by an administrator says `managed`, and it is still a row — one
   * octopus cannot change, and a caller should say so rather than hide it.
   */
  readonly scope: string
  /** In its own project, for a `project` or `local` install — see `listInstalled`. */
  readonly enabled: boolean
  /** The project a `project` or `local` install belongs to. */
  readonly projectPath: string | null
  readonly description: string | null
  readonly author: string | null
  readonly homepage: string | null
  readonly components: readonly PluginComponent[]
  /** Why it would not load, in Claude Code's words. */
  readonly errors: readonly string[]
}

/** One plugin a connected marketplace offers. */
export interface CatalogPlugin {
  readonly id: string
  readonly name: string
  readonly marketplace: string
  readonly description: string | null
  readonly version: string | null
  /** How many installs the marketplace counts; only the official one does. */
  readonly installs: number | null
  readonly category: string | null
  readonly author: string | null
  readonly homepage: string | null
  readonly keywords: readonly string[]
}

/** What the store draws. */
export interface PluginCatalog {
  /**
   * Whether the official marketplace is connected. Claude Code adds it on the
   * first interactive terminal session, so a machine that only ever ran the
   * agent through the SDK may not have it — and an empty store has to say why.
   */
  readonly officialConnected: boolean
  readonly marketplaces: readonly string[]
  readonly plugins: readonly CatalogPlugin[]
}

/**
 * What an install came to.
 *
 * `needsConsent` is a plugin whose marketplace declares a command to run, and
 * the CLI will not run one nobody saw. It reports the command and its digest;
 * the caller shows the command, and the install is repeated with that digest
 * once a person has read it. A catalog that changed in between makes the CLI
 * ask again.
 */
export type InstallOutcome =
  | { readonly kind: 'installed' }
  | { readonly kind: 'needsConsent'; readonly command: string; readonly sha256: string }

/** What one run of the CLI printed. */
export interface CliOutput {
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs `claude` with these arguments and answers with what it printed.
 *
 * Resolves on a non-zero exit when there is stdout to read, because that is
 * where a refusal explains itself. Injected so the suite never runs the real
 * CLI against the real `~/.claude`.
 */
export type PluginCli = (args: readonly string[], cwd?: string) => Promise<CliOutput>

/** How the real CLI is run; every field has the app's own default. */
export interface PluginCliOptions {
  readonly binary?: string | null
  /**
   * Where a command with no project runs. Home rather than wherever the app
   * happens to stand: the CLI reads the project around its working directory,
   * and `npm run dev` would otherwise list octopus's own project plugins.
   */
  readonly home?: string
  /**
   * Generous by default, because an install clones a repository. A hung clone
   * still ends, as a failure that says it timed out.
   */
  readonly timeoutMs?: number
  /** The `--available` listing alone is a little over 2 MB. */
  readonly maxOutput?: number
}

const CLI_TIMEOUT_MS = 120_000
const MAX_OUTPUT = 32 * 1024 * 1024

/** A manifest larger than this is not read; the official catalog is well under it. */
const MAX_MANIFEST = 8 * 1024 * 1024

/** The real CLI. */
export function pluginCli({
  binary = agentBinary(),
  home = homedir(),
  timeoutMs = CLI_TIMEOUT_MS,
  maxOutput = MAX_OUTPUT
}: PluginCliOptions = {}): PluginCli {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      if (binary === null) {
        reject(unavailable('the Claude Code binary is not installed'))
        return
      }

      execFile(
        binary,
        [...args],
        { cwd: cwd ?? home, timeout: timeoutMs, maxBuffer: maxOutput, encoding: 'utf8' },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ stdout, stderr })
            return
          }

          // Each of these ends the process part-way, so whatever stdout holds is
          // half an answer — a clone's `Cloning…` with no result after it — and
          // reading it as one would report a timeout as unreadable output.
          if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            reject(unavailable(`printed more than ${String(maxOutput)} bytes`))
          } else if (error.killed === true) {
            const seconds = String(Math.round(timeoutMs / 1000))
            reject(
              new PluginError(
                'pluginTimedOut',
                { seconds },
                `Claude Code CLI timed out: ${seconds} s`
              )
            )
          } else if (typeof error.signal === 'string') {
            // \`typeof\`, not a comparison with \`undefined\`: Node sets null on
            // a process no signal ended, whatever the type says.
            reject(unavailable(`stopped by ${error.signal}`))
          } else if (stdout.trim() !== '') {
            // A refusal: exit 1, with its result line.
            resolve({ stdout, stderr })
          } else {
            reject(unavailable(stderr.trim() || error.message))
          }
        }
      )
    })
}

function unavailable(message: string): PluginError {
  return new PluginError('pluginCliUnavailable', { message }, `Claude Code CLI failed: ${message}`)
}

const AuthorSchema = z.union([z.string(), z.looseObject({ name: z.string() })])

const InstalledItemSchema = z.looseObject({
  id: z.string(),
  version: z.string().optional(),
  scope: z.string(),
  enabled: z.boolean(),
  installPath: z.string().optional(),
  projectPath: z.string().optional(),
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  errors: z.array(z.unknown()).optional()
})

const AvailableItemSchema = z.looseObject({
  pluginId: z.string(),
  name: z.string(),
  marketplaceName: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),
  installCount: z.number().optional()
})

const AvailableSchema = z.looseObject({
  available: z.array(AvailableItemSchema),
  installed: z.array(z.looseObject({ id: z.string() })).default([])
})

const MarketplaceSchema = z.looseObject({
  name: z.string(),
  installLocation: z.string().optional()
})

const ResultSchema = z.looseObject({
  outcome: z.string(),
  message: z.string().optional(),
  failureCode: z.string().optional(),
  alreadyInGoalState: z.boolean().optional(),
  shownCommand: z.looseObject({ command: z.unknown().optional(), sha256: z.string() }).optional()
})

type Result = z.infer<typeof ResultSchema>

/** The parts of `.claude-plugin/plugin.json` a row shows. */
const ManifestSchema = z.looseObject({
  description: z.string().optional(),
  author: AuthorSchema.optional(),
  homepage: z.string().optional()
})

/** The parts of a marketplace's entry the `--available` listing leaves out. */
const MarketplaceEntrySchema = z.looseObject({
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  homepage: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional()
})

type MarketplaceEntry = z.infer<typeof MarketplaceEntrySchema>

const MarketplaceFileSchema = z.looseObject({ plugins: z.array(z.unknown()) })

/**
 * Every installed plugin, in every scope, with what it brings.
 *
 * `enabled` is answered **relative to the working directory**, measured on
 * 2.1.299: a `local` install that is on in its project lists as off from home.
 * So a row with a project takes its state from a listing run in that project —
 * one per project, and only for one that still exists. A row whose project is
 * gone keeps what home said, which is the most anyone can say about it.
 */
export async function listInstalled(cli: PluginCli): Promise<InstalledPlugin[]> {
  const items = await listItems(cli)
  const projects = [
    ...new Set(items.flatMap((item) => (item.projectPath === undefined ? [] : [item.projectPath])))
  ]
  const states = new Map<string, Map<string, boolean>>()

  for (const project of projects) {
    if (!(await isDirectory(project))) continue

    const here = await listItems(cli, project)
    states.set(
      project,
      new Map(
        here
          .filter((item) => item.projectPath === project)
          .map((item) => [`${item.id} ${item.scope}`, item.enabled] as const)
      )
    )
  }

  return Promise.all(
    items.map((item) => {
      const enabled =
        item.projectPath === undefined
          ? undefined
          : states.get(item.projectPath)?.get(`${item.id} ${item.scope}`)

      return describeInstalled({ ...item, enabled: enabled ?? item.enabled })
    })
  )
}

async function listItems(
  cli: PluginCli,
  cwd?: string
): Promise<z.infer<typeof InstalledItemSchema>[]> {
  return readDocument(await run(cli, ['plugin', 'list'], cwd), z.array(InstalledItemSchema))
}

/**
 * Everything the connected marketplaces offer.
 *
 * Filtered to those marketplaces on purpose. `--available` also lists Claude
 * Code's built-in directory — some 3,500 entries, most of them other
 * marketplaces' plugins under a second name — and the store was decided to be
 * the official marketplace and whatever the user added.
 */
export async function catalog(cli: PluginCli): Promise<PluginCatalog> {
  const marketplaces = await listMarketplaces(cli)
  const names = marketplaces.map((marketplace) => marketplace.name)
  const officialConnected = names.includes(OFFICIAL_MARKETPLACE)

  // Nothing to offer, so the slow listing is not worth starting.
  if (names.length === 0) return { officialConnected, marketplaces: names, plugins: [] }

  const { available, installed } = readDocument(
    await run(cli, ['plugin', 'list', '--available']),
    AvailableSchema
  )
  const entries = new Map(
    await Promise.all(
      marketplaces.map(
        async (marketplace) => [marketplace.name, await marketplaceEntries(marketplace)] as const
      )
    )
  )

  // Measured on 2.1.299: `available` leaves out a plugin once it is installed
  // for every project, so the store would lose a card the moment its install
  // worked. It comes back from the marketplace's own entry — without a count,
  // which only the listing carries.
  const listed = new Set(available.map((item) => item.pluginId))
  const returned = [...new Set(installed.map((item) => item.id))]
    .filter((id) => !listed.has(id))
    .map((id) => {
      const { name, marketplace } = splitId(id)
      return {
        pluginId: id,
        name,
        marketplaceName: marketplace,
        description: entries.get(marketplace)?.get(name)?.description
      }
    })

  const plugins = [...available, ...returned]
    .filter((item) => names.includes(item.marketplaceName))
    .map((item) => describeAvailable(item, entries.get(item.marketplaceName)?.get(item.name)))

  return { officialConnected, marketplaces: names, plugins }
}

/** Installs into the user scope, or reports the command it would have to run. */
export async function installPlugin(
  cli: PluginCli,
  id: string,
  acceptCommand?: string
): Promise<InstallOutcome> {
  const accept = acceptCommand === undefined ? [] : ['--accept-command', acceptCommand]
  const result = await act(cli, ['plugin', 'install', id, '--scope', 'user', ...accept])

  if (result.outcome === 'ok') return { kind: 'installed' }

  if (result.shownCommand !== undefined) {
    return {
      kind: 'needsConsent',
      command: commandText(result.shownCommand.command),
      sha256: result.shownCommand.sha256
    }
  }

  throw failed(result)
}

/**
 * Removes a plugin from one scope, and its data directory with it.
 *
 * The data goes because that is what removing means in `/plugin` as well, and
 * a caller should say so before asking.
 */
export async function uninstallPlugin(
  cli: PluginCli,
  id: string,
  target: PluginTarget
): Promise<void> {
  await requireInstalled(cli, id, target)
  settle(await act(cli, ['plugin', 'uninstall', id, '--scope', target.scope], projectOf(target)))
}

/**
 * Switches a plugin on or off in one scope.
 *
 * A plugin already in that state is a success: the CLI refuses it with
 * `alreadyInGoalState`, and a switch that ends where it was asked to end has
 * done its job — a second click while the list caught up is the usual way
 * there.
 */
export async function setPluginEnabled(
  cli: PluginCli,
  id: string,
  enabled: boolean,
  target: PluginTarget
): Promise<void> {
  await requireInstalled(cli, id, target)
  const verb = enabled ? 'enable' : 'disable'
  settle(await act(cli, ['plugin', verb, id, '--scope', target.scope], projectOf(target)))
}

/** Adds the official marketplace, as Claude Code's first terminal session would. */
export async function connectOfficialMarketplace(cli: PluginCli): Promise<void> {
  settle(await act(cli, ['plugin', 'marketplace', 'add', OFFICIAL_SOURCE]))
}

/**
 * Pulls every connected marketplace again.
 *
 * One at a time and by name, because `marketplace update` with no name has no
 * JSON result to read. Every marketplace is tried before the first failure is
 * reported, whatever the failure — so one unreachable source does not leave the
 * rest stale.
 *
 * A name is a marketplace's own word for itself and goes back to the CLI as an
 * argument, so one that could be read as a flag is refused rather than passed.
 */
export async function refreshMarketplaces(cli: PluginCli): Promise<void> {
  let failure: PluginError | null = null

  for (const { name } of await listMarketplaces(cli)) {
    if (!ARGUMENT_NAME.test(name)) {
      failure ??= new PluginError(
        'pluginActionFailed',
        { message: `refused marketplace name "${name}"` },
        `Refused marketplace name: ${name}`
      )
      continue
    }

    try {
      const result = await act(cli, ['plugin', 'marketplace', 'update', name])
      if (result.outcome !== 'ok') failure ??= failed(result)
    } catch (error) {
      // Only ours are a marketplace's failure; anything else is a fault here.
      if (!(error instanceof PluginError)) throw error
      failure ??= error
    }
  }

  if (failure !== null) throw failure
}

/**
 * Refuses a write aimed at a plugin that is not installed there.
 *
 * The target is the renderer's to name, and a project path becomes the CLI's
 * working directory — where it writes `.claude/settings*.json`. Held to what
 * the listing reports, no directory can be named that Claude Code did not
 * already record a plugin in.
 */
async function requireInstalled(cli: PluginCli, id: string, target: PluginTarget): Promise<void> {
  const project = projectOf(target)
  const installed = (await listItems(cli)).some(
    (item) => item.id === id && item.scope === target.scope && item.projectPath === project
  )

  if (!installed) {
    throw new PluginError(
      'pluginNotInstalled',
      { id, scope: target.scope },
      `Not installed in ${target.scope} scope: ${id}`
    )
  }
}

function projectOf(target: PluginTarget): string | undefined {
  return target.scope === 'user' ? undefined : target.projectPath
}

async function listMarketplaces(cli: PluginCli): Promise<z.infer<typeof MarketplaceSchema>[]> {
  return readDocument(await run(cli, ['plugin', 'marketplace', 'list']), z.array(MarketplaceSchema))
}

/**
 * Every command here wants `--json`, so it is added in one place — and a
 * project that has gone is said to have gone. `spawn` reports a missing working
 * directory as the **binary** missing (`spawn …/claude ENOENT`), which would
 * tell the user Claude Code is not installed when it is their project that
 * was deleted.
 */
async function run(cli: PluginCli, args: readonly string[], cwd?: string): Promise<CliOutput> {
  if (cwd !== undefined && !(await isDirectory(cwd))) {
    throw new PluginError('pluginProjectMissing', { path: cwd }, `Project is gone: ${cwd}`)
  }

  return cli([...args, '--json'], cwd)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** A write, answered by its result line. */
async function act(cli: PluginCli, args: readonly string[], cwd?: string): Promise<Result> {
  const { stdout, stderr } = await run(cli, args, cwd)
  // The last line, not the whole output: the result is documented as the last
  // line, which leaves the CLI free to print progress above it.
  const text = stdout.trimEnd()
  const line = text.slice(text.lastIndexOf('\n') + 1)

  return readDocument({ stdout: line, stderr }, ResultSchema)
}

function settle(result: Result): void {
  if (result.outcome === 'ok' || result.alreadyInGoalState === true) return

  throw failed(result)
}

function failed(result: Result): PluginError {
  // The CLI's own sentence. It is English and it is the only explanation there
  // is, so it travels as a parameter for a localised frame around it.
  const message = result.message ?? result.failureCode ?? result.outcome

  return new PluginError('pluginActionFailed', { message }, `Plugin action failed: ${message}`)
}

function readDocument<T>({ stdout, stderr }: CliOutput, schema: z.ZodType<T>): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw unreadable(stdout, stderr)
  }

  const result = schema.safeParse(parsed)
  if (!result.success) throw unreadable(stdout, stderr)

  return result.data
}

function unreadable(stdout: string, stderr: string): PluginError {
  // stderr first: when stdout is not the answer, stderr is usually why
  // ("✘ Failed …"). Bounded, because the listing that failed may be two
  // megabytes.
  const excerpt = (stderr.trim() || stdout.trim()).slice(0, 200)

  return new PluginError(
    'pluginOutputUnreadable',
    { message: excerpt },
    `Claude Code CLI printed something unreadable: ${excerpt}`
  )
}

async function describeInstalled(
  item: z.infer<typeof InstalledItemSchema>
): Promise<InstalledPlugin> {
  const { name, marketplace } = splitId(item.id)
  const path = item.installPath
  const [manifest, present] = await Promise.all([
    path === undefined
      ? null
      : readLenient(join(path, '.claude-plugin', 'plugin.json'), ManifestSchema),
    path === undefined ? new Set<string>() : listNames(path)
  ])

  const components: PluginComponent[] = []
  for (const kind of ['skills', 'commands', 'agents', 'hooks'] as const) {
    if (present.has(kind) || (manifest !== null && kind in manifest)) components.push(kind)
  }
  if (
    Object.keys(item.mcpServers ?? {}).length > 0 ||
    present.has('.mcp.json') ||
    (manifest !== null && 'mcpServers' in manifest)
  ) {
    components.push('mcp')
  }
  if (present.has('.lsp.json') || (manifest !== null && 'lspServers' in manifest)) {
    components.push('lsp')
  }

  return {
    id: item.id,
    name,
    marketplace,
    version: item.version ?? null,
    scope: item.scope,
    enabled: item.enabled,
    projectPath: item.projectPath ?? null,
    description: manifest?.description ?? null,
    author: authorName(manifest?.author),
    homepage: manifest?.homepage ?? null,
    components,
    errors: (item.errors ?? []).map(errorText)
  }
}

function describeAvailable(
  item: z.infer<typeof AvailableItemSchema>,
  entry: MarketplaceEntry | undefined
): CatalogPlugin {
  return {
    id: item.pluginId,
    name: item.name,
    marketplace: item.marketplaceName,
    description: item.description ?? null,
    version: item.version ?? null,
    installs: item.installCount ?? null,
    category: entry?.category ?? null,
    author: authorName(entry?.author),
    homepage: entry?.homepage ?? null,
    keywords: entry?.keywords ?? entry?.tags ?? []
  }
}

/**
 * A marketplace's own entries by plugin name, for what the listing leaves out.
 *
 * Read leniently, entry by entry: losing this file costs the store its
 * categories and authors, never a plugin.
 */
async function marketplaceEntries(
  marketplace: z.infer<typeof MarketplaceSchema>
): Promise<Map<string, MarketplaceEntry>> {
  const entries = new Map<string, MarketplaceEntry>()
  if (marketplace.installLocation === undefined) return entries

  const file = await readLenient(
    join(marketplace.installLocation, '.claude-plugin', 'marketplace.json'),
    MarketplaceFileSchema
  )

  for (const raw of file?.plugins ?? []) {
    const entry = MarketplaceEntrySchema.safeParse(raw)
    if (entry.success) entries.set(entry.data.name, entry.data)
  }

  return entries
}

/**
 * A JSON file, or null for anything short of a clear answer — missing, too
 * large, not JSON, not the shape. These are details beside a row that stands
 * without them.
 */
async function readLenient<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    if ((await stat(path)).size > MAX_MANIFEST) return null

    const raw = await readFile(path, 'utf8')
    const result = schema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

async function listNames(path: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(path))
  } catch {
    return new Set()
  }
}

/** `name@marketplace`, split at the last `@` — a name never carries one. */
function splitId(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@')

  return at === -1
    ? { name: id, marketplace: '' }
    : { name: id.slice(0, at), marketplace: id.slice(at + 1) }
}

function authorName(author: z.infer<typeof AuthorSchema> | undefined): string | null {
  if (author === undefined) return null

  return typeof author === 'string' ? author : author.name
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error
    if (typeof message === 'string') return message
  }

  return JSON.stringify(error)
}

function commandText(command: unknown): string {
  if (typeof command === 'string') return command
  // Absent is possible — the field is the CLI's — and `stringify` answers
  // `undefined` for it whatever its type says.
  if (command === undefined) return ''

  return JSON.stringify(command)
}
