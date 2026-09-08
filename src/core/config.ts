/**
 * Global application settings — `~/.octopus/config.json`.
 *
 * Created on first run, then only read and updated.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { StandingPermissionSchema } from './standingPermissions.js'

import {
  DEFAULT_EFFORT,
  type Effort,
  EXIT_PLAN_MODE,
  StoredEffortSchema,
  type WorkingMode,
  WorkingModeSchema
} from './chats.js'
import { configFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'
import { ASK_USER_QUESTION } from './questions.js'

/**
 * Tools no standing approval may ever cover.
 *
 * Both are tools whose whole purpose is to put something in front of the user,
 * and `askPermission` answers a tool on this list **before it emits anything at
 * all** — so a standing "always" here does not grant a permission, it deletes
 * the thing the tool exists to show.
 *
 * `ExitPlanMode` is how the agent hands a finished plan back, so a standing
 * "always" accepts every future plan unread: no dialog, no record that planning
 * ended, a toggle still lit over an agent that has started editing.
 *
 * `AskUserQuestion` is how the agent asks the user to choose. Approved
 * standing, the question is answered before it is drawn — the tool then runs
 * with no answers in it, and the agent, reading that nobody replied, says so
 * and stops. Which is exactly what it did: this name reached a real config
 * through the card's own "always allow" button, and the conversation dead-ended
 * on a question the user never saw.
 *
 * Both got into one of these lists before there was anything to stop it, which
 * is why this strips rather than merely refuses.
 */
const NEVER_STANDING: readonly string[] = [EXIT_PLAN_MODE, ASK_USER_QUESTION]

/**
 * Which setting sources the agent is allowed to load.
 *
 * The default is `all` (§12.3 docs/PROJECT.md): octopus is a harness around
 * Claude Code, not a filter on it, so the agent arrives knowing what the
 * project and the user have written for it. The switch is still offered —
 * nothing / `project` / `user + project + local` — for anyone who wants
 * isolation; it is simply no longer what everybody gets. Version 2 of the
 * config raises an install that was still on `none`.
 */
export const SettingSourcesModeSchema = z.enum(['none', 'project', 'all'])
export type SettingSourcesMode = z.infer<typeof SettingSourcesModeSchema>

export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>

export const LanguageSchema = z.enum(['en', 'uk'])
export type LanguagePreference = z.infer<typeof LanguageSchema>

/**
 * The right pane's tabs, named here so the pane and the stored value cannot
 * drift apart. The renderer takes the **type** only — this module reaches
 * `node:os` through `paths.ts`, and a value import would follow it there.
 */
export const RIGHT_PANEL_TABS = ['diff', 'terminal', 'scripts', 'pullRequest', 'notes'] as const
export const RightPanelTabSchema = z.enum(RIGHT_PANEL_TABS)
export type RightPanelTab = z.infer<typeof RightPanelTabSchema>

/**
 * The tab as it is stored, which is not quite as it is offered.
 *
 * Build and server were two tabs before they were one, and configs on disk name
 * them. `.default()` answers for a key that is missing and says nothing about a
 * key that is present holding a word this build no longer knows — and
 * `persist.ts` throws on a value it cannot parse rather than resetting, at
 * `createService`, un-guarded. Left to the plain enum, every existing install
 * would fail to start over a tab nobody chose.
 *
 * So the two old names are still accepted and folded into the one that replaced
 * them. Applied on the way in **and** on the way out, since `persist.ts` writes
 * what the schema returned: the stale word leaves the disk the next time
 * anything is saved. `StoredEffortSchema` in `chats.ts` is the same shape for
 * the same reason.
 */
export const StoredRightPanelTabSchema = z
  .enum([...RIGHT_PANEL_TABS, 'build', 'server'])
  .default('diff')
  .transform((tab): RightPanelTab => (tab === 'build' || tab === 'server' ? 'scripts' : tab))

