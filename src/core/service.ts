/**
 * Core facade — the single entry point for application operations.
 *
 * Holds state in memory and persists it after every change. It exists so
 * `main/` stays a thin proxy with no logic (§11.1 docs/PROJECT.md): an IPC
 * handler should only have to forward the call here.
 */

import { randomUUID } from 'node:crypto'

import { query as defaultQuery } from '@anthropic-ai/claude-agent-sdk'

import { type CommandExec, defaultExec } from './accounts.js'
import { type AgentSession, type QueryFn, READ_ONLY_TOOLS, startSession } from './agent.js'
import { type Chat, newChat, type PermissionMode } from './chats.js'
import { type Config, loadConfig, saveConfig, toSdkSettingSources } from './config.js'
import { type AgentEvent, isEphemeral } from './events.js'
import { cloneRepository, listRepositories, type RemoteRepository } from './github.js'
import type { GitExec } from './git.js'
import { gitIn } from './git.js'
import { type InstructionKind, readInstruction, writeInstruction } from './instructions.js'
import { configFile, rootDir, stateFile, stateTempFile } from './paths.js'
import { describeError } from './persist.js'
import { appendEntry, type ChatEntry, readTranscript, removeTranscript } from './transcript.js'
import { assertBranchExists, createProject, orderBaseBranches } from './projects.js'
import { readScript, type ScriptKind, scriptExists, scriptPath, writeScript } from './scripts.js'
import {
  addChat,
  addProject,
  addWorkspace,
  chatsOfWorkspace,
  findChat,
  findProject,
  loadState,
  type Project,
  removeProject,
  type ProjectPatch,
  removeWorkspace as removeWorkspaceRecord,
  saveState,
  type State,
  updateChat,
  updateProject,
  updateWorkspace,
  type Workspace,
  workspacesOfProject
} from './store.js'
import { listBranches, listRemoteBranches, listWorktrees } from './worktree.js'
import {
  changeCount,
  countChanges,
  createWorkspace,
  reconcile,
  removeWorkspace,
  renameWorkspace,
  rollbackWorkspace,
  WorkspaceError,
  type WorkspaceView,
  type RemoveOptions
} from './workspaces.js'

export interface ServiceOptions {
  readonly stateFilePath?: string
  readonly stateTempFilePath?: string
  readonly configFilePath?: string
  /**
   * Root for workspace directories.
   *
   * Separate from the state and config paths because worktrees are the one
   * thing the service writes outside those files — without it, a test with
   * its own state file would still create worktrees in the real home
   * directory.
   */
  readonly dataRoot?: string
  readonly makeExec?: (cwd: string) => GitExec
  readonly commandExec?: CommandExec
  /**
   * The Agent SDK's entry point.
   *
   * Injected so the chat can be tested end to end without spawning an agent
   * or reaching the network — the same reasoning as `makeExec`.
   */
  readonly query?: QueryFn
  readonly uuid?: () => string
  /** Current time as an ISO string; a parameter so records are predictable in tests. */
  readonly now?: () => string
}

/** An agent event together with where it came from. */
export interface ChatEvent {
  readonly chatId: string
  readonly workspaceId: string
  readonly event: AgentEvent
}

/** What the user answered to a permission request. */
export type PermissionAnswer = 'allow' | 'always' | 'deny'

/** How much of the subscription's window is gone, as last reported. */
export type RateLimit = Extract<AgentEvent, { type: 'rate_limit' }>

/** A permission request the agent is still blocked on. */
interface PendingPermission {
  readonly resolve: (allowed: boolean) => void
  readonly toolName: string
  readonly workspaceId: string
}

