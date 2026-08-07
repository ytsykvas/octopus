import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type Config,
  createDefaultConfig,
  loadConfig,
  saveConfig,
  toSdkSettingSources
} from './config.js'
import { InvalidFileError } from './persist.js'

const UUID = '00000000-0000-4000-8000-000000000000'
const NOW = new Date('2026-08-07T12:00:00.000Z')

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maestro-config-'))
  file = join(dir, 'config.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createDefaultConfig', () => {
  it('типово не підтягує жодних джерел налаштувань — прозорість за замовчуванням', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).settingSources).toBe('none')
  })

  it('зберігає переданий префікс гілок', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).branchPrefix).toBe('ytsykvas')
  })

  it('проставляє deviceId та мітку встановлення — закладки під ліцензування', () => {
    const config = createDefaultConfig('ytsykvas', NOW, () => UUID)
    expect(config.deviceId).toBe(UUID)
    expect(config.installedAt).toBe('2026-08-07T12:00:00.000Z')
  })

  it('типово тримається системної теми', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).theme).toBe('system')
  })

  it('генерує різні deviceId без підміни генератора', () => {
    expect(createDefaultConfig('a').deviceId).not.toBe(createDefaultConfig('a').deviceId)
  })

  it('типово бере поточний час', () => {
    const before = Date.now()
    const at = Date.parse(createDefaultConfig('a').installedAt)
    expect(at).toBeGreaterThanOrEqual(before - 1000)
  })
})

describe('loadConfig', () => {
  it('створює файл при першому запуску', async () => {
    const defaults = createDefaultConfig('ytsykvas', NOW, () => UUID)
    await expect(loadConfig(file, defaults)).resolves.toEqual(defaults)
    await expect(readFile(file, 'utf8')).resolves.toContain('ytsykvas')
  })

  it('читає наявний конфіг, не перезаписуючи його', async () => {
    const saved = { ...createDefaultConfig('перший', NOW, () => UUID) }
    await saveConfig(saved, file)

    const other = createDefaultConfig('другий', NOW, () => UUID)
    await expect(loadConfig(file, other)).resolves.toEqual(saved)
  })

  it('кидає помилку на пошкодженому конфізі, а не мовчки скидає налаштування', async () => {
    await writeFile(file, '{ зіпсовано', 'utf8')
    await expect(loadConfig(file)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('типово використовує власні значення, якщо їх не передали', async () => {
    const config = await loadConfig(file)
    expect(config.branchPrefix).toBe('maestro')
  })
})

describe('saveConfig', () => {
  it('зберігає зміни, які потім читаються назад', async () => {
    const config = createDefaultConfig('ytsykvas', NOW, () => UUID)
    await saveConfig({ ...config, theme: 'dark' }, file)
    await expect(loadConfig(file)).resolves.toMatchObject({ theme: 'dark' })
  })

  it('відмовляється зберігати конфіг із порожнім префіксом гілки', async () => {
    const broken = { ...createDefaultConfig('x', NOW, () => UUID), branchPrefix: '' } as Config
    await expect(saveConfig(broken, file)).rejects.toBeInstanceOf(InvalidFileError)
  })
})

describe('toSdkSettingSources', () => {
  it('режим none дає порожній масив — SDK не підтягне CLAUDE.md непомітно', () => {
    expect(toSdkSettingSources('none')).toEqual([])
  })

  it('режим project підтягує лише налаштування репозиторію', () => {
    expect(toSdkSettingSources('project')).toEqual(['project'])
  })

  it('режим all підтягує повний набір джерел', () => {
    expect(toSdkSettingSources('all')).toEqual(['user', 'project', 'local'])
  })
})
