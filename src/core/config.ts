/**
 * Global application settings — `~/.octopus/config.json`.
 *
 * Created on first run, then only read and updated.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

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
 * This is the key transparency switch (§4 docs/PROJECT.md): the default
 * `none` means nothing reaches the agent's context that we did not put
 * there deliberately.
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
export const RightPanelTabSchema = z.enum(['diff', 'terminal', 'build', 'server'])
export type RightPanelTab = z.infer<typeof RightPanelTabSchema>

export const ConfigSchema = z.object({
  /** Format version — needed once the config has to be migrated. */
  version: z.literal(1),

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
   * Tools the user has answered "always" for.
   *
   * Kept here rather than inside the SDK's own permission rules, because
   * `settingSources` may well be `none` — in which case the SDK has nowhere to
   * write them, and the answer would be forgotten the moment the session ends.
   * A list in the config is also a list the user can read and shorten (§4).
   *
   * Filtered rather than merely validated, and the schema is used on the way
   * out as well as in, so a config holding one of these is cleaned the next
   * time it is written.
   */
  alwaysAllowedTools: z
    .array(z.string())
    .default([])
    .transform((tools) => tools.filter((tool) => !NEVER_STANDING.includes(tool))),

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
  rightPanelTab: RightPanelTabSchema.default('diff'),

  /**
   * Width of the workspace list in pixels.
   *
   * The lower bound is where the project name stops having room beside the
   * buttons in its header: below it the name is all ellipsis, and the row reads
   * as broken rather than as narrow.
   */
  sidebarWidth: z.number().int().min(180).max(560).default(240),

  /**
   * Stable device identifier (§15.3).
   * Unused for now — reserved for future licensing.
   */
  deviceId: z.uuid(),

  /** First-run timestamp (§15.3). */
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
    version: 1,
    branchPrefix,
    settingSources: 'none',
    workingMode,
    effort,
    // Nothing to name: no catalogue has arrived on a first run, and the two
    // nulls are already the right answers — the agent's own choice, and no
    // split between planning and writing.
    model: null,
    planModel: null,
    alwaysAllowedTools: [],
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

/** Reads the config, creating and persisting it if the file is missing. */
export async function loadConfig(
  filePath: string = configFile(),
  defaults: Config = createDefaultConfig('octopus')
): Promise<Config> {
  const existing = await readJsonFile<Config | null>(filePath, ConfigSchema.nullable(), null)
  if (existing) return existing

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
 * The empty array is exactly what stops the SDK from quietly picking up
 * `CLAUDE.md` and user settings behind our back (§12.3).
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
