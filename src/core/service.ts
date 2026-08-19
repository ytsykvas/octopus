/**
 * Core facade — the single entry point for application operations.
 *
 * Holds state in memory and persists it after every change. It exists so
 * `main/` stays a thin proxy with no logic (§11.1 docs/PROJECT.md): an IPC
 * handler should only have to forward the call here.
 */

import { randomUUID } from 'node:crypto'

import {
  forkSession as defaultForkSession,
  query as defaultQuery
} from '@anthropic-ai/claude-agent-sdk'

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
  ChatError,
  type ChatStatus,
  DEFAULT_AGENT,
  type EffortChoice,
  EXIT_PLAN_MODE,
  forkChat as forkChatRecord,
  isClearCommand,
  MAX_CHATS_PER_WORKSPACE,
  newChat,
  sessionMode,
  sessionModel,
  type WorkingMode
} from './chats.js'
import { type EditTarget, readChangeContext, readEditTarget } from './changeContext.js'
import { readWorkspaceDiff, type WorkspaceDiff } from './diff.js'
import { isListening } from './ports.js'
import { carryInto, readCarryList, writeCarryList } from './carry.js'
import { type Config, ConfigSchema, loadConfig, saveConfig, toSdkSettingSources } from './config.js'
import { type AgentEvent, isEphemeral } from './events.js'
import { cloneRepository, listRepositories, type RemoteRepository } from './github.js'
import type { GitExec } from './git.js'
import {
  createPullRequest,
  type GhExec,
  ghIn,
  type NewPullRequest,
  type PullRequestView,
  readPullRequest
} from './pullRequests.js'
import { gitIn } from './git.js'
import {
  effectiveInstruction,
  type InstructionKind,
  readInstruction,
  writeInstruction
} from './instructions.js'
import { configFile, rootDir, stateFile, stateTempFile } from './paths.js'
import { type QuestionAnswer, readQuestions, withAnswers } from './questions.js'
import { describeError } from './persist.js'
import {
  appendEntry,
  type ChatEntry,
  copyTranscript,
  readTranscript,
  removeTranscript
} from './transcript.js'
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
  removeChat,
  removeProject,
  type ProjectPatch,
  removeWorkspace as removeWorkspaceRecord,
  saveState,
  type State,
  updateChat,
  updateProject,
  updateWorkspace,
  type Workspace,
  workspacesOfProject,
  workspaceStatusFrom
} from './store.js'
import { listBranches, listRemoteBranches, listWorktrees } from './worktree.js'
import {
  changeCount,
  countChanges,
  createWorkspace,
  fileInWorkspace,
  reconcile,
  removeWorkspace,
  renameWorkspace,
  rollbackWorkspace,
  WorkspaceError,
  type WorkspaceView,
  type RemoveOptions
} from './workspaces.js'

/**
 * The SDK's `forkSession`, narrowed to what this service asks of it.
 *
 * Ours rather than the SDK's own signature, so the injected stand-in in tests
 * is written against what is actually used rather than against an options bag
 * with alpha members in it.
 */
export type ForkSessionFn = (
  sessionId: string,
  options: { readonly dir: string }
) => Promise<{ readonly sessionId: string }>

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
   * `gh` in a worktree, injected for the reason the two above are: a test that
   * used the real one would open pull requests on somebody's repository.
   */
  readonly makeGh?: (cwd: string) => GhExec
  /**
   * The Agent SDK's entry point.
   *
   * Injected so the chat can be tested end to end without spawning an agent
   * or reaching the network — the same reasoning as `makeExec`.
   */
  readonly query?: QueryFn
  /**
   * The SDK's session fork, injected for the same reason as `query`.
   *
   * A real fork reads and writes the agent CLI's own session store, so a test
   * that called it would depend on a conversation having happened on the
   * machine running it.
   */
  readonly forkSession?: ForkSessionFn
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

/**
 * A workspace and what it is now doing.
 *
 * Sent rather than left to be discovered: the list draws this, and asking for
 * the workspaces again to find out would put git to work on every one of them
 * to learn something this process had already decided.
 */
export interface WorkspaceStatusEvent {
  readonly workspaceId: string
  readonly status: Workspace['status']
}

