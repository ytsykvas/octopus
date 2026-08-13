/**
 * Global application settings — `~/.octopus/config.json`.
 *
 * Created on first run, then only read and updated.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import {
  type Effort,
  EffortSchema,
  EXIT_PLAN_MODE,
  type WorkingMode,
  WorkingModeSchema
} from './chats.js'
import { configFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'

/**
 * Tools no standing approval may ever cover.
 *
 * `ExitPlanMode` is how the agent hands a finished plan back, so a standing
 * "always" on it accepts every future plan unread — planning undone by one
 * click, and silently: `askPermission` answers a tool on this list before it
 * emits anything at all. No dialog, no record that planning ended, a toggle
 * still lit over an agent that has started editing.
 *
 * It got into one of these lists before there was anything to stop it, which is
 * why this strips rather than merely refuses.
 */
const NEVER_STANDING: readonly string[] = [EXIT_PLAN_MODE]

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
   * How much thinking a new chat asks for; null leaves the choice to the agent.
   *
   * Global for the same reason as the mode above, and null by default because
   * the SDK already has an answer — picking one of our own here would be us
   * overriding it in every chat while looking like we had not chosen at all.
   */
  effort: EffortSchema.nullable().default(null),

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
   * smaller display — what actually limits dragging is how much room the
   * centre pane needs, which depends on the window and so cannot live here.
   */
  rightPanelWidth: z.number().int().min(280).max(4000).default(360),

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
  const effort: Effort | null = null

  return {
    version: 1,
    branchPrefix,
    settingSources: 'none',
    workingMode,
    effort,
    alwaysAllowedTools: [],
    theme: 'system',
    language: 'en',
    cloneDirectory: '',
    rightPanelWidth: 360,
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
