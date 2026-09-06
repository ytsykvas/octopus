/**
 * Every IPC channel the renderer can call.
 *
 * Electron's own surface arrives as parameters rather than being imported
 * here, so the whole table can be exercised with a stand-in `ipcMain` that
 * simply records handlers — the same reasoning that keeps the core headless,
 * applied to the process that talks to it.
 */

import type { OpenDialogOptions, WebContents } from 'electron'
import { z } from 'zod'

import type { Config } from '../core/config.js'
import {
  type AccountKind,
  BUTTON_TIMEOUT_MS,
  checkAccounts,
  checkGitHubAccount,
  execWithin,
  signOut
} from '../core/accounts.js'
import {
  ChatMessageSchema,
  ChatTitleSchema,
  EffortChoiceSchema,
  PermissionAnswerSchema,
  PlanFeedbackSchema,
  WorkingModeSchema
} from '../core/chats.js'
import { CarryListSchema } from '../core/carry.js'
import { EnvBodySchema } from '../core/env.js'
import { ProfileNameSchema } from '../core/envProfileNames.js'
import type { RemoteRepository } from '../core/github.js'
import { InstructionBodySchema, InstructionKindSchema } from '../core/instructions.js'
import {
  CommitMessageSchema,
  MergeMethodSchema,
  NewPullRequestSchema,
  PullRequestNumberSchema,
  ReplyBodySchema,
  ThreadIdSchema
} from '../core/pullRequests.js'
import { QuestionAnswerSchema } from '../core/questions.js'
import { RepoItemIdsSchema } from '../core/repoConfig.js'
import { RevertPathSchema } from '../core/revert.js'
import { ScriptBodySchema, ScriptKindSchema } from '../core/scripts.js'
import { SkillImportSchema, SkillSaveSchema } from '../core/skills.js'
import { SkillNameSchema, SkillStoreSchema } from '../core/skillNames.js'
import type {
  ChatEvent,
  ChatsChangedEvent,
  ChatStatusEvent,
  OctopusService,
  WorkspaceStatusEvent
} from '../core/service.js'
import { ProjectPatchSchema } from '../core/store.js'
import { TerminalSpecSchema } from '../core/terminal.js'
import type { ThemeName } from '../core/types.js'
import type { UsageWindows } from '../core/usage.js'
import type { RemoveOptions } from '../core/workspaces.js'
import type { TerminalManager } from './terminals.js'
import { attempt } from './result.js'
import { resolveTheme } from './theme.js'

/** What a directory picker answers: a path, or nothing when cancelled. */
export interface PickedDirectory {
  readonly canceled: boolean
  readonly filePaths: readonly string[]
}

/**
 * The part of an IPC event this module uses.
 *
 * A type-only import from Electron: it is erased at build time, so nothing
 * about it reaches the test environment.
 */
export interface IpcEvent {
  readonly sender: WebContents
}

/**
 * The parts of Electron this module needs.
 *
 * Named explicitly so a test can supply small functions instead of a
 * framework, and so it is obvious at a glance how much of Electron the IPC
 * layer actually touches.
 *
 * Deliberately not counted, here or in the documents that describe it. Four
 * places said nine while it held ten, all of them left behind by the one commit
 * that added the tenth.
 */