/**
 * A conversation and what it is now doing — the twin of the above, one level in.
 *
 * Two streams because two lists draw two different things: the tab strip draws
 * a conversation, the workspace list draws a workspace, and they move at
 * different moments. A second tab finishing does not move a workspace whose
 * first tab is still running.
 *
 * Not folded into `ChatEvent` either. That stream carries `AgentEvent`, which is
 * the isolation boundary around the SDK and the shape written to the transcript
 * — a status this application computes has no business in it, and half the
 * changes here come from places with no agent event at all: an interrupt, an
 * answered permission, a closed tab.
 */
export interface ChatStatusEvent {
  readonly chatId: string
  readonly workspaceId: string
  readonly status: ChatStatus
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

  /** Which of the checkout's files travel into a workspace, one path per line. */
  readProjectCarryList(projectId: string): Promise<string>
  saveProjectCarryList(projectId: string, contents: string): Promise<void>
  /**
   * Copies them into a workspace that is missing them.
   *
   * Called before a run as well as at creation, so a workspace made before the
   * list mentioned a file picks it up rather than staying broken until it is
   * recreated. Never overwrites — see `carryInto`.
   */
  carryIntoWorkspace(workspaceId: string): Promise<string[]>

  /**
   * Whether anything is listening on the port this workspace was given.
   *
   * Read on demand rather than remembered: it is a fact about the machine, and
   * a script that ignores `$OCTOPUS_PORT` makes our own record of it a lie.
   */
  isWorkspaceServing(workspaceId: string): Promise<boolean>

  /**
   * Guidance handed to the agent, or a starting template if none is written.
   *
   * `null` for the project is the installation's own, which every project falls
   * back to — the same call for both, because they are edited the same way and
   * a second pair of methods would be two spellings of one thing.
   */
  readProjectInstruction(projectId: string | null, kind: InstructionKind): Promise<string>
  saveProjectInstruction(
    projectId: string | null,
    kind: InstructionKind,
    contents: string
  ): Promise<void>

  /**
   * What a workspace would actually send: its project's, or the global one.
   *
   * Resolved here rather than in the renderer, which would have to know the
   * order of precedence and ask twice to apply it.
   */
  readEffectiveInstruction(workspaceId: string, kind: InstructionKind): Promise<string>

  /** Workspaces of a project, reconciled with what git actually has. */
  listWorkspaces(projectId: string): Promise<WorkspaceView[]>
  createWorkspaceIn(projectId: string): Promise<Workspace>
  renameWorkspaceById(workspaceId: string, name: string): Promise<void>
  removeWorkspaceById(workspaceId: string, options?: RemoveOptions): Promise<void>
  /** Whether a workspace holds work that removal would discard. */
  workspaceHasChanges(workspaceId: string): Promise<boolean>
  /** Everything the workspace changed since it left the project's base branch. */
  readWorkspaceChanges(workspaceId: string): Promise<WorkspaceDiff>

  /** What has become of this workspace's branch on GitHub, if anything. */
  readPullRequest(workspaceId: string): Promise<PullRequestView>

  /**
   * Pushes the branch if it needs it and opens a pull request for it.
   *
   * Returns the URL, which is the one thing the caller has no other way to get.
   */
  createPullRequest(
    workspaceId: string,
    request: Omit<NewPullRequest, 'branch' | 'base'>
  ): Promise<string>
  /**
   * An absolute path inside a workspace, for a caller that will open it.
   *
   * Refuses a path that climbs out of the worktree, symlinks followed: it
   * arrives from the renderer, which draws agent output, and is about to be
   * handed to the operating system.
   */
  resolveWorkspaceFile(workspaceId: string, path: string): Promise<string>

