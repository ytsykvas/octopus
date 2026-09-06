import { contextBridge, ipcRenderer } from 'electron'

import type { AccountKind, AccountsStatus, GitHubAccount } from '@core/accounts.js'
import type { AgentCommand, AgentModel, Chat, EffortChoice, WorkingMode } from '@core/chats.js'
import type {
  ChatEvent,
  ChatsChangedEvent,
  ChatStatusEvent,
  DeclaredCarryFiles,
  PermissionAnswer,
  PermissionRequest,
  RateLimit,
  SessionUsage,
  UsageOutcome,
  WorkspaceStatusEvent
} from '@core/service.js'
import type { ScriptsInWorkspace } from '@core/repoSource.js'
import type { QuestionAnswer } from '@core/questions.js'
import type { ChatEntry } from '@core/transcript.js'
import type { TerminalExit, TerminalOutput, TerminalSpec } from '@core/terminal.js'
import type { Config } from '@core/config.js'
import type { WorkspaceDiff } from '@core/diff.js'
import type { MergeMethod, PullRequestDraft, PullRequestView } from '@core/pullRequests.js'
import type { DraftedPullRequest } from '@core/pullRequestDraft.js'
import type { BranchRequest, PullRequestDetail } from '@core/pullRequestShapes.js'
import type { RemoteRepository, RepositoryList } from '@core/github.js'
import type { Workspace } from '@core/store.js'
import type { RemoveOptions, WorkspaceView } from '@core/workspaces.js'
import type { InstructionKind } from '@core/instructions.js'
import type { ScriptKind } from '@core/scripts.js'
import type {
  SkillDocument,
  SkillEntry,
  SkillImport,
  SkillListing,
  SkillPreview,
  SkillSave
} from '@core/skills.js'
import type { SkillStore } from '@core/skillNames.js'
import type { InstructionSource } from '@core/instructionSources.js'
import type { UsageWindows } from '@core/usage.js'
import type { RepoConfigView, RepoItemId } from '@core/repoConfig.js'
import type { CarryReport } from '@core/carry.js'
import type { CapabilityFile } from '@core/repoTrust.js'
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
      ipcRenderer.invoke('config:update', patch) as Promise<Result<Config>>,

    /**
     * The config as it now stands, whenever main writes it.
     *
     * A window otherwise learns of a write only from its own reply, so a
     * destination chosen in main's dialog — or any setting changed in a second
     * window — stayed unknown for the rest of the session.
     */
    onChange: (handler: (config: Config) => void): (() => void) => {
      const listener = (_event: unknown, config: Config): void => {
        handler(config)
      }
      ipcRenderer.on('config:changed', listener)
      return () => {
        ipcRenderer.off('config:changed', listener)
      }
    }
  },

  accounts: {
    status: (): Promise<Result<AccountsStatus>> =>
      ipcRenderer.invoke('accounts:status') as Promise<Result<AccountsStatus>>,

    /** GitHub alone, for a button that has no use for the other check. */
    github: (): Promise<Result<GitHubAccount>> =>
      ipcRenderer.invoke('accounts:github') as Promise<Result<GitHubAccount>>,

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

    /** Resolves once the session has actually ended, not once it was asked to. */
    dispose: (id: string): Promise<void> =>
      ipcRenderer.invoke('terminal:dispose', id) as Promise<void>,

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

    /** The effort planning runs at; null means the one above does both. */
    setPlanEffort: (chatId: string, effort: EffortChoice | null): Promise<Result<void>> =>
      ipcRenderer.invoke('chats:planEffort', chatId, effort) as Promise<Result<void>>,

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

    /**
     * How much of the account's windows is gone, with no chat in the question.
     *
     * Answered from the last reading, which is kept in the state file — so it
     * is there when the window opens rather than after the first message.
     */
    subscription: (): Promise<Result<UsageWindows | null>> =>
      ipcRenderer.invoke('chats:subscription') as Promise<Result<UsageWindows | null>>,

    /**
     * Asks the account now rather than waiting for a turn.
     *
     * `null` where there is no conversation anywhere to ask through — a
     * session runs in a worktree, so an installation with no workspace has
     * nowhere to start one.
     */
    refreshSubscription: (): Promise<Result<UsageOutcome>> =>
      ipcRenderer.invoke('chats:refreshSubscription') as Promise<Result<UsageOutcome>>,

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
     * The account's windows, whenever the service learns they moved.
     *
     * Pushed rather than asked for. A window that watched for a finished turn
     * and then read the cache was racing whatever filled it, and drew the
     * previous turn's figure every time.
     */
    onUsageWindows: (handler: (windows: UsageWindows) => void): (() => void) => {
      const listener = (_event: unknown, windows: UsageWindows): void => {
        handler(windows)
      }
      ipcRenderer.on('usage:windows', listener)
      return () => {
        ipcRenderer.off('usage:windows', listener)
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
    },

    /**
     * Which conversations a workspace has, when that set changes.
     *
     * The tab strip reads its list once per workspace, so without this a second
     * window draws the strip that was true when it opened — a tab it never sees
     * created, and one it keeps drawing after the other window closed it.
     */
    onChanged: (handler: (event: ChatsChangedEvent) => void): (() => void) => {
      const listener = (_event: unknown, changed: ChatsChangedEvent): void => {
        handler(changed)
      }
      ipcRenderer.on('chats:changed', listener)
      return () => {
        ipcRenderer.off('chats:changed', listener)
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

    /**
     * Puts one file back to the state the workspace branched from.
     *
     * `oldPath` is the far end of a rename — one row in the pane, two paths on
     * disk, and both have to move.
     */
    revertFile: (
      workspaceId: string,
      path: string,
      oldPath: string | null = null
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:revertFile', workspaceId, path, oldPath) as Promise<
        Result<void>
      >,

    /** What has become of this workspace's branch on GitHub, if anything. */
    pullRequest: (workspaceId: string): Promise<Result<PullRequestView>> =>
      ipcRenderer.invoke('workspaces:pullRequest', workspaceId) as Promise<Result<PullRequestView>>,

    /** Pushes the branch if it needs it, opens the request, answers with its URL. */
    createPullRequest: (workspaceId: string, request: PullRequestDraft): Promise<Result<string>> =>
      ipcRenderer.invoke('workspaces:createPullRequest', workspaceId, request) as Promise<
        Result<string>
      >,

    /**
     * Asks the agent to write a title and a description for this branch.
     *
     * Opens nothing — the answer goes into the form, to be read and edited.
     */
    draftPullRequest: (workspaceId: string): Promise<Result<DraftedPullRequest>> =>
      ipcRenderer.invoke('workspaces:draftPullRequest', workspaceId) as Promise<
        Result<DraftedPullRequest>
      >,

    /** Commits everything here and pushes the branch, to update a request. */
    commitAndPush: (workspaceId: string, message: string): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:commitAndPush', workspaceId, message) as Promise<Result<void>>,

    /** The checks, the review and the mergeability of a request that exists. */
    pullRequestDetail: (workspaceId: string, number: number): Promise<Result<PullRequestDetail>> =>
      ipcRenderer.invoke('workspaces:pullRequestDetail', workspaceId, number) as Promise<
        Result<PullRequestDetail>
      >,

    /** Merges it. Answers with nothing: the caller reads the request again. */
    mergePullRequest: (
      workspaceId: string,
      number: number,
      method: MergeMethod
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:mergePullRequest', workspaceId, number, method) as Promise<
        Result<void>
      >,

    /** Closes it without merging, and leaves the branch where it is. */
    closePullRequest: (workspaceId: string, number: number): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:closePullRequest', workspaceId, number) as Promise<
        Result<void>
      >,

    /** Answers one review thread. The caller reads the request again. */
    replyToReviewThread: (
      workspaceId: string,
      threadId: string,
      body: string
    ): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:replyToReviewThread', workspaceId, threadId, body) as Promise<
        Result<void>
      >,

    /** Marks a thread settled, or puts it back. */
    setReviewThreadResolved: (
      workspaceId: string,
      threadId: string,
      resolved: boolean
    ): Promise<Result<void>> =>
      ipcRenderer.invoke(
        'workspaces:resolveReviewThread',
        workspaceId,
        threadId,
        resolved
      ) as Promise<Result<void>>,

    /**
     * Which script runs for each kind here, from where, and whether the ones
     * the repository supplies have been read.
     */
    scripts: (workspaceId: string): Promise<Result<ScriptsInWorkspace>> =>
      ipcRenderer.invoke('scripts:resolved', workspaceId) as Promise<Result<ScriptsInWorkspace>>,

    /** Records that the repository's scripts were read, so they may run. */
    approveScripts: (workspaceId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('scripts:approve', workspaceId) as Promise<Result<void>>,

    /** Puts this workspace on a set of variables of its own, or back to follow. */
    setEnvProfile: (workspaceId: string, name: string | null): Promise<Result<void>> =>
      ipcRenderer.invoke('workspaces:envProfile', workspaceId, name) as Promise<Result<void>>,

    /**
     * The instruction this workspace would send.
     *
     * Three layers, not two: the **repository's** own — `.octopus/instructions`
     * or Conductor's `[prompts]` — then the project's copy, then the
     * installation's. The first is a fact about the branch in front of you
     * rather than a setting, which is why it wins.
     */
    instruction: (workspaceId: string, kind: InstructionKind): Promise<Result<string>> =>
      ipcRenderer.invoke('instructions:effective', workspaceId, kind) as Promise<Result<string>>,

    /**
     * Copies the project's carried files into this workspace, where it lacks
     * them.
     *
     * Called before a run, so a workspace made before the list mentioned a file
     * picks it up instead of staying broken until it is recreated. Answers with
     * what it wrote and what the list named that the worktree still has not
     * got — the second half being the one a run needs, since a missing file is
     * how a build fails while complaining about something else.
     */
    prepare: (workspaceId: string): Promise<Result<CarryReport>> =>
      ipcRenderer.invoke('workspace:prepare', workspaceId) as Promise<Result<CarryReport>>,

    /** What this repository can grant itself, and whether it was approved. */
    trust: (
      workspaceId: string
    ): Promise<Result<{ approved: boolean; files: readonly CapabilityFile[] }>> =>
      ipcRenderer.invoke('trust:read', workspaceId) as Promise<
        Result<{ approved: boolean; files: readonly CapabilityFile[] }>
      >,

    /** Records that those files were read. */
    approveSettings: (workspaceId: string): Promise<Result<void>> =>
      ipcRenderer.invoke('trust:approve', workspaceId) as Promise<Result<void>>,

    /** The workspace's env file as it stands, or null where it has none. */
    env: (workspaceId: string): Promise<Result<string | null>> =>
      ipcRenderer.invoke('workspace:env', workspaceId) as Promise<Result<string | null>>,

    /** Whether anything is listening on the port this workspace was given. */
    serving: (workspaceId: string): Promise<Result<boolean>> =>
      ipcRenderer.invoke('workspaces:serving', workspaceId) as Promise<Result<boolean>>,

    /**
     * The port to serve on, moved if the old one has been taken since.
     *
     * Asked before a run rather than remembered: a port free when the workspace
     * was made can belong to something else by the time anybody runs it.
     */
    port: (workspaceId: string): Promise<Result<number>> =>
      ipcRenderer.invoke('workspaces:port', workspaceId) as Promise<Result<number>>
  },

  files: {
    /** Hands a file in a workspace to whatever the system opens it with. */
    open: (workspaceId: string, path: string): Promise<Result<void>> =>
      ipcRenderer.invoke('files:open', workspaceId, path) as Promise<Result<void>>
  },

  dialog: {
    /** Opens a directory picker; `null` means the user cancelled. */
    pickDirectory: (title: string): Promise<Result<string | null>> =>
      ipcRenderer.invoke('dialog:pickDirectory', title) as Promise<Result<string | null>>,

    /** The same for a skill, which may be a folder or a lone `SKILL.md`. */
    pickSkill: (title: string): Promise<Result<string | null>> =>
      ipcRenderer.invoke('dialog:pickSkill', title) as Promise<Result<string | null>>
  },

  skills: {
    /** What one of the two stores holds, for a settings section. */
    list: (store: SkillStore): Promise<Result<SkillEntry[]>> =>
      ipcRenderer.invoke('skills:list', store) as Promise<Result<SkillEntry[]>>,

    /** One of them opened: the form's two fields and the raw document. */
    read: (store: SkillStore, name: string): Promise<Result<SkillDocument>> =>
      ipcRenderer.invoke('skills:read', store, name) as Promise<Result<SkillDocument>>,

    save: (store: SkillStore, name: string, save: SkillSave): Promise<Result<SkillEntry>> =>
      ipcRenderer.invoke('skills:save', store, name, save) as Promise<Result<SkillEntry>>,

    remove: (store: SkillStore, name: string): Promise<Result<void>> =>
      ipcRenderer.invoke('skills:remove', store, name) as Promise<Result<void>>,

    /**
     * Gives one another name, moving every answer stored against it.
     *
     * A migration rather than an edit: the name is the directory and the key
     * three stored things use, so a rename that moved only the folder would
     * switch the skill back on wherever it had been turned off.
     */
    rename: (store: SkillStore, folder: string, to: string): Promise<Result<SkillEntry>> =>
      ipcRenderer.invoke('skills:rename', store, folder, to) as Promise<Result<SkillEntry>>,

    /**
     * What an import would write, without writing it.
     *
     * For a link the answer carries the document back, so importing what was
     * previewed does not fetch the address a second time — the second answer
     * need not be the first, and it is the first the reader approved.
     */
    inspect: (store: SkillStore, request: SkillImport): Promise<Result<SkillPreview>> =>
      ipcRenderer.invoke('skills:inspect', store, request) as Promise<Result<SkillPreview>>,

    /** Brings in a skill written elsewhere: on disk, pasted, or downloaded. */
    import: (store: SkillStore, request: SkillImport): Promise<Result<SkillEntry>> =>
      ipcRenderer.invoke('skills:import', store, request) as Promise<Result<SkillEntry>>,

    /** The skills the checkout carries, so one can be copied into a store. */
    inRepository: (workspaceId: string): Promise<Result<SkillEntry[]>> =>
      ipcRenderer.invoke('skills:inRepository', workspaceId) as Promise<Result<SkillEntry[]>>,

    /**
     * Every skill this conversation could use, and whether it is on.
     *
     * Resolved in core: three sources and two lists of defaults are more than
     * a window should have to ask four questions to work out.
     */
    forChat: (chatId: string): Promise<Result<SkillListing[]>> =>
      ipcRenderer.invoke('skills:forChat', chatId) as Promise<Result<SkillListing[]>>,

    /** The same before the first message, when there is no conversation yet. */
    forWorkspace: (workspaceId: string): Promise<Result<SkillListing[]>> =>
      ipcRenderer.invoke('skills:forWorkspace', workspaceId) as Promise<Result<SkillListing[]>>,

    /** Switches one skill for one conversation, a running session included. */
    setForChat: (chatId: string, key: string, enabled: boolean): Promise<Result<void>> =>
      ipcRenderer.invoke('skills:setForChat', chatId, key, enabled) as Promise<Result<void>>
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

    /**
     * Every branch of the repository that has a pull request.
     *
     * One call for the whole project, which is what lets the workspace list
     * mark every row without a network call per row.
     */
    pullRequests: (projectId: string): Promise<Result<BranchRequest[]>> =>
      ipcRenderer.invoke('projects:pullRequests', projectId) as Promise<Result<BranchRequest[]>>,

    /** Reads a project script; a missing one comes back as a template. */
    readScript: (projectId: string, kind: ScriptKind): Promise<Result<string>> =>
      ipcRenderer.invoke('scripts:read', projectId, kind) as Promise<Result<string>>,

    saveScript: (projectId: string, kind: ScriptKind, contents: string): Promise<Result<void>> =>
      ipcRenderer.invoke('scripts:save', projectId, kind, contents) as Promise<Result<void>>,

    /** Which of the checkout's files travel into a workspace, one path per line. */
    readCarryList: (projectId: string): Promise<Result<string>> =>
      ipcRenderer.invoke('carry:read', projectId) as Promise<Result<string>>,

    saveCarryList: (projectId: string, contents: string): Promise<Result<void>> =>
      ipcRenderer.invoke('carry:save', projectId, contents) as Promise<Result<void>>,

    /**
     * What the checkout's `.conductor` declares it needs, beside what the list
     * above actually carries. Null where nothing declares anything.
     */
    declaredCarryFiles: (projectId: string): Promise<Result<DeclaredCarryFiles | null>> =>
      ipcRenderer.invoke('carry:declared', projectId) as Promise<Result<DeclaredCarryFiles | null>>,

    /** The named sets of variables this project holds, and its default. */
    envProfiles: (
      projectId: string
    ): Promise<Result<{ profiles: readonly string[]; projectDefault: string }>> =>
      ipcRenderer.invoke('env:profiles', projectId) as Promise<
        Result<{ profiles: readonly string[]; projectDefault: string }>
      >,

    /** One set, written last into every workspace's `.env` so it wins. */
    readEnv: (projectId: string, name: string): Promise<Result<string>> =>
      ipcRenderer.invoke('env:read', projectId, name) as Promise<Result<string>>,

    saveEnv: (projectId: string, name: string, contents: string): Promise<Result<void>> =>
      ipcRenderer.invoke('env:save', projectId, name, contents) as Promise<Result<void>>,

    createEnv: (projectId: string, name: string, from: string | null): Promise<Result<void>> =>
      ipcRenderer.invoke('env:create', projectId, name, from) as Promise<Result<void>>,

    renameEnv: (projectId: string, from: string, to: string): Promise<Result<void>> =>
      ipcRenderer.invoke('env:rename', projectId, from, to) as Promise<Result<void>>,

    removeEnv: (projectId: string, name: string): Promise<Result<void>> =>
      ipcRenderer.invoke('env:remove', projectId, name) as Promise<Result<void>>,

    /** Which scripts this repository supplies, and whether they may run. */
    scripts: (projectId: string, workspaceId: string | null): Promise<Result<ScriptsInWorkspace>> =>
      ipcRenderer.invoke('scripts:project', projectId, workspaceId) as Promise<
        Result<ScriptsInWorkspace>
      >,

    /** What this project offers the agent, and what this machine adds. */
    instructionSources: (
      projectId: string,
      workspaceId: string | null
    ): Promise<Result<InstructionSource[]>> =>
      ipcRenderer.invoke('instructions:sources', projectId, workspaceId) as Promise<
        Result<InstructionSource[]>
      >,

    /**
     * The settings this project's repository carries, beside the app's own.
     *
     * A snapshot in `.octopus/`, so a wiped installation can be rebuilt from
     * the repository. Read on demand; nothing in it runs on its own.
     */
    repoConfig: (projectId: string): Promise<Result<RepoConfigView>> =>
      ipcRenderer.invoke('repoConfig:read', projectId) as Promise<Result<RepoConfigView>>,

    /** Takes the named items out of the repository and into the installation. */
    importRepoConfig: (
      projectId: string,
      ids: readonly RepoItemId[]
    ): Promise<Result<RepoItemId[]>> =>
      ipcRenderer.invoke('repoConfig:import', projectId, ids) as Promise<Result<RepoItemId[]>>,

    /** Writes the named items from the installation into the repository. */
    exportRepoConfig: (
      projectId: string,
      ids: readonly RepoItemId[]
    ): Promise<Result<RepoItemId[]>> =>
      ipcRenderer.invoke('repoConfig:export', projectId, ids) as Promise<Result<RepoItemId[]>>,

    /** Whether git would keep the env file out of a commit. */
    isEnvIgnored: (projectId: string): Promise<Result<boolean>> =>
      ipcRenderer.invoke('env:ignored', projectId) as Promise<Result<boolean>>,

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
    listRemote: (): Promise<Result<RepositoryList>> =>
      ipcRenderer.invoke('projects:listRemote') as Promise<Result<RepositoryList>>,

    /** Clones a repository and adds it. `null` means the destination prompt was cancelled. */
    addFromGitHub: (repository: RemoteRepository): Promise<Result<Project | null>> =>
      ipcRenderer.invoke('projects:addFromGitHub', repository) as Promise<Result<Project | null>>
  }
} as const

export type OctopusApi = typeof api

contextBridge.exposeInMainWorld('octopus', api)
