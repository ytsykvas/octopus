/**
 * Глобальні налаштування застосунку — `~/.maestro/config.json`.
 *
 * Створюється при першому запуску й далі лише читається та оновлюється.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { configFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'

/**
 * Які джерела налаштувань дозволено підтягувати агенту.
 *
 * Це ключовий перемикач прозорості (§4 docs/PROJECT.md): типове значення
 * `none` означає, що в контекст агента не потрапляє нічого, чого ми не
 * додали свідомо.
 */
export const SettingSourcesModeSchema = z.enum(['none', 'project', 'all'])
export type SettingSourcesMode = z.infer<typeof SettingSourcesModeSchema>

export const ThemePreferenceSchema = z.enum(['system', 'light', 'dark'])
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>

export const ConfigSchema = z.object({
  /** Версія формату — знадобиться, коли доведеться мігрувати конфіг. */
  version: z.literal(1),

  /** Префікс гілок воркспейсів, напр. GitHub-username. */
  branchPrefix: z.string().min(1),

  settingSources: SettingSourcesModeSchema,
  theme: ThemePreferenceSchema,

  /**
   * Стабільний ідентифікатор пристрою (§15.3).
   * Наразі не використовується — місце під майбутнє ліцензування.
   */
  deviceId: z.uuid(),

  /** Мітка першого запуску (§15.3). */
  installedAt: z.iso.datetime()
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Створює конфіг першого запуску.
 *
 * `now` і `uuid` приймаються параметрами, щоб функція лишалася чистою
 * і тестувалася без підміни глобального часу.
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
    deviceId: uuid(),
    installedAt: now.toISOString()
  }
}

/** Читає конфіг; за відсутності файлу створює його й записує на диск. */
export async function loadConfig(
  filePath: string = configFile(),
  defaults: Config = createDefaultConfig('maestro')
): Promise<Config> {
  const existing = await readJsonFile<Config | null>(filePath, ConfigSchema.nullable(), null)
  if (existing) return existing

  await writeJsonFile(filePath, ConfigSchema, defaults)
  return defaults
}

/** Записує оновлений конфіг. */
export async function saveConfig(config: Config, filePath: string = configFile()): Promise<void> {
  await writeJsonFile(filePath, ConfigSchema, config)
}

/**
 * Перетворює режим із конфігу на значення для `settingSources` Agent SDK.
 *
 * Порожній масив — це саме те, що не дає SDK підтягнути `CLAUDE.md`
 * і користувацькі налаштування непомітно для нас (§12.3).
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
