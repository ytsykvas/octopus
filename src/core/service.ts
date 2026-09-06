/**
 * Core facade — the single entry point for application operations.
 *
 * Holds state in memory and persists it after every change. It exists so
 * `main/` stays a thin proxy with no logic (§11.1 docs/PROJECT.md): an IPC
 * handler should only have to forward the call here.
 */

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

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
  type PermissionAsk,
  type PermissionOutcome,
  type QueryFn,
  READ_ONLY_TOOLS,
  startSession
} from './agent.js'
import {
  type AgentCommand,
  type AgentModel,
  type Chat,
  ChatError,
  type ChatStatus,
  DEFAULT_AGENT,
  DEFAULT_EFFORT,
  type EffortChoice,
  effortInForce,
  EXIT_PLAN_MODE,
  forkChat as forkChatRecord,
  isClearCommand,
  isUsageCommand,
  MAX_CHATS_PER_WORKSPACE,
  newChat,
  sessionMode,
  sessionModel,
  type WorkingMode
} from './chats.js'
import { type EditTarget, readChangeContext, readEditTarget } from './changeContext.js'
import { readWorkspaceDiff, type WorkspaceDiff } from './diff.js'
import { revertFile } from './revert.js'
import { draftPullRequest, type DraftedPullRequest } from './pullRequestDraft.js'
import { isListening, settlePort } from './ports.js'
import {
  carriedFiles,
  carryInto,
  carryListForExport,
  readCarryList,
  storedCarryList,
  writeCarryList
} from './carry.js'
import type { CarryReport } from './carry.js'
import { type ConductorConfig, type DeclaredFile, readConductorConfig } from './conductorConfig.js'
import { applyEnvOverrides, discardIfOnlyBlock, removeEnvBlock, readWorkspaceEnv } from './env.js'
import { DEFAULT_PROFILE } from './envProfileNames.js'
import {
  createProfile,
  listProfiles,
  migrateEnvProfiles,
  readEffectiveEnv,
  readProfile,
  removeProfile,
  renameProfile,
  writeProfile
} from './envProfiles.js'
import { runArchiveScript } from './archive.js'
import { shortBranchName } from './branches.js'
import { type UsageWindows, windowsFrom } from './usage.js'
import {
  type Config,
  ConfigSchema,
  loadConfig,
  saveConfig,
  type SettingSourceName,
  toSdkSettingSources
} from './config.js'
import { type AgentEvent, forTranscript, isEphemeral } from './events.js'
import {
  cloneRepository,
  listRepositories,
  type RemoteRepository,
  type RepositoryList
} from './github.js'
import type { GitExec, GitOptions } from './git.js'
import {
  commitAndPush,
  createPullRequest,
  type GhExec,
  ghIn,
  type MergeMethod,
  closePullRequest,
  mergePullRequest,
  replyToReviewThread,
  setReviewThreadResolved,
  type NewPullRequest,
  type PullRequestView,
  readBranchRequests,
  readPullRequest,
  readPullRequestDetail
} from './pullRequests.js'
import type { BranchRequest, PullRequestDetail } from './pullRequestShapes.js'
import { gitIn, isIgnored } from './git.js'
import { FETCH_OPTIONS, resolveBase } from './remotes.js'
import { type InstructionSource, instructionSources } from './instructionSources.js'
import { type CapabilityFile, capabilityFiles, trustDigest, withApproval } from './repoTrust.js'
import {
  effectiveInstruction,
  type InstructionKind,
  readInstruction,
  storedInstruction,
  writeInstruction
} from './instructions.js'
import {
  configFile,
  globalSkillsRoot,
  projectSkillsRoot,
  rootDir,
  skillsDirOf,
  stateFile,
  stateTempFile
} from './paths.js'
import {
  DOWNLOAD_TIMEOUT_MS,
  ensureStore,
  importFromPath,
  importFromText,
  inspectImport,
  importFromUrl,
  readSkill,
  readSkillsIn,
  removeSkill,
  renameSkill,
  type SkillDocument,
  type SkillEntry,
  skillEnabled,
  type SkillImport,
  type SkillListing,
  type SkillPreview,
  type SkillSave,
  writeRawSkill,
  writeSkill
} from './skills.js'
import { type SkillStore, skillKey, type SkillScope } from './skillNames.js'
import { type QuestionAnswer, readQuestions, withAnswers } from './questions.js'
import { describeError } from './persist.js'
import {
  appendEntry,
  type ChatEntry,
  copyTranscript,
  readTranscript,
  removeTranscript
} from './transcript.js'
import {
  assertBranchExists,
  createProject,
  inspectRepository,
  orderBaseBranches,
  removeProjectData
} from './projects.js'
import {
  type ResolvedScript,
  type ScriptsInWorkspace,
  repoInstruction,
  resolveScripts,
  scriptsDigest
} from './repoSource.js'
import { readScript, type ScriptKind, scriptExists, scriptPath, writeScript } from './scripts.js'
import {
  compareRepoItem,
  formatRepoProject,
  instructionKindOf,
  parseRepoProject,
  REPO_ITEM_IDS,
  REPO_README_FILE,
  readRepoConfig,
  type RepoConfigItem,
  type RepoConfigView,
  type RepoItem,
  type RepoItemId,
  type RepoProject,
  repoItemFile,
  scriptKindOf,
  writeRepoConfig
} from './repoConfig.js'
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
  discardWorkspace,
  ensureRemovable,
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
  /**
   * The options parameter is what the fetch needs: it alone leaves the machine,
   * so it alone wants a deadline and an environment. A fake may still take one
   * parameter — a function is assignable to a type taking more — so every
   * existing injection keeps working, and a fake spawns nothing for a deadline
   * to apply to anyway.
   */
  readonly makeExec?: (cwd: string, options?: GitOptions) => GitExec
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
   * How a skill is downloaded, injected for the reason `makeGh` is: the real
   * one leaves the machine, and a suite that used it would be testing
   * somebody's web server.
   */
  readonly fetch?: typeof fetch
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

/**
 * The conversations of a workspace are not the set they were.
 *
 * One created, forked, renamed or closed — anything the tab strip draws. Not
 * what any of them is *doing*, which is `ChatStatusEvent` and moves several
 * times a turn: a window re-reading its list on every status move would ask
 * about every conversation of a workspace for news it already has.
 *
 * Carries the workspace and nothing else. Sending the list would let the push
 * and `listChats` disagree about shape, and the window has to be able to read
 * the list anyway.
 */
export interface ChatsChangedEvent {
  readonly workspaceId: string
}

/** What the user answered to a permission request. */
export type PermissionAnswer = 'allow' | 'always' | 'deny'

/** How much of the subscription's window is gone, as last reported. */
export type RateLimit = Extract<AgentEvent, { type: 'rate_limit' }>

/**
 * Whether two readings say the same thing.
 *
 * Compared field by field rather than by identity: a fresh object arrives from
 * the control channel on every read, so identity would call every one of them a
 * change and write the state file three times a turn.
 *
 * Exported to be tested on values. What it has to get right is the four ways a
 * window can be absent on one side and not the other, and reaching those
 * through a session's fake would be arranging the agent to say something odd
 * rather than asking the question directly.
 */
export function sameWindows(left: UsageWindows, right: UsageWindows | null): boolean {
  if (left.limitsApply !== right?.limitsApply) return false
  if (left.limits.length !== right.limits.length) return false

  // `readAt` is deliberately not compared: it moves on every read and is the
  // one field that says nothing about the account.
  return left.limits.every((window, index) => {
    const other = right.limits[index]

    return (
      window.key === other?.key &&
      window.label === other.label &&
      window.utilization === other.utilization &&
      window.resetsAt === other.resetsAt
    )
  })
}

/**
 * The two readings a running session can be asked for.
 *
 * One object rather than two calls: they are wanted at the same moments, and
 * splitting them would double the round trips to say one thing.
 */
export interface SessionUsage {
  readonly context: ContextUsage | null
}

/**
 * What came of asking the account how much of its windows is gone.
 *
 * Four answers rather than a nullable reading, because the block has four
 * things to say and used to guess them from one value — getting two wrong. A
 * read that failed returned the previous figures and reported success, so the
 * press redrew a stale number as though it were fresh; and a cache that was
 * empty when a live read failed said "open a workspace first", which describes
 * only one of the ways it can happen.
 */
export type UsageOutcome =
  | { readonly kind: 'read'; readonly windows: UsageWindows }
  /** An API-key, Bedrock or Vertex session: no plan to be near the end of. */
  | { readonly kind: 'noPlan' }
  /** A session runs in a worktree, and this installation has none to run in. */
  | { readonly kind: 'nowhereToAsk' }
  /** Asked, and the answer did not come: an older CLI, a refused request. */
  | { readonly kind: 'failed' }

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

/**
 * A `.conductor` declaration, reconciled against the carry list beside it.
 *
 * `carried` is the reconciliation and it runs one way only: a declaration the
 * list already names is settled, and a list entry the declaration does not
 * mention is nobody's problem — the list is the thing that decides.
 */
export interface DeclaredCarryFiles {
  /** The settings file that declared them, relative to the checkout. */
  readonly path: string
  readonly files: readonly (DeclaredFile & { readonly carried: boolean })[]
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
  listRemoteRepositories(): Promise<RepositoryList>
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
   *
   * The project's own copies alone — what the editors in Project settings read
   * and write. What actually **runs** is `workspaceScripts`, which asks the
   * repository first.
   */
  projectScriptPaths(projectId: string): Promise<Record<ScriptKind, string | null>>

  /**
   * Which script would run for each kind in this workspace, and from where.
   *
   * `approved` is about the ones the repository supplies: until somebody has
   * read them, they do not run. A project's own scripts are never gated — the
   * user wrote them, and a dialog asking somebody to approve their own text is
   * one they learn to click through.
   */
  workspaceScripts(workspaceId: string): Promise<ScriptsInWorkspace>
  /** Records that these scripts were read, so they may run. */
  approveWorkspaceScripts(workspaceId: string): Promise<void>
  /**
   * The same answer for a project, resolved against its checkout.
   *
   * Project settings has no workspace to ask about, and the checkout is the
   * best answer available — it is what every worktree is cut from.
   */
  projectScripts(projectId: string, workspaceId: string | null): Promise<ScriptsInWorkspace>

