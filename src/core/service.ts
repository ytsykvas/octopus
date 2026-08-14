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
import {
  ABANDONED,
  type AgentSession,
  type ContextUsage,
  DENIED,
  type PermissionOutcome,
  type QueryFn,
  READ_ONLY_TOOLS,
  startSession,
  type SubscriptionUsage
} from './agent.js'
import {
  type AgentCommand,
  type AgentModel,
  type Chat,
  type Effort,
  EXIT_PLAN_MODE,
  isClearCommand,
  newChat,
  sessionMode,
  type WorkingMode
} from './chats.js'
import { type EditTarget, readChangeContext, readEditTarget } from './changeContext.js'
import { type Config, loadConfig, saveConfig, toSdkSettingSources } from './config.js'
import { type AgentEvent, isEphemeral } from './events.js'
import { cloneRepository, listRepositories, type RemoteRepository } from './github.js'
import type { GitExec } from './git.js'
import { gitIn } from './git.js'
import { type InstructionKind, readInstruction, writeInstruction } from './instructions.js'
import { configFile, rootDir, stateFile, stateTempFile } from './paths.js'
import { type QuestionAnswer, readQuestions, withAnswers } from './questions.js'
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
  commandsUnchanged,
  modelsUnchanged,
  type Project,
  rememberModels,
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

/**
 * The two readings a running session can be asked for.
 *
 * One object rather than two calls: they are wanted at the same moments, and
 * splitting them would double the round trips to say one thing.
 */
export interface SessionUsage {
  readonly context: ContextUsage | null
  readonly subscription: SubscriptionUsage | null
}

/** A permission request the agent is still blocked on. */
/**
 * A question the agent is blocked on, as anyone asking after the fact sees it.
 *
 * The same three fields the event carried. A window that was not listening when
 * it went out — opened later, or switched away and back — has no other way to
 * learn that the conversation is waiting on it.
 */
export interface PermissionRequest {
  readonly requestId: string
  readonly toolName: string
  readonly input: unknown
}

interface PendingPermission {
  readonly resolve: (outcome: PermissionOutcome) => void
  readonly toolName: string
  /** Kept so the question can be asked again, not merely answered. */
  readonly input: unknown
  /** Which conversation is blocked — approving a plan reads its mode back. */
  readonly chatId: string
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
  /** Sets how freely the chat works once it is working. */
  setChatWorkingMode(chatId: string, mode: WorkingMode): Promise<void>
  /** Turns planning on or off for the chat. */
  setChatPlanMode(chatId: string, planning: boolean): Promise<void>
  /** Sets how much thinking the chat asks for. */
  setChatEffort(chatId: string, effort: Effort): Promise<void>
  /** Sets the model the chat runs on; null returns the choice to the agent. */
  setChatModel(chatId: string, model: string | null): Promise<void>
  /**
   * What a live session says about its context window and the account's windows.
   *
   * Both are pulled from the running agent rather than pushed, so a chat with
   * no session answers `context: null` — and the subscription figure falls back
   * to whatever another chat last learned, since it describes the account.
   */
  sessionUsage(chatId: string): Promise<SessionUsage>
  /**
   * What the chat's agent is blocked on, or null when it is not blocked.
   *
   * Asked rather than only announced, because the announcement happens once.
   * A window that opens afterwards — or comes back to a workspace it had
   * switched away from — otherwise shows a conversation that looks busy for
   * ever while the answer it needs is one nobody can give.
   */
  pendingPermission(chatId: string): PermissionRequest | null
  /**
   * Models the agent last reported, for the picker.
   *
   * Empty until a session has run once — the agent can only be asked while one
   * is open, so there is nothing to report before that.
   */
  knownModels(): readonly AgentModel[]
  /**
   * Slash commands this chat's agent last reported, for the suggestion list.
   *
   * Per chat rather than application-wide, unlike the models above: which
   * commands exist depends on the worktree and the branch in it, because a
   * project's own live in `.claude/commands/`. Empty until a session has run.
   */
  chatCommands(chatId: string): readonly AgentCommand[]
  /** Answers a pending permission request. Unknown ids are ignored. */
  /**
   * Answers a blocked tool call.
   *
   * `feedback` accompanies a refusal and reaches the agent as the reason — the
   * one place the user can steer without waiting for the turn to end.
   */
  answerPermission(requestId: string, answer: PermissionAnswer, feedback?: string): Promise<void>
  /**
   * Answers the questions the agent asked, releasing the tool call.
   *
   * Separate from `answerPermission` because it is not a permission: the user
   * is not saying whether the agent may do something, they are handing it the
   * information it asked for. Both settle the same waiting promise, so a
   * question withdrawn while unanswered is withdrawn the same way.
   *
   * Ignored when the request is not a question, or is already answered.
   */
  answerQuestions(requestId: string, answers: readonly QuestionAnswer[]): Promise<void>
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

