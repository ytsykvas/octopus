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
import { configFile, rootDir, stateFile, stateTempFile } from './paths.js'
import { assertBranchExists, createProject, orderBaseBranches } from './projects.js'
import { readScript, type ScriptKind, scriptExists, scriptPath, writeScript } from './scripts.js'
import {
  addProject,
  addWorkspace,
  findProject,
  loadState,
  type Project,
  removeProject,
  type ProjectPatch,
  removeWorkspace as removeWorkspaceRecord,
  saveState,
  type State,
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

  /** Workspaces of a project, reconciled with what git actually has. */
  listWorkspaces(projectId: string): Promise<WorkspaceView[]>
  createWorkspaceIn(projectId: string): Promise<Workspace>
  renameWorkspaceById(workspaceId: string, name: string): Promise<void>
  removeWorkspaceById(workspaceId: string, options?: RemoveOptions): Promise<void>
  /** Whether a workspace holds work that removal would discard. */
  workspaceHasChanges(workspaceId: string): Promise<boolean>
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

  let state: State = await loadState(statePath)
  let config: Config = await loadConfig(configPath)

  async function commit(next: State): Promise<void> {
    await saveState(next, statePath, stateTempPath)
    state = next
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

    async updateProjectById(projectId, patch) {
      const project = requireProject(projectId)

      // Checked before the write, so a branch deleted since the dialog opened
      // is reported here rather than as a worktree failure days later.
      if (patch.baseBranch !== undefined) {
        await assertBranchExists(makeExec(project.repoPath), patch.baseBranch)
      }

      await commit(updateProject(state, projectId, patch))
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

      await commit(removeProject(state, projectId))
    },

    async listWorkspaces(projectId) {
      const project = findProject(state, projectId)
      if (!project) return []

      const stored = workspacesOfProject(state, projectId)
      if (stored.length === 0) return []

      // git is the source of truth about worktrees; the store only holds what
      // git does not know. A failure to read it must not blank the list.
      const worktrees = await listWorktrees(makeExec(project.repoPath)).catch(() => [])
      const changes = await countChanges(stored, makeExec)

      return reconcile(stored, worktrees, changes)
    },

    async createWorkspaceIn(projectId) {
      const project = requireProject(projectId)
      const exec = makeExec(project.repoPath)

      const workspace = await createWorkspace(project, state, exec, { root: dataRoot })

      try {
        await commit(addWorkspace(state, workspace))
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
      await commit(updateWorkspace(state, workspaceId, renamed))
    },

    async removeWorkspaceById(workspaceId, options) {
      const workspace = requireWorkspace(workspaceId)
      const project = requireProject(workspace.projectId)

      await removeWorkspace(
        workspace,
        { repository: makeExec(project.repoPath), workspace: makeExec(workspace.path) },
        options
      )

      await commit(removeWorkspaceRecord(state, workspaceId))
    },

    async workspaceHasChanges(workspaceId) {
      const workspace = requireWorkspace(workspaceId)
      return (await changeCount(workspace, makeExec)) > 0
    }
  }
}
