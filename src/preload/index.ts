import { contextBridge, ipcRenderer } from 'electron'

import type { AccountKind, AccountsStatus } from '@core/accounts.js'
import type { TerminalExit, TerminalOutput, TerminalSpec } from '@core/terminal.js'
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
    get: (): Promise<Result<Config>> => ipcRenderer.invoke('config:get') as Promise<Result<Config>>,

    update: (patch: Partial<Config>): Promise<Result<Config>> =>
      ipcRenderer.invoke('config:update', patch) as Promise<Result<Config>>
  },

  accounts: {
    status: (): Promise<Result<AccountsStatus>> =>
      ipcRenderer.invoke('accounts:status') as Promise<Result<AccountsStatus>>,

    /** Returns the argv to run for signing in or out; the UI hosts it in a terminal. */
    authCommand: (kind: AccountKind, action: 'login' | 'logout'): readonly string[] =>
      kind === 'claude' ? ['claude', 'auth', action] : ['gh', 'auth', action]
  },

  terminal: {
    create: (spec: Partial<TerminalSpec> & { cwd: string }): Promise<Result<string>> =>
      ipcRenderer.invoke('terminal:create', spec) as Promise<Result<string>>,

    write: (id: string, data: string): void => {
      void ipcRenderer.invoke('terminal:write', id, data)
    },

    resize: (id: string, cols: number, rows: number): void => {
      void ipcRenderer.invoke('terminal:resize', id, cols, rows)
    },

    dispose: (id: string): void => {
      void ipcRenderer.invoke('terminal:dispose', id)
    },

    onData: (handler: (output: TerminalOutput) => void): (() => void) => {
      const listener = (_event: unknown, output: TerminalOutput): void => {
        handler(output)
      }
      ipcRenderer.on('terminal:data', listener)
      return () => {
        ipcRenderer.off('terminal:data', listener)
      }
    },

    onExit: (handler: (exit: TerminalExit) => void): (() => void) => {
      const listener = (_event: unknown, exit: TerminalExit): void => {
        handler(exit)
      }
      ipcRenderer.on('terminal:exit', listener)
      return () => {
        ipcRenderer.off('terminal:exit', listener)
      }
    }
  },

  settings: {
    /** Fires when the user picks Settings from the native menu (⌘,). */
    onOpen: (handler: () => void): (() => void) => {
      const listener = (): void => {
        handler()
      }
      ipcRenderer.on('settings:open', listener)
      return () => {
        ipcRenderer.off('settings:open', listener)
      }
    }
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

export type OctopusApi = typeof api

contextBridge.exposeInMainWorld('octopus', api)
