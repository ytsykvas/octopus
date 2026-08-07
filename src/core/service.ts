/**
 * Core facade — the single entry point for application operations.
 *
 * Holds state in memory and persists it after every change. It exists so
 * `main/` stays a thin proxy with no logic (§11.1 docs/PROJECT.md): an IPC
 * handler should only have to forward the call here.
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

export interface OctopusService {
  getConfig(): Config
  updateConfig(
    patch: Partial<Omit<Config, 'version' | 'deviceId' | 'installedAt'>>
  ): Promise<Config>
  listProjects(): readonly Project[]
  addProjectFromPath(path: string): Promise<Project>
  removeProjectById(projectId: string): Promise<void>
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