export interface IpcHost {
  readonly handle: (
    channel: string,
    handler: (event: IpcEvent, ...args: never[]) => unknown
  ) => void
  readonly showOpenDialog: (
    options: OpenDialogOptions,
    parent?: unknown
  ) => Promise<PickedDirectory>
  /** The window a call came from, for a sheet-style dialog; null if it is gone. */
  readonly windowFor: (event: IpcEvent) => unknown
  readonly prefersDark: () => boolean
  /** Sends a theme change to every open window. */
  readonly broadcastTheme: (theme: ThemeName) => void
  /**
   * Sends an agent event to every open window.
   *
   * A broadcast rather than a reply to whoever sent the message: events keep
   * arriving long after the call that started them returned, and a second
   * window looking at the same workspace should see the same conversation.
   */
  readonly broadcastChatEvent: (event: ChatEvent) => void
  /**
   * What a workspace is doing, to every window.
   *
   * A second stream rather than a variant of the one above: this says nothing
   * about a conversation, and the list that draws it is not looking at a chat.
   */
  readonly broadcastWorkspaceStatus: (event: WorkspaceStatusEvent) => void
  /** The account's windows, whenever the service learns they moved. */
  readonly broadcastUsageWindows: (windows: UsageWindows) => void
  /**
   * What each conversation is doing, to every window.
   *
   * The twin of the above one level in, and a third stream for the same reason
   * the second exists: the tab strip draws a conversation's state, and it moves
   * at moments the workspace's does not.
   */
  readonly broadcastChatStatus: (event: ChatStatusEvent) => void
  /**
   * Which conversations a workspace has, when that set changes.
   *
   * A fifth stream rather than a widening of the one above: a status moves
   * several times a turn, and a window told to re-read its list on each of them
   * would be asking about conversations it already knows.
   */
  readonly broadcastChatsChanged: (event: ChatsChangedEvent) => void
  /**
   * The config as it now stands, to every window.
   *
   * A sixth stream because a window has no other way to learn of a write it did
   * not make: it reads the config on mount and then only from its own update's
   * reply.
   */
  readonly broadcastConfig: (config: Config) => void
  /**
   * Hands a path to the system, which decides what opens it.
   *
   * Answers with an empty string on success and a reason otherwise — Electron's
   * own shape, kept rather than normalised so nothing is lost on the way here.
   */
  readonly openPath: (path: string) => Promise<string>
}

/**
 * A path on its way to being opened.
 *
 * The ceiling is well past any real path and short of what would make a useful
 * denial-of-service argument; the service is what proves the path is inside the
 * workspace it claims.
 */
const FilePathSchema = z.string().min(1).max(4096)

/**
 * Writes the config and tells every window, from the one place that writes it.
 *
 * Both announcements live here rather than at the handler, and that is the
 * point rather than tidiness: `resolveCloneDirectory` called the service
 * directly, so a destination chosen in main's own dialog reached no window and
 * skipped the theme push as well. The window then went on reporting "you will
 * be asked where to clone" while every later clone of the session was written
 * somewhere it had already been told about once and never showed. Any config
 * write added in main from now on gets both by construction.
 */
async function writeConfig(
  service: OctopusService,
  host: IpcHost,
  patch: Partial<Config>
): Promise<Config> {
  const updated = await service.updateConfig(patch)

  host.broadcastTheme(resolveTheme(updated.theme, host.prefersDark()))
  host.broadcastConfig(updated)

  return updated
}

/**
 * Registers IPC handlers.
 *
 * They are deliberately one-liners: all logic lives in the core service and
 * this layer only forwards calls (§11.1).
 */
