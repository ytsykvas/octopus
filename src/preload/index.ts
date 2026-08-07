import { contextBridge, ipcRenderer } from 'electron'

import type { AccountKind, AccountsStatus } from '@core/accounts.js'
import type { TerminalExit, TerminalOutput, TerminalSpec } from '@core/terminal.js'
import type { Config } from '@core/config.js'
import type { RemoteRepository } from '@core/github.js'
import type { Workspace } from '@core/store.js'
import type { RemoveOptions, WorkspaceView } from '@core/workspaces.js'
import type { Project, ProjectPatch } from '@core/store.js'
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

    /** Argv for the interactive sign-in; the UI hosts it in a terminal. */
    signInCommand: (kind: AccountKind): readonly string[] =>
      kind === 'claude' ? ['claude', 'auth', 'login'] : ['gh', 'auth', 'login'],

    /** Signs out silently and reports whether the account is really gone. */
    signOut: (kind: AccountKind, login: string | null): Promise<Result<boolean>> =>
      ipcRenderer.invoke('accounts:signOut', kind, login) as Promise<Result<boolean>>
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

  workspaces: {
    /** Workspaces of a project, reconciled with what git actually has. */
    list: (projectId: string): Promise<Result<WorkspaceView[]>> =>
      ipcRenderer.invoke('workspaces:list', projectId) as Promise<Result<WorkspaceView[]>>,

    create: (projectId: string): Promise<Result<Workspace>> =>
      ipcRenderer.invoke('workspaces:create', projectId) as Promise<Result<Workspace>>,

    rename: (workspaceId: string, name: string): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:rename', workspaceId, name) as Promise<Result<void>>,

    remove: (workspaceId: string, options: RemoveOptions = {}): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:remove', workspaceId, options) as Promise<Result<void>>,

    /** Whether removing this workspace would discard uncommitted work. */
    hasChanges: (workspaceId: string): Promise<Result<boolean>> =>
      ipcRenderer.invoke('workspaces:hasChanges', workspaceId) as Promise<Result<boolean>>
  },

  dialog: {
    /** Opens a directory picker; `null` means the user cancelled. */
    pickDirectory: (title: string): Promise<Result<string | null>> =>
      ipcRenderer.invoke('dialog:pickDirectory', title) as Promise<Result<string | null>>
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

    /** Changes a project's editable fields; omitted keys are left alone. */
    update: (projectId: string, patch: ProjectPatch): Promise<Result<void>> =>
      ipcRenderer.invoke('projects:update', projectId, patch) as Promise<Result<void>>,

    /** Branches the repository offers as a base, remotes included. */
    branches: (projectId: string): Promise<Result<string[]>> =>
      ipcRenderer.invoke('projects:branches', projectId) as Promise<Result<string[]>>,

    remove: (projectId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('projects:remove', projectId) as Promise<Result<void>>,

    /** Repositories of the signed-in GitHub account. */
    listRemote: (): Promise<Result<RemoteRepository[]>> =>
      ipcRenderer.invoke('projects:listRemote') as Promise<Result<RemoteRepository[]>>,

    /** Clones a repository and adds it. `null` means the destination prompt was cancelled. */
    addFromGitHub: (repository: RemoteRepository): Promise<Result<Project | null>> =>
      ipcRenderer.invoke('projects:addFromGitHub', repository) as Promise<Result<Project | null>>
  }
} as const

export type OctopusApi = typeof api

contextBridge.exposeInMainWorld('octopus', api)
