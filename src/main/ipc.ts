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
import { type AccountKind, checkAccounts, signOut } from '../core/accounts.js'
import {
  ChatMessageSchema,
  ChatTitleSchema,
  EffortChoiceSchema,
  PermissionAnswerSchema,
  PlanFeedbackSchema,
  WorkingModeSchema
} from '../core/chats.js'
import type { RemoteRepository } from '../core/github.js'
import { InstructionBodySchema, InstructionKindSchema } from '../core/instructions.js'
import { NewPullRequestSchema } from '../core/pullRequests.js'
import { QuestionAnswerSchema } from '../core/questions.js'
import { ScriptBodySchema, ScriptKindSchema } from '../core/scripts.js'
import type {
  ChatEvent,
  ChatStatusEvent,
  OctopusService,
  WorkspaceStatusEvent
} from '../core/service.js'
import { ProjectPatchSchema } from '../core/store.js'
import { TerminalSpecSchema } from '../core/terminal.js'
import type { ThemeName } from '../core/types.js'
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
 * The parts of Electron this module needs.
 *
 * Named explicitly so a test can supply seven small functions instead of a
 * framework, and so it is obvious at a glance how much of Electron the IPC
 * layer actually touches.
 */
/**
 * The part of an IPC event this module uses.
 *
 * A type-only import from Electron: it is erased at build time, so nothing
 * about it reaches the test environment.
 */
export interface IpcEvent {
  readonly sender: WebContents
}

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
  /**
   * What each conversation is doing, to every window.
   *
   * The twin of the above one level in, and a third stream for the same reason
   * the second exists: the tab strip draws a conversation's state, and it moves
   * at moments the workspace's does not.
   */
  readonly broadcastChatStatus: (event: ChatStatusEvent) => void
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
    attempt(async () => {
      const updated = await service.updateConfig(patch)
      host.broadcastTheme(resolveTheme(updated.theme, host.prefersDark()))
      return updated
    })
  )

  host.handle('projects:list', () => attempt(() => service.listProjects()))

  host.handle('accounts:status', () => attempt(() => checkAccounts()))

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

  host.handle('terminal:dispose', (_event, id: string) => {
    terminals.dispose(id)
  })

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

  host.handle('workspaces:pullRequest', (_event, workspaceId: string) =>
    attempt(() => service.readPullRequest(workspaceId))
  )

  // Title and body are typed by the user and end up as arguments to `gh`, so
  // they are bounded here like every other string crossing this boundary — a
  // body the size of a file is a mistake, not a description.
  host.handle('workspaces:createPullRequest', (_event, workspaceId: string, request: unknown) =>
    attempt(() => service.createPullRequest(workspaceId, NewPullRequestSchema.parse(request)))
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
  service.onChatStatus(host.broadcastChatStatus)

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

  await service.updateConfig({ cloneDirectory: chosen })
  return chosen
}