  /**
   * The workspace's chat, created on first use.
   *
   * Lazy on purpose: a workspace nobody has spoken to gets no record and no
   * transcript file, so the state stays a description of what happened rather
   * than of what might.
   */
  openChat(workspaceId: string): Promise<Chat>
  /**
   * An additional conversation in this workspace, refusing past the cap.
   *
   * Separate from `openChat` rather than a flag on it: opening is idempotent
   * and answers "the conversation to write into", which is what every caller
   * that is not the new-tab button wants. This one always writes a record,
   * which is the whole request.
   */
  createChat(workspaceId: string): Promise<Chat>
  /**
   * A new conversation continuing this one, in the same worktree.
   *
   * The agent keeps what it remembers; the two then diverge. Refuses a chat
   * that has never run, since there is nothing to continue.
   */
  forkChat(chatId: string): Promise<Chat>
  /**
   * Gives a conversation a name of its own, or takes it back.
   *
   * An empty name is not a refusal but a request: it clears the field, and the
   * strip goes back to naming the conversation after its agent and its place.
   */
  renameChat(chatId: string, title: string): Promise<void>
  /**
   * Ends a conversation and discards it, transcript included.
   *
   * Refuses the last one of a workspace: throwing away the only conversation is
   * `/clear`, which does it without leaving the workspace without one.
   */
  closeChat(chatId: string): Promise<void>
  /** Every chat of a workspace, in the order they were opened. */
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
  setChatEffort(chatId: string, effort: EffortChoice): Promise<void>
  /** Sets the model the chat writes code with; null returns the choice to the agent. */
  setChatModel(chatId: string, model: string | null): Promise<void>
  /** Sets the model the chat plans with; null means the one above does both. */
  setChatPlanModel(chatId: string, model: string | null): Promise<void>
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
  /** What a workspace is doing, as it changes. A broadcast, like the above. */
  onWorkspaceStatus(handler: (event: WorkspaceStatusEvent) => void): () => void
  /** What each conversation is doing, as it changes. The tab strip draws this. */
  onChatStatus(handler: (event: ChatStatusEvent) => void): () => void
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
  const makeGh = options.makeGh ?? ghIn
  const dataRoot = options.dataRoot ?? rootDir()
  const runQuery = options.query ?? defaultQuery
  const runForkSession = options.forkSession ?? defaultForkSession
  const uuid = options.uuid ?? randomUUID
  const now = options.now ?? ((): string => new Date().toISOString())

  let state: State = await loadState(statePath)
  let config: Config = await loadConfig(configPath)

  /** Live agent sessions, keyed by chat. A missing entry means "not started". */
  const sessions = new Map<string, AgentSession>()
  const listeners = new Set<(event: ChatEvent) => void>()
  const statusListeners = new Set<(event: WorkspaceStatusEvent) => void>()
  const chatStatusListeners = new Set<(event: ChatStatusEvent) => void>()
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
    // Parsed on the way in, not only on the way out. `saveConfig` parses before
    // writing, so the file was always valid while the copy held here was
    // whatever arrived — and the two could disagree until the next restart.
    // This is the same parse that is about to happen anyway, one step earlier.
    const next: Config = ConfigSchema.parse({ ...config, ...patch })
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
   * Copies one conversation's history onto another — what a fork needs.
   *
   * In the same queue as the appends, for the reason `discard` gives: a copy
   * racing the writes around it could read the source between two lines of one
   * turn. Awaited rather than left running like `record`, because the caller is
   * about to hand the new conversation to a window that reads the file at once.
   */
  function copyHistory(from: Chat, to: Chat): Promise<void> {
    // No failure arms, unlike `record` and `discard`: the queue's tail is
    // always a settled promise because both of those end in a `catch`, and
    // `copyTranscript` is silent rather than throwing.
    const run = transcriptWrites.then(() => copyTranscript(from.id, to.id, dataRoot))
    transcriptWrites = run

    return run
  }