  /** Which of the checkout's files travel into a workspace, one path per line. */
  readProjectCarryList(projectId: string): Promise<string>
  saveProjectCarryList(projectId: string, contents: string): Promise<void>
  /**
   * What the checkout's `.conductor` says its workspaces need.
   *
   * Read and shown, never followed — see `conductorConfig.ts`. Answers `null`
   * where there is no such declaration, which is every repository that was not
   * set up for Conductor and most of the ones that were.
   */
  declaredCarryFiles(projectId: string): Promise<DeclaredCarryFiles | null>
  /**
   * The named sets of variables a project holds, and which it uses by default.
   *
   * The default is unioned in, so the picker always has something selected even
   * for a project that has never written a variable.
   */
  listEnvProfiles(projectId: string): Promise<{
    readonly profiles: readonly string[]
    readonly projectDefault: string
  }>
  /** One set's body, written last into every workspace's `.env` so it wins. */
  readEnvProfile(projectId: string, name: string): Promise<string>
  saveEnvProfile(projectId: string, name: string, contents: string): Promise<void>
  /** Adds one, empty or copied from another. */
  createEnvProfile(projectId: string, name: string, from: string | null): Promise<void>
  renameEnvProfile(projectId: string, from: string, to: string): Promise<void>
  /**
   * Removes one, and moves everything that pointed at it.
   *
   * In the same commit as the delete, so `state.json` never holds a reference
   * to a set that is not there.
   */
  removeEnvProfile(projectId: string, name: string): Promise<void>
  /** Puts one workspace on a set of its own, or `null` to follow the project. */
  setWorkspaceEnvProfile(workspaceId: string, name: string | null): Promise<void>
  /**
   * Whether git would keep this project's env file out of a commit.
   *
   * Asked of the checkout, which shares its `.gitignore` with every worktree
   * made from it — and asked at all because octopus writes credentials into
   * that file, in a directory an agent commits from freely.
   */
  isProjectEnvIgnored(projectId: string): Promise<boolean>

  /**
   * The settings this project's repository carries, beside the app's own.
   *
   * `~/.octopus` lives on one machine and disappears with it, so a repository
   * may keep a copy under `.octopus/` — a snapshot, never read while the app
   * works. This is what the Repository section shows, and what the import
   * dialog reads before writing anything.
   */
  projectRepoConfig(projectId: string): Promise<RepoConfigView>
  /** Writes the named items into the installation; answers with what it took. */
  importRepoConfig(projectId: string, ids: readonly RepoItemId[]): Promise<RepoItemId[]>
  /** Writes the named items into the repository; answers with what it wrote. */
  exportRepoConfig(projectId: string, ids: readonly RepoItemId[]): Promise<RepoItemId[]>
  /**
   * What this project offers the agent, and what this machine adds.
   *
   * octopus loads every settings source, so the agent arrives carrying whatever
   * has been written for it; this is how the app can say what that was.
   */
  projectInstructionSources(
    projectId: string,
    /** The workspace to answer for; the checkout where none is open. */
    workspaceId: string | null
  ): Promise<InstructionSource[]>
  /**
   * What this workspace's repository can grant itself, and whether it has been
   * approved.
   *
   * A repository ships `.claude/settings.json`, hook scripts and `.mcp.json`;
   * octopus loads them as the CLI does, so opening a clone would hand it those
   * unless somebody has read them.
   */
  workspaceTrust(workspaceId: string): Promise<{
    readonly approved: boolean
    readonly files: readonly CapabilityFile[]
  }>
  /** Records that these files were read, so the next session may load them. */
  approveWorkspaceSettings(workspaceId: string): Promise<void>
  /**
   * A workspace's env file as it stands, or null where it has none.
   *
   * The file itself, not a reconstruction: what the scripts will read is the
   * only version worth showing.
   */
  readWorkspaceEnv(workspaceId: string): Promise<string | null>

  /**
   * Puts a workspace in a state its scripts can run in.
   *
   * Two things, because they are one moment: the carried files land, and then
   * the project's env overrides are written at the end of the workspace's
   * `.env`. Done at creation and again before a run, so a workspace made before
   * either changed picks the change up rather than staying broken until it is
   * recreated.
   *
   * Answers with the files it copied; nothing is ever overwritten.
   */
  prepareWorkspace(workspaceId: string): Promise<CarryReport>

  /**
   * Whether anything is listening on the port this workspace was given.
   *
   * Read on demand rather than remembered: it is a fact about the machine, and
   * a script that ignores `$OCTOPUS_PORT` makes our own record of it a lie.
   */
  isWorkspaceServing(workspaceId: string): Promise<boolean>

  /**
   * The port this workspace should serve on, moving it if the old one is gone.
   *
   * Asked before a run starts and only while nothing of this workspace is
   * alive, which is what makes the answer knowable: with nothing of ours
   * running, whatever is answering on that port belongs to somebody else.
   */
  ensureWorkspacePort(workspaceId: string): Promise<number>

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

  /** The skills one of the two stores holds, for a settings section. */
  listSkills(store: SkillStore): Promise<SkillEntry[]>
  /**
   * The skills the checkout itself carries, so one can be copied out of it.
   *
   * Listed whatever the Agent setting says, unlike the panel in the composer:
   * that one is about a conversation and must not offer a switch over
   * something the session would not load, while this is about files that are
   * there either way and can be taken a copy of.
   */
  listRepositorySkills(workspaceId: string): Promise<SkillEntry[]>
  /** One of them, opened: the form's two fields and the raw document. */
  /**
   * One skill of a store, addressed by the directory the listing found it in.
   *
   * A folder rather than a name: the two are the same string only for a skill
   * the app itself created, and a name cannot address a row at all where two
   * directories claim one.
   */
  readStoredSkill(store: SkillStore, folder: string): Promise<SkillDocument>
  saveStoredSkill(store: SkillStore, folder: string, save: SkillSave): Promise<SkillEntry>
  removeStoredSkill(store: SkillStore, folder: string): Promise<void>
  /**
   * Gives a skill another name, and moves every answer stored against it.
   *
   * A migration rather than an edit, which is why the editor's name field is
   * disabled: the name is the directory *and* the key three stored things use.
   */
  renameStoredSkill(store: SkillStore, folder: string, to: string): Promise<SkillEntry>
  importStoredSkill(store: SkillStore, request: SkillImport): Promise<SkillEntry>
  /**
   * What an import would write, without writing it.
   *
   * The link is what this is for: a folder the user picked they know and pasted
   * text they can read, while an address shows nothing until it has been
   * fetched — and what comes back is prose the agent will later follow.
   */
  inspectSkillImport(store: SkillStore, request: SkillImport): Promise<SkillPreview>
  /**
   * Every skill this conversation could use, and whether it is on.
   *
   * Resolved here rather than in the renderer: three sources and three layers
   * of defaults are the service's arithmetic, and a window doing it would have
   * to ask four times to get one answer.
   */
  skillsForChat(chatId: string): Promise<SkillListing[]>
  /**
   * The same, for a workspace whose first message has not been sent.
   *
   * `openChat` is lazy — a conversation has no record until it has something
   * to record — so the panel would otherwise be empty in every fresh
   * workspace, which is exactly where somebody looks first. Nothing has been
   * said about any skill yet, so the defaults are the whole answer.
   */
  skillsForWorkspace(workspaceId: string): Promise<SkillListing[]>
  /** Switches one skill for one conversation, on a running session included. */
  setChatSkill(chatId: string, key: string, enabled: boolean): Promise<void>

  /** Workspaces of a project, reconciled with what git actually has. */
  listWorkspaces(projectId: string): Promise<WorkspaceView[]>
  createWorkspaceIn(projectId: string): Promise<Workspace>
  renameWorkspaceById(workspaceId: string, name: string): Promise<void>
  removeWorkspaceById(workspaceId: string, options?: RemoveOptions): Promise<void>
  /** Whether a workspace holds work that removal would discard. */
  workspaceHasChanges(workspaceId: string): Promise<boolean>
  /** Everything the workspace changed since it left the project's base branch. */
  readWorkspaceChanges(workspaceId: string): Promise<WorkspaceDiff>
  /**
   * Puts one file back to the state the workspace branched from.
   *
   * The pane's own scope, so the file's row leaves it afterwards: committed
   * work is undone as a change in the working tree, and the commits stand.
   * `oldPath` is the far end of a rename, which is one row and two paths.
   */
  revertWorkspaceFile(workspaceId: string, path: string, oldPath?: string | null): Promise<void>

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
   * Asks the agent for a title and a description for this branch.
   *
   * Opens nothing and pushes nothing: the answer goes back to the form, where
   * whoever asked can read it, change it, or throw it away.
   */
  draftPullRequest(workspaceId: string): Promise<DraftedPullRequest>

  /**
   * The checks, the review and the mergeability of a request that exists.
   *
   * Apart from `readPullRequest` rather than folded into it, because the two
   * fail differently: that one failing means the branch cannot be described at
   * all, while this one failing leaves the number, the title and the link worth
   * drawing.
   */
  readPullRequestDetail(workspaceId: string, number: number): Promise<PullRequestDetail>

  /**
   * Commits everything in a workspace and pushes the branch.
   *
   * What gets an answer to a review onto a request that already exists; opening
   * one does the same two steps on its way.
   */
  commitAndPushWorkspace(workspaceId: string, message: string): Promise<void>

  /** Merges it. Answers with nothing — see `mergePullRequest` for why. */
  mergePullRequest(workspaceId: string, number: number, method: MergeMethod): Promise<void>

  /** Closes it without merging. The branch is left alone. */
  closePullRequest(workspaceId: string, number: number): Promise<void>

  /**
   * Answers one review thread.
   *
   * The other half of reading a review: saying why something was left as it is
   * fits in a sentence and nowhere in a commit.
   */
  replyToReviewThread(workspaceId: string, threadId: string, body: string): Promise<void>

  /** Marks a thread settled, or puts it back. */
  setReviewThreadResolved(workspaceId: string, threadId: string, resolved: boolean): Promise<void>

