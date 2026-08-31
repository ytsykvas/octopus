/**
 * Application state — `~/.octopus/state.json`.
 *
 * Holds the list of projects and workspaces. Git remains the source of truth
 * about git; this file only stores what git does not know — the agent session
 * binding, status and port.
 */

import { isAbsolute, normalize } from 'node:path'

import { z } from 'zod'

import {
  type AgentCommand,
  type AgentModel,
  AgentModelSchema,
  type Chat,
  ChatSchema
} from './chats.js'
import { nextProjectColor, type ProjectColor, ProjectColorSchema } from './colors.js'
import { DEFAULT_ENV_FILE } from './envBlock.js'
import { ProjectIconSchema } from './icons.js'

export {
  type AgentCommand,
  AgentCommandSchema,
  type AgentModel,
  AgentModelSchema,
  type Chat,
  ChatSchema,
  type ChatStatus,
  ChatStatusSchema
} from './chats.js'
export { PROJECT_COLORS, type ProjectColor } from './colors.js'
export { PROJECT_ICONS, type ProjectIcon } from './icons.js'
import { stateFile, stateTempFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'

/*
 * The widest a stored port may be, not where one comes from.
 *
 * Allocation moved to `ports.ts`, which hands out blocks from a small pool —
 * but a workspace made before that keeps the port it was given, and this has to
 * keep loading it.
 */
export const PORT_RANGE_START = 3000
export const PORT_RANGE_END = 9000

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  branchPrefix: z.string().min(1),
  /**
   * Optional on disk, always present in memory.
   *
   * A default here would give every project written before colours existed
   * the same one, which is the opposite of what the colour is for. `migrate`
   * hands out distinct colours instead, and can only do that if it can tell
   * "had no colour" from "chose blue".
   */
  color: ProjectColorSchema.optional(),
  /**
   * Absent or `null` means the tab falls back to the project's initials.
   *
   * Unlike the colour, no icon is the reasonable default: a picture that was
   * not chosen says nothing about the project. `null` is accepted alongside
   * "absent" because that is what clearing a chosen icon writes.
   */
  icon: ProjectIconSchema.nullable().optional(),
  /**
   * Which file the env overrides are written into, relative to the worktree.
   *
   * Defaulted rather than required, so a project written before this existed
   * still loads — and `.env` is what most stacks read. Rails and dotenv do;
   * Vite reads `.env.local` and Next `NEXT_PUBLIC_*` out of `.env.local` too,
   * and a project on one of those had nowhere to put its variables while this
   * was a constant.
   */
  envFile: z.string().min(1).default(DEFAULT_ENV_FILE),
  /**
   * Digests of this repository's capability files that somebody has read.
   *
   * A repository can pre-approve tools and declare shell hooks through
   * `.claude/settings.json`, and octopus loads it as the CLI does — so opening
   * a clone grants it that unless somebody has looked. A **set**, so moving
   * between two branches whose settings differ does not ask on every switch.
   */
  approvedSettings: z.array(z.string()).default([]),
  /**
   * Digests of the scripts this repository supplies that somebody has read.
   *
   * A separate list from `approvedSettings` on purpose. The two answer
   * different questions — what the agent may load, and what the Run button may
   * execute — and one list would mean reading a hook file quietly approved a
   * build script as well. Same shape otherwise: a bounded set, so moving
   * between two branches whose scripts differ does not ask on every switch.
   */
  approvedScripts: z.array(z.string()).default([])
})

export const WorkspaceStatusSchema = z.enum(['idle', 'running', 'waiting_permission', 'error'])

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
  status: WorkspaceStatusSchema,
  port: z.number().int().min(PORT_RANGE_START).max(PORT_RANGE_END),
  createdAt: z.iso.datetime(),
  /** Reserved for future multi-user support; always null for now. */
  ownerId: z.string().nullable()
})

/**
 * One subscription window, as the account last reported it.
 *
 * Mirrors `UsageWindow` in `agent.ts` rather than importing it: that module
 * reaches the SDK, and this one is read by the renderer.
 *
 * Nothing has to keep the two in step by hand. `service.ts` assigns what it
 * loads from here to a `SubscriptionUsage`, so a field that drifts on either
 * side fails to compile there — a stronger check than a test, and one nobody
 * has to remember to write.
 */
export const UsageWindowSchema = z.object({
  /** Share of the window used, 0–100. */
  utilization: z.number(),
  resetsAt: z.string().nullable()
})

