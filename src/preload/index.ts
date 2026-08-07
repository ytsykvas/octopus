import { contextBridge, ipcRenderer } from 'electron'

import type { Config } from '@core/config.js'
import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

/**
 * A core operation either succeeded or explained why not — see `attempt` in main.
 *
 * `code` and `params` are present for known validation failures, letting the
 * renderer show a localised message; `error` is the English fallback.
 */
export interface Failure {
  ok: false
  error: string
  code?: string
  params?: Readonly<Record<string, string>>
}

export type Result<T> = { ok: true; value: T } | Failure

/**
 * Typed bridge between the renderer and main.
 *
 * There is deliberately no logic here — it is a thin proxy (§11.1). The work
 * lives in `src/core`; main only exposes it over IPC.
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

    /** Opens a directory picker. `null` means the user cancelled. */
    add: (): Promise<Result<Project | null>> =>
      ipcRenderer.invoke('projects:add') as Promise<Result<Project | null>>,

    remove: (projectId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('projects:remove', projectId) as Promise<Result<void>>
  }
} as const

export type MaestroApi = typeof api

contextBridge.exposeInMainWorld('maestro', api)