export interface OctopusService {
  getConfig(): Config
  updateConfig(
    patch: Partial<Omit<Config, 'version' | 'deviceId' | 'installedAt'>>
  ): Promise<Config>
  listProjects(): readonly Project[]
  addProjectFromPath(path: string): Promise<Project>
  /** Clones a GitHub repository into `destination`, then adds it as a project. */
  addProjectFromGitHub(repository: RemoteRepository, destination: string): Promise<Project>
  listRemoteRepositories(): Promise<RemoteRepository[]>
  updateProjectById(projectId: string, patch: ProjectPatch): Promise<void>
  removeProjectById(projectId: string): Promise<void>
  /** Branches the project's repository offers as a base, remotes included. */
  listProjectBranches(projectId: string): Promise<string[]>

  /** Contents of a project script, or a starting template if none exists. */
  readProjectScript(projectId: string, kind: ScriptKind): Promise<string>
  saveProjectScript(projectId: string, kind: ScriptKind, contents: string): Promise<void>
  /**
   * Absolute path of each script, or null where none has been written.
   *
   * A path rather than a flag: the tab has to show which file it runs and hand
   * it to a shell, and only the core knows where the data root is.
   */
  projectScriptPaths(projectId: string): Promise<Record<ScriptKind, string | null>>

  /** Guidance handed to the agent, or a starting template if none is written. */
  readProjectInstruction(projectId: string, kind: InstructionKind): Promise<string>
  saveProjectInstruction(projectId: string, kind: InstructionKind, contents: string): Promise<void>

  /** Workspaces of a project, reconciled with what git actually has. */
  listWorkspaces(projectId: string): Promise<WorkspaceView[]>
  createWorkspaceIn(projectId: string): Promise<Workspace>
  renameWorkspaceById(workspaceId: string, name: string): Promise<void>
  removeWorkspaceById(workspaceId: string, options?: RemoveOptions): Promise<void>
  /** Whether a workspace holds work that removal would discard. */
  workspaceHasChanges(workspaceId: string): Promise<boolean>

  /**
   * The workspace's chat, created on first use.
   *
   * Lazy on purpose: a workspace nobody has spoken to gets no record and no
   * transcript file, so the state stays a description of what happened rather
   * than of what might.
   */
  openChat(workspaceId: string): Promise<Chat>
  /** Every chat of a workspace. One today; the shape already allows more. */
  listChats(workspaceId: string): readonly Chat[]
  /** Everything said in a chat, as it will be redrawn after a restart. */
  chatHistory(chatId: string): Promise<ChatEntry[]>
  /** Sends a message, starting or resuming the agent session as needed. */
  sendToChat(chatId: string, text: string): Promise<void>
  /** Stops the current turn; the session stays open. */
  interruptChat(chatId: string): Promise<void>
  setChatPermissionMode(chatId: string, mode: PermissionMode): Promise<void>
  /** Answers a pending permission request. Unknown ids are ignored. */
  answerPermission(requestId: string, answer: PermissionAnswer): Promise<void>
  /**
   * The last rate limit any session reported, or null before one has.
   *
   * Kept in memory rather than in `state.json`: it describes the account right
   * now and goes stale on its own, and a reading restored from disk that
   * expired overnight is worse than none at all.
   */
  getRateLimit(): RateLimit | null
  /** Subscribes to agent events; the returned function unsubscribes. */
  onAgentEvent(handler: (event: ChatEvent) => void): () => void
  /** Ends every live session. Called when the application quits. */
  closeChats(): Promise<void>
}

/**
 * Creates the service, reading state and config from disk.
 *
 * Every path is a parameter with a default, so the service can be tested
 * against a temporary directory without touching real data.
 */