  /**
   * Every branch of a project that has a request, in one call.
   *
   * Per project rather than per workspace: the list marks every row at once.
   */
  readBranchRequests(projectId: string): Promise<BranchRequest[]>
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
  /** Sets how much thinking the chat asks for while it works. */
  setChatEffort(chatId: string, effort: EffortChoice): Promise<void>
  /** Sets the effort the chat plans at; null means the one above does both. */
  setChatPlanEffort(chatId: string, effort: EffortChoice | null): Promise<void>
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
  /**
   * The account's window shares, with no conversation in the question.
   *
   * Read by the sidebar, which has no chat to ask about — and answered from the
   * last reading, kept in the state file, so it is there before the first
   * message of a session rather than after it.
   */
  getUsageWindows(): UsageWindows | null
  /**
   * Asks the account for its window shares now, rather than waiting for a turn.
   *
   * Nothing is sent to the agent: this is a control request, so it costs no
   * turn and no tokens. Measured, a cold one — spawn the CLI, ask, answer — is
   * 720–850ms, and one against a session already running is about 260ms.
   *
   * Answers what came of it rather than a reading that may be the old one:
   * four outcomes, because the block has four things to say and inferring them
   * from one nullable value got two of them wrong.
   */
  refreshSubscriptionUsage(): Promise<UsageOutcome>
  /** Subscribes to agent events; the returned function unsubscribes. */
  onAgentEvent(handler: (event: ChatEvent) => void): () => void
  /** What a workspace is doing, as it changes. A broadcast, like the above. */
  onWorkspaceStatus(handler: (event: WorkspaceStatusEvent) => void): () => void
  /**
   * The account's windows, whenever they move.
   *
   * Pushed rather than pulled, and that is the whole of what stops the block
   * lagging: a window watching for a finished turn and then reading the cache
   * was racing whatever filled it, and lost every time.
   */
  onUsageWindows(handler: (windows: UsageWindows) => void): () => void
  /** What each conversation is doing, as it changes. The tab strip draws this. */
  onChatStatus(handler: (event: ChatStatusEvent) => void): () => void
  /**
   * Which conversations a workspace has, when that set changes.
   *
   * The tab strip reads its list once when a workspace is selected, so without
   * this a second window on the same workspace draws a strip that was true when
   * it opened: a tab it never sees created, and one it goes on drawing after it
   * is closed.
   */
  onChatsChanged(handler: (event: ChatsChangedEvent) => void): () => void
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

  /*
   * A project's variables used to be one file. Giving each project its `envs/`
   * directory happens here, before anything can read one — the directory's
   * presence is the version marker, so it costs a `readdir` per project on
   * start and nothing afterwards.
   *
   * Allowed to throw: a service that cannot read its own data root should fail
   * loudly rather than quietly behave as though every project had no variables.
   */
  for (const project of state.projects) await migrateEnvProfiles(project.id, dataRoot)
  let config: Config = await loadConfig(configPath)

  /** Live agent sessions, keyed by chat. A missing entry means "not started". */
  /**
   * How a skill is downloaded, settled once here rather than at each call.
   *
   * The real `fetch` and the deadline the module never defaults, put together
   * where every service gets one — which is also what keeps the injected
   * stand-in and the real thing on the same footing.
   */
  const download = { fetch: options.fetch ?? globalThis.fetch, timeoutMs: DOWNLOAD_TIMEOUT_MS }

  const sessions = new Map<string, AgentSession>()
  const listeners = new Set<(event: ChatEvent) => void>()
  const statusListeners = new Set<(event: WorkspaceStatusEvent) => void>()
  const usageListeners = new Set<(windows: UsageWindows) => void>()
  const chatStatusListeners = new Set<(event: ChatStatusEvent) => void>()
  const chatsChangedListeners = new Set<(event: ChatsChangedEvent) => void>()
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
  //
  // Seeded from the state file, unlike the pushed one above. These are drawn in
  // the sidebar from the moment the window opens, and a reading arrives only
  // from a running session's control channel — so without the last one on disk
  // the block would be empty until somebody sent a message, which is the whole
  // thing this is here to avoid.
  let usageWindows: UsageWindows | null = state.usageWindows
  /** The read in flight, so four callers at once make one request. */
  let reading: Promise<UsageOutcome> | null = null

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

  /**
   * The ref a project's base branch actually names.
   *
   * A workspace is now cut from the remote copy of its base where there is one,
   * because a fetch does not move a local branch. Everything that compares
   * against the base has to follow it there: `main` and `origin/main` are the
   * same point only until somebody else pushes, and measuring against the local
   * one then reports a fortnight of their commits as this workspace's work —
   * in the diff, in the count of changes, and in the check that asks whether a
   * branch is safe to delete.
   *
   * Not applied to what is stored or to what is validated: the project holds
   * the branch the user chose, and `assertBranchExists` has to check the name
   * they actually typed.
   *
   * Falls back to the stored name when git says nothing — a repository that was
   * moved or renamed answers no question at all, and the reads this serves have
   * to keep working: `listWorkspaces` marks such workspaces missing, which is
   * the answer the UI acts on, and it cannot do that from an exception. The
   * creation path does not come through here; there a remote that cannot be
   * reached is exactly the failure worth refusing on.
   */
  async function baseRefOf(project: Project): Promise<string> {
    try {
      return (await resolveBase(makeExec(project.repoPath), project.baseBranch)).ref
    } catch {
      return project.baseBranch
    }
  }

  /**
   * The fields a project exports, which is not every field it has.
   *
   * `branchPrefix` is a person's username rather than a fact about the project,
   * and `approvedSettings` is the trust record — a repository that could
   * declare itself approved would defeat the gate it has to pass.
   */
  function exportedFields(project: Project): RepoProject {
    return {
      baseBranch: project.baseBranch,
      envFile: project.envFile,
      name: project.name,
      color: project.color,
      // `null` is "back to the initials", and JSON should say nothing rather
      // than impose that on whoever imports it.
      icon: project.icon ?? undefined
    }
  }

  /**
   * What this installation holds for one item, or null where nobody wrote it.
   *
   * The distinction matters in both directions: an untouched script should not
   * be exported as a template, and an item the app lacks is one the repository
   * can offer rather than merely differ from.
   */
  async function localItem(project: Project, id: RepoItemId): Promise<string | null> {
    const script = scriptKindOf(id)
    if (script !== undefined) {
      return (await scriptExists(script, project.id, dataRoot))
        ? readScript(script, project.id, dataRoot)
        : null
    }

    const instruction = instructionKindOf(id)
    if (instruction !== undefined) return storedInstruction(instruction, project.id, dataRoot)

    // Stripped of its sources on the way out. `.octopus/carry` is committed and
    // cloned by everybody; where this machine keeps its `.env` is nobody else's
    // business and would be readable for ever.
    if (id === 'carry') return carryListForExport(await storedCarryList(project.id, dataRoot))

    // The project's own fields, which it always has.
    return formatRepoProject(exportedFields(project))
  }

  /**
   * Applies the fields a repository states, once git agrees they are usable.
   *
   * The base branch is checked here rather than trusted, because this value did
   * not come from the branch picker: a clone stating `develop` while this one
   * has only `main` would otherwise be stored and surface much later as a
   * `worktree add` failure that says nothing about settings. The env file is
   * checked by `updateProject`, which already refuses one that leaves the
   * worktree.
   */
  async function applyRepoProject(project: Project, fields: RepoProject): Promise<void> {
    if (fields.baseBranch !== undefined) {
      await assertBranchExists(makeExec(project.repoPath), fields.baseBranch)
    }

    await commit((current) => updateProject(current, project.id, fields))
  }

  /**
   * Holds on to a reading, and writes it down when it says something new.
   *
   * Three callers now — a turn ending, a `/usage` somebody typed, and the
   * sidebar's own refresh — and one of them runs up to three times a turn. A
   * write per read would put the busiest path in the app on the state file to
   * record a number that had not moved, so the comparison comes first.
   *
   * A reading that failed leaves the last good one standing: blanking the
   * figures because one request was refused would report a change in the
   * account that never happened.
   */
  /** One session's answer, narrowed to what the sidebar draws and dated. */
  async function readWindows(session: AgentSession): Promise<UsageOutcome> {
    const report = await session.usageReport()
    if (report === null) return { kind: 'failed' }
    if (!report.limitsApply) return { kind: 'noPlan' }

    const windows = windowsFrom(report, now())
    await keepWindows(windows)

    return { kind: 'read', windows }
  }

  /**
   * Asks the account, through whatever session there is or one started for it.
   *
   * **Coalesced.** A finished turn, the window regaining focus, the timer and a
   * press of the control can all land at once, and each starting its own read
   * would spawn its own CLI. The one in flight is shared instead.
   *
   * A session already running answers for nothing: one control request against
   * a process that exists, about 260ms. With none, `startProbe` opens one of
   * its own and closes it again.
   *
   * A workspace is still needed for its worktree, and it is found through a
   * conversation that already exists, for the reason `openChat` is lazy: a
   * workspace nobody has spoken to has no record, and filling a gauge is not
   * enough to give it one. The chat is the *address* of a directory here and
   * nothing more — see `startProbe` for why that distinction is the fix.
   */
  function askAccount(): Promise<UsageOutcome> {
    reading ??= (async (): Promise<UsageOutcome> => {
      try {
        const [running] = sessions.values()
        if (running) return await readWindows(running)

        const chat = state.chats.at(-1)
        const workspace = state.workspaces.find((item) => item.id === chat?.workspaceId)
        if (!chat || !workspace) return { kind: 'nowhereToAsk' }

        const probe = startProbe(workspace)
        try {
          return await readWindows(probe)
        } finally {
          await probe.close()
        }
      } finally {
        reading = null
      }
    })()

    return reading
  }