  /**
   * Edits the agent has announced but not yet finished, keyed by tool call.
   *
   * The call says which file and what text; whether it worked is only known
   * when the result arrives, and the file is only worth reading once it has.
   * Entries are removed as they are answered and with the session that made
   * them, so this cannot grow.
   */
  const editsInFlight = new Map<string, EditTarget & { readonly chatId: string }>()

  /**
   * Chats whose user asked, just now, for the conversation to be forgotten.
   *
   * The reset that comes back cannot be read as consent on its own: the SDK
   * sends the same message when the agent leaves plan mode, and clearing the
   * visible log on that would erase the conversation every time a plan was
   * approved. So the intent is recorded where it is known — at the point the
   * message was sent — and consumed by the event it belongs to.
   *
   * A chat id is removed the moment a reset is seen, or with the chat when its
   * workspace is removed. An entry that never gets its reset — a `/clear` the
   * CLI refused — goes that second way, so this cannot grow.
   */
  const clearRequests = new Set<string>()

  /**
   * Chats whose clearing turn has not ended yet.
   *
   * `/clear` discards the transcript the moment the reset says it was asked
   * for, and the command's own `result` arrives a tick later — recreating the
   * file it had just removed, to hold the footer of a turn nobody can see. An
   * emptied conversation reopened as one row reading `0.1s · 0 tokens`.
   *
   * It is the *writing* that is skipped and nothing else: the result still has
   * to be announced, being what stops the composer offering to stop.
   *
   * Dropped with the chat when its workspace is removed, like `clearRequests`
   * above: bookkeeping, so neither set outlives what it is about. It is not a
   * guard against a stuck flag, and does not need to be — a `/clear` whose
   * result never comes means the session stopped answering, and a session that
   * stops answering is not replaced (`sessions` keeps it), so there is no
   * later footer for a stale flag to swallow.
   */
  const clearedTurns = new Set<string>()

  // One reading for the whole service, not one per chat: the limit belongs to
  // the account, and whichever session reports it is reporting the same thing.
  let rateLimit: RateLimit | null = null