export const SubscriptionUsageSchema = z.object({
  fiveHour: UsageWindowSchema.nullable(),
  sevenDay: UsageWindowSchema.nullable()
})

export const StateSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
  workspaces: z.array(WorkspaceSchema),
  /**
   * Defaulted rather than required, so a state file written before chats
   * existed still loads. The version stays at 1 for the same reason: a field
   * that can be absent needs a default, not a migration.
   */
  chats: z.array(ChatSchema).default([]),
  /**
   * Models the agent last said the account may use.
   *
   * Here rather than in `config.json` for two reasons. The config is written
   * unqueued, so a list saved whenever a session starts would race the user's
   * own edit in Settings and drop a field; this file is written through
   * `commit`, which serialises. And the config is a file §4 promises the user
   * can read and shorten — a cache the application writes for itself is not a
   * setting.
   *
   * Remembered only so the picker is usable before the first message, since the
   * agent can list its models solely while a session is running. Replaced whole
   * at the next session start.
   */
  knownModels: z.array(AgentModelSchema).default([]),
  /**
   * How much of the account's windows the agent last said were gone.
   *
   * Here for the same two reasons as the models above, and remembered for the
   * same one: the figures arrive from a running session's control channel, so
   * without this the sidebar has nothing to show until somebody has sent a
   * message. A reading is a fact about the account rather than about any
   * conversation, which is why it sits beside the projects and not inside one.
   *
   * `null` is "never read one", which is a different statement from a reading
   * of zero and has to stay tellable apart from it.
   */
  subscriptionUsage: SubscriptionUsageSchema.nullable().default(null)
})

/**
 * A project as the rest of the application sees it — colour always resolved.
 *
 * The schema keeps `color` optional because that is how an older file on disk
 * looks; `migrate` fills it in, and nothing downstream should have to wonder
 * whether a project has a colour.
 */
export type Project = z.infer<typeof ProjectSchema> & { color: ProjectColor }
export type Workspace = z.infer<typeof WorkspaceSchema>

/** State as read from disk, before `migrate` has filled anything in. */
type StoredState = z.infer<typeof StateSchema>

export type State = Omit<StoredState, 'projects'> & { projects: Project[] }

export const EMPTY_STATE: State = {
  version: 1,
  projects: [],
  workspaces: [],
  chats: [],
  knownModels: [],
  subscriptionUsage: null
}

/** State integrity violation — a duplicate or a dangling reference. */
export class StateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateConflictError'
  }
}

export async function loadState(filePath: string = stateFile()): Promise<State> {
  return settleStatuses(migrate(await readJsonFile(filePath, StateSchema, EMPTY_STATE)))
}

/**
 * What a workspace is doing, from what its conversations are doing.
 *
 * Derived rather than written by whichever chat last had an event, because a
 * workspace holds up to three and they run at once: the tab that finished used
 * to mark the two still working as idle.
 *
 * The order is what the sidebar's single dot should say when they disagree.
 * `waiting_permission` wins because that turn has stopped and is waiting on the
 * user — the one state worth crossing the window for (§10.8). `running` beats
 * `error` because the dot says what is happening now, and a failed turn is a
 * record while a running one is an event.
 *
 * The workspace's own status is not consulted, and there is nothing left for it
 * to say: every value the enum holds is something a conversation is doing.
 */
export function workspaceStatusFrom(chats: readonly Chat[]): Workspace['status'] {
  if (chats.some((chat) => chat.status === 'waiting_permission')) return 'waiting_permission'
  if (chats.some((chat) => chat.status === 'running')) return 'running'
  if (chats.some((chat) => chat.status === 'error')) return 'error'
  return 'idle'
}

/**
 * Puts down what the last run was carrying.
 *
 * `running` and `waiting_permission` describe a session, and no session
 * survives the process that held it — so a conversation left mid-turn when the
 * app quit would come back claiming to be working, with nothing behind the
 * claim and nothing that would ever correct it.
 *
 * `error` stays. It is a record of something that happened rather than a
 * session still being waited on.
 *
 * The workspaces are then derived from the settled chats rather than settled by
 * the same rule alongside them. Two lists settled independently agree today and
 * would drift the first time one of the rules changed — and a workspace is no
 * longer a thing that has a status of its own to put down.
 */
export function settleStatuses(state: State): State {
  const chats = state.chats.map((chat) =>
    chat.status === 'running' || chat.status === 'waiting_permission'
      ? { ...chat, status: 'idle' as const }
      : chat
  )

  return {
    ...state,
    chats,
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      status: workspaceStatusFrom(chats.filter((chat) => chat.workspaceId === workspace.id))
    }))
  }
}

