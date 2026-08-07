/**
 * Стан застосунку — `~/.maestro/state.json`.
 *
 * Тримає перелік проєктів і воркспейсів. Джерелом правди про git лишається
 * сам git: тут зберігається лише те, чого в ньому немає — прив'язка до
 * сесії агента, статус і порт.
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
  /** Місце під майбутню багатокористувацькість (§15.3); поки завжди null. */
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

/** Помилка порушення цілісності стану — дублікат або посилання в нікуди. */
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
 * Обчислює порт для воркспейсу детерміновано з його id.
 *
 * Детермінованість важлива: порт має лишатися тим самим між запусками,
 * щоб закладки в браузері не протухали. Зайняті порти передаються окремо,
 * щоб функція лишалася чистою.
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

  throw new StateConflictError('Вільних портів у діапазоні 3000–9000 не лишилося')
}

export function findProject(state: State, projectId: string): Project | undefined {
  return state.projects.find((project) => project.id === projectId)
}

export function workspacesOfProject(state: State, projectId: string): Workspace[] {
  return state.workspaces.filter((workspace) => workspace.projectId === projectId)
}

/** Додає проєкт. Повторний шлях до репозиторію — конфлікт, а не мовчазна заміна. */
export function addProject(state: State, project: Project): State {
  if (state.projects.some((existing) => existing.id === project.id)) {
    throw new StateConflictError(`Проєкт ${project.id} вже доданий`)
  }
  if (state.projects.some((existing) => existing.repoPath === project.repoPath)) {
    throw new StateConflictError(`Репозиторій ${project.repoPath} вже доданий як проєкт`)
  }

  return { ...state, projects: [...state.projects, project] }
}

/** Прибирає проєкт разом з його воркспейсами — осиротілих записів не лишається. */
export function removeProject(state: State, projectId: string): State {
  return {
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    workspaces: state.workspaces.filter((workspace) => workspace.projectId !== projectId)
  }
}

export function addWorkspace(state: State, workspace: Workspace): State {
  if (!findProject(state, workspace.projectId)) {
    throw new StateConflictError(`Проєкт ${workspace.projectId} не існує`)
  }
  if (state.workspaces.some((existing) => existing.id === workspace.id)) {
    throw new StateConflictError(`Воркспейс ${workspace.id} вже існує`)
  }
  if (state.workspaces.some((existing) => existing.branch === workspace.branch)) {
    throw new StateConflictError(`Гілка ${workspace.branch} вже зайнята іншим воркспейсом`)
  }

  return { ...state, workspaces: [...state.workspaces, workspace] }
}

export function updateWorkspace(
  state: State,
  workspaceId: string,
  patch: Partial<Omit<Workspace, 'id' | 'projectId'>>
): State {
  if (!state.workspaces.some((workspace) => workspace.id === workspaceId)) {
    throw new StateConflictError(`Воркспейс ${workspaceId} не знайдено`)
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