  // The same reasoning, for the figures pulled rather than pushed. It is what
  // lets a workspace nobody has spoken to — and so has no session to ask —
  // still show what another workspace's turn learned a minute ago.
  let subscriptionUsage: SubscriptionUsage | null = null

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
   * Throws away everything written down about a conversation.
   *
   * In the same queue as the appends, and that is the whole point: a delete
   * racing the writes around it could remove the file between two of them and
   * leave the log holding the tail of a conversation whose head it discarded.
   */
  function discard(chat: Chat): void {
    // No guard for a chat that has since gone, unlike `record`: appending
    // recreates the file it was told to forget, while removing one that is
    // already absent is exactly what was wanted anyway.
    const remove = (): Promise<void> => removeTranscript(chat.id, dataRoot)

    transcriptWrites = transcriptWrites.then(remove, remove).catch((error: unknown) => {
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
   * Fills in the half of a reset the SDK layer could not know.
   *
   * `mapMessage` is a pure function of one message, and one message cannot say
   * whether the user asked for this: the same reset arrives when the agent
   * leaves plan mode. The answer was recorded when the message went out, and
   * this is where the two halves meet. Everything else passes through.
   */
  function answerReset(chat: Chat, event: AgentEvent): AgentEvent {
    if (event.type !== 'conversation_reset') return event

    // Deleted whether or not it was there: the request belongs to the reset it
    // caused, and leaving it behind would clear the log on the next one.
    return clearRequests.delete(chat.id) ? { ...event, cleared: true } : event
  }

  /**
   * Whether this event is the footer of the turn that emptied the log.
   *
   * Consumed rather than read, in the shape `answerReset` above uses: the flag
   * belongs to one turn, and the event that ends it takes the flag with it.
   */
  function closesTheClearedTurn(chat: Chat, event: AgentEvent): boolean {
    return event.type === 'result' && clearedTurns.delete(chat.id)
  }

  /**
   * Writes down which commands a chat's agent offers.
   *
   * Skipped when the list already matches, because this runs on every session
   * start and the answer is almost always the same one — see
   * `commandsUnchanged`. A failure is reported into the chat rather than
   * swallowed: it is a failed write like any other.
   */
  function rememberCommands(chat: Chat, commands: readonly AgentCommand[]): void {
    const current = findChat(state, chat.id)
    if (current && commandsUnchanged(current, commands)) return

    background(
      chat,
      commit((next) =>
        findChat(next, chat.id) ? updateChat(next, chat.id, { knownCommands: [...commands] }) : next
      )
    )
  }

  /**
   * Everything that happens to one event: recorded, applied, then announced.
   *
   * The order matters only in that the announcement is synchronous while the
   * writes are not — the UI redraws immediately and the disk catches up.
   */
  function handleEvent(chat: Chat, incoming: AgentEvent): void {
    const event = answerReset(chat, incoming)

    // A conversation the user asked to forget keeps no record of itself. The
    // delete goes in before the append that would otherwise write this very
    // event into the file it is about to remove.
    if (event.type === 'conversation_reset' && event.cleared) {
      discard(chat)
      clearedTurns.add(chat.id)
    } else if (!isEphemeral(event) && !closesTheClearedTurn(chat, event)) {
      record(chat, { role: 'agent', at: now(), event })
    }

    if (event.type === 'rate_limit') rateLimit = event

    if (event.type === 'session_started') {
      // Persisted the moment it appears: this id is the only thing that makes
      // a conversation survive the application being restarted.
      //
      // Guarded on having actually changed, because this arrives far more often
      // than it used to: every slash command produces a fresh init, and without
      // the check each one would rewrite the state file to the same bytes.
      background(
        chat,
        commit((current) => {
          const existing = findChat(current, chat.id)
          if (!existing || existing.sessionId === event.sessionId) return current
          return updateChat(current, chat.id, { sessionId: event.sessionId })
        })
      )
    }

    if (event.type === 'commands_changed') rememberCommands(chat, event.commands)

    if (event.type === 'permission_request') {
      background(chat, setStatus(chat.workspaceId, 'waiting_permission'))
    }

    // An edit announced. Remembered rather than acted on: whether it worked is
    // only known when the result arrives, and the file is only worth reading
    // once it has.
    if (event.type === 'tool_use') {
      const edit = readEditTarget(event.name, event.input)
      if (edit) editsInFlight.set(event.toolUseId, { ...edit, chatId: chat.id })
    }

    if (event.type === 'tool_result') {
      const edit = editsInFlight.get(event.toolUseId)
      editsInFlight.delete(event.toolUseId)

      // Read now, while the file still says what the edit made it say. Looked
      // up when the conversation is drawn it would be wrong: a later edit
      // shifts every line after it, so the lines around a change would be the
      // lines around wherever that text has since ended up.
      if (edit && event.ok) background(chat, recordContext(chat, event.toolUseId, edit))
    }

    if (event.type === 'result') {
      background(chat, setStatus(chat.workspaceId, event.ok ? 'idle' : 'error'))
    }

    if (event.type === 'error') {
      background(chat, setStatus(chat.workspaceId, 'error'))
    }

    // A turn that has ended cannot answer for a tool it never ran. Only the
    // session's own stream reaches here — a background write that failed is
    // reported straight to the listeners by `report` — so this cannot withdraw
    // a question a live turn is still waiting on.
    if (event.type === 'result' || event.type === 'error') abandonPermissions(chat.id)

    emit({ chatId: chat.id, workspaceId: chat.workspaceId, event })
  }

  /**
   * Reads the lines around a finished edit and announces them.
   *
   * Fed back through `handleEvent`, so it is recorded and emitted like anything
   * else. Silence when the context cannot be had — the file gone, the text no
   * longer unique — is deliberate: this is a courtesy, and a wrong one would
   * show a change sitting among lines it never touched.
   */
  async function recordContext(chat: Chat, toolUseId: string, edit: EditTarget): Promise<void> {
    const workspace = state.workspaces.find((item) => item.id === chat.workspaceId)
    // Unreachable: an edit is forgotten with the session that made it, so one
    // still in flight has a workspace to belong to. The guard is here because
    // the lookup's type says otherwise.
    /* v8 ignore next */
    if (!workspace) return

    const context = await readChangeContext(workspace.path, edit.path, edit.written)
    if (context) handleEvent(chat, { type: 'change_context', toolUseId, context })
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
  async function askPermission(
    chat: Chat,
    toolName: string,
    input: unknown
  ): Promise<PermissionOutcome> {
    if (config.alwaysAllowedTools.includes(toolName)) return { allow: true }

    const requestId = uuid()
    handleEvent(chat, { type: 'permission_request', requestId, toolName, input })

    return new Promise<PermissionOutcome>((resolve) => {
      pending.set(requestId, {
        resolve,
        toolName,
        input,
        chatId: chat.id,
        workspaceId: chat.workspaceId
      })
    })
  }

  /**
   * Lets go of every question one chat is blocked on.
   *
   * A request used to outlive the turn that raised it. Nothing but an answer
   * removed it, so a question the user had stopped instead of answering stayed
   * in the map — and `pendingPermission` hands the first one it finds to
   * whatever window opens that conversation next, which brought the cancelled
   * card back with live buttons on it.
   *
   * Resolved rather than merely dropped: the promise this returns to the SDK is
   * what holds the tool call, and a refusal is the only answer that cannot
   * start work nobody approved.
   */
  function abandonPermissions(chatId: string): void {
    for (const [requestId, request] of pending) {
      if (request.chatId !== chatId) continue

      pending.delete(requestId)
      request.resolve({ allow: false, message: ABANDONED })
    }
  }

  /**
   * Stores a change to either half of the mode and pushes the result live.
   *
   * Both halves go through here because the session only understands the two
   * folded together: turning planning off has to send `acceptEdits` if that is
   * what the other half says, not merely "not planning".
   */
  async function applyMode(chatId: string, patch: Partial<Chat>): Promise<void> {
    requireChat(chatId)
    await commit((current) => updateChat(current, chatId, patch))

    // Applied to the running session too, so the choice takes effect on the
    // current turn rather than only on the next one. Read back after the write
    // rather than merged by hand: the session wants both halves, and only one
    // of them is in the patch.
    await sessions.get(chatId)?.setPermissionMode(sessionMode(requireChat(chatId)))
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

      // A session that ends mid-tool leaves an edit nobody will ever answer
      // for, and a question nobody will ever answer at all. Both go with it,
      // and only this chat's, since the maps are the whole service's.
      abandonPermissions(chat.id)
      for (const [toolUseId, edit] of editsInFlight) {
        if (edit.chatId === chat.id) editsInFlight.delete(toolUseId)
      }

      // A `/clear` the session never got round to answering, and a clearing
      // turn whose result never came. Both belong to a chat that is going with
      // this workspace, so neither is left in a set for the rest of the run.
      clearRequests.delete(chat.id)
      clearedTurns.delete(chat.id)

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
        permissionMode: sessionMode(chat),
        model: chat.model,
        effort: chat.effort,
        // The read-only set, and nothing else. A name here is approved by the
        // SDK before `canUseTool` is consulted, which is what that set wants
        // and exactly what the user's own answers must not have: one handed
        // over at the start of a session cannot be taken back until the session
        // ends, so unticking it in Settings changed nothing the agent was
        // already doing. `askPermission` consults `alwaysAllowedTools` itself,
        // on every call, against the config as it stands at that moment.
        allowedTools: [...READ_ONLY_TOOLS]
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

    // Fire-and-forget, and the two failures go different ways. A list that
    // cannot be *read* is swallowed: it is a convenience for the picker, a
    // session that cannot start already says so through the event stream, and
    // failing a message over the model names would report the wrong problem.
    // A list that cannot be *written* is a failed write like any other and is
    // reported into the chat — nothing caught it before, so it left the main
    // process with an uncaught rejection and Electron with a modal to show.
    background(
      chat,
      session.models().then(
        async (models) => {
          if (modelsUnchanged(state, models)) return
          await commit((current) => rememberModels(current, models))
        },
        () => undefined
      )
    )

    // The same arrangement for the command list, and asked here rather than
    // once at start-up because this is the only moment it can be asked: the
    // answer comes from the running agent, and it is about this worktree —
    // a project's own commands live in its `.claude/commands/`.
    background(
      chat,
      session.commands().then(
        (commands) => {
          rememberCommands(chat, commands)
        },
        () => undefined
      )
    )

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
        workingMode: config.workingMode,
        effort: config.effort,
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

      /*
       * The record is what the session runs under, re-asserted rather than
       * assumed.
       *
       * The agent's own CLI changes mode by itself — it leaves plan mode once a
       * plan is settled — and announces nothing when it does: no message in the
       * SDK carries a mode except the one at startup. Set only at the start and
       * on a user's change, the session drifted, and the footer ended up
       * promising "without asking" over an agent asking about every edit.
       *
       * The toggle wins over whatever the CLI decided. A setting that turns
       * itself off is worse than a turn planned once more than needed.
       *
       * A session started just now already has it, from the options it was
       * built with. Not caught: this governs what the agent may do without
       * asking, and sending into a mode we could not set is the fault being
       * fixed here.
       */
      /*
       * Whether this message is the one that throws the conversation away.
       *
       * Decided here because here is the only place it can be: the reset that
       * comes back looks identical to the one the agent sends when it leaves
       * plan mode, so read from the event alone it would erase the log every
       * time a plan was approved. Aliases count — `/reset` and `/new` are the
       * same command — which is why the chat's own list is consulted rather
       * than the text compared to one word.
       */
      if (isClearCommand(text, chat.knownCommands)) clearRequests.add(chatId)

      /*
       * The model is deliberately **not** re-asserted here, unlike the mode.
       *
       * It was, briefly, on the belief that `/model` changed the session behind
       * our backs with no way to find out. The second half of that is wrong:
       * the context reading names the running model, which is what the footer
       * now shows. So re-asserting stopped being a guard against drift and
       * became an undo of an explicit instruction — `/model opus`, and the next
       * message went out on whatever the picker still held.
       *
       * The CLI is explicit that the command is scoped to the session ("for
       * this session only"), so the record staying put is the truth rather than
       * a compromise: it holds what was chosen here, and the footer shows what
       * is running.
       */
      const running = sessions.get(chatId)
      if (running) await running.setPermissionMode(sessionMode(chat))

      const session = running ?? startFor(chat, workspace)
      session.send(text)

      await setStatus(workspace.id, 'running')
    },

    async interruptChat(chatId) {
      const chat = requireChat(chatId)

      // Before the interrupt rather than after it: stopping a turn is how a
      // question gets abandoned in the first place, and an interrupt that
      // throws must still leave nothing behind to be asked again.
      abandonPermissions(chatId)

      // Nothing running is not a failure — the button is simply ahead of the
      // agent, which finished between the render and the click.
      await sessions.get(chatId)?.interrupt()
      await setStatus(chat.workspaceId, 'idle')
    },

    async setChatWorkingMode(chatId, mode) {
      await applyMode(chatId, { workingMode: mode })
    },

    async setChatPlanMode(chatId, planning) {
      await applyMode(chatId, { planMode: planning })
    },

    async setChatEffort(chatId, effort) {
      requireChat(chatId)
      await commit((current) => updateChat(current, chatId, { effort }))
      await sessions.get(chatId)?.setEffort(effort)
    },

    async setChatModel(chatId, model) {
      requireChat(chatId)
      await commit((current) => updateChat(current, chatId, { model }))

      await sessions.get(chatId)?.setModel(model)
    },

    knownModels() {
      return state.knownModels
    },

    chatCommands(chatId) {
      return requireChat(chatId).knownCommands
    },

    pendingPermission(chatId) {
      requireChat(chatId)

      for (const [requestId, request] of pending) {
        if (request.chatId === chatId) {
          return { requestId, toolName: request.toolName, input: request.input }
        }
      }

      return null
    },

    async answerPermission(requestId, answer, feedback) {
      const request = pending.get(requestId)
      // Unknown means already answered, or the session it belonged to is gone.
      if (!request) return

      if (answer === 'deny') {
        // The user's own words when there are any: the agent reads a refusal's
        // message as instruction, which is how "not quite, do this instead"
        // reaches it without costing a turn.
        const note = feedback?.trim() ?? ''
        // Removed as the answer is given, never before it. An "always" whose
        // config write fails throws from here, and taking the question out
        // first left the agent blocked on something nothing could offer again:
        // the window had dropped its copy, and `pendingPermission` had none.
        pending.delete(requestId)
        request.resolve({ allow: false, message: note === '' ? DENIED : note })
        await setStatus(request.workspaceId, 'idle')
        return
      }

      // Approving a plan is never a standing answer. `config.ts` explains why
      // at length; the short of it is that `askPermission` answers a standing
      // tool before it emits anything, so the dialog, the record and the toggle
      // would all stop happening at once.
      const leaving = request.toolName === EXIT_PLAN_MODE

      if (answer === 'always' && !leaving) {
        await applyConfig({
          alwaysAllowedTools: [...new Set([...config.alwaysAllowedTools, request.toolName])]
        })
      }

      // Approving a plan is the moment planning ends. Both halves of that have
      // to happen or the interface starts lying: the record, so the next
      // session does not start by planning again, and the running session, so
      // the work the plan describes can actually begin.
      if (leaving) {
        await commit((current) => updateChat(current, request.chatId, { planMode: false }))
      }

      const chat = findChat(state, request.chatId)
      // Both writes above are behind us, so this is the point the answer is
      // actually given — see the deny path for what removing it any earlier
      // cost. A second answer racing this one changes nothing: the writes are
      // idempotent and a settled promise ignores the later call.
      pending.delete(requestId)
      request.resolve({
        allow: true,
        ...(leaving && chat && { setMode: chat.workingMode })
      })
      await setStatus(request.workspaceId, 'running')
    },

    async answerQuestions(requestId, answers) {
      const request = pending.get(requestId)
      // Unknown means already answered — by the other window, most likely — or
      // the session it belonged to is gone.
      if (!request) return

      // Left in `pending` rather than answered blind: this is a permission
      // request like any other, and something that is not a question has to
      // stay answerable by the card that can answer it.
      const asked = readQuestions(request.toolName, request.input)
      if (!asked) return

      const chat = findChat(state, request.chatId)
      // Unreachable: a chat that goes takes its questions with it —
      // `closeChatsOf` abandons them — so one still waiting has a record to
      // belong to. The guard is here because the lookup's type says otherwise.
      /* v8 ignore next */
      if (!chat) return

      // Recorded before the answer goes out. It is what the card is redrawn
      // from after a restart, and the agent may well have moved on by the time
      // a later write lands.
      handleEvent(chat, { type: 'question_answered', requestId, answers: [...answers] })

      pending.delete(requestId)
      // The whole point: the tool reads the user's choices off its own input,
      // so the reply that releases it carries them.
      request.resolve({ allow: true, updatedInput: withAnswers(asked, answers) })
      await setStatus(request.workspaceId, 'running')
    },

    getRateLimit() {
      return rateLimit
    },

    async sessionUsage(chatId) {
      requireChat(chatId)

      const session = sessions.get(chatId)
      // Deliberately not started. Spawning an agent to fill a gauge would also
      // create a record for a workspace nobody has spoken to, which is the very
      // thing `openChat`'s laziness exists to avoid.
      if (!session) return { context: null, subscription: subscriptionUsage }

      // Together rather than in turn: the subscription reading crosses the
      // network, the context one does not, and asked in sequence the fast one
      // would wait on the slow one for no reason.
      const [context, subscription] = await Promise.all([
        session.contextUsage(),
        session.subscriptionUsage()
      ])

      // A reading that failed leaves the last good one standing. Blanking the
      // figure because one request was refused would report a change in the
      // account that never happened.
      if (subscription) subscriptionUsage = subscription

      return { context, subscription: subscriptionUsage }
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
