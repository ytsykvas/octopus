import { contextBridge, ipcRenderer } from 'electron'

import type { AccountKind, AccountsStatus } from '@core/accounts.js'
import type { AgentCommand, AgentModel, Chat, EffortChoice, WorkingMode } from '@core/chats.js'
import type {
  ChatEvent,
  ChatStatusEvent,
  PermissionAnswer,
  PermissionRequest,
  RateLimit,
  SessionUsage,
  WorkspaceStatusEvent
} from '@core/service.js'
import type { QuestionAnswer } from '@core/questions.js'
import type { ChatEntry } from '@core/transcript.js'
import type { TerminalExit, TerminalOutput, TerminalSpec } from '@core/terminal.js'
import type { Config } from '@core/config.js'
import type { WorkspaceDiff } from '@core/diff.js'
import type { PullRequestDraft, PullRequestView } from '@core/pullRequests.js'
import type { RemoteRepository } from '@core/github.js'
import type { Workspace } from '@core/store.js'
import type { RemoveOptions, WorkspaceView } from '@core/workspaces.js'
import type { InstructionKind } from '@core/instructions.js'
import type { ScriptKind } from '@core/scripts.js'
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

  chats: {
    /** Chats of a workspace; empty when nobody has written yet. Creates nothing. */
    list: (workspaceId: string): Promise<Result<Chat[]>> =>
      ipcRenderer.invoke('chats:list', workspaceId) as Promise<Result<Chat[]>>,

    /** The workspace's chat, created on first use. */
    open: (workspaceId: string): Promise<Result<Chat>> =>
      ipcRenderer.invoke('chats:open', workspaceId) as Promise<Result<Chat>>,

    /** An additional chat in this workspace; refuses past the cap. */
    create: (workspaceId: string): Promise<Result<Chat>> =>
      ipcRenderer.invoke('chats:create', workspaceId) as Promise<Result<Chat>>,

    /** A new chat continuing this one — the agent keeps what it remembers. */
    fork: (chatId: string): Promise<Result<Chat>> =>
      ipcRenderer.invoke('chats:fork', chatId) as Promise<Result<Chat>>,

    /** Ends a chat and discards it, history included; refuses the last one. */
    close: (chatId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:close', chatId) as Promise<Result<void>>,

    /** Names a chat; an empty name gives it back the one it is given. */
    rename: (chatId: string, title: string): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:rename', chatId, title) as Promise<Result<void>>,

    /** Everything said in this chat before now. */
    history: (chatId: string): Promise<Result<ChatEntry[]>> =>
      ipcRenderer.invoke('chats:history', chatId) as Promise<Result<ChatEntry[]>>,

    /** Sends a message. The answer arrives through `onEvent`, not here. */
    send: (chatId: string, text: string): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:send', chatId, text) as Promise<Result<void>>,

    /** Stops the current turn; the session stays open for the next message. */
    interrupt: (chatId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:interrupt', chatId) as Promise<Result<void>>,

    /** Sets how freely the chat works once it is working. */
    setWorkingMode: (chatId: string, mode: WorkingMode): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:mode', chatId, mode) as Promise<Result<void>>,

    /** Turns planning on or off for the chat. */
    setPlanMode: (chatId: string, planning: boolean): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:planMode', chatId, planning) as Promise<Result<void>>,

    /** Sets how much thinking the chat asks for; there is always a level. */
    setEffort: (chatId: string, effort: EffortChoice): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:effort', chatId, effort) as Promise<Result<void>>,

    /** Sets the model the chat writes code with; null hands the choice to the agent. */
    setModel: (chatId: string, model: string | null): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:model', chatId, model) as Promise<Result<void>>,

    /** Sets the model the chat plans with; null means the one above does both. */
    setPlanModel: (chatId: string, model: string | null): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:planModel', chatId, model) as Promise<Result<void>>,

    /** Models the agent last reported; empty until a session has run once. */
    models: (): Promise<Result<readonly AgentModel[]>> =>
      ipcRenderer.invoke('chats:models') as Promise<Result<readonly AgentModel[]>>,

    /**
     * Slash commands this chat's agent offers; empty until a session has run.
     *
     * Per chat, unlike the models above: a project's own commands live in its
     * `.claude/commands/`, so the answer belongs to the worktree.
     */
    commands: (chatId: string): Promise<Result<readonly AgentCommand[]>> =>
      ipcRenderer.invoke('chats:commands', chatId) as Promise<Result<readonly AgentCommand[]>>,

    /**
     * Answers the questions the agent asked, releasing the tool call.
     *
     * Not a permission: the user is not saying whether the agent may act, they
     * are handing it what it asked for. The answers go to the tool as a
     * modified copy of its own arguments — the only way in it has.
     */
    answerQuestions: (
      requestId: string,
      answers: readonly QuestionAnswer[]
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:answerQuestions', requestId, answers) as Promise<Result<void>>,

    /**
     * What the chat's agent is blocked on, or `null` when it is not blocked.
     *
     * Asked on opening a conversation, because the event announcing it goes
     * out once: a window that was not there to hear it would otherwise show a
     * chat that stays busy for ever.
     */
    pendingPermission: (chatId: string): Promise<Result<PermissionRequest | null>> =>
      ipcRenderer.invoke('chats:pending', chatId) as Promise<Result<PermissionRequest | null>>,

    /** How full the context is and how much of the subscription is gone. */
    usage: (chatId: string): Promise<Result<SessionUsage>> =>
      ipcRenderer.invoke('chats:usage', chatId) as Promise<Result<SessionUsage>>,

    /**
     * Answers a pending permission request; the agent is blocked until it arrives.
     *
     * `feedback` accompanies a refusal and reaches the agent as the reason.
     */
    answerPermission: (
      requestId: string,
      answer: PermissionAnswer,
      feedback?: string
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:permission', requestId, answer, feedback) as Promise<Result<void>>,

    /** The last rate limit any session reported; `null` before one has. */
    rateLimit: (): Promise<Result<RateLimit | null>> =>
      ipcRenderer.invoke('chats:rateLimit') as Promise<Result<RateLimit | null>>,

    onEvent: (handler: (event: ChatEvent) => void): (() => void) => {
      const listener = (_event: unknown, chatEvent: ChatEvent): void => {
        handler(chatEvent)
      }
      ipcRenderer.on('chats:event', listener)
      return () => {
        ipcRenderer.off('chats:event', listener)
      }
    },

    /**
     * What each conversation is doing, as it changes.
     *
     * A stream of its own rather than a variant of `onEvent`: that one carries
     * the agent's messages, and half of these come from moments no agent
     * message describes — an interrupt, an answered permission, a closed tab.
     */
    onStatus: (handler: (event: ChatStatusEvent) => void): (() => void) => {
      const listener = (_event: unknown, status: ChatStatusEvent): void => {
        handler(status)
      }
      ipcRenderer.on('chats:status', listener)
      return () => {
        ipcRenderer.off('chats:status', listener)
      }
    }
  },

  workspaces: {
    /**
     * What each workspace is doing, as it changes.
     *
     * A second stream beside `chats.onEvent`, because the list that draws this
     * is not looking at a conversation — and re-reading the workspaces to find
     * out would ask git about every one of them twice a turn.
     */
    onStatus: (handler: (event: WorkspaceStatusEvent) => void): (() => void) => {
      const listener = (_event: unknown, status: WorkspaceStatusEvent): void => {
        handler(status)
      }
      ipcRenderer.on('workspaces:status', listener)
      return () => {
        ipcRenderer.off('workspaces:status', listener)
      }
    },

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
      ipcRenderer.invoke('workspaces:hasChanges', workspaceId) as Promise<Result<boolean>>,

    /** Everything the workspace changed since it left the project's base branch. */
    diff: (workspaceId: string): Promise<Result<WorkspaceDiff>> =>
      ipcRenderer.invoke('workspaces:diff', workspaceId) as Promise<Result<WorkspaceDiff>>,

    /** What has become of this workspace's branch on GitHub, if anything. */
    pullRequest: (workspaceId: string): Promise<Result<PullRequestView>> =>
      ipcRenderer.invoke('workspaces:pullRequest', workspaceId) as Promise<Result<PullRequestView>>,

    /** Pushes the branch if it needs it, opens the request, answers with its URL. */
    createPullRequest: (workspaceId: string, request: PullRequestDraft): Promise<Result<string>> =>
      ipcRenderer.invoke('workspaces:createPullRequest', workspaceId, request) as Promise<
        Result<string>
      >,

    /** The instruction this workspace would send: its project's, or the global one. */
    instruction: (workspaceId: string, kind: InstructionKind): Promise<Result<string>> =>
      ipcRenderer.invoke('instructions:effective', workspaceId, kind) as Promise<Result<string>>
  },

  files: {
    /** Hands a file in a workspace to whatever the system opens it with. */
    open: (workspaceId: string, path: string): Promise<Result<void>> =>
      ipcRenderer.invoke('files:open', workspaceId, path) as Promise<Result<void>>
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

    /** Reads a project script; a missing one comes back as a template. */
    readScript: (projectId: string, kind: ScriptKind): Promise<Result<string>> =>
      ipcRenderer.invoke('scripts:read', projectId, kind) as Promise<Result<string>>,

    saveScript: (projectId: string, kind: ScriptKind, contents: string): Promise<Result<void>> =>
      ipcRenderer.invoke('scripts:save', projectId, kind, contents) as Promise<Result<void>>,

    /**
     * Guidance for the agent; a missing one comes back as a template.
     *
     * A null project is the installation's own, which every project without one
     * of its own falls back to.
     */
    readInstruction: (projectId: string | null, kind: InstructionKind): Promise<Result<string>> =>
      ipcRenderer.invoke('instructions:read', projectId, kind) as Promise<Result<string>>,

    saveInstruction: (
      projectId: string | null,
      kind: InstructionKind,
      contents: string
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('instructions:save', projectId, kind, contents) as Promise<Result<void>>,

    /** Where each script lives, or null where none has been written. */
    scriptPaths: (projectId: string): Promise<Result<Record<ScriptKind, string | null>>> =>
      ipcRenderer.invoke('scripts:paths', projectId) as Promise<
        Result<Record<ScriptKind, string | null>>
      >,

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