export function registerIpc(
  service: OctopusService,
  terminals: TerminalManager,
  host: IpcHost
): void {
  host.handle('theme:get', () => resolveTheme(service.getConfig().theme, host.prefersDark()))

  host.handle('config:get', () => attempt(() => service.getConfig()))

  host.handle('config:update', (_event, patch: Partial<Config>) =>
    attempt(() => writeConfig(service, host, patch))
  )

  host.handle('projects:list', () => attempt(() => service.listProjects()))

  host.handle('accounts:status', () => attempt(() => checkAccounts()))

  /*
   * GitHub alone, for the button that is about GitHub alone.
   *
   * `accounts:status` queries both services, so a click on "Add from GitHub"
   * started a Claude CLI process nobody asked for and then waited on whichever
   * of the two answered last. The timeout is shorter for the same reason the
   * channel exists: this one is a button press.
   */
  host.handle('accounts:github', () =>
    attempt(() => checkGitHubAccount(execWithin(BUTTON_TIMEOUT_MS)))
  )

  // Signing out asks nothing, so it runs silently rather than in a terminal.
  host.handle('accounts:signOut', (_event, kind: AccountKind, login: string | null) =>
    attempt(() => signOut(kind, login))
  )

  // Terminal sessions. The spec is validated rather than trusted: it arrives
  // over IPC and ends up as a working directory and a command line.
  host.handle('terminal:create', (event, spec: unknown) =>
    attempt(() => terminals.create(TerminalSpecSchema.parse(spec), event.sender))
  )

  host.handle('terminal:write', (_event, id: string, data: string) => {
    terminals.write(id, data)
  })

  host.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    terminals.resize(id, cols, rows)
  })

  // Answers when the session has gone rather than when it was asked to go: a
  // restart waits on this before binding the port again.
  host.handle('terminal:dispose', (_event, id: string) => terminals.dispose(id))

  // The patch is validated rather than trusted: it arrives from the renderer
  // and its base branch reaches a git command.
  host.handle('projects:update', (_event, projectId: string, patch: unknown) =>
    attempt(() => service.updateProjectById(projectId, ProjectPatchSchema.parse(patch)))
  )

  host.handle('projects:branches', (_event, projectId: string) =>
    attempt(() => service.listProjectBranches(projectId))
  )

  // The kind and the body both arrive from the renderer, and the body becomes
  // an executable file — neither is taken on trust.
  host.handle('scripts:read', (_event, projectId: string, kind: unknown) =>
    attempt(() => service.readProjectScript(projectId, ScriptKindSchema.parse(kind)))
  )

  host.handle('scripts:save', (_event, projectId: string, kind: unknown, contents: unknown) =>
    attempt(() =>
      service.saveProjectScript(
        projectId,
        ScriptKindSchema.parse(kind),
        ScriptBodySchema.parse(contents)
      )
    )
  )

  host.handle('scripts:paths', (_event, projectId: string) =>
    attempt(() => service.projectScriptPaths(projectId))
  )

  host.handle('carry:read', (_event, projectId: string) =>
    attempt(() => service.readProjectCarryList(projectId))
  )

  host.handle('carry:save', (_event, projectId: string, contents: unknown) =>
    attempt(() => service.saveProjectCarryList(projectId, CarryListSchema.parse(contents)))
  )

  host.handle('carry:declared', (_event, projectId: string) =>
    attempt(() => service.declaredCarryFiles(projectId))
  )

  host.handle('workspace:env', (_event, workspaceId: string) =>
    attempt(() => service.readWorkspaceEnv(workspaceId))
  )

  // Keyed by workspace: the files live in the worktree a session runs in, and
  // a branch may carry different ones from the branch beside it.
  host.handle('trust:read', (_event, workspaceId: string) =>
    attempt(() => service.workspaceTrust(workspaceId))
  )

  host.handle('trust:approve', (_event, workspaceId: string) =>
    attempt(() => service.approveWorkspaceSettings(workspaceId))
  )

  // Keyed by workspace for the same reason: which script runs is a fact about
  // the worktree, and a branch may carry a different one from the branch beside
  // it. The pair mirrors `trust:read` / `trust:approve` exactly, because it is
  // the same shape of question about a different thing.
  host.handle('scripts:resolved', (_event, workspaceId: string) =>
    attempt(() => service.workspaceScripts(workspaceId))
  )

  host.handle('scripts:approve', (_event, workspaceId: string) =>
    attempt(() => service.approveWorkspaceScripts(workspaceId))
  )

  // The workspace as well, because a run happens in a worktree and a branch may
  // carry a script the checkout has not got. Null when settings is open with no
  // workspace to ask about, and the checkout answers then.
  host.handle('scripts:project', (_event, projectId: string, workspaceId: unknown) =>
    attempt(() => service.projectScripts(projectId, z.string().nullable().parse(workspaceId)))
  )

  // The workspace as well, because whether a source is read depends on the
  // worktree a session would run in — that is where the trust gate looks.
  host.handle('instructions:sources', (_event, projectId: string, workspaceId: unknown) =>
    attempt(() =>
      service.projectInstructionSources(projectId, z.string().nullable().parse(workspaceId))
    )
  )

  // Asked of the checkout, which shares its `.gitignore` with every worktree
  // made from it.
  host.handle('env:ignored', (_event, projectId: string) =>
    attempt(() => service.isProjectEnvIgnored(projectId))
  )

  // A snapshot of the project's settings that its repository may carry, so a
  // wiped installation can be rebuilt from the repository rather than memory.
  host.handle('repoConfig:read', (_event, projectId: string) =>
    attempt(() => service.projectRepoConfig(projectId))
  )

  // The ids name files the app reads and writes, so they are parsed rather than
  // trusted to be ours.
  host.handle('repoConfig:import', (_event, projectId: string, ids: unknown) =>
    attempt(() => service.importRepoConfig(projectId, RepoItemIdsSchema.parse(ids)))
  )

  host.handle('repoConfig:export', (_event, projectId: string, ids: unknown) =>
    attempt(() => service.exportRepoConfig(projectId, RepoItemIdsSchema.parse(ids)))
  )

  // Keyed by workspace rather than project: the files land in a worktree, and
  // only the workspace knows where that is.
  host.handle('workspace:prepare', (_event, workspaceId: string) =>
    attempt(() => service.prepareWorkspace(workspaceId))
  )

  host.handle('env:profiles', (_event, projectId: string) =>
    attempt(() => service.listEnvProfiles(projectId))
  )

  // The name becomes a filename, so it is parsed here as well as in the core:
  // types vanish at this boundary and a renderer can send any value.
  host.handle('env:read', (_event, projectId: string, name: unknown) =>
    attempt(() => service.readEnvProfile(projectId, ProfileNameSchema.parse(name)))
  )

  host.handle('env:save', (_event, projectId: string, name: unknown, contents: unknown) =>
    attempt(() =>
      service.saveEnvProfile(
        projectId,
        ProfileNameSchema.parse(name),
        EnvBodySchema.parse(contents)
      )
    )
  )

  host.handle('env:create', (_event, projectId: string, name: unknown, from: unknown) =>
    attempt(() =>
      service.createEnvProfile(
        projectId,
        ProfileNameSchema.parse(name),
        from === null ? null : ProfileNameSchema.parse(from)
      )
    )
  )

  host.handle('env:rename', (_event, projectId: string, from: unknown, to: unknown) =>
    attempt(() =>
      service.renameEnvProfile(
        projectId,
        ProfileNameSchema.parse(from),
        ProfileNameSchema.parse(to)
      )
    )
  )

  host.handle('env:remove', (_event, projectId: string, name: unknown) =>
    attempt(() => service.removeEnvProfile(projectId, ProfileNameSchema.parse(name)))
  )

  host.handle('workspaces:envProfile', (_event, workspaceId: string, name: unknown) =>
    attempt(() =>
      service.setWorkspaceEnvProfile(
        workspaceId,
        name === null ? null : ProfileNameSchema.parse(name)
      )
    )
  )

  // Keyed by workspace rather than taking a port: a port from the renderer is a
  // number to connect to, and this one is ours to decide.
  host.handle('workspaces:serving', (_event, workspaceId: string) =>
    attempt(() => service.isWorkspaceServing(workspaceId))
  )

  // Asked before a run, and only while nothing of this workspace is alive —
  // which is what lets it treat anything on the port as somebody else's.
  host.handle('workspaces:port', (_event, workspaceId: string) =>
    attempt(() => service.ensureWorkspacePort(workspaceId))
  )

  // `null` is the installation's own instruction rather than a project's, which
  // is why the id is not narrowed to a string here.
  host.handle('instructions:read', (_event, projectId: string | null, kind: unknown) =>
    attempt(() => service.readProjectInstruction(projectId, InstructionKindSchema.parse(kind)))
  )

  host.handle(
    'instructions:save',
    (_event, projectId: string | null, kind: unknown, contents: unknown) =>
      attempt(() =>
        service.saveProjectInstruction(
          projectId,
          InstructionKindSchema.parse(kind),
          InstructionBodySchema.parse(contents)
        )
      )
  )

  host.handle('instructions:effective', (_event, workspaceId: string, kind: unknown) =>
    attempt(() => service.readEffectiveInstruction(workspaceId, InstructionKindSchema.parse(kind)))
  )

  /*
   * Every skill argument is parsed rather than trusted, and the name most of
   * all: it becomes a directory under `~/.octopus` and reaches a recursive
   * delete, so `SkillNameSchema` is the boundary that refuses `..` before any
   * of it is a path.
   */
  host.handle('skills:list', (_event, store: unknown) =>
    attempt(() => service.listSkills(SkillStoreSchema.parse(store)))
  )

  host.handle('skills:read', (_event, store: unknown, folder: unknown) =>
    attempt(() =>
      service.readStoredSkill(SkillStoreSchema.parse(store), SkillNameSchema.parse(folder))
    )
  )

  host.handle('skills:save', (_event, store: unknown, folder: unknown, save: unknown) =>
    attempt(() =>
      service.saveStoredSkill(
        SkillStoreSchema.parse(store),
        SkillNameSchema.parse(folder),
        SkillSaveSchema.parse(save)
      )
    )
  )

  host.handle('skills:remove', (_event, store: unknown, folder: unknown) =>
    attempt(() =>
      service.removeStoredSkill(SkillStoreSchema.parse(store), SkillNameSchema.parse(folder))
    )
  )

  /*
   * Both names are parsed with the same schema, and the second one has to be:
   * it becomes a directory, and the folder it moves to is joined onto a path.
   */
  host.handle('skills:rename', (_event, store: unknown, folder: unknown, to: unknown) =>
    attempt(() =>
      service.renameStoredSkill(
        SkillStoreSchema.parse(store),
        SkillNameSchema.parse(folder),
        SkillNameSchema.parse(to)
      )
    )
  )

  /*
   * Reads what an import would write, and writes nothing. The one route worth
   * the extra call is the link: an address shows nothing until it is fetched.
   */
  host.handle('skills:inspect', (_event, store: unknown, request: unknown) =>
    attempt(() =>
      service.inspectSkillImport(SkillStoreSchema.parse(store), SkillImportSchema.parse(request))
    )
  )

  host.handle('skills:import', (_event, store: unknown, request: unknown) =>
    attempt(() =>
      service.importStoredSkill(SkillStoreSchema.parse(store), SkillImportSchema.parse(request))
    )
  )

  host.handle('skills:inRepository', (_event, workspaceId: string) =>
    attempt(() => service.listRepositorySkills(workspaceId))
  )

  host.handle('skills:forChat', (_event, chatId: string) =>
    attempt(() => service.skillsForChat(chatId))
  )

  // For a workspace whose first message has not been sent: `openChat` is lazy,
  // so there is no conversation to ask about yet.
  host.handle('skills:forWorkspace', (_event, workspaceId: string) =>
    attempt(() => service.skillsForWorkspace(workspaceId))
  )

  host.handle('skills:setForChat', (_event, chatId: string, key: unknown, enabled: unknown) =>
    attempt(() =>
      service.setChatSkill(
        chatId,
        z.string().min(1).max(200).parse(key),
        z.boolean().parse(enabled)
      )
    )
  )

  host.handle('projects:remove', (_event, projectId: string) =>
    attempt(() => service.removeProjectById(projectId))
  )

  host.handle('projects:listRemote', () => attempt(() => service.listRemoteRepositories()))

  host.handle('workspaces:list', (_event, projectId: string) =>
    attempt(() => service.listWorkspaces(projectId))
  )

  host.handle('workspaces:create', (_event, projectId: string) =>
    attempt(() => service.createWorkspaceIn(projectId))
  )

  host.handle('workspaces:rename', (_event, workspaceId: string, name: string) =>
    attempt(() => service.renameWorkspaceById(workspaceId, name))
  )

  host.handle('workspaces:remove', (_event, workspaceId: string, options: RemoveOptions) =>
    attempt(() => service.removeWorkspaceById(workspaceId, options))
  )

  host.handle('workspaces:hasChanges', (_event, workspaceId: string) =>
    attempt(() => service.workspaceHasChanges(workspaceId))
  )

  host.handle('workspaces:diff', (_event, workspaceId: string) =>
    attempt(() => service.readWorkspaceChanges(workspaceId))
  )

  // Both paths are parsed rather than trusted: one becomes a git argument and,
  // for a file nobody added, a file to delete.
  host.handle(
    'workspaces:revertFile',
    (_event, workspaceId: string, path: unknown, oldPath: unknown) =>
      attempt(() =>
        service.revertWorkspaceFile(
          workspaceId,
          RevertPathSchema.parse(path),
          oldPath == null ? null : RevertPathSchema.parse(oldPath)
        )
      )
  )

  host.handle('workspaces:pullRequest', (_event, workspaceId: string) =>
    attempt(() => service.readPullRequest(workspaceId))
  )

  // Title and body are typed by the user and end up as arguments to `gh`, so
  // they are bounded here like every other string crossing this boundary — a
  // body the size of a file is a mistake, not a description.
  host.handle('workspaces:createPullRequest', (_event, workspaceId: string, request: unknown) =>
    attempt(() => service.createPullRequest(workspaceId, NewPullRequestSchema.parse(request)))
  )

  // Nothing to validate past the id: this one takes no user values, and what
  // comes back is checked where it is parsed rather than trusted from here.
  host.handle('workspaces:draftPullRequest', (_event, workspaceId: string) =>
    attempt(() => service.draftPullRequest(workspaceId))
  )

  host.handle('workspaces:commitAndPush', (_event, workspaceId: string, message: unknown) =>
    attempt(() => service.commitAndPushWorkspace(workspaceId, CommitMessageSchema.parse(message)))
  )

  // The number becomes an argument to `gh`, so it is proved to be one before it
  // gets there rather than trusted because the renderer read it from us.
  host.handle('workspaces:pullRequestDetail', (_event, workspaceId: string, number: unknown) =>
    attempt(() => service.readPullRequestDetail(workspaceId, PullRequestNumberSchema.parse(number)))
  )

  host.handle(
    'workspaces:mergePullRequest',
    (_event, workspaceId: string, number: unknown, method: unknown) =>
      attempt(() =>
        service.mergePullRequest(
          workspaceId,
          PullRequestNumberSchema.parse(number),
          MergeMethodSchema.parse(method)
        )
      )
  )

  host.handle('workspaces:closePullRequest', (_event, workspaceId: string, number: unknown) =>
    attempt(() => service.closePullRequest(workspaceId, PullRequestNumberSchema.parse(number)))
  )

  // Both become arguments to `gh` the same way a number does, so both are
  // proved rather than trusted — the renderer read them from us, and types are
  // gone by the time they cross back.
  host.handle(
    'workspaces:replyToReviewThread',
    (_event, workspaceId: string, threadId: unknown, body: unknown) =>
      attempt(() =>
        service.replyToReviewThread(
          workspaceId,
          ThreadIdSchema.parse(threadId),
          ReplyBodySchema.parse(body)
        )
      )
  )

  host.handle(
    'workspaces:resolveReviewThread',
    (_event, workspaceId: string, threadId: unknown, resolved: unknown) =>
      attempt(() =>
        service.setReviewThreadResolved(
          workspaceId,
          ThreadIdSchema.parse(threadId),
          z.boolean().parse(resolved)
        )
      )
  )

  host.handle('projects:pullRequests', (_event, projectId: string) =>
    attempt(() => service.readBranchRequests(projectId))
  )

  // The one channel here that takes a path. It is validated, and the service
  // then proves it is inside the workspace, because what comes back is handed
  // to the operating system rather than looked up in our own records.
  host.handle('files:open', (_event, workspaceId: string, path: unknown) =>
    attempt(async () => {
      const absolute = await service.resolveWorkspaceFile(workspaceId, FilePathSchema.parse(path))
      const refusal = await host.openPath(absolute)
      if (refusal !== '') throw new Error(refusal)
    })
  )

  // The agent chat. Everything the renderer sends here reaches a model or a
  // stored record, so each argument is validated rather than trusted.
  service.onAgentEvent(host.broadcastChatEvent)
  service.onWorkspaceStatus(host.broadcastWorkspaceStatus)
  service.onUsageWindows(host.broadcastUsageWindows)
  service.onChatStatus(host.broadcastChatStatus)
  service.onChatsChanged(host.broadcastChatsChanged)

  // Listing does not create, opening does. The distinction is what keeps a
  // workspace nobody has spoken to free of a record and a transcript file.
  host.handle('chats:list', (_event, workspaceId: string) =>
    attempt(() => service.listChats(workspaceId))
  )

  host.handle('chats:open', (_event, workspaceId: string) =>
    attempt(() => service.openChat(workspaceId))
  )

  // The three below take ids and nothing else, so there is nothing to parse:
  // the service proves an id against the store, which is stronger than a shape
  // check — the same treatment `chats:history` and `chats:interrupt` get.
  host.handle('chats:create', (_event, workspaceId: string) =>
    attempt(() => service.createChat(workspaceId))
  )

  host.handle('chats:fork', (_event, chatId: string) => attempt(() => service.forkChat(chatId)))

  host.handle('chats:close', (_event, chatId: string) => attempt(() => service.closeChat(chatId)))

  // The one of the four that carries something the user typed, so it is parsed
  // rather than trusted — it is bounded, and the bound is what stops a tab
  // carrying a pasted paragraph.
  host.handle('chats:rename', (_event, chatId: string, title: unknown) =>
    attempt(() => service.renameChat(chatId, ChatTitleSchema.parse(title)))
  )

  host.handle('chats:history', (_event, chatId: string) =>
    attempt(() => service.chatHistory(chatId))
  )

  host.handle('chats:send', (_event, chatId: string, text: unknown) =>
    attempt(() => service.sendToChat(chatId, ChatMessageSchema.parse(text)))
  )

  host.handle('chats:interrupt', (_event, chatId: string) =>
    attempt(() => service.interruptChat(chatId))
  )

  host.handle('chats:mode', (_event, chatId: string, mode: unknown) =>
    attempt(() => service.setChatWorkingMode(chatId, WorkingModeSchema.parse(mode)))
  )

  host.handle('chats:planMode', (_event, chatId: string, planning: unknown) =>
    attempt(() => service.setChatPlanMode(chatId, z.boolean().parse(planning)))
  )

  host.handle('chats:effort', (_event, chatId: string, effort: unknown) =>
    attempt(() => service.setChatEffort(chatId, EffortChoiceSchema.parse(effort)))
  )

  host.handle('chats:planEffort', (_event, chatId: string, effort: unknown) =>
    attempt(() => service.setChatPlanEffort(chatId, EffortChoiceSchema.nullable().parse(effort)))
  )

  host.handle('chats:model', (_event, chatId: string, model: unknown) =>
    attempt(() => service.setChatModel(chatId, z.string().min(1).nullable().parse(model)))
  )

  host.handle('chats:planModel', (_event, chatId: string, model: unknown) =>
    attempt(() => service.setChatPlanModel(chatId, z.string().min(1).nullable().parse(model)))
  )

  host.handle('chats:models', () => attempt(() => service.knownModels()))

  host.handle('chats:commands', (_event, chatId: string) =>
    attempt(() => service.chatCommands(chatId))
  )

  host.handle('chats:answerQuestions', (_event, requestId: string, answers: unknown) =>
    attempt(() => service.answerQuestions(requestId, z.array(QuestionAnswerSchema).parse(answers)))
  )

  host.handle('chats:pending', (_event, chatId: string) =>
    attempt(() => service.pendingPermission(chatId))
  )

  host.handle('chats:usage', (_event, chatId: string) =>
    attempt(() => service.sessionUsage(chatId))
  )

  host.handle('chats:permission', (_event, requestId: string, answer: unknown, feedback: unknown) =>
    attempt(() =>
      service.answerPermission(
        requestId,
        PermissionAnswerSchema.parse(answer),
        PlanFeedbackSchema.optional().parse(feedback)
      )
    )
  )

  // Read once when a window opens. Afterwards the figure arrives on its own,
  // in the same stream as everything else the agent says.
  host.handle('chats:rateLimit', () => attempt(() => service.getRateLimit()))

  // No chat in the question: the sidebar draws this, and the figures belong to
  // the account rather than to any conversation.
  host.handle('chats:subscription', () => attempt(() => service.getUsageWindows()))

  // A press of the block in the sidebar, which is somebody asking — nothing
  // fills it on its own. A control request: no turn, no tokens.
  host.handle('chats:refreshSubscription', () => attempt(() => service.refreshSubscriptionUsage()))

  /*
   * A skill arrives as either shape, so the picker offers both.
   *
   * One that carries references or scripts is a folder; one copied out of a
   * README is a lone `SKILL.md`. Refusing either would send the user off to
   * rearrange files before importing them.
   */
  host.handle('dialog:pickSkill', async (event, title: string) => {
    const window = host.windowFor(event)
    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'SKILL.md', extensions: ['md'] }]
    }

    const picked = await host.showOpenDialog(options, window ?? undefined)

    const [chosen] = picked.filePaths
    return { ok: true, value: picked.canceled ? null : (chosen ?? null) }
  })

  // Choosing a directory needs Electron's dialog, so it lives here.
  host.handle('dialog:pickDirectory', async (event, title: string) => {
    const window = host.windowFor(event)
    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openDirectory', 'createDirectory']
    }

    const picked = await host.showOpenDialog(options, window ?? undefined)

    const [chosen] = picked.filePaths
    return { ok: true, value: picked.canceled ? null : (chosen ?? null) }
  })

  // Inside `attempt`, not before it: resolving the destination writes the
  // choice to the config, and a failed write would otherwise reject across IPC
  // as an opaque Electron error the renderer cannot explain.
  host.handle('projects:addFromGitHub', (event, repository: RemoteRepository) =>
    attempt(async () => {
      const destination = await resolveCloneDirectory(service, event, host)
      // Cancelling the destination prompt is a decision, not a failure.
      if (destination === null) return null

      return service.addProjectFromGitHub(repository, destination)
    })
  )

  // Picking a directory is the one part that genuinely belongs to main:
  // the dialog is an Electron API.
  host.handle('projects:add', async (event) => {
    const window = host.windowFor(event)
    const picked = await host.showOpenDialog(
      {
        title: 'Select a repository',
        properties: ['openDirectory'],
        buttonLabel: 'Add'
      },
      window ?? undefined
    )

    const [path] = picked.filePaths
    if (picked.canceled || !path) return { ok: true, value: null }

    return attempt(() => service.addProjectFromPath(path))
  })
}

/**
 * Where a cloned repository should land.
 *
 * A configured directory is used silently; otherwise the user picks one and
 * the choice is remembered, so the question is asked once rather than on
 * every clone.
 */
async function resolveCloneDirectory(
  service: OctopusService,
  event: IpcEvent,
  host: IpcHost
): Promise<string | null> {
  const configured = service.getConfig().cloneDirectory
  if (configured !== '') return configured

  const window = host.windowFor(event)
  const picked = await host.showOpenDialog(
    {
      title: 'Where should repositories be cloned?',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Clone here'
    },
    window ?? undefined
  )

  const [chosen] = picked.filePaths
  if (picked.canceled || chosen === undefined) return null

  await writeConfig(service, host, { cloneDirectory: chosen })
  return chosen
}
