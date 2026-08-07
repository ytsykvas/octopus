/**
 * Core facade — the single entry point for application operations.
 *
 * Holds state in memory and persists it after every change. It exists so
 * `main/` stays a thin proxy with no logic (§11.1 docs/PROJECT.md): an IPC
 * handler should only have to forward the call here.
 */

import { type CommandExec, defaultExec } from './accounts.js'
import { type Config, loadConfig, saveConfig } from './config.js'
import { cloneRepository, listRepositories, type RemoteRepository } from './github.js'
import type { GitExec } from './git.js'
import { gitIn } from './git.js'
import { configFile, stateFile, stateTempFile } from './paths.js'
import { createProject } from './projects.js'
import {
  addProject,
  loadState,
  type Project,
  removeProject,
  renameProject,
  saveState,
  type State
} from './store.js'

export interface ServiceOptions {
  readonly stateFilePath?: string
  readonly stateTempFilePath?: string
  readonly configFilePath?: string
  readonly makeExec?: (cwd: string) => GitExec
  readonly commandExec?: CommandExec
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
  renameProjectById(projectId: string, name: string): Promise<void>
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
  const commandExec = options.commandExec ?? defaultExec

  let state: State = await loadState(statePath)
  let config: Config = await loadConfig(configPath)

  async function commit(next: State): Promise<void> {
    await saveState(next, statePath, stateTempPath)
    state = next
  }

  async function addFromPath(path: string): Promise<Project> {
    const project = await createProject(path, config.branchPrefix, state, makeExec)
    await commit(addProject(state, project))
    return project
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

    async renameProjectById(projectId, name) {
      await commit(renameProject(state, projectId, name))
    },

    async removeProjectById(projectId) {
      await commit(removeProject(state, projectId))
    }
  }
}