  async function keepWindows(reading: UsageWindows | null): Promise<void> {
    if (!reading || sameWindows(reading, usageWindows)) return

    usageWindows = reading
    await commit((current) => ({ ...current, usageWindows: reading }))

    // Announced rather than left to be asked for. This is the single moment the
    // figures change, and a window that had to notice by polling the cache was
    // racing whoever filled it — which is exactly how the block came to draw
    // the previous turn's reading on every turn.
    for (const listener of usageListeners) listener(reading)
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

  /**
   * Port settlements, run one after another.
   *
   * The choice has to be serialised, not only the write. `settlePort` reads the
   * ports every other workspace holds, then awaits a probe per block, then
   * commits — and `commit` orders the writes without ordering what led to them.
   * Two settlements overlapping inside that window both saw a pool in which
   * neither had moved, and both took the same free block.
   */
  let portChoices: Promise<unknown> = Promise.resolve()

  function settlingOneAtATime<T>(choose: () => Promise<T>): Promise<T> {
    const next = portChoices.then(choose, choose)
    // Swallowed on the chain only: the caller still gets the rejection, and a
    // failure must not stop the workspace behind it from being served.
    portChoices = next.catch(() => undefined)

    return next
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
  /**
   * The conversations of a workspace as the tab strip draws them.
   *
   * Ids and titles, in order, and deliberately **not** statuses. Every status
   * move goes through `commitChats` too, so a reading that included them would
   * announce the list as changed several times a turn — and the whole point of
   * a second stream is that a window re-reads when the set moves rather than
   * when a conversation does.
   */
  function membershipOf(current: State, workspaceId: string): string {
    return chatsOfWorkspace(current, workspaceId)
      .map((chat) => `${chat.id}\u0000${chat.title ?? ''}`)
      .join('\u0001')
  }

  function commitChats(workspaceId: string, change: (current: State) => State): Promise<void> {
    const before = state.workspaces.find((workspace) => workspace.id === workspaceId)
    const members = membershipOf(state, workspaceId)

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
      // Before the status, because a window told the set moved re-reads it —
      // and a status arriving first would be about a conversation it has not
      // heard of yet.
      if (membershipOf(state, workspaceId) !== members) {
        for (const listener of chatsChangedListeners) listener({ workspaceId })
      }

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
      record(chat, { role: 'agent', at: now(), event: forTranscript(event) })
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

      /*
       * The account's windows have just moved, and this is the moment they can
       * be read for nothing — the session is up and the request is warm.
       *
       * Read here rather than by whichever pane happens to be mounted, which is
       * where it used to live: a workspace with no chat pane open refreshed
       * nothing, and the sidebar's own handler read a **cache** the pane was
       * still filling, so the block drew the previous turn's figure on every
       * turn. Swallowed like the model list above: a reading that will not come
       * is not a reason to report a failure into somebody's conversation.
       */
      background(
        chat,
        askAccount().then(
          () => undefined,
          () => undefined
        )
      )
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
    { toolName, input, reason }: PermissionAsk
  ): Promise<PermissionOutcome> {
    if (config.alwaysAllowedTools.includes(toolName)) return { allow: true }

    const requestId = uuid()
    handleEvent(chat, {
      type: 'permission_request',
      requestId,
      toolName,
      input,
      ...(reason !== undefined && { reason })
    })

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
    const beforeEffort = effortInForce(requireChat(chatId))
    await commit((current) => updateChat(current, chatId, patch))

    // Applied to the running session too, so the choice takes effect on the
    // current turn rather than only on the next one. Read back after the write
    // rather than merged by hand: the session wants both halves, and only one
    // of them is in the patch.
    await sessions.get(chatId)?.setPermissionMode(sessionMode(requireChat(chatId)))
    await pushModel(chatId, before)
    await pushEffort(chatId, beforeEffort)
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
   * The same for effort, at the same two moments and with the same guard.
   *
   * A conversation whose two jobs share an effort runs that one whatever the
   * toggles do, so nothing is ever pushed at it — byte for byte the behaviour
   * there was before a conversation could hold two.
   */
  async function pushEffort(chatId: string, before: EffortChoice): Promise<void> {
    const wanted = effortInForce(requireChat(chatId))
    if (wanted === before) return

    await sessions.get(chatId)?.setEffort(wanted)
  }

  /**
   * Ends a chat's session, and leaves its history where it is.
   *
   * The record goes with its workspace at the caller's commit; what needs
   * doing here is the child process, which a record removal would not touch.
   *
   * The transcript is deliberately not among it. Everything above is memory
   * and a process — losing them costs a session that was ending anyway — while
   * the transcript is the only copy of what was said, and this runs before the
   * steps that can still fail. `discardHistories` takes it, after the record
   * has gone.
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
  }

  /**
   * Discards the transcripts of chats whose records have already gone.
   *
   * After the commit, and swallowing its own failure — the same order and the
   * same reason as `removeProjectData`. A record that outlives its history is
   * a conversation the pane draws empty above an agent that remembers all of
   * it; a file nothing points at is only litter. Of the two, litter.
   */
  async function discardHistories(chats: readonly Chat[]): Promise<void> {
    for (const chat of chats) {
      await removeTranscript(chat.id, dataRoot).catch(() => undefined)
    }
  }

  /**
   * Gives a worktree the files and the variables it needs to run.
   *
   * One helper because there were two copies of this, identical down to the
   * five-field literal — creation and every run — and the choice of *which*
   * profile a workspace uses had to be made in both or in neither.
   *
   * The order is load-bearing. `discardIfOnlyBlock` first, because a file
   * holding nothing but our own block would otherwise stand in the way of the
   * real one for ever: `carryInto` never writes over what the worktree already
   * has. The block last, because it has to end up below whatever was copied,
   * which is the whole reason it wins.
   *
   * The port is read here rather than passed in, so it is whatever the
   * workspace holds at this moment — which is why a run settles the port first
   * and prepares second.
   */
  async function prepare(project: Project, workspace: Workspace): Promise<CarryReport> {
    await discardIfOnlyBlock(workspace.path, project.envFile)

    const report = await carryInto(project.id, project.repoPath, workspace.path, dataRoot)

    await applyEnvOverrides(await readEffectiveEnv(project, workspace, dataRoot), {
      path: workspace.path,
      envFile: project.envFile,
      rootPath: project.repoPath,
      workspaceName: workspace.name,
      port: workspace.port
    })

    return report
  }

  /**
   * Whether the scripts a repository supplies may run.
   *
   * Three ways to yes, and they are different statements. Nothing supplied is
   * nothing to approve. A digest that has been read says *this text* is fine. A
   * project marked trusted says whatever its repository holds is fine — one
   * decision, recorded in settings where it can be seen and undone, rather than
   * a prompt every time a script is edited.
   */
  function allowedToRun(project: Project, digest: string): boolean {
    return digest === '' || project.trustRepoScripts || project.approvedScripts.includes(digest)
  }

  /**
   * The cleanup script to run for a workspace, or null for none.
   *
   * Null covers three different things on purpose, because a removal treats
   * them alike: the project has no cleanup script, the repository supplies one
   * nobody has read, and the repository's settings could not be read at all.
   *
   * That last one is why this exists. `readConductorConfig` throws on
   * unparseable TOML, on a file too large and on a symlinked directory — and a
   * worktree is where an agent works, so half-written and conflict-marked
   * settings are ordinary rather than exotic. Left to throw, one such file made
   * its workspace, and through `removeProjectById` the entire project,
   * impossible to remove: the opposite of what `archive.ts` promises and what
   * the comment at the call site says.
   *
   * Losing the cleanup leaves a database behind. Losing the removal leaves a
   * project that cannot be deleted from the interface at all.
   */
  async function cleanupFor(
    project: Project,
    workspace: Workspace
  ): Promise<ResolvedScript | null> {
    let scripts: Readonly<Partial<Record<ScriptKind, ResolvedScript>>>
    try {
      scripts = await resolveScripts(workspace.path, project.id, dataRoot)
    } catch {
      return null
    }

    const cleanup = scripts.archive
    if (cleanup === undefined) return null

    // The user's own script is never gated; a repository's runs only once
    // somebody has read it.
    const allowed = cleanup.source === 'project' || allowedToRun(project, scriptsDigest(scripts))

    return allowed ? cleanup : null
  }

  async function closeChatsOf(workspaceId: string): Promise<void> {
    // One at a time rather than all at once, so a session that hangs on close
    // is one wait rather than a race between several.
    for (const chat of chatsOfWorkspace(state, workspaceId)) {
      await closeOneChat(chat)
    }
  }

  /**
   * The settings sources this workspace may load.
   *
   * Narrowed to the user's own layer while the repository's capability files
   * are unapproved. octopus loads every source as the CLI does, so a clone's
   * `.claude/settings.json` would otherwise pre-approve tools and declare shell
   * hooks the moment somebody opened it.
   *
   * Fail safe rather than closed: the agent still runs, it just reads nothing
   * of the project's — and because one flag governs both, that includes its
   * `CLAUDE.md`. Loud on purpose, and the chat says so.
   *
   * A worktree that grants nothing digests to the empty string and needs no
   * approval, which is most repositories.
   */
  async function sourcesIn(cwd: string, project: Project): Promise<SettingSourceName[]> {
    const configured = toSdkSettingSources(config.settingSources)

    const digest = trustDigest(await capabilityFiles(cwd))
    if (digest === '' || project.approvedSettings.includes(digest)) return configured

    return configured.filter((source) => source === 'user')
  }

  /**
   * The instruction this workspace would actually send.
   *
   * Three layers, repository first: a worktree carrying
   * `.octopus/instructions/<kind>.md`, or Conductor's `[prompts]`, wins over
   * the project's own copy and the installation's. Not gated the way a script
   * is — this text goes into the log as a visible message, read before it does
   * anything, so a dialog in front of every one would be friction for no gain.
   *
   * Taking the workspace rather than its id is what lets the draft share it:
   * that path has the record in hand already, and it used to call
   * `effectiveInstruction` directly — one layer short, so a repository
   * supplying its own pull-request instruction was obeyed everywhere except in
   * the one place the app writes a description itself.
   */
  async function instructionFor(workspace: Workspace, kind: InstructionKind): Promise<string> {
    const supplied = await repoInstruction(kind, workspace.path)

    return supplied?.body ?? effectiveInstruction(kind, workspace.projectId, dataRoot)
  }

  /** Where a store's files sit; a path, so reading one creates nothing. */
  function storeRoot(store: SkillStore): string {
    return store.kind === 'global'
      ? globalSkillsRoot(dataRoot)
      : projectSkillsRoot(requireProject(store.projectId).id, dataRoot)
  }

  /** The same, given the shape a session reads — only on the way to writing. */
  function writableStore(store: SkillStore): Promise<string> {
    return ensureStore(storeRoot(store))
  }

  function storeSkills(store: SkillStore): Promise<SkillEntry[]> {
    return readSkillsIn(skillsDirOf(storeRoot(store)))
  }

  /**
   * The names already in use in the store *beside* this one.
   *
   * A skill is keyed by its bare name wherever it came from, so a global
   * `review` and a project `review` are one skill to the agent and two rows
   * here — and the switch on either used to move both. Uniqueness was checked
   * inside a single directory, which is the wrong scope for a key this wide.
   *
   * **All three sources**, which is what the scope of the key demands. The
   * checkouts were the missing one: a `SkillStore` names no workspace, so this
   * looked unreachable from here — but the worktrees are in `state`, and which
   * of them share a session with this store is a question this function is the
   * only place able to answer. A global skill meets every project's checkout; a
   * project's meets only its own, which is the whole difference between the two
   * arms below.
   *
   * Read on a write rather than kept: a listing is a `readdir` that never
   * throws, and one taken at startup would be wrong the moment somebody pulled.
   */
  async function namesBesideStore(store: SkillStore): Promise<string[]> {
    const others =
      store.kind === 'global'
        ? state.projects.map((project) => projectSkillsRoot(project.id, dataRoot))
        : [globalSkillsRoot(dataRoot)]

    const worktrees = (
      store.kind === 'global'
        ? state.workspaces
        : state.workspaces.filter((workspace) => workspace.projectId === store.projectId)
    ).map((workspace) => join(workspace.path, '.claude', 'skills'))

    const listings = await Promise.all([
      ...others.map((root) => readSkillsIn(skillsDirOf(root))),
      ...worktrees.map((dir) => readSkillsIn(dir))
    ])

    return listings.flat().map((skill) => skill.name)
  }

  interface SessionSkills {
    /** Extra roots to hand the session, so it finds the stores' skills. */
    readonly roots: string[]
    readonly overrides: Record<string, 'off'>
    readonly listing: SkillListing[]
  }

  /**
   * What this conversation may be offered, and what it is not.
   *
   * Three sources and three layers, and they are not the same three. The
   * sources are the two stores octopus keeps and the checkout's own
   * `.claude/skills`; the layers deciding whether a skill is on are the
   * installation's default list, the project's, and what this conversation was
   * told.
   *
   * All three follow `settingSources`, because all three are discovered the
   * same way — our stores are extra working-directory roots rather than a
   * plugin, and a root's `.claude/skills` is read exactly when the checkout's
   * is. A plugin would have escaped that gate, and was tried: its skills load
   * and then cannot be switched off, which is the whole feature. "Load
   * nothing" therefore means what it says, skills included.
   */
  async function sessionSkills(
    project: Project,
    workspace: Workspace,
    // Narrowed to the one field this reads, so a workspace nobody has spoken
    // to can be answered for as well — before the first message there is no
    // record, and the two default lists are then the whole answer.
    chat: { readonly skillOverrides: Readonly<Record<string, boolean>> },
    settingSources: readonly SettingSourceName[]
  ): Promise<SessionSkills> {
    const globalRoot = globalSkillsRoot(dataRoot)
    const projectRoot = projectSkillsRoot(project.id, dataRoot)

    // A switch over something the session would not load is a control with
    // nothing behind it, so the list is empty rather than inert.
    const loaded = settingSources.includes('project')

    const [ours, theirs, carried] = await Promise.all([
      loaded ? readSkillsIn(skillsDirOf(globalRoot)) : [],
      loaded ? readSkillsIn(skillsDirOf(projectRoot)) : [],
      loaded ? readSkillsIn(join(workspace.path, '.claude', 'skills')) : []
    ])

    const defaults = {
      global: config.disabledSkillDefaults,
      project: project.disabledSkillDefaults
    }

    const row = (scope: SkillScope, skill: SkillEntry): SkillListing => {
      const key = skillKey(skill.name)

      return { ...skill, key, scope, enabled: skillEnabled(key, defaults, chat.skillOverrides) }
    }

    const listing = [
      ...ours.map((skill) => row('global', skill)),
      ...theirs.map((skill) => row('project', skill)),
      ...carried.map((skill) => row('repository', skill))
    ]

    const overrides: Record<string, 'off'> = {}
    for (const item of listing) {
      if (!item.enabled) overrides[item.key] = 'off'
    }

    return {
      /*
       * Both, whether or not either holds anything today.
       *
       * An empty store used to be left unmentioned — a root widens what the
       * session may reach, and one handed over for an empty directory looked
       * like a cost with nothing bought. It buys the ability to fill it. The
       * roots are passed **once**, at session start, and `reloadSkills` only
       * re-scans the directories the session already knows about, so a store
       * that was empty then stayed invisible for the life of the conversation
       * — every skill later written into it, not merely the first. That is the
       * state of every fresh install, and the panel listed the new skill as
       * available the whole time because it re-reads disk on every call.
       *
       * The `loaded` gate stays, and it is the one case where the old
       * reasoning still holds: with no project layer in `settingSources` the
       * SDK reads no `.claude/skills` under any root, so a root there really
       * would buy nothing.
       */
      roots: loaded ? [globalRoot, projectRoot] : [],
      overrides,
      listing
    }
  }

  /**
   * Tells every running conversation to look at the skill directories again.
   *
   * Best effort and never awaited into a failure: this follows a write that
   * has already succeeded, and a session that will not answer is a stale
   * listing rather than a lost skill.
   */
  async function refreshRunningSkills(): Promise<void> {
    await Promise.all(
      [...sessions.values()].map((session) => session.refreshSkills().catch(() => undefined))
    )
  }

  async function sourcesFor(workspace: Workspace): Promise<SettingSourceName[]> {
    // `requireProject`, not a lookup with a fallback: a workspace whose project
    // is gone is a broken state, and quietly handing it the full set of sources
    // is the one answer it must not get.
    return sourcesIn(workspace.path, requireProject(workspace.projectId))
  }

  /**
   * A session of the app's own, for asking the account a question.
   *
   * Not `startFor`, and that is the whole of the difference. `startFor` makes a
   * session **the conversation's**: it registers it in `sessions` under the
   * chat's id, wires the ordinary event handler, resumes the chat's session id
   * and fires the commands and models reads against that record. A background
   * gauge borrowing all of that had three consequences, and none of them was
   * visible from the button that caused it.
   *
   * A message sent while the probe was out was handed to the probe —
   * `sendToChat` takes whatever is in the map — and the probe's `finally` then
   * closed the process answering it. The turn vanished: the message in the log,
   * the tab busy, and no result ever coming. If that message was `/clear`, the
   * chat stayed in `clearRequests` with nothing left to consume it, and the
   * next reset the CLI sent — the one that follows an approved plan — was read
   * as the user's clear and took the transcript with it.
   *
   * And a probe that could not spawn became an `error` event in whichever chat
   * was created last, in any project, turning its row red every three minutes
   * with a message naming the agent binary rather than the missing worktree.
   *
   * So: nothing in the map, nothing to adopt it, and the close is
   * unconditional again. A sink that drops every event rather than a filter,
   * because `handleEvent` is what writes the transcript, the status and the
   * session id. No settings sources and no skills — a usage figure is an
   * account's, not a repository's, and it is worth saying that a repository's
   * hooks therefore do not run for a gauge. Nothing to permit, so permission
   * is refused rather than asked about.
   */
  function startProbe(workspace: Workspace): AgentSession {
    return startSession(
      {
        cwd: workspace.path,
        resume: null,
        settingSources: [],
        permissionMode: 'default',
        model: null,
        effort: DEFAULT_EFFORT,
        allowedTools: [],
        additionalDirectories: [],
        skillOverrides: {}
      },
      {
        query: runQuery,
        onEvent: () => undefined,
        askPermission: () => Promise.resolve({ allow: false, message: DENIED })
      }
    )
  }

  async function startFor(
    chat: Chat,
    workspace: Workspace,
    settingSources: readonly SettingSourceName[]
  ): Promise<AgentSession> {
    const skills = await sessionSkills(
      requireProject(workspace.projectId),
      workspace,
      chat,
      settingSources
    )

    // Before the roots are handed over, because `--add-dir` on a directory that
    // is not there is at best untested — and until the first skill is written
    // neither of ours exists. A write, so it lives here rather than in
    // `sessionSkills`, which is also the read path behind the skills panel.
    await Promise.all(skills.roots.map((root) => ensureStore(root)))

    const session = startSession(
      {
        cwd: workspace.path,
        resume: chat.sessionId,
        settingSources,
        permissionMode: sessionMode(chat),
        model: sessionModel(chat),
        effort: effortInForce(chat),
        // The read-only set, and nothing else. A name here is approved by the
        // SDK before `canUseTool` is consulted, which is what that set wants
        // and exactly what the user's own answers must not have: one handed
        // over at the start of a session cannot be taken back until the session
        // ends, so unticking it in Settings changed nothing the agent was
        // already doing. `askPermission` consults `alwaysAllowedTools` itself,
        // on every call, against the config as it stands at that moment.
        allowedTools: [...READ_ONLY_TOOLS],
        additionalDirectories: skills.roots,
        skillOverrides: skills.overrides
      },
      {
        query: runQuery,
        onEvent: (event) => {
          // Re-read rather than closed over: `chat` is a snapshot, and the
          // session id written after the first turn would not be in it.
          handleEvent(findChat(state, chat.id) ?? chat, event)
        },
        askPermission: (ask) => askPermission(chat, ask)
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

  /** The same list with one key renamed, or the list itself when it has none. */
  function renamedIn(keys: readonly string[], from: string, to: string): string[] {
    return keys.map((key) => (key === from ? to : key))
  }

  /**
   * The same overrides with one key renamed.
   *
   * Rebuilt rather than patched, because deleting a key from a record and
   * adding another is two writes over a value `commit` takes whole — and the
   * order of the rest is what the panel draws.
   */
  function renamedOverride(
    overrides: Readonly<Record<string, boolean>>,
    from: string,
    to: string
  ): Record<string, boolean> {
    return Object.fromEntries(
      Object.entries(overrides).map(([key, on]) => [key === from ? to : key, on])
    )
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

      /*
       * A new checkout is asked about before it is recorded.
       *
       * `updateProject` refuses what it can see from the state alone — a
       * relative path, another project's, a project that still has workspaces.
       * Whether the directory is a repository at all it cannot know, and the
       * **stored base branch** may simply not exist in the new one, which would
       * otherwise surface as a git error on the next workspace saying nothing
       * about settings.
       */
      let applied = patch
      if (patch.repoPath !== undefined) {
        const info = await inspectRepository(patch.repoPath, makeExec)
        await assertBranchExists(makeExec(info.root), patch.baseBranch ?? project.baseBranch)

        // The repository's root, not the directory that was picked — the same
        // answer `addProjectFromPath` records, so choosing a subdirectory means
        // the same thing whichever way a project arrives at a checkout.
        applied = { ...patch, repoPath: info.root }
      }

      // Checked before the write, so a branch deleted since the dialog opened
      // is reported here rather than as a worktree failure days later.
      if (patch.baseBranch !== undefined && patch.repoPath === undefined) {
        await assertBranchExists(makeExec(project.repoPath), patch.baseBranch)
      }

      const wasEnvFile = project.envFile

      await commit((current) => updateProject(current, projectId, applied))

      /*
       * The block in the file the project used to name.
       *
       * Nothing else would ever revisit it: `applyEnvOverrides` only touches
       * the file named now, so every existing workspace kept a second, live
       * block — credentials and a `$OCTOPUS_PORT` frozen at the moment of the
       * switch — in a file its stack very likely still reads.
       *
       * After the commit, so a rejected patch leaves the old file alone.
       */
      const envFile = findProject(state, projectId)?.envFile
      if (envFile !== undefined && envFile !== wasEnvFile) {
        for (const workspace of workspacesOfProject(state, projectId)) {
          await removeEnvBlock(workspace.path, wasEnvFile)
        }
      }
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

      return {
        setup: await resolve('setup'),
        run: await resolve('run'),
        archive: await resolve('archive')
      }
    },

    async readProjectCarryList(projectId) {
      requireProject(projectId)
      return readCarryList(projectId, dataRoot)
    },

    async saveProjectCarryList(projectId, contents) {
      requireProject(projectId)
      await writeCarryList(projectId, contents, dataRoot)
    },

    async declaredCarryFiles(projectId) {
      const project = requireProject(projectId)

      /* Unreadable settings answer `null` rather than throwing, as `cleanupFor`
         does and for the same reason: this is a courtesy beside a list that
         works without it, and a half-written TOML in a checkout should not take
         a settings screen down with it. */
      let conductor: ConductorConfig | null
      try {
        conductor = await readConductorConfig(project.repoPath)
      } catch {
        return null
      }

      if (conductor === null || conductor.files.length === 0) return null

      // Compared against the list's own reading of itself rather than against
      // its raw text: the left side of `a = b` is the path, and a declaration
      // matching that is already carried however the line was written.
      const carried = new Set(
        carriedFiles(await readCarryList(projectId, dataRoot)).map((file) => file.path)
      )

      return {
        path: conductor.filesPath,
        files: conductor.files.map((file) => ({ ...file, carried: carried.has(file.glob) }))
      }
    },

    async listEnvProfiles(projectId) {
      const project = requireProject(projectId)
      const profiles = await listProfiles(projectId, dataRoot)

      // Unioned rather than listed raw: a project that has never written a
      // variable still names the set it would write into.
      return {
        profiles: profiles.includes(project.envProfile)
          ? profiles
          : [...profiles, project.envProfile].sort(),
        projectDefault: project.envProfile
      }
    },

    async readEnvProfile(projectId, name) {
      requireProject(projectId)
      return readProfile(projectId, name, dataRoot)
    },

    async saveEnvProfile(projectId, name, contents) {
      requireProject(projectId)
      await writeProfile(projectId, name, contents, dataRoot)
    },

    async createEnvProfile(projectId, name, from) {
      requireProject(projectId)
      await createProfile(projectId, name, from, dataRoot)
    },

    async renameEnvProfile(projectId, from, to) {
      const project = requireProject(projectId)
      await renameProfile(projectId, from, to, dataRoot)

      // The references follow the file, in one commit: a rename that left the
      // project pointing at the old name would silently give every workspace
      // nothing at all.
      await commit((current) => ({
        ...current,
        projects: current.projects.map((other) =>
          other.id === project.id && other.envProfile === from
            ? { ...other, envProfile: to }
            : other
        ),
        workspaces: current.workspaces.map((workspace) =>
          workspace.projectId === project.id && workspace.envProfile === from
            ? { ...workspace, envProfile: to }
            : workspace
        )
      }))
    },

    async removeEnvProfile(projectId, name) {
      const project = requireProject(projectId)
      await removeProfile(projectId, name, dataRoot)

      /*
       * Every reference moves in the same commit, so `state.json` never holds
       * one to a set that is not there. A workspace goes back to following the
       * project; the project falls back to whatever is left, or to the name a
       * new project starts with when nothing is.
       */
      const remaining = await listProfiles(projectId, dataRoot)
      const fallback = remaining[0] ?? DEFAULT_PROFILE

      await commit((current) => ({
        ...current,
        projects: current.projects.map((other) =>
          other.id === project.id && other.envProfile === name
            ? { ...other, envProfile: fallback }
            : other
        ),
        workspaces: current.workspaces.map((workspace) =>
          workspace.projectId === project.id && workspace.envProfile === name
            ? { ...workspace, envProfile: null }
            : workspace
        )
      }))
    },

    async setWorkspaceEnvProfile(workspaceId, name) {
      const workspace = requireWorkspace(workspaceId)
      await commit((current) => updateWorkspace(current, workspace.id, { envProfile: name }))
    },

    /**
     * What this project's repository carries, beside what the app holds.
     *
     * Read on demand rather than watched: `.octopus/` is a snapshot, and
     * nothing here is consulted while the app works.
     */
    async projectRepoConfig(projectId) {
      const project = requireProject(projectId)
      const carried = await readRepoConfig(project.repoPath)
      const byId = new Map(carried.map((item) => [item.id, item.contents]))

      const items: RepoConfigItem[] = []
      for (const id of REPO_ITEM_IDS) {
        const compared = compareRepoItem(id, byId.get(id) ?? null, await localItem(project, id))
        if (compared) items.push(compared)
      }

      return {
        present: carried.length > 0,
        // Asked of the checkout, which shares its `.gitignore` with every
        // worktree made from it — and asked at all because an ignored folder
        // makes exporting into it a change nobody will ever receive.
        ignored: await isIgnored(makeExec(project.repoPath), REPO_README_FILE),
        items
      }
    },

    /**
     * Takes named items out of the repository and into this installation.
     *
     * Everything lands through the same writers a hand-edit uses, so an
     * imported script is executable and an imported instruction sits where the
     * editor reads it. Nothing is executed: the repository's copy is data until
     * somebody presses Run on the copy that has just been written.
     */
    async importRepoConfig(projectId, ids) {
      const project = requireProject(projectId)
      const wanted = new Set(ids)
      const applied: RepoItemId[] = []

      for (const item of await readRepoConfig(project.repoPath)) {
        if (!wanted.has(item.id)) continue

        const script = scriptKindOf(item.id)
        if (script !== undefined) {
          await writeScript(script, projectId, item.contents, dataRoot)
          applied.push(item.id)
          continue
        }

        const instruction = instructionKindOf(item.id)
        if (instruction !== undefined) {
          await writeInstruction(instruction, projectId, item.contents, dataRoot)
          applied.push(item.id)
          continue
        }

        if (item.id === 'carry') {
          await writeCarryList(projectId, item.contents, dataRoot)
          applied.push(item.id)
          continue
        }

        await applyRepoProject(project, parseRepoProject(item.contents))
        applied.push(item.id)
      }

      return applied
    },

    /**
     * Writes named items from this installation into the repository.
     *
     * The one place the app writes inside a checkout, which is why it goes
     * through `repoConfig.ts` rather than building paths here. An item nobody
     * has written is skipped rather than exported as its template: a file
     * committed to say nothing is a file somebody has to read.
     */
    async exportRepoConfig(projectId, ids) {
      const project = requireProject(projectId)
      const wanted = new Set(ids)

      const items: RepoItem[] = []
      for (const id of REPO_ITEM_IDS) {
        if (!wanted.has(id)) continue

        const contents = await localItem(project, id)
        if (contents !== null) items.push({ id, path: repoItemFile(id), contents })
      }

      await writeRepoConfig(project.repoPath, items)
      return items.map((item) => item.id)
    },

    async projectInstructionSources(projectId, workspaceId) {
      const project = requireProject(projectId)
      /*
       * The same function the session start uses, over the same directory.
       *
       * Two of them was the defect: the panel narrowed by the setting alone,
       * while the session narrows by the setting **and** the trust gate — so an
       * unapproved repository was reported as read while the agent was reading
       * none of it. Wrong about a security state, in the direction that
       * reassures.
       *
       * A workspace when there is one, because trust is a fact about the
       * worktree a session runs in; the checkout otherwise, which is the best
       * answer available before one is open.
       */
      const workspace = workspaceId === null ? null : requireWorkspace(workspaceId)
      const cwd = workspace?.path ?? project.repoPath

      return instructionSources(
        cwd,
        await sourcesIn(cwd, project),
        /*
         * Null once a workspace is open, and that is not a shortcut: `cwd` is
         * then the directory the session is started in, so a gitignored file
         * sitting there is read whether or not the carry list put it there.
         * A workspace terminal answering "always allow" writes that file, and
         * the panel used to go on reporting it unread — a claim about a
         * security state, wrong in the reassuring direction.
         *
         * Before a workspace is open there is only the checkout to look at,
         * and there the carry list is the whole of the evidence: the
         * destinations alone, since this asks what the worktree ends up
         * holding rather than where any of it was read from.
         */
        workspace === null
          ? carriedFiles(await readCarryList(project.id, dataRoot)).map((file) => file.path)
          : null
      )
    },

    async workspaceTrust(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)
      const files = await capabilityFiles(workspace.path)
      const digest = trustDigest(files)

      // Nothing to grant is nothing to approve, which is most repositories.
      return { approved: digest === '' || project.approvedSettings.includes(digest), files }
    },

    async workspaceScripts(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)
      const scripts = await resolveScripts(workspace.path, project.id, dataRoot)
      const digest = scriptsDigest(scripts)

      // Nothing supplied by the repository is nothing to approve, which is
      // every project configured the way they all used to be.
      return { approved: allowedToRun(project, digest), scripts }
    },

    async projectScripts(projectId, workspaceId) {
      const project = requireProject(projectId)
      /*
       * The worktree when there is one, exactly as `projectInstructionSources`
       * does, and for the same reason: a run happens in a worktree and a branch
       * may carry a script the checkout has not got.
       *
       * Asked of the checkout alone, the dialog described one set of scripts
       * while the workspace beside it ran another. Seen in the real app —
       * planner's checkout sat on `main` with a `.conductor/` while every
       * worktree was cut from `develop` and carried an `.octopus/` — and the
       * section even marked the project's own editors read-only against scripts
       * that were not going to run.
       *
       * The checkout otherwise, which is the best answer available before a
       * workspace is open.
       */
      const workspace = workspaceId === null ? null : requireWorkspace(workspaceId)
      const scripts = await resolveScripts(
        workspace?.path ?? project.repoPath,
        project.id,
        dataRoot
      )

      return { approved: allowedToRun(project, scriptsDigest(scripts)), scripts }
    },

    async approveWorkspaceScripts(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)
      const digest = scriptsDigest(await resolveScripts(workspace.path, project.id, dataRoot))
      if (digest === '') return

      await commit((current) =>
        updateProject(current, project.id, {
          approvedScripts: withApproval(project.approvedScripts, digest)
        })
      )
    },

    async approveWorkspaceSettings(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)
      const digest = trustDigest(await capabilityFiles(workspace.path))
      if (digest === '') return

      await commit((current) =>
        updateProject(current, project.id, {
          approvedSettings: withApproval(project.approvedSettings, digest)
        })
      )
    },

    async isProjectEnvIgnored(projectId) {
      const project = requireProject(projectId)
      return isIgnored(makeExec(project.repoPath), project.envFile)
    },

    async readWorkspaceEnv(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      return readWorkspaceEnv(workspace.path, project.envFile)
    },

    async prepareWorkspace(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      return prepare(requireProject(workspace.projectId), workspace)
    },

    async isWorkspaceServing(workspaceId) {
      return isListening(requireWorkspace(workspaceId).port)
    },

    async ensureWorkspacePort(workspaceId) {
      return settlingOneAtATime(async () => {
        // Read inside the chain, not outside it: the whole point is that this
        // sees what the settlement before it committed.
        const workspace = requireWorkspace(workspaceId)

        const free = await settlePort(
          workspace.port,
          state.workspaces.flatMap((other) => (other.id === workspaceId ? [] : [other.port]))
        )
        if (free === workspace.port) return free

        await commit((current) => ({
          ...current,
          workspaces: current.workspaces.map((other) =>
            other.id === workspaceId ? { ...other, port: free } : other
          )
        }))

        return free
      })
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
      return instructionFor(requireWorkspace(workspaceId), kind)
    },

    // Both `async` although neither awaits anything of its own: `storeRoot`
    // throws for a project that is gone, and a method returning a promise must
    // reject rather than throw out of the call — the renderer awaits it.
    async listSkills(store) {
      return storeSkills(store)
    },

    async listRepositorySkills(workspaceId) {
      return readSkillsIn(join(requireWorkspace(workspaceId).path, '.claude', 'skills'))
    },

    async readStoredSkill(store, folder) {
      return readSkill(skillsDirOf(storeRoot(store)), folder)
    },

    async saveStoredSkill(store, folder, save) {
      const dir = await writableStore(store)
      const elsewhere = await namesBesideStore(store)
      const written =
        save.kind === 'form'
          ? await writeSkill(dir, folder, save.content, elsewhere)
          : await writeRawSkill(dir, folder, save.text, elsewhere)

      await refreshRunningSkills()

      return written
    },

    async removeStoredSkill(store, folder) {
      await removeSkill(skillsDirOf(storeRoot(store)), folder)
      await refreshRunningSkills()
    },

    async renameStoredSkill(store, folder, to) {
      const dir = await writableStore(store)
      const renamed = await renameSkill(dir, folder, to, await namesBesideStore(store))

      /*
       * The key moves with the directory, everywhere it is stored, or the
       * rename only looks like it worked: `skillEnabled` reads a key no list
       * mentions as **on**, so a skill somebody had switched off would come
       * back on under its new name, in every conversation at once.
       *
       * Three homes, and they are not one write. The installation's list is in
       * the config file; the project lists and every chat's overrides are in
       * `state.json`, which `commit` writes whole. The config goes first so
       * that a failure leaves the narrower answers stale rather than the
       * broadest one.
       */
      const from = skillKey(folder)
      const key = skillKey(to)

      if (config.disabledSkillDefaults.includes(from)) {
        await applyConfig({
          disabledSkillDefaults: renamedIn(config.disabledSkillDefaults, from, key)
        })
      }

      await commit((current) => ({
        ...current,
        projects: current.projects.map((project) => ({
          ...project,
          disabledSkillDefaults: renamedIn(project.disabledSkillDefaults, from, key)
        })),
        chats: current.chats.map((chat) => ({
          ...chat,
          skillOverrides: renamedOverride(chat.skillOverrides, from, key)
        }))
      }))

      await refreshRunningSkills()

      return renamed
    },

    async importStoredSkill(store, request) {
      const dir = await writableStore(store)
      const elsewhere = await namesBesideStore(store)
      const imported =
        request.kind === 'path'
          ? await importFromPath(dir, request.path, elsewhere)
          : request.kind === 'text'
            ? await importFromText(dir, request.text, elsewhere)
            : await importFromUrl(dir, request.url, download, elsewhere)

      await refreshRunningSkills()

      return imported
    },

    async inspectSkillImport(store, request) {
      // The store's own directory, read rather than made: a preview must not
      // create the folder for a skill nobody has agreed to yet.
      return inspectImport(
        skillsDirOf(storeRoot(store)),
        request,
        download,
        await namesBesideStore(store)
      )
    },

    async skillsForChat(chatId) {
      const chat = requireChat(chatId)
      const workspace = requireWorkspace(chat.workspaceId)

      const { listing } = await sessionSkills(
        requireProject(workspace.projectId),
        workspace,
        chat,
        await sourcesFor(workspace)
      )

      return listing
    },

    async skillsForWorkspace(workspaceId) {
      const workspace = requireWorkspace(workspaceId)

      const { listing } = await sessionSkills(
        requireProject(workspace.projectId),
        workspace,
        { skillOverrides: {} },
        await sourcesFor(workspace)
      )

      return listing
    },

    async setChatSkill(chatId, key, enabled) {
      const chat = requireChat(chatId)
      const workspace = requireWorkspace(chat.workspaceId)
      const skillOverrides = { ...chat.skillOverrides, [key]: enabled }

      await commit((current) => updateChat(current, chatId, { skillOverrides }))

      // A running conversation is told at once rather than on its next start.
      // A switch whose effect waits for a restart is a switch that looks
      // broken, and the flag layer takes this the way it takes the effort.
      const session = sessions.get(chatId)
      if (session) {
        const { overrides } = await sessionSkills(
          requireProject(workspace.projectId),
          workspace,
          { ...chat, skillOverrides },
          await sourcesFor(workspace)
        )

        await session.setSkills(overrides)
      }
    },

    async removeProjectById(projectId) {
      const project = findProject(state, projectId)
      const closing: Chat[] = []

      // The records go either way, so the directories and branches have to go
      // with them: left behind they are invisible to the app but still occupy
      // names, and adding the project back would collide with its own debris.
      if (project) {
        const repository = makeExec(project.repoPath)

        for (const workspace of workspacesOfProject(state, projectId)) {
          // Read before the closing below, which leaves the records in place
          // but is the last moment the chats are reachable from the state that
          // is about to be rewritten.
          closing.push(...chatsOfWorkspace(state, workspace.id))

          // The same closing `removeWorkspaceById` does, and for the same
          // reason: a session outliving its worktree holds a child process
          // pointed at a directory that no longer exists, and nothing in the
          // interface can reach it again — only quitting the application ends
          // it. Left out here, removing a project leaked every agent in it.
          await closeChatsOf(workspace.id)

          /*
           * And the cleanup script, in the same order and for the same reason
           * `removeWorkspaceById` runs it: in the worktree while it still
           * exists. Left out here, removing a project abandoned every database
           * its workspaces had been given — the accumulation the script exists
           * to prevent, at the one moment there is most of it to clean up.
           */
          await runArchiveScript(await cleanupFor(project, workspace), {
            rootPath: project.repoPath,
            workspaceName: workspace.name,
            path: workspace.path,
            port: workspace.port,
            defaultBranch: shortBranchName(project.baseBranch)
          })

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
      await discardHistories(closing)

      /*
       * After the commit, and swallowing its own failure.
       *
       * The other order leaves a live project whose scripts have been deleted,
       * which is worse than a directory nothing points at. Run unconditionally,
       * outside the guard above: a record already gone while its directory
       * survives is exactly the case worth cleaning.
       */
      await removeProjectData(projectId, dataRoot).catch(() => undefined)
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
      const counts = await countChanges(stored, await baseRefOf(project), makeExec)

      return reconcile(stored, worktrees, counts, state.chats)
    },

    async createWorkspaceIn(projectId) {
      const project = requireProject(projectId)
      const exec = makeExec(project.repoPath)

      const workspace = await createWorkspace(project, state, exec, {
        root: dataRoot,
        fetchExec: makeExec(project.repoPath, FETCH_OPTIONS)
      })

      try {
        // Inside the rollback, not after it: a worktree missing the files it
        // cannot run without is a workspace that will fail its first build, and
        // undoing it says so at the one moment somebody is watching.
        await prepare(project, workspace)
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

      const renamed = await renameWorkspace(
        workspace,
        project,
        name,
        makeExec(project.repoPath),
        // The siblings, for the collision a branch cannot catch: two names can
        // differ as branches and still name one database.
        workspacesOfProject(state, workspace.projectId)
      )
      await commit((current) => updateWorkspace(current, workspaceId, renamed))
    },

    async removeWorkspaceById(workspaceId, options) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Resolved once and used twice below: the two answers have to be about
      // the same ref, or a branch reads as unmerged against one and merged
      // against the other.
      const baseRef = await baseRefOf(project)

      const execs = {
        repository: makeExec(project.repoPath),
        workspace: makeExec(workspace.path)
      }
      const removal = {
        ...options,
        // The base branch travels with the request so "is this merged" can be
        // answered before the worktree is destroyed rather than after.
        baseBranch: baseRef,
        /*
         * What git cannot see.
         *
         * A squash or a rebase merge rewrites the commits, so none of them is
         * an ancestor of the base afterwards and git reports the branch as
         * unmerged — including when it was this app's own merge button that
         * landed it. GitHub knows better, and is asked only after git has
         * said no.
         *
         * A failure here is not a failure to remove: gh may be missing or
         * signed out, and then the git answer is the only one there is.
         */
        mergedRemotely: async (): Promise<boolean> => {
          try {
            const view = await readPullRequest(
              workspace.branch,
              baseRef,
              makeGh(workspace.path),
              makeExec(workspace.path)
            )
            return view.request?.state === 'merged'
          } catch {
            return false
          }
        }
      }

      /*
       * Everything below this line destroys something, so the refusal comes
       * first.
       *
       * The pane pre-ticks the delete-branch box and only forces when the
       * worktree is dirty, so a clean workspace whose commits are not merged
       * refuses on the ordinary path rather than a rare one. Asked afterwards,
       * the answer arrived with the conversations already deleted and the
       * cleanup script already run, against a workspace that then went on
       * living — which is the opposite of what docs/core.md promises about an
       * operation that fails.
       */
      await ensureRemovable(workspace, execs, removal)

      // Captured before the chats are closed, because the records go with the
      // workspace at the commit below and the transcripts are discarded after
      // it — by which point there is nothing left to read the ids off.
      const closing = chatsOfWorkspace(state, workspaceId)

      // Before the worktree goes: the session's working directory is about to
      // stop existing, and a live agent would keep a child process pointed at
      // a path that is no longer there.
      await closeChatsOf(workspaceId)

      // Also before it goes, and for the same reason — the script runs in the
      // worktree. Whatever it says, the removal continues: a workspace that
      // cannot be deleted because a cleanup script is broken is the worse
      // problem of the two.
      /*
       * A repository's script that nobody has read is skipped, not run.
       *
       * Everywhere else an unapproved script refuses the run and says so. Here
       * it cannot: nothing may stop a workspace being removed, and a dialog in
       * the middle of a deletion is a dialog nobody can answer usefully. So the
       * cleanup is simply not performed — which leaves a database behind, and
       * is the lesser of the two: the alternative is executing shell that
       * arrived with a `git pull` at the one moment the user is not looking.
       */
      await runArchiveScript(await cleanupFor(project, workspace), {
        rootPath: project.repoPath,
        workspaceName: workspace.name,
        path: workspace.path,
        port: workspace.port,
        defaultBranch: shortBranchName(project.baseBranch)
      })

      /*
       * The one window this ordering cannot close, recorded rather than left
       * to be rediscovered: the script has run, and `discardWorkspace` below
       * can still fail on a worktree git will not let go of. The workspace
       * then lives on without whatever the cleanup took back.
       *
       * It is irreducible. The script runs *in* the worktree, so it cannot be
       * moved after the removal, and git offers no way to ask whether a
       * worktree would come away without trying it. What the ordering does buy
       * is that the refusals cannot land here: everything reachable by asking
       * has been asked above.
       */

      await discardWorkspace(workspace, execs, removal)

      await commit((current) => removeWorkspaceRecord(current, workspaceId))
      await discardHistories(closing)
    },

    async workspaceHasChanges(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      return (await changeCount(workspace, makeExec)) > 0
    },

    async readWorkspaceChanges(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Run from the worktree, not the repository: the base branch is a fact
      // about the project, but everything else — the working tree, the index,
      // the untracked files — is a fact about this workspace's own directory.
      return readWorkspaceDiff(makeExec(workspace.path), {
        baseBranch: await baseRefOf(project),
        root: workspace.path
      })
    },

    async revertWorkspaceFile(workspaceId, path, oldPath = null) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Run from the worktree for the same reason the diff read is: the base
      // branch belongs to the project, everything being written belongs here.
      return revertFile(makeExec(workspace.path), {
        baseBranch: await baseRefOf(project),
        root: workspace.path,
        path,
        oldPath
      })
    },

    async readPullRequest(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      // Both run from the worktree: `gh` finds the repository from the
      // directory it is in, and the branch's own state is a fact about there.
      return readPullRequest(
        workspace.branch,
        await baseRefOf(project),
        makeGh(workspace.path),
        makeExec(workspace.path)
      )
    },

    async createPullRequest(workspaceId, request) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      return createPullRequest(
        { ...request, branch: workspace.branch, base: await baseRefOf(project) },
        makeGh(workspace.path),
        makeExec(workspace.path)
      )
    },

    async draftPullRequest(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      const [diff, changed, instruction, commitInstruction] = await Promise.all([
        readWorkspaceDiff(makeExec(workspace.path), {
          baseBranch: await baseRefOf(project),
          root: workspace.path
        }),
        changeCount(workspace, makeExec),
        // The same chain the pane reads and the prepared prompts send. These
        // two called `effectiveInstruction` directly and so skipped the
        // repository's own — the one layer that is a fact about the branch in
        // front of you rather than a setting.
        instructionFor(workspace, 'pullRequest'),
        instructionFor(workspace, 'commitMessage')
      ])

      return draftPullRequest(
        {
          cwd: workspace.path,
          instruction,
          // Null is what tells the draft not to ask for a commit message: with
          // a clean worktree the request carries what is already committed, and
          // there is nothing for one to describe.
          commitInstruction: changed > 0 ? commitInstruction : null,
          diff,
          branch: workspace.branch,
          // The model a chat would start on. A description is the agent's
          // ordinary work, and there is no reason it should be answered by a
          // different model than the one that did the work being described.
          model: config.model
        },
        runQuery
      )
    },

    commitAndPushWorkspace(workspaceId, message) {
      const workspace = requireWorkspace(workspaceId)
      return commitAndPush(message, workspace.branch, makeExec(workspace.path))
    },

    readPullRequestDetail(workspaceId, number) {
      const workspace = requireWorkspace(workspaceId)
      return readPullRequestDetail(number, makeGh(workspace.path))
    },

    mergePullRequest(workspaceId, number, method) {
      const workspace = requireWorkspace(workspaceId)
      return mergePullRequest(number, method, workspace.branch, makeGh(workspace.path))
    },

    closePullRequest(workspaceId, number) {
      const workspace = requireWorkspace(workspaceId)
      return closePullRequest(number, workspace.branch, makeGh(workspace.path))
    },

    /* No branch check on either of these, unlike merge and close. Those take a
       number, which `gh` resolves against the repository — so a stale one names
       whatever request now holds it. A thread id names one thread and nothing
       else, whichever workspace it is sent from. */
    replyToReviewThread(workspaceId, threadId, body) {
      const workspace = requireWorkspace(workspaceId)
      return replyToReviewThread(threadId, body, makeGh(workspace.path))
    },

    setReviewThreadResolved(workspaceId, threadId, resolved) {
      const workspace = requireWorkspace(workspaceId)
      return setReviewThreadResolved(threadId, resolved, makeGh(workspace.path))
    },

    readBranchRequests(projectId) {
      const project = requireProject(projectId)

      // From the checkout rather than from a worktree: this is a question about
      // the repository, and a project can be open with no workspace in it.
      return readBranchRequests(makeGh(project.repoPath))
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

      // Through `commitChats`, so the window that did not open it hears about
      // the one that did. The call that loses the race writes nothing, and the
      // membership reading is what tells the two apart without a second branch
      // here saying which happened.
      await commitChats(workspaceId, (current) => {
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
      // Through `commitChats` rather than a plain commit: the name is what the
      // strip draws, so a second window on this workspace has to hear about it.
      // The workspace's status cannot move on a rename, so nothing else fires.
      await commitChats(requireChat(chatId).workspaceId, (current) =>
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
      await discardHistories([chat])
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
        await running.setEffort(effortInForce(chat))
      }

      const session = running ?? (await startFor(chat, workspace, await sourcesFor(workspace)))

      /*
       * `/usage` is answered here, and the message is not sent on.
       *
       * The one command octopus takes off the agent rather than merely noticing
       * — `/clear` still goes, because only the CLI can do what it asks. This
       * one the CLI would answer in prose, while the same figures are available
       * structured from the session's own control channel, so forwarding it as
       * well would print the paragraph underneath the card.
       *
       * A session is started for it if none was running, unlike `sessionUsage`,
       * which refuses to. The difference is who asked: that fills a gauge
       * nobody requested, this answers a command somebody typed.
       *
       * The status deliberately stays as it was. Nothing went to the agent, so
       * no `result` is coming to put it back, and a conversation left saying
       * "running" for the rest of its life is a worse answer than the prose.
       */
      if (isUsageCommand(text, chat.knownCommands)) {
        const report = await session.usageReport()
        handleEvent(chat, { type: 'usage', report })

        // The card and the sidebar draw the same windows out of the same
        // answer. Reading them and letting them go would leave the block stale
        // beside a card that had just drawn them fresh.
        if (report?.limitsApply) await keepWindows(windowsFrom(report, now()))
        return
      }

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
      const before = effortInForce(requireChat(chatId))
      await commit((current) => updateChat(current, chatId, { effort }))
      // Through the same guard as the two toggles: while planning is on and a
      // plan effort is set, changing the working one moves nothing that is
      // running, and pushing it would drop the session to the wrong level
      // mid-plan.
      await pushEffort(chatId, before)
    },

    async setChatPlanEffort(chatId, effort) {
      const before = effortInForce(requireChat(chatId))
      await commit((current) => updateChat(current, chatId, { planEffort: effort }))
      await pushEffort(chatId, before)
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

        /*
         * `running`, not `idle`: a refusal does not end the turn. `agent.ts`
         * returns the SDK's deny without its `interrupt` flag on purpose, so
         * the refusal reaches the model as a tool result and the same turn
         * carries on — which is what makes deny-with-feedback the app's
         * steering mechanism, and what the plan dialog's "keep planning" is.
         * Written `idle`, the workspace went grey for the whole remainder of
         * every steered turn, and nothing put it back: no agent event writes
         * `running`.
         *
         * Leaving it unwritten is worse, not better — the chat would stay
         * `waiting_permission`, which `workspaceStatusFrom` ranks above
         * `running`, so the sidebar would show the amber "come and answer this"
         * mark against a question nobody can answer any more.
         *
         * Self-correcting: the turn always ends in a `result`, which writes
         * `idle` or `error`, and `settleStatuses` clears a `running` a crash
         * left behind.
         */
        await setChatStatus(request.chatId, 'running')
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
        const beforeEffort = effortInForce(requireChat(request.chatId))
        await commit((current) => updateChat(current, request.chatId, { planMode: false }))

        // The model leaves planning with the record. Before the reply, never
        // after it: the reply is what releases the tool call, so a model sent
        // behind it would reach a session already editing files on the model
        // that wrote the plan. The reply carries a mode and has no field for a
        // model, so this is the closest to riding along that there is.
        await pushModel(request.chatId, before)
        // Effort leaves planning with the model, and for the same reason: the
        // reply is what releases the tool call, so anything sent after it
        // reaches a session already editing files at the level the plan wanted.
        await pushEffort(request.chatId, beforeEffort)
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

    /**
     * What the account last reported, with no conversation in the question.
     *
     * The sidebar draws this and has no chat to ask about — the figures belong
     * to the account, and `sessionUsage` only takes a chat id because it
     * answers about a context window at the same time.
     */
    getUsageWindows() {
      return usageWindows
    },

    refreshSubscriptionUsage() {
      return askAccount()
    },

    async sessionUsage(chatId) {
      requireChat(chatId)

      const session = sessions.get(chatId)
      // Deliberately not started. Spawning an agent to fill a gauge would also
      // create a record for a workspace nobody has spoken to, which is the very
      // thing `openChat`'s laziness exists to avoid.
      if (!session) return { context: null }

      return { context: await session.contextUsage() }
    },

    onAgentEvent(handler) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },

    onWorkspaceStatus(handler) {
      statusListeners.add(handler)
      return () => statusListeners.delete(handler)
    },

    onUsageWindows(handler) {
      usageListeners.add(handler)
      return () => usageListeners.delete(handler)
    },

    onChatStatus(handler) {
      chatStatusListeners.add(handler)
      return () => chatStatusListeners.delete(handler)
    },

    onChatsChanged(handler) {
      chatsChangedListeners.add(handler)
      return () => chatsChangedListeners.delete(handler)
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
