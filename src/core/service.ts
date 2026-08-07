/**
 * Фасад ядра — єдина точка, через яку застосунок виконує операції.
 *
 * Тримає стан у пам'яті й записує його на диск після кожної зміни.
 * Існує, щоб `main/` лишався тонким проксі без логіки (§11.1 docs/PROJECT.md):
 * IPC-обробник має вміти лише переадресувати виклик сюди.
 */

import { type Config, loadConfig, saveConfig } from './config.js'
import type { GitExec } from './git.js'
import { gitIn } from './git.js'
import { configFile, stateFile, stateTempFile } from './paths.js'
import { createProject } from './projects.js'
import {
  addProject,
  loadState,
  type Project,
  removeProject,
  saveState,
  type State
} from './store.js'

export interface ServiceOptions {
  readonly stateFilePath?: string
  readonly stateTempFilePath?: string
  readonly configFilePath?: string
  readonly makeExec?: (cwd: string) => GitExec
}

export interface MaestroService {
  getConfig(): Config
  updateConfig(
    patch: Partial<Omit<Config, 'version' | 'deviceId' | 'installedAt'>>
  ): Promise<Config>
  listProjects(): readonly Project[]
  addProjectFromPath(path: string): Promise<Project>
  removeProjectById(projectId: string): Promise<void>
}

/**
 * Створює сервіс, читаючи стан і конфіг з диска.
 *
 * Усі шляхи приймаються параметрами з типовими значеннями — це дозволяє
 * тестувати сервіс на тимчасовій теці, не чіпаючи справжніх даних.
 */
export async function createService(options: ServiceOptions = {}): Promise<MaestroService> {
  const statePath = options.stateFilePath ?? stateFile()
  const stateTempPath = options.stateTempFilePath ?? stateTempFile()
  const configPath = options.configFilePath ?? configFile()
  const makeExec = options.makeExec ?? gitIn

  let state: State = await loadState(statePath)
  let config: Config = await loadConfig(configPath)

  async function commit(next: State): Promise<void> {
    await saveState(next, statePath, stateTempPath)
    state = next
  }

  return {
    getConfig() {
      return config
    },

    async updateConfig(patch) {
      const next: Config = { ...config, ...patch }
      await saveConfig(next, configPath)
      config = next
      return next
    },

    listProjects() {
      return state.projects
    },

    async addProjectFromPath(path) {
      const project = await createProject(path, config.branchPrefix, state, makeExec)
      await commit(addProject(state, project))
      return project
    },

    async removeProjectById(projectId) {
      await commit(removeProject(state, projectId))
    }
  }
}
