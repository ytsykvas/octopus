/**
 * Global application settings — `~/.octopus/config.json`.
 *
 * Created on first run, then only read and updated.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { configFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'

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
   * The bounds are functional rather than cosmetic. Below ~280px a terminal
   * wraps almost every line of build output; above 900 the centre pane, which
   * is the actual working area, stops being one.
   */
  rightPanelWidth: z.number().int().min(280).max(900).default(360),

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
  return {
    version: 1,
    branchPrefix,
    settingSources: 'none',
    theme: 'system',
    language: 'en',
    cloneDirectory: '',
    rightPanelWidth: 360,
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
 * Maps the config mode onto the Agent SDK's `settingSources` value.
 *
 * The empty array is exactly what stops the SDK from quietly picking up
 * `CLAUDE.md` and user settings behind our back (§12.3).
 */
export function toSdkSettingSources(mode: SettingSourcesMode): string[] {
  switch (mode) {
    case 'none':
      return []
    case 'project':
      return ['project']
    case 'all':
      return ['user', 'project', 'local']
  }
}
