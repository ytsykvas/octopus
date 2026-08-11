/**
 * Application state — `~/.octopus/state.json`.
 *
 * Holds the list of projects and workspaces. Git remains the source of truth
 * about git; this file only stores what git does not know — the agent session
 * binding, status and port.
 */

import { z } from 'zod'

import { type Chat, ChatSchema } from './chats.js'
import { nextProjectColor, type ProjectColor, ProjectColorSchema } from './colors.js'
import { ProjectIconSchema } from './icons.js'

export { type Chat, ChatSchema } from './chats.js'
export { PROJECT_COLORS, type ProjectColor } from './colors.js'
export { PROJECT_ICONS, type ProjectIcon } from './icons.js'
import { stateFile, stateTempFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'

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
  icon: ProjectIconSchema.nullable().optional()
})

export const WorkspaceStatusSchema = z.enum([
  'idle',
  'running',
  'waiting_permission',
  'error',
  'archived'
])

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1),
  branch: z.string().min(1),
  path: z.string().min(1),
  status: WorkspaceStatusSchema,
  port: z.number().int().min(PORT_RANGE_START).max(PORT_RANGE_END),
  createdAt: z.iso.datetime(),
  /** Reserved for future multi-user support (§15.3); always null for now. */
  ownerId: z.string().nullable()
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
  chats: z.array(ChatSchema).default([])
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

export const EMPTY_STATE: State = { version: 1, projects: [], workspaces: [], chats: [] }

/** State integrity violation — a duplicate or a dangling reference. */
export class StateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateConflictError'
  }
}

export async function loadState(filePath: string = stateFile()): Promise<State> {
  return migrate(await readJsonFile(filePath, StateSchema, EMPTY_STATE))
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

/**
 * Derives a workspace port deterministically from its id.
 *
 * Determinism matters: the port must stay the same across restarts so browser
 * bookmarks keep working. Taken ports are passed in separately to keep the
 * function pure.
 */
export function assignPort(workspaceId: string, taken: readonly number[] = []): number {
  const span = PORT_RANGE_END - PORT_RANGE_START + 1

  let hash = 0
  for (const char of workspaceId) {
    hash = (hash * 31 + char.charCodeAt(0)) % span
  }

  const busy = new Set(taken)
  for (let offset = 0; offset < span; offset++) {
    const port = PORT_RANGE_START + ((hash + offset) % span)
    if (!busy.has(port)) return port
  }

  throw new StateConflictError('No free ports left in the 3000-9000 range')
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
  icon: true
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
            ...(baseBranch !== undefined && { baseBranch })
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
