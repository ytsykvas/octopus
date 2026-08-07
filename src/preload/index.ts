import { contextBridge, ipcRenderer } from 'electron'

import type { Config } from '@core/config.js'
import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

/** Операція ядра або вдалася, або пояснила причину — див. `attempt` у main. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Типізований міст між renderer і main.
 *
 * Логіки тут немає свідомо — це тонкий проксі (§11.1). Уся робота
 * живе в `src/core`, main лише пробрасує її в IPC.
 */
const api = {
  theme: {
    get: (): Promise<ThemeName> => ipcRenderer.invoke('theme:get') as Promise<ThemeName>,
    onChange: (handler: (theme: ThemeName) => void): (() => void) => {
      const listener = (_event: unknown, theme: ThemeName): void => {
        handler(theme)
      }
      ipcRenderer.on('theme:changed', listener)
      return () => {
        ipcRenderer.off('theme:changed', listener)
      }
    }
  },

  config: {
    get: (): Promise<Result<Config>> => ipcRenderer.invoke('config:get') as Promise<Result<Config>>
  },

  projects: {
    list: (): Promise<Result<Project[]>> =>
      ipcRenderer.invoke('projects:list') as Promise<Result<Project[]>>,

    /** Відкриває діалог вибору теки. `null` означає, що користувач скасував. */
    add: (): Promise<Result<Project | null>> =>
      ipcRenderer.invoke('projects:add') as Promise<Result<Project | null>>,

    remove: (projectId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('projects:remove', projectId) as Promise<Result<void>>
  }
} as const

export type MaestroApi = typeof api

contextBridge.exposeInMainWorld('maestro', api)