  /**
   * Adds a conversation to a workspace, refusing past the cap.
   *
   * The count is taken inside the commit rather than before it, for the same
   * reason `openChat` decides inside its own: two presses of the new-tab button
   * landing together would both see room against two conversations, and the cap
   * would hold for neither.
   */
  function addChatCapped(chat: Chat): Promise<void> {
    return commitChats(chat.workspaceId, (current) => {
      if (chatsOfWorkspace(current, chat.workspaceId).length >= MAX_CHATS_PER_WORKSPACE) {
        throw new ChatError(
          'tooManyChats',
          { limit: String(MAX_CHATS_PER_WORKSPACE) },
          `Workspace ${chat.workspaceId} already holds ${String(MAX_CHATS_PER_WORKSPACE)} chats.`
        )
      }

      return addChat(current, chat)
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

  /**
   * Changes a workspace's conversations, brings its status back in line, and
   * says so if it moved.
   *
   * The workspace's status is derived from its chats, so the two move in one
   * `commit`. Two commits would leave a moment in which the chats say one thing
   * and the workspace derived from them says another — and that moment is when
   * the file gets written.
   *
   * Announced as well as stored because the list draws it: reading the
   * workspaces again to find out would ask git about every one of them, twice a
   * turn, for something this process already knew. Announced only on a change,
   * or every unchanged commit would send an event describing nothing.
   */
  function commitChats(workspaceId: string, change: (current: State) => State): Promise<void> {
    const before = state.workspaces.find((workspace) => workspace.id === workspaceId)

    return commit((current) => {
      const next = change(current)

      // Mapped rather than looked up and updated, so a workspace removed while
      // its last events were still arriving is simply not among them — there is
      // no "and what if it has gone" arm to get wrong.
      return {
        ...next,
        workspaces: next.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                status: workspaceStatusFrom(chatsOfWorkspace(next, workspaceId))
              }
            : workspace
        )
      }
    }).then(() => {
      const settled = state.workspaces.find((workspace) => workspace.id === workspaceId)
      if (!settled || settled.status === before?.status) return
      for (const listener of statusListeners) listener({ workspaceId, status: settled.status })
    })
  }

  /**
   * Records what a conversation is doing, and says so.
   *
   * Its own stream beside the workspace's, because the tab strip draws the
   * conversation while the list draws the workspace, and the two move at
   * different moments: a second tab finishing leaves a workspace whose first
   * tab is still running exactly where it was.
   */
  function setChatStatus(chatId: string, status: ChatStatus): Promise<void> {
    const before = findChat(state, chatId)
    // A closing session goes on emitting for a moment after its conversation
    // was closed, and there is nothing left to record it against.
    if (!before) return Promise.resolve()

    const { workspaceId } = before

    // Mapped for the same reason the workspaces are: a conversation closed
    // while its session's last events were still arriving is not in the list,
    // and that is the whole of what has to happen about it.
    return commitChats(workspaceId, (current) => ({
      ...current,
      chats: current.chats.map((chat) => (chat.id === chatId ? { ...chat, status } : chat))
    })).then(() => {
      if (before.status === status) return
      for (const listener of chatStatusListeners) listener({ chatId, workspaceId, status })
    })
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
      background(chat, setChatStatus(chat.id, 'waiting_permission'))
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
      background(chat, setChatStatus(chat.id, event.ok ? 'idle' : 'error'))
    }

    if (event.type === 'error') {
      background(chat, setChatStatus(chat.id, 'error'))
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
  /**
   * Forgets the edits a chat announced and never finished.
   *
   * An entry is made on `tool_use` and removed by the matching result, so a
   * turn stopped mid-edit leaves one behind — against the map's own promise
   * that it cannot grow. Called wherever a turn stops being answered for: with
   * the session, and with an interrupt.
   */
  function abandonEdits(chatId: string): void {
    for (const [toolUseId, edit] of editsInFlight) {
      if (edit.chatId === chatId) editsInFlight.delete(toolUseId)
    }
  }

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
    const before = sessionModel(requireChat(chatId))
    await commit((current) => updateChat(current, chatId, patch))

    // Applied to the running session too, so the choice takes effect on the
    // current turn rather than only on the next one. Read back after the write
    // rather than merged by hand: the session wants both halves, and only one
    // of them is in the patch.
    await sessions.get(chatId)?.setPermissionMode(sessionMode(requireChat(chatId)))
    await pushModel(chatId, before)
  }

  /**
   * Tells a running session the model it should now be on, if that moved.
   *
   * The two moments where the effective model changes without anyone naming
   * one: planning turned on or off, and a plan approved. `before` is what was
   * in force when the change was decided.
   *
   * The guard is the whole reason `/model` still stands. A conversation whose
   * two jobs share a model runs that one whatever the toggles do, so nothing
   * is ever pushed at it — which is byte for byte the behaviour there was
   * before a conversation could hold two.
   */
  async function pushModel(chatId: string, before: string | null): Promise<void> {
    const wanted = sessionModel(requireChat(chatId))
    if (wanted === before) return

    await sessions.get(chatId)?.setModel(wanted)
  }

  /**
   * Ends the sessions of a workspace and discards their history.
   *
   * The records themselves go with the workspace in `removeWorkspace`; what
   * needs doing here is the part outside the state file — a child process and
   * a transcript, neither of which a record removal would touch.
   */
  async function closeOneChat(chat: Chat): Promise<void> {
    const session = sessions.get(chat.id)
    sessions.delete(chat.id)

    // A session that ends mid-tool leaves an edit nobody will ever answer
    // for, and a question nobody will ever answer at all. Both go with it,
    // and only this chat's, since the maps are the whole service's.
    abandonPermissions(chat.id)
    abandonEdits(chat.id)

    // A `/clear` the session never got round to answering, and a clearing
    // turn whose result never came. Both belong to a chat that is going, so
    // neither is left in a set for the rest of the run.
    clearRequests.delete(chat.id)
    clearedTurns.delete(chat.id)

    // Best effort: a session that fails to close must not stop the workspace
    // from being removed, nor the tab from closing.
    await session?.close().catch(() => undefined)
    await removeTranscript(chat.id, dataRoot).catch(() => undefined)
  }

  async function closeChatsOf(workspaceId: string): Promise<void> {
    // One at a time rather than all at once, so a session that hangs on close
    // is one wait rather than a race between several.
    for (const chat of chatsOfWorkspace(state, workspaceId)) {
      await closeOneChat(chat)
    }
  }

  function startFor(chat: Chat, workspace: Workspace): AgentSession {
    const session = startSession(
      {
        cwd: workspace.path,
        resume: chat.sessionId,
        settingSources: toSdkSettingSources(config.settingSources),
        permissionMode: sessionMode(chat),
        model: sessionModel(chat),
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

    async readProjectCarryList(projectId) {
      requireProject(projectId)
      return readCarryList(projectId, dataRoot)
    },

    async saveProjectCarryList(projectId, contents) {
      requireProject(projectId)
      await writeCarryList(projectId, contents, dataRoot)
    },

    async carryIntoWorkspace(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      return carryInto(project.id, project.repoPath, workspace.path, dataRoot)
    },

    async isWorkspaceServing(workspaceId) {
      return isListening(requireWorkspace(workspaceId).port)
    },

    async readProjectInstruction(projectId, kind) {
      // Only a project has to exist. The global one belongs to the install and
      // is written the first time anybody saves it.
      if (projectId !== null) requireProject(projectId)
      return readInstruction(kind, projectId, dataRoot)
    },

    async saveProjectInstruction(projectId, kind, contents) {
      if (projectId !== null) requireProject(projectId)
      await writeInstruction(kind, projectId, contents, dataRoot)
    },

    async readEffectiveInstruction(workspaceId, kind) {
      const workspace = requireWorkspace(workspaceId)
      return effectiveInstruction(kind, workspace.projectId, dataRoot)
    },

    async removeProjectById(projectId) {
      const project = findProject(state, projectId)

      // The records go either way, so the directories and branches have to go
      // with them: left behind they are invisible to the app but still occupy
      // names, and adding the project back would collide with its own debris.
      if (project) {
        const repository = makeExec(project.repoPath)

        for (const workspace of workspacesOfProject(state, projectId)) {
          // The same closing `removeWorkspaceById` does, and for the same
          // reason: a session outliving its worktree holds a child process
          // pointed at a directory that no longer exists, and nothing in the
          // interface can reach it again — only quitting the application ends
          // it. Left out here, removing a project leaked every agent in it.
          await closeChatsOf(workspace.id)

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

      return reconcile(stored, worktrees, changes, state.chats)
    },

    async createWorkspaceIn(projectId) {
      const project = requireProject(projectId)
      const exec = makeExec(project.repoPath)

      const workspace = await createWorkspace(project, state, exec, { root: dataRoot })

      try {
        // Inside the rollback, not after it: a worktree missing the files it
        // cannot run without is a workspace that will fail its first build, and
        // undoing it says so at the one moment somebody is watching.
        await carryInto(project.id, project.repoPath, workspace.path, dataRoot)
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

    readWorkspaceChanges(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Run from the worktree, not the repository: the base branch is a fact
      // about the project, but everything else — the working tree, the index,
      // the untracked files — is a fact about this workspace's own directory.
      return readWorkspaceDiff(makeExec(workspace.path), {
        baseBranch: project.baseBranch,
        root: workspace.path
      })
    },

    readPullRequest(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Both run from the worktree: `gh` finds the repository from the
      // directory it is in, and the branch's own state is a fact about there.
      return readPullRequest(
        workspace.branch,
        project.baseBranch,
        makeGh(workspace.path),
        makeExec(workspace.path)
      )
    },

    createPullRequest(workspaceId, request) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      return createPullRequest(
        { ...request, branch: workspace.branch, base: project.baseBranch },
        makeGh(workspace.path),
        makeExec(workspace.path)
      )
    },

    async resolveWorkspaceFile(workspaceId, path) {
      const workspace = requireWorkspace(workspaceId)
      const resolved = await fileInWorkspace(workspace, path)

      if (!resolved) {
        throw new WorkspaceError(
          'worktreeMissing',
          { workspaceId, path },
          `Path ${path} is not inside workspace ${workspaceId}.`
        )
      }

      return resolved
    },

    async openChat(workspaceId) {
      requireWorkspace(workspaceId)

      const chat = newChat(workspaceId, {
        id: uuid(),
        agent: DEFAULT_AGENT,
        // The global setting is the starting point; the chat may then diverge
        // from it without changing what the next workspace inherits.
        workingMode: config.workingMode,
        effort: config.effort,
        model: config.model,
        planModel: config.planModel,
        createdAt: now()
      })

      /*
       * Decided inside the commit rather than before it.
       *
       * The renderer has two ways in — a setting picked in the composer, and a
       * message sent — and either can be in flight when the other starts. Both
       * saw no record and both wrote one: the reply and its whole transcript
       * went to the second while `listChats` answered with the first, so the
       * conversation reopened empty and the transcript that had it was filed
       * under an id nothing pointed at. `commit` serialises, so the second
       * caller cannot read a state the first has not written.
       */
      // The one that was written, which for whichever call lost the race is not
      // the one it brought.
      let opened = chat

      await commit((current) => {
        const [existing] = chatsOfWorkspace(current, workspaceId)
        if (!existing) return addChat(current, chat)

        opened = existing
        return current
      })

      return opened
    },

    async createChat(workspaceId) {
      requireWorkspace(workspaceId)

      const chat = newChat(workspaceId, {
        id: uuid(),
        agent: DEFAULT_AGENT,
        // The global setting is the starting point, as it is for the first
        // conversation: a second tab is a fresh start, not a copy of the one
        // beside it.
        workingMode: config.workingMode,
        effort: config.effort,
        model: config.model,
        planModel: config.planModel,
        createdAt: now()
      })

      await addChatCapped(chat)
      return chat
    },

    async forkChat(chatId) {
      const source = requireChat(chatId)
      const workspace = requireWorkspace(source.workspaceId)

      if (source.sessionId === null) {
        throw new ChatError('nothingToFork', { chatId }, `Chat ${chatId} has not started yet.`)
      }

      /*
       * The agent's own fork, run before any record exists.
       *
       * Resuming a session continues it in place and keeps its id — which is
       * exactly what the SDK's `forkSession` option exists to opt out of — so a
       * second record carrying the source's id would be two agent processes
       * appending to one session file, each reading the other's turns as part
       * of its own conversation. What comes back is a new id, which makes the
       * new chat an ordinary one from its first render.
       *
       * Not caught into a clean conversation: a tab that says it continues this
       * one and does not is worse than a refusal.
       */
      let forked: { readonly sessionId: string }
      try {
        // `dir` rather than letting it search: without one the SDK looks
        // through every project directory for a session id.
        forked = await runForkSession(source.sessionId, { dir: workspace.path })
      } catch (error) {
        throw new ChatError('forkFailed', { chatId }, describeError(error))
      }

      const chat = forkChatRecord(source, {
        id: uuid(),
        sessionId: forked.sessionId,
        createdAt: now()
      })

      await addChatCapped(chat)

      // The fork above copied what the model remembers; this copies what the
      // screen draws. Without it the new tab opens empty above an agent that
      // remembers all of it.
      await copyHistory(source, chat)
      return chat
    },

    async renameChat(chatId, title) {
      requireChat(chatId)

      // Trimmed here rather than at the boundary: what reaches the record is
      // what the strip will draw, and a name of three spaces draws as a gap
      // nothing explains.
      const trimmed = title.trim()
      await commit((current) =>
        updateChat(current, chatId, { title: trimmed === '' ? null : trimmed })
      )
    },

    async closeChat(chatId) {
      const chat = requireChat(chatId)

      // A workspace without a conversation has no way back to one but the
      // first message, and throwing the only one away is `/clear` — which does
      // it without leaving the pane with nothing to draw.
      if (chatsOfWorkspace(state, chat.workspaceId).length <= 1) {
        throw new ChatError('lastChat', { chatId }, `Chat ${chatId} is its workspace's only one.`)
      }

      await closeOneChat(chat)
      // Through `commitChats` rather than a plain commit: the workspace's
      // status is derived from its conversations, and one of them has gone —
      // closing the tab that was running leaves the workspace idle, and the
      // list has to hear about it.
      await commitChats(chat.workspaceId, (current) => removeChat(current, chatId))
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
       * plan is settled. Set only at the start and on a user's change, the
       * session drifted, and the footer ended up promising "without asking"
       * over an agent asking about every edit.
       *
       * The mode can now be read: `SDKStatusMessage` carries an optional
       * `permissionMode`, and a live session emits those messages routinely.
       * Re-asserted all the same, because a push is not a guarantee — reading
       * the mode from a message that arrives means trusting that it always
       * does, and the failure it would bring back is a silent one.
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
       *
       * A **mode** change is the one thing that does move it, in `applyMode`
       * and on an approved plan — and only for a conversation whose plan and
       * code models differ, where leaving the model alone would run the plan
       * on the model that wrote it. That is not a re-assertion but a second
       * instruction, given later than `/model` was, and the later one wins.
       */
      /*
       * Effort is re-asserted for the same reason the mode is, and unlike the
       * model there is nothing to read instead.
       *
       * `/effort high` changes the level inside the CLI and announces nothing:
       * the context reading names the running model and carries no effort, and
       * `applyFlagSettings` returns void, so there is no reading that reports
       * the truth. Left alone, a level set by a command survived every message
       * after it, next to a picker naming a different one — and effort is what
       * a turn costs and how long it takes.
       *
       * The price is that `/effort` lasts one turn. That is the same bargain
       * `/permissions` already lives with, and `docs/ui.md` says so rather than
       * leaving it to be discovered.
       */
      const running = sessions.get(chatId)
      if (running) {
        await running.setPermissionMode(sessionMode(chat))
        await running.setEffort(chat.effort)
      }

      const session = running ?? startFor(chat, workspace)
      session.send(text)

      await setChatStatus(chatId, 'running')
    },

    async interruptChat(chatId) {
      requireChat(chatId)

      // Before the interrupt rather than after it: stopping a turn is how a
      // question gets abandoned in the first place, and an interrupt that
      // throws must still leave nothing behind to be asked again. The same
      // applies to an edit announced and never finished — no result is coming
      // for it now.
      abandonPermissions(chatId)
      abandonEdits(chatId)

      // Nothing running is not a failure — the button is simply ahead of the
      // agent, which finished between the render and the click.
      await sessions.get(chatId)?.interrupt()
      await setChatStatus(chatId, 'idle')
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

      // The effective model rather than the one just stored: a conversation
      // planning under a split runs the plan model, and choosing the one that
      // writes the code must not drag the current turn off it.
      await sessions.get(chatId)?.setModel(sessionModel(requireChat(chatId)))
    },

    async setChatPlanModel(chatId, model) {
      requireChat(chatId)
      await commit((current) => updateChat(current, chatId, { planModel: model }))

      await sessions.get(chatId)?.setModel(sessionModel(requireChat(chatId)))
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
        await setChatStatus(request.chatId, 'idle')
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
        const before = sessionModel(requireChat(request.chatId))
        await commit((current) => updateChat(current, request.chatId, { planMode: false }))

        // The model leaves planning with the record. Before the reply, never
        // after it: the reply is what releases the tool call, so a model sent
        // behind it would reach a session already editing files on the model
        // that wrote the plan. The reply carries a mode and has no field for a
        // model, so this is the closest to riding along that there is.
        await pushModel(request.chatId, before)
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
      await setChatStatus(request.chatId, 'running')
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
      await setChatStatus(request.chatId, 'running')
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

    onWorkspaceStatus(handler) {
      statusListeners.add(handler)
      return () => statusListeners.delete(handler)
    },

    onChatStatus(handler) {
      chatStatusListeners.add(handler)
      return () => chatStatusListeners.delete(handler)
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