export async function createService(options: ServiceOptions = {}): Promise<OctopusService> {
  const statePath = options.stateFilePath ?? stateFile()
  const stateTempPath = options.stateTempFilePath ?? stateTempFile()
  const configPath = options.configFilePath ?? configFile()
  const makeExec = options.makeExec ?? gitIn
  const commandExec = options.commandExec ?? defaultExec
  const dataRoot = options.dataRoot ?? rootDir()
  const runQuery = options.query ?? defaultQuery
  const uuid = options.uuid ?? randomUUID
  const now = options.now ?? ((): string => new Date().toISOString())

  let state: State = await loadState(statePath)
  let config: Config = await loadConfig(configPath)

  /** Live agent sessions, keyed by chat. A missing entry means "not started". */
  const sessions = new Map<string, AgentSession>()
  const listeners = new Set<(event: ChatEvent) => void>()
  const pending = new Map<string, PendingPermission>()

  // One reading for the whole service, not one per chat: the limit belongs to
  // the account, and whichever session reports it is reporting the same thing.
  let rateLimit: RateLimit | null = null

  /**
   * State writes, run one after another.
   *
   * `writeJsonFile` writes to one fixed temporary path and renames it, so two
   * saves in flight at once race for that file: the first rename wins and the
   * second fails with ENOENT. Agent events arrive from a callback nobody
   * awaits, so a status change from the agent and one the user asked for
   * genuinely can land together.
   */
  let stateWrites: Promise<void> = Promise.resolve()

  /**
   * Applies a change to the state and persists it.
   *
   * Takes a function rather than a finished state so the change is computed
   * from the state as it is when its turn comes round, not as it was when the
   * caller asked — otherwise a queued write would silently undo whatever
   * landed while it waited.
   *
   * Nothing inside `change` may call `commit` again: it would queue behind the
   * write it is already part of, and wait for itself.
   */
  function commit(change: (current: State) => State): Promise<void> {
    const apply = async (): Promise<void> => {
      const next = change(state)
      await saveState(next, statePath, stateTempPath)
      state = next
    }

    // Chained onto both outcomes: one write that could not be made is not a
    // reason to stop making the rest.
    const run = stateWrites.then(apply, apply)
    stateWrites = run.then(
      () => undefined,
      () => undefined
    )

    return run
  }

  async function applyConfig(patch: Partial<Config>): Promise<Config> {
    const next: Config = { ...config, ...patch }
    await saveConfig(next, configPath)
    config = next
    return next
  }

  /**
   * Looks up a project, failing loudly.
   *
   * An operation aimed at something that is not there is a bug in the caller,
   * not a state the UI should try to render around.
   */
  function requireProject(projectId: string): Project {
    const project = findProject(state, projectId)
    if (!project) {
      throw new WorkspaceError('worktreeMissing', { projectId }, `Project ${projectId} not found.`)
    }
    return project
  }

  function requireWorkspace(workspaceId: string): Workspace {
    const workspace = state.workspaces.find((item) => item.id === workspaceId)
    if (!workspace) {
      throw new WorkspaceError(
        'worktreeMissing',
        { workspaceId },
        `Workspace ${workspaceId} not found.`
      )
    }
    return workspace
  }

  function requireChat(chatId: string): Chat {
    const chat = findChat(state, chatId)
    if (!chat) {
      throw new WorkspaceError('worktreeMissing', { chatId }, `Chat ${chatId} not found.`)
    }
    return chat
  }

  function emit(event: ChatEvent): void {
    for (const listener of listeners) listener(event)
  }

  /**
   * Transcript appends, run one after another.
   *
   * Their own chain rather than the state one: an append does not read the
   * state, so making it wait for a save would only slow the log down. What it
   * does need is order — two appends racing would interleave the conversation.
   */
  let transcriptWrites: Promise<void> = Promise.resolve()

  function record(chat: Chat, entry: ChatEntry): void {
    const append = async (): Promise<void> => {
      // A closing session goes on emitting for a moment after its workspace was
      // removed. Without this a late event would write the transcript back
      // after it had been deleted, leaving a file nothing points at.
      if (findChat(state, chat.id)) await appendEntry(chat.id, entry, dataRoot)
    }

    transcriptWrites = transcriptWrites.then(append, append).catch((error: unknown) => {
      report(chat, error)
    })
  }

  /**
   * Reports a background failure into the chat it belongs to, then drops it.
   *
   * The session is still running, and a write that could not be made is not a
   * reason to stop answering. Announced straight to the listeners rather than
   * through `record`, which would try to write the failure down and fail again.
   */
  function report(chat: Chat, error: unknown): void {
    emit({
      chatId: chat.id,
      workspaceId: chat.workspaceId,
      event: { type: 'error', message: describeError(error) }
    })
  }

  function setStatus(workspaceId: string, status: Workspace['status']): Promise<void> {
    return commit((current) =>
      // The workspace can be removed while its last events are still arriving.
      current.workspaces.some((workspace) => workspace.id === workspaceId)
        ? updateWorkspace(current, workspaceId, { status })
        : current
    )
  }

  /**
   * Everything that happens to one event: recorded, applied, then announced.
   *
   * The order matters only in that the announcement is synchronous while the
   * writes are not — the UI redraws immediately and the disk catches up.
   */
  function handleEvent(chat: Chat, event: AgentEvent): void {
    if (!isEphemeral(event)) record(chat, { role: 'agent', at: now(), event })

    if (event.type === 'rate_limit') rateLimit = event

    if (event.type === 'session_started') {
      // Persisted the moment it appears: this id is the only thing that makes
      // a conversation survive the application being restarted.
      background(
        chat,
        commit((current) =>
          findChat(current, chat.id)
            ? updateChat(current, chat.id, { sessionId: event.sessionId })
            : current
        )
      )
    }

    if (event.type === 'permission_request') {
      background(chat, setStatus(chat.workspaceId, 'waiting_permission'))
    }

    if (event.type === 'result') {
      background(chat, setStatus(chat.workspaceId, event.ok ? 'idle' : 'error'))
    }

    if (event.type === 'error') {
      background(chat, setStatus(chat.workspaceId, 'error'))
    }

    emit({ chatId: chat.id, workspaceId: chat.workspaceId, event })
  }

  /** Lets a write started from an event handler finish without anyone awaiting it. */
  function background(chat: Chat, work: Promise<unknown>): void {
    void work.catch((error: unknown) => {
      report(chat, error)
    })
  }

  /**
   * Asks the user whether the agent may use a tool.
   *
   * Returns a promise that stays unresolved until an answer arrives — which is
   * exactly what the SDK wants: `canUseTool` blocks the tool call, so the agent
   * waits rather than guessing.
   */
  async function askPermission(chat: Chat, toolName: string, input: unknown): Promise<boolean> {
    if (config.alwaysAllowedTools.includes(toolName)) return true

    const requestId = uuid()
    handleEvent(chat, { type: 'permission_request', requestId, toolName, input })

    return new Promise<boolean>((resolve) => {
      pending.set(requestId, { resolve, toolName, workspaceId: chat.workspaceId })
    })
  }

  /**
   * Ends the sessions of a workspace and discards their history.
   *
   * The records themselves go with the workspace in `removeWorkspace`; what
   * needs doing here is the part outside the state file — a child process and
   * a transcript, neither of which a record removal would touch.
   */
  async function closeChatsOf(workspaceId: string): Promise<void> {
    for (const chat of chatsOfWorkspace(state, workspaceId)) {
      const session = sessions.get(chat.id)
      sessions.delete(chat.id)

      // Best effort, one at a time: a session that fails to close must not
      // stop the workspace from being removed.
      await session?.close().catch(() => undefined)
      await removeTranscript(chat.id, dataRoot).catch(() => undefined)
    }
  }

  function startFor(chat: Chat, workspace: Workspace): AgentSession {
    const session = startSession(
      {
        cwd: workspace.path,
        resume: chat.sessionId,
        settingSources: toSdkSettingSources(config.settingSources),
        permissionMode: chat.permissionMode,
        model: chat.model,
        // The read-only set and the user's own answers are the only things
        // pre-approved; everything else reaches `askPermission`.
        allowedTools: [...READ_ONLY_TOOLS, ...config.alwaysAllowedTools]
      },
      {
        query: runQuery,
        onEvent: (event) => {
          // Re-read rather than closed over: `chat` is a snapshot, and the
          // session id written after the first turn would not be in it.
          handleEvent(findChat(state, chat.id) ?? chat, event)
        },
        askPermission: ({ toolName, input }) => askPermission(chat, toolName, input)
      }
    )

    sessions.set(chat.id, session)
    return session
  }

  async function addFromPath(path: string): Promise<Project> {
    const project = await createProject(path, config.branchPrefix, state, makeExec)
    await commit((current) => addProject(current, project))
    return project
  }

  return {
    getConfig() {
      return config
    },

    updateConfig(patch) {
      return applyConfig(patch)
    },

    listProjects() {
      return state.projects
    },

    addProjectFromPath(path) {
      return addFromPath(path)
    },

    async listRemoteRepositories() {
      return listRepositories(commandExec)
    },

    async addProjectFromGitHub(repository, destination) {
      const path = await cloneRepository(repository, destination, commandExec)
      return addFromPath(path)
    },

    async updateProjectById(projectId, patch) {
      const project = requireProject(projectId)

      // Checked before the write, so a branch deleted since the dialog opened
      // is reported here rather than as a worktree failure days later.
      if (patch.baseBranch !== undefined) {
        await assertBranchExists(makeExec(project.repoPath), patch.baseBranch)
      }

      await commit((current) => updateProject(current, projectId, patch))
    },

    async listProjectBranches(projectId) {
      const project = requireProject(projectId)
      const exec = makeExec(project.repoPath)

      // Remote branches are the shared history worth branching from. A
      // repository added from disk may have no remote at all, though, and an
      // empty list would leave nothing to choose.
      const remote = await listRemoteBranches(exec)
      return orderBaseBranches(remote.length > 0 ? remote : await listBranches(exec))
    },

    async readProjectScript(projectId, kind) {
      requireProject(projectId)
      return readScript(kind, projectId, dataRoot)
    },

    async saveProjectScript(projectId, kind, contents) {
      requireProject(projectId)
      await writeScript(kind, projectId, contents, dataRoot)
    },

    async projectScriptPaths(projectId) {
      requireProject(projectId)

      const resolve = async (kind: ScriptKind): Promise<string | null> =>
        (await scriptExists(kind, projectId, dataRoot))
          ? scriptPath(kind, projectId, dataRoot)
          : null

      return { setup: await resolve('setup'), run: await resolve('run') }
    },

    async readProjectInstruction(projectId, kind) {
      requireProject(projectId)
      return readInstruction(kind, projectId, dataRoot)
    },

    async saveProjectInstruction(projectId, kind, contents) {
      requireProject(projectId)
      await writeInstruction(kind, projectId, contents, dataRoot)
    },

    async removeProjectById(projectId) {
      const project = findProject(state, projectId)

      // The records go either way, so the directories and branches have to go
      // with them: left behind they are invisible to the app but still occupy
      // names, and adding the project back would collide with its own debris.
      if (project) {
        const repository = makeExec(project.repoPath)

        for (const workspace of workspacesOfProject(state, projectId)) {
          // Best-effort, one by one: a worktree already deleted from outside
          // must not stop the rest — or the project — from being removed. The
          // user has confirmed, so uncommitted work goes too.
          await removeWorkspace(
            workspace,
            { repository, workspace: makeExec(workspace.path) },
            { force: true, deleteBranch: true }
          ).catch(() => undefined)
        }
      }

      await commit((current) => removeProject(current, projectId))
    },

    async listWorkspaces(projectId) {
      const project = findProject(state, projectId)
      if (!project) return []

      const stored = workspacesOfProject(state, projectId)
      if (stored.length === 0) return []

      // git is the source of truth about worktrees; the store only holds what
      // git does not know. `null` on failure, not an empty list: a repository
      // that was moved or renamed answers nothing, and treating that as "no
      // worktrees" marked every workspace missing — which the UI acts on by
      // closing their terminals.
      const worktrees = await listWorktrees(makeExec(project.repoPath)).catch(() => null)
      const changes = await countChanges(stored, makeExec)

      return reconcile(stored, worktrees, changes)
    },

    async createWorkspaceIn(projectId) {
      const project = requireProject(projectId)
      const exec = makeExec(project.repoPath)

      const workspace = await createWorkspace(project, state, exec, { root: dataRoot })

      try {
        await commit((current) => addWorkspace(current, workspace))
      } catch (error) {
        await rollbackWorkspace(workspace, exec)
        throw error
      }

      return workspace
    },

    async renameWorkspaceById(workspaceId, name) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      const renamed = await renameWorkspace(workspace, project, name, makeExec(project.repoPath))
      await commit((current) => updateWorkspace(current, workspaceId, renamed))
    },

    async removeWorkspaceById(workspaceId, options) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Before the worktree goes: the session's working directory is about to
      // stop existing, and a live agent would keep a child process pointed at
      // a path that is no longer there.
      await closeChatsOf(workspaceId)

      await removeWorkspace(
        workspace,
        { repository: makeExec(project.repoPath), workspace: makeExec(workspace.path) },
        // The base branch travels with the request so "is this merged" can be
        // answered before the worktree is destroyed rather than after.
        { ...options, baseBranch: project.baseBranch }
      )

      await commit((current) => removeWorkspaceRecord(current, workspaceId))
    },

    async workspaceHasChanges(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      return (await changeCount(workspace, makeExec)) > 0
    },

    async openChat(workspaceId) {
      requireWorkspace(workspaceId)

      const [existing] = chatsOfWorkspace(state, workspaceId)
      if (existing) return existing

      const chat = newChat(workspaceId, {
        id: uuid(),
        agent: 'claude',
        // The global setting is the starting point; the chat may then diverge
        // from it without changing what the next workspace inherits.
        permissionMode: config.permissionMode,
        createdAt: now()
      })

      await commit((current) => addChat(current, chat))
      return chat
    },

    listChats(workspaceId) {
      return chatsOfWorkspace(state, workspaceId)
    },

    chatHistory(chatId) {
      return readTranscript(chatId, dataRoot)
    },

    async sendToChat(chatId, text) {
      const chat = requireChat(chatId)
      const workspace = requireWorkspace(chat.workspaceId)

      // Written before the agent is asked anything: if starting the session
      // fails, the message the user typed is still in their history rather
      // than lost along with the failure.
      await appendEntry(chatId, { role: 'user', at: now(), text }, dataRoot)

      const session = sessions.get(chatId) ?? startFor(chat, workspace)
      session.send(text)

      await setStatus(workspace.id, 'running')
    },

    async interruptChat(chatId) {
      const chat = requireChat(chatId)

      // Nothing running is not a failure — the button is simply ahead of the
      // agent, which finished between the render and the click.
      await sessions.get(chatId)?.interrupt()
      await setStatus(chat.workspaceId, 'idle')
    },

    async setChatPermissionMode(chatId, mode) {
      requireChat(chatId)
      await commit((current) => updateChat(current, chatId, { permissionMode: mode }))

      // Applied to the running session too, so the choice takes effect on the
      // current turn rather than only on the next one.
      await sessions.get(chatId)?.setPermissionMode(mode)
    },

    async answerPermission(requestId, answer) {
      const request = pending.get(requestId)
      // Unknown means already answered, or the session it belonged to is gone.
      if (!request) return

      pending.delete(requestId)

      if (answer === 'always') {
        await applyConfig({
          alwaysAllowedTools: [...new Set([...config.alwaysAllowedTools, request.toolName])]
        })
      }

      request.resolve(answer !== 'deny')
      await setStatus(request.workspaceId, answer === 'deny' ? 'idle' : 'running')
    },

    getRateLimit() {
      return rateLimit
    },

    onAgentEvent(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },

    async closeChats() {
      const live = [...sessions.values()]
      sessions.clear()

      // Every one of them, even if an earlier close fails: each holds a child
      // process, and one that is not closed outlives the application.
      await Promise.allSettled(live.map((session) => session.close()))
    }
  }
}