/**
 * Brings a state written by an older build up to date.
 *
 * Workspace ids used to be the bare name, which collided as soon as two
 * projects each had an `anna`. They are now `<project>/<name>`. Records
 * written before that change are rewritten on load, so only one format is
 * ever in play.
 */
export function migrate(state: StoredState): State {
  const workspaces = state.workspaces.map((workspace) =>
    workspace.id.includes('/')
      ? workspace
      : { ...workspace, id: `${workspace.projectId}/${workspace.id}` }
  )

  // Colours are handed out one project at a time, each seeing what the
  // previous ones took, so a file written before colours existed comes back
  // with distinct ones rather than a wall of the same default.
  const assigned: ProjectColor[] = []
  const projects = state.projects.map((project) => {
    const color = project.color ?? nextProjectColor(assigned)
    assigned.push(color)
    return { ...project, color }
  })

  return { ...state, projects, workspaces }
}

export async function saveState(
  state: State,
  filePath: string = stateFile(),
  tempPath: string = stateTempFile()
): Promise<void> {
  await writeJsonFile(filePath, StateSchema, state, tempPath)
}

export function findProject(state: State, projectId: string): Project | undefined {
  return state.projects.find((project) => project.id === projectId)
}

export function workspacesOfProject(state: State, projectId: string): Workspace[] {
  return state.workspaces.filter((workspace) => workspace.projectId === projectId)
}

/** Adds a project. A repeated repository path is a conflict, not a silent replace. */
export function addProject(state: State, project: Project): State {
  if (state.projects.some((existing) => existing.id === project.id)) {
    throw new StateConflictError(`Project ${project.id} is already added`)
  }
  if (state.projects.some((existing) => existing.repoPath === project.repoPath)) {
    throw new StateConflictError(`Repository ${project.repoPath} is already added as a project`)
  }

  return { ...state, projects: [...state.projects, project] }
}

/**
 * The parts of a project a user may change after it is added.
 *
 * `id` and `repoPath` are absent on purpose: workspaces and on-disk paths are
 * keyed by the id, and the repository is not ours to move. `branchPrefix`
 * belongs to the config, which is shared across projects.
 */
export const ProjectPatchSchema = ProjectSchema.pick({
  name: true,
  baseBranch: true,
  color: true,
  icon: true,
  envFile: true,
  approvedSettings: true,
  approvedScripts: true
}).partial()

export type ProjectPatch = z.infer<typeof ProjectPatchSchema>

/**
 * Updates a project's editable fields.
 *
 * Only the keys present in the patch are touched, so changing the base branch
 * cannot quietly rewrite the name with a stale copy held by the UI.
 */
export function updateProject(state: State, projectId: string, patch: ProjectPatch): State {
  if (!state.projects.some((project) => project.id === projectId)) {
    throw new StateConflictError(`Project ${projectId} not found`)
  }

  const name = patch.name?.trim()
  if (name !== undefined && name === '') {
    throw new StateConflictError('A project name cannot be empty')
  }

  const baseBranch = patch.baseBranch?.trim()
  if (baseBranch !== undefined && baseBranch === '') {
    throw new StateConflictError('A base branch cannot be empty')
  }

  const envFile = patch.envFile?.trim()
  if (envFile !== undefined) {
    if (envFile === '') throw new StateConflictError('An env file cannot be empty')

    // It is joined to a worktree path, so it has to stay inside one. The same
    // rule the carry list applies to every line it reads, for the same reason.
    if (isAbsolute(envFile) || normalize(envFile).startsWith('..')) {
      throw new StateConflictError('An env file has to sit inside the workspace')
    }
  }

  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            ...(patch.color !== undefined && { color: patch.color }),
            // `null` is a value here, not an absence: it is how the dialog says
            // "back to the initials". Only `undefined` means "leave it alone".
            ...(patch.icon !== undefined && { icon: patch.icon }),
            ...(name !== undefined && { name }),
            ...(baseBranch !== undefined && { baseBranch }),
            ...(envFile !== undefined && { envFile }),
            ...(patch.approvedScripts !== undefined && {
              approvedScripts: patch.approvedScripts
            }),
            ...(patch.approvedSettings !== undefined && {
              approvedSettings: patch.approvedSettings
            })
          }
        : project
    )
  }
}

