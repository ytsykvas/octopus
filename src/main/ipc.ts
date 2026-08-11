/**
 * Every IPC channel the renderer can call.
 *
 * Electron's own surface arrives as parameters rather than being imported
 * here, so the whole table can be exercised with a stand-in `ipcMain` that
 * simply records handlers — the same reasoning that keeps the core headless,
 * applied to the process that talks to it.
 */

import type { OpenDialogOptions, WebContents } from 'electron'

import type { Config } from '../core/config.js'
import { type AccountKind, checkAccounts, signOut } from '../core/accounts.js'
import { ChatMessageSchema, PermissionAnswerSchema, PermissionModeSchema } from '../core/chats.js'
import type { RemoteRepository } from '../core/github.js'
import { InstructionBodySchema, InstructionKindSchema } from '../core/instructions.js'
import { ScriptBodySchema, ScriptKindSchema } from '../core/scripts.js'
import type { ChatEvent, OctopusService } from '../core/service.js'
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
 * Named explicitly so a test can supply five small functions instead of a
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

  host.handle('instructions:read', (_event, projectId: string, kind: unknown) =>
    attempt(() => service.readProjectInstruction(projectId, InstructionKindSchema.parse(kind)))
  )

  host.handle('instructions:save', (_event, projectId: string, kind: unknown, contents: unknown) =>
    attempt(() =>
      service.saveProjectInstruction(
        projectId,
        InstructionKindSchema.parse(kind),
        InstructionBodySchema.parse(contents)
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

  // The agent chat. Everything the renderer sends here reaches a model or a
  // stored record, so each argument is validated rather than trusted.
  service.onAgentEvent(host.broadcastChatEvent)

  // Listing does not create, opening does. The distinction is what keeps a
  // workspace nobody has spoken to free of a record and a transcript file.
  host.handle('chats:list', (_event, workspaceId: string) =>
    attempt(() => service.listChats(workspaceId))
  )

  host.handle('chats:open', (_event, workspaceId: string) =>
    attempt(() => service.openChat(workspaceId))
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
    attempt(() => service.setChatPermissionMode(chatId, PermissionModeSchema.parse(mode)))
  )

  host.handle('chats:permission', (_event, requestId: string, answer: unknown) =>
    attempt(() => service.answerPermission(requestId, PermissionAnswerSchema.parse(answer)))
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