export const ConfigSchema = z.object({
  /**
   * Format version.
   *
   * 2 raised `settingSources` from `none` to `all`. That was not a fix to a
   * shape but a reversal of a decision: version 1 kept the agent from reading
   * the project's own `CLAUDE.md`, and only a migration could undo it for
   * anybody already installed. A config already on 2 is never touched again, so
   * choosing `none` deliberately survives.
   */
  version: z.literal(2),

  /** Branch prefix for workspaces, e.g. a GitHub username. */
  branchPrefix: z.string().min(1),

  /**
   * Where repositories cloned from GitHub land.
   *
   * Defaulted rather than required so a config from an older build still
   * loads; an empty string means "ask every time".
   */
  cloneDirectory: z.string().default(''),

  settingSources: SettingSourcesModeSchema,

  /**
   * How much a new chat lets the agent do before asking.
   *
   * Global rather than per workspace: the answer is a working habit, and being
   * asked it again on every new branch is the kind of friction that gets a
   * setting turned all the way off.
   *
   * Planning is deliberately not one of the choices, though the old
   * `permissionMode` this replaces offered it. Whether to plan is a judgement
   * about one task — is it broad enough to want the approach agreed first —
   * and a standing answer to that question is not a working habit but a way of
   * never being asked it.
   */
  workingMode: WorkingModeSchema.default('default'),

  /**
   * How much thinking a new chat asks for; always a level.
   *
   * Global for the same reason as the mode above. It named no level for a
   * while, on the grounds that the SDK already has an answer — but the composer
   * shows this setting, and a control naming a level the agent was never told
   * about is the interface reporting a decision that was not taken. Naming one
   * and sending it is the honest half of that trade.
   */
  effort: StoredEffortSchema,

  /**
   * The models a new chat starts on: one that writes the code, one that plans.
   *
   * Global for the reason the mode and the effort above are — which model does
   * which job is a working habit, and re-answering it in every conversation is
   * the friction that gets a setting left alone.
   *
   * Both nullable and both defaulted, and the two nulls mean different things:
   * `model` null is the agent's own default, `planModel` null is "no split".
   * `ChatSchema` explains the asymmetry at length; these are copied onto a new
   * record by `newChat`, so the meanings have to match exactly.
   *
   * No model name is written down here or anywhere else: the catalogue arrives
   * from the running agent, so a model added or withdrawn upstream needs no
   * release of ours.
   */
  model: z.string().min(1).nullable().default(null),
  planModel: z.string().min(1).nullable().default(null),

  /**
   * What the user has answered "always" for, and how narrow each answer is.
   *
   * Kept here rather than inside the SDK's own permission rules, because
   * `settingSources` may well be `none` — in which case the SDK has nowhere to
   * write them, and the answer would be forgotten the moment the session ends.
   * A list in the config is also a list the user can read and shorten (§4).
   *
   * An entry used to be a bare tool name, so answering "always" about one file
   * under `.claude/` granted every `Edit` in every workspace. It is a rule now,
   * carrying the place the question was about — see `standingPermissions.ts`.
   * A bare name is still read, and still means the whole tool, which is exactly
   * what it always meant: a normalisation rather than a version bump, which is
   * the convention `StateSchema` states.
   *
   * Filtered rather than merely validated, and the schema is used on the way
   * out as well as in, so a config holding one of these is cleaned the next
   * time it is written.
   */
  alwaysAllowedTools: z
    .array(StandingPermissionSchema)
    .default([])
    .transform((rules) => rules.filter((rule) => !NEVER_STANDING.includes(rule.toolName))),

  /**
   * Skills that are off in every new conversation, by the key the agent knows
   * them by.
   *
   * A list of the ones switched **off** rather than the ones switched on, so
   * an empty list means what it says on a fresh install: every skill the agent
   * discovers is available, which is how Claude Code behaves without us. The
   * alternative would leave a skill somebody has just written doing nothing
   * until they found a second control and ticked it.
   *
   * Names the checkout's skills as readily as our own — a repository skill
   * nobody wants in any conversation is answered here rather than switched off
   * again in each one.
   */
  disabledSkillDefaults: z.array(z.string()).default([]),

  theme: ThemePreferenceSchema,

  /**
   * Newer fields carry a default so a config written by an older build still
   * loads. Without it, adding a field would reject every existing config as
   * malformed — which is what happened when `language` was introduced.
   */
  language: LanguageSchema.default('en'),

  /**
   * Width of the right pane in pixels.
   *
   * Stored because it is a working preference, not a view state: someone who
   * widened the pane to read test output wants it that way tomorrow too.
   *
   * The lower bound is functional: below ~280px a terminal wraps almost every
   * line of build output. The upper one only has to survive a move to a
   * smaller display — what actually limits dragging is how much room the centre
   * pane needs, which depends on the window and on how wide the workspace list
   * has been dragged, and so cannot live here.
   *
   * Only a drag is written here. Resizing the window moves the pane too — it
   * takes what the window gains or loses so the centre keeps its width — but
   * that is measured from this number rather than replacing it, so a window put
   * back where it was puts the pane back too.
   */
  rightPanelWidth: z.number().int().min(280).max(4000).default(360),

  /**
   * How a diff is laid out: one column, or the two sides beside each other.
   *
   * Stored rather than kept per session because it is a preference about how
   * code is read, not a mood. Side by side needs room the pane may not have,
   * and the panel falls back to one column when it does not — the stored value
   * is what the reader asked for, not what is currently on screen.
   */
  diffView: z.enum(['unified', 'split']).default('unified'),

  /**
   * Which of the right pane's tabs is showing.
   *
   * Stored for the same reason as the two above: the pane's width persists and
   * so does the diff's layout, and the tab is the one thing about that pane a
   * reader changes most often. Somebody who works with the server log open got
   * Changes back on every launch.
   *
   * Whether the pane is folded away is deliberately **not** stored — that is a
   * mood about the current window, and `App` keeps it. This says what is behind
   * the tab strip when there is one, not whether there is one.
   */
  rightPanelTab: StoredRightPanelTabSchema,

  /**
   * Width of the workspace list in pixels.
   *
   * The lower bound is where the project name stops having room beside the
   * buttons in its header: below it the name is all ellipsis, and the row reads
   * as broken rather than as narrow.
   */
  sidebarWidth: z.number().int().min(180).max(560).default(240),

  /**
   * Stable device identifier, shown in Settings.
   *
   * Introduced as an anchor for licence binding, which is not happening — the
   * app is open source. It stays because it is the only stable name this
   * installation has, and a support conversation about a broken state file has
   * nothing else to quote.
   */
  deviceId: z.uuid(),

  /** First-run timestamp, shown in Settings. */
  installedAt: z.iso.datetime()
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Builds the first-run config.
 *
 * `now` and `uuid` are parameters so the function stays pure and testable
 * without patching global time.
 */
export function createDefaultConfig(
  branchPrefix: string,
  now: Date = new Date(),
  uuid: () => string = randomUUID
): Config {
  const workingMode: WorkingMode = 'default'
  const effort: Effort = DEFAULT_EFFORT

  return {
    version: 2,
    branchPrefix,
    settingSources: 'all',
    workingMode,
    effort,
    // Nothing to name: no catalogue has arrived on a first run, and the two
    // nulls are already the right answers — the agent's own choice, and no
    // split between planning and writing.
    model: null,
    planModel: null,
    alwaysAllowedTools: [],
    disabledSkillDefaults: [],
    theme: 'system',
    language: 'en',
    cloneDirectory: '',
    rightPanelWidth: 360,
    diffView: 'unified',
    rightPanelTab: 'diff',
    sidebarWidth: 240,
    deviceId: uuid(),
    installedAt: now.toISOString()
  }
}

/**
 * The config as it may be found on disk, before `migrateConfig` has run.
 *
 * The same split `store.ts` makes between `StoredState` and `State`: a version
 * the current build no longer writes still has to parse here, or every other
 * setting in the file would be unreachable because of one number.
 *
 * A version this build has never heard of is a different matter and is **not**
 * accepted: `readJsonFile` throws `InvalidFileError`, `createService` does not
 * catch it, and the app says so and quits. That is deliberate — a newer build
 * wrote that file, and starting anyway would write it back in an older shape,
 * silently discarding whatever the newer one had put there.
 */
export const StoredConfigSchema = ConfigSchema.extend({
  version: z.union([z.literal(1), z.literal(2)])
})

export type StoredConfig = z.infer<typeof StoredConfigSchema>

/**
 * Brings a config written by an older build up to date.
 *
 * Version 1 shipped `settingSources: 'none'`, which stopped the agent from
 * loading the project's `CLAUDE.md`, its `.claude/` settings, its commands and
 * its skills — an agent less capable than the same model in a terminal. The
 * default is now `all`; an install already carrying `none` would keep it for
 * ever without this, since a default only reaches a config that is being
 * created.
 *
 * Only on the way from 1. Once a config says 2, whatever it holds is a choice.
 */
export function migrateConfig(config: StoredConfig): Config {
  if (config.version === 2) return { ...config, version: 2 }

  return {
    ...config,
    version: 2,
    settingSources: config.settingSources === 'none' ? 'all' : config.settingSources
  }
}

/** Reads the config, creating and persisting it if the file is missing. */
export async function loadConfig(
  filePath: string = configFile(),
  defaults: Config = createDefaultConfig('octopus')
): Promise<Config> {
  const existing = await readJsonFile<StoredConfig | null>(
    filePath,
    StoredConfigSchema.nullable(),
    null
  )
  if (existing) {
    const migrated = migrateConfig(existing)
    // Written back, not only held in memory: the next read should not have to
    // migrate again, and the file is what the user is invited to open (§4).
    if (migrated.version !== existing.version) await writeJsonFile(filePath, ConfigSchema, migrated)
    return migrated
  }

  await writeJsonFile(filePath, ConfigSchema, defaults)
  return defaults
}

/** Persists an updated config. */
export async function saveConfig(config: Config, filePath: string = configFile()): Promise<void> {
  await writeJsonFile(filePath, ConfigSchema, config)
}

/**
 * A setting source as the SDK names it.
 *
 * Spelled out rather than imported from the SDK so this module stays free of
 * it: the config is read by the preload bridge, and a dependency here would
 * follow it there.
 */
export type SettingSourceName = 'user' | 'project' | 'local'

/**
 * Maps the config mode onto the Agent SDK's `settingSources` value.
 *
 * The empty array is what `none` has to become: it is the only value that
 * stops the SDK loading `CLAUDE.md` and user settings. That is a mode on
 * offer for someone who wants the agent isolated, not the app's posture —
 * §12.3 explains why it stopped being the default.
 */
export function toSdkSettingSources(mode: SettingSourcesMode): SettingSourceName[] {
  switch (mode) {
    case 'none':
      return []
    case 'project':
      return ['project']
    case 'all':
      return ['user', 'project', 'local']
  }
}
