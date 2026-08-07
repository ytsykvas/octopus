/**
 * Application state — `~/.maestro/state.json`.
 *
 * Holds the list of projects and workspaces. Git remains the source of truth
 * about git; this file only stores what git does not know — the agent session
 * binding, status and port.
 */

import { z } from 'zod'

import { stateFile, stateTempFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './persist.js'

export const PORT_RANGE_START = 3000
export const PORT_RANGE_END = 9000

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1),
  branchPrefix: z.string().min(1)
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
  sessionId: z.string().nullable(),
  port: z.number().int().min(PORT_RANGE_START).max(PORT_RANGE_END),
  createdAt: z.iso.datetime(),
  /** Reserved for future multi-user support (§15.3); always null for now. */
  ownerId: z.string().nullable()
})

export const StateSchema = z.object({
  version: z.literal(1),
  projects: z.array(ProjectSchema),
  workspaces: z.array(WorkspaceSchema)
})

export type Project = z.infer<typeof ProjectSchema>
export type Workspace = z.infer<typeof WorkspaceSchema>
export type State = z.infer<typeof StateSchema>

export const EMPTY_STATE: State = { version: 1, projects: [], workspaces: [] }

/** State integrity violation — a duplicate or a dangling reference. */
export class StateConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateConflictError'
  }
}

export async function loadState(filePath: string = stateFile()): Promise<State> {
  return readJsonFile(filePath, StateSchema, EMPTY_STATE)
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

/** Removes a project together with its workspaces — no orphans are left behind. */
export function removeProject(state: State, projectId: string): State {
  return {
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    workspaces: state.workspaces.filter((workspace) => workspace.projectId !== projectId)
  }
}

export function addWorkspace(state: State, workspace: Workspace): State {
  if (!findProject(state, workspace.projectId)) {
    throw new StateConflictError(`Project ${workspace.projectId} does not exist`)
  }
  if (state.workspaces.some((existing) => existing.id === workspace.id)) {
    throw new StateConflictError(`Workspace ${workspace.id} already exists`)
  }
  if (state.workspaces.some((existing) => existing.branch === workspace.branch)) {
    throw new StateConflictError(`Branch ${workspace.branch} is already used by another workspace`)
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
    workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId)
  }
}