/** Removes a project together with its workspaces — no orphans are left behind. */
export function removeProject(state: State, projectId: string): State {
  const dropped = new Set(workspacesOfProject(state, projectId).map((workspace) => workspace.id))

  return {
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    workspaces: state.workspaces.filter((workspace) => workspace.projectId !== projectId),
    chats: state.chats.filter((chat) => !dropped.has(chat.workspaceId))
  }
}

export function addWorkspace(state: State, workspace: Workspace): State {
  if (!findProject(state, workspace.projectId)) {
    throw new StateConflictError(`Project ${workspace.projectId} does not exist`)
  }
  if (state.workspaces.some((existing) => existing.id === workspace.id)) {
    throw new StateConflictError(`Workspace ${workspace.id} already exists`)
  }
  // Branches live inside a repository, so the clash is only real within one
  // project: `octopus/anna` in two different projects is two different
  // branches, and rejecting the second would make every project after the
  // first unable to use the start of the name pool.
  if (
    state.workspaces.some(
      (existing) =>
        existing.projectId === workspace.projectId && existing.branch === workspace.branch
    )
  ) {
    throw new StateConflictError(
      `Branch ${workspace.branch} is already used by another workspace of ${workspace.projectId}`
    )
  }

  return { ...state, workspaces: [...state.workspaces, workspace] }
}

export function updateWorkspace(
  state: State,
  workspaceId: string,
  patch: Partial<Omit<Workspace, 'id' | 'projectId'>>
): State {
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new StateConflictError(`Workspace ${workspaceId} not found`)
  }

  return {
    ...state,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, ...patch } : workspace
    )
  }
}

export function removeWorkspace(state: State, workspaceId: string): State {
  return {
    ...state,
    workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
    chats: state.chats.filter((chat) => chat.workspaceId !== workspaceId)
  }
}

export function chatsOfWorkspace(state: State, workspaceId: string): Chat[] {
  return state.chats.filter((chat) => chat.workspaceId === workspaceId)
}

export function findChat(state: State, chatId: string): Chat | undefined {
  return state.chats.find((chat) => chat.id === chatId)
}

/** Adds a chat. Its workspace must exist — a chat with nowhere to run is a bug. */
export function addChat(state: State, chat: Chat): State {
  if (!state.workspaces.some((workspace) => workspace.id === chat.workspaceId)) {
    throw new StateConflictError(`Workspace ${chat.workspaceId} does not exist`)
  }
  if (state.chats.some((existing) => existing.id === chat.id)) {
    throw new StateConflictError(`Chat ${chat.id} already exists`)
  }

  return { ...state, chats: [...state.chats, chat] }
}

/**
 * Removes a chat.
 *
 * An id that is not there is not an error, unlike `updateChat` above: removal
 * is idempotent, and the one caller reaches here after closing a live session,
 * which is exactly the window in which the record can already have gone.
 */
export function removeChat(state: State, chatId: string): State {
  return { ...state, chats: state.chats.filter((chat) => chat.id !== chatId) }
}

/**
 * Updates a chat's mutable fields.
 *
 * `workspaceId` is absent from the patch on purpose: a conversation belongs to
 * the branch it happened on, and moving it would leave its transcript
 * describing files that are not there.
 */
export function updateChat(
  state: State,
  chatId: string,
  patch: Partial<Omit<Chat, 'id' | 'workspaceId'>>
): State {
  if (!state.chats.some((chat) => chat.id === chatId)) {
    throw new StateConflictError(`Chat ${chatId} not found`)
  }

  return {
    ...state,
    chats: state.chats.map((chat) => (chat.id === chatId ? { ...chat, ...patch } : chat))
  }
}

/**
 * Replaces the remembered model list.
 *
 * Wholesale rather than merged: the agent reports what the account may use
 * *now*, and keeping an entry it stopped naming would leave a withdrawn model
 * in the picker forever.
 */
export function rememberModels(state: State, models: readonly AgentModel[]): State {
  return { ...state, knownModels: [...models] }
}

/** Whether the remembered list already says exactly this — a write to avoid. */
export function modelsUnchanged(state: State, models: readonly AgentModel[]): boolean {
  return JSON.stringify(state.knownModels) === JSON.stringify(models)
}

/**
 * Whether this chat's remembered commands already say exactly this.
 *
 * Worth more here than for models: a session asks for the list every time it
 * starts, and a chat is where the answer is kept, so without this every restart
 * of every conversation would rewrite the state file to the same bytes.
 */
export function commandsUnchanged(chat: Chat, commands: readonly AgentCommand[]): boolean {
  return JSON.stringify(chat.knownCommands) === JSON.stringify(commands)
}
