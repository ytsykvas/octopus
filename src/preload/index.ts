import { contextBridge, ipcRenderer } from 'electron'

import type { ThemeName } from '@core/types.js'

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
  }
} as const

export type MaestroApi = typeof api

contextBridge.exposeInMainWorld('maestro', api)
