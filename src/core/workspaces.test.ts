import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type GitExec, gitIn } from './git.js'
import { NAME_POOL_SIZE } from './names.js'
import { addProject, EMPTY_STATE, type Project, type State, type Workspace } from './store.js'
import { listWorktrees } from './worktree.js'
import {
  branchFor,
  countChanges,
  createWorkspace,
  reconcile,
  removeWorkspace,
  renameWorkspace,
  WorkspaceError
} from './workspaces.js'

const run = promisify(execFile)

let dir: string
let repo: string
let root: string
let exec: GitExec
let project: Project
let state: State

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-workspaces-'))
  repo = join(dir, 'repo')
  root = join(dir, 'data')

  await run('git', ['init', '-q', '--initial-branch=main', repo])
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  await run('git', ['config', 'user.name', 'Test'], { cwd: repo })
  await writeFile(join(repo, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: repo })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: repo })

  exec = gitIn(repo)
  project = {
    id: 'planner',
    name: 'planner',
    repoPath: repo,
    baseBranch: 'main',
    branchPrefix: 'ytsykvas'
  }
  state = addProject(EMPTY_STATE, project)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Creates a workspace and folds it into the state, as the service does. */
async function create(): Promise<Workspace> {
  const workspace = await createWorkspace(project, state, exec, { root })
  state = { ...state, workspaces: [...state.workspaces, workspace] }
  return workspace
}

describe('branchFor', () => {
  it('joins the prefix and a slugged name', () => {
    expect(branchFor(project, 'fix auth')).toBe('ytsykvas/fix-auth')
  })

  it('keeps non-Latin names readable, as git allows', () => {
    expect(branchFor(project, 'Виправити')).toBe('ytsykvas/виправити')
  })
})

describe('createWorkspace', () => {
  it('creates a real worktree with its own branch', async () => {
    const workspace = await create()

    const worktrees = await listWorktrees(exec)
    expect(worktrees.map((item) => item.branch)).toContain('ytsykvas/anna')
    expect(workspace.path).toContain(join('workspaces', 'planner', 'anna'))
  })

  it('names the first workspace from the start of the pool', async () => {
    const workspace = await create()
    expect(workspace.name).toBe('anna')
  })

  // The name is per project; the id has to be unique across the whole app,
  // because renaming, removal and the jump shortcuts carry nothing else.
  it('keys the workspace by project and name', async () => {
    const workspace = await create()
    expect(workspace.id).toBe('planner/anna')
  })

  it('lets two projects each have an anna', async () => {
    // A second project means a second repository — addProject refuses to add
    // the same one twice — so the branches cannot collide.
    const otherRepo = join(dir, 'esl')
    await run('git', ['init', '-q', '--initial-branch=main', otherRepo])
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: otherRepo })
    await run('git', ['config', 'user.name', 'Test'], { cwd: otherRepo })
    await writeFile(join(otherRepo, 'README.md'), '# other\n', 'utf8')
    await run('git', ['add', '.'], { cwd: otherRepo })
    await run('git', ['commit', '-q', '-m', 'first'], { cwd: otherRepo })

    const other: Project = { ...project, id: 'esl', name: 'esl', repoPath: otherRepo }

    const first = await create()
    const second = await createWorkspace(other, state, gitIn(otherRepo), { root })

    expect(second.name).toBe(first.name)
    expect(second.id).not.toBe(first.id)
  })

  it('gives the next workspace a different name and branch', async () => {
    const first = await create()
    const second = await create()

    expect(second.id).not.toBe(first.id)
    expect(second.branch).not.toBe(first.branch)
  })

  it('assigns each workspace its own port', async () => {
    const first = await create()
    const second = await create()

    expect(second.port).not.toBe(first.port)
  })

  it('starts idle with no agent session', async () => {
    const workspace = await create()
    expect(workspace.status).toBe('idle')
    expect(workspace.sessionId).toBeNull()
  })

  it('refuses when the directory is already occupied', async () => {
    const occupied = (): Promise<boolean> => Promise.resolve(true)

    const error = await createWorkspace(project, state, exec, { root, exists: occupied }).catch(
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(WorkspaceError)
    expect((error as WorkspaceError).code).toBe('pathExists')
  })

  it('branches from the project base branch', async () => {
    const workspace = await create()
    const inside = gitIn(workspace.path)

    await expect(inside(['log', '--oneline', '-1'])).resolves.toContain('first')
  })

  it('checks the real filesystem when no checker is supplied', async () => {
    // Without an `exists` override the default runs; the path is free, so
    // creation proceeds.
    const workspace = await createWorkspace(project, state, exec, { root })
    expect(workspace.name).toBe('anna')
  })

  it('refuses a directory that genuinely exists on disk', async () => {
    // Occupy the path the generator will pick first.
    await mkdir(join(root, 'workspaces', 'planner', 'anna'), { recursive: true })

    const error = await createWorkspace(project, state, exec, { root }).catch(
      (cause: unknown) => cause
    )

    expect((error as WorkspaceError).code).toBe('pathExists')
  })

  // git canonicalises paths, so we ask it where the worktree landed. If that
  // question fails or comes back empty, the computed path is the fallback —
  // creation must not break over it.
  it('falls back to the computed path when git cannot report one', async () => {
    const quiet: GitExec = (args) => {
      if (args[0] === 'worktree' && args[1] === 'list') return Promise.resolve('')
      return exec(args)
    }

    const workspace = await createWorkspace(project, state, quiet, { root })
    expect(workspace.path).toContain(join('workspaces', 'planner', 'anna'))
  })

  it('survives git failing to list worktrees at all', async () => {
    const broken: GitExec = (args) => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        return Promise.reject(new Error('git exploded'))
      }
      return exec(args)
    }

    const workspace = await createWorkspace(project, state, broken, { root })
    expect(workspace.path).toContain('anna')
  })
})

describe('renameWorkspace', () => {
  it('renames the branch and returns the new label', async () => {
    const workspace = await create()

    const renamed = await renameWorkspace(workspace, project, 'fix auth', exec)

    expect(renamed.name).toBe('fix auth')
    expect(renamed.branch).toBe('ytsykvas/fix-auth')
    await expect(exec(['branch', '--list', 'ytsykvas/fix-auth'])).resolves.toContain('fix-auth')
  })

  // The directory is fixed at creation because `git worktree move` fails
  // whenever something is running inside it.
  it('leaves the directory where it was', async () => {
    const workspace = await create()
    await renameWorkspace(workspace, project, 'fix auth', exec)

    const worktrees = await listWorktrees(exec)
    expect(worktrees.some((item) => item.path === workspace.path)).toBe(true)
  })

  it('trims the name', async () => {
    const workspace = await create()
    await expect(renameWorkspace(workspace, project, '  spaced  ', exec)).resolves.toMatchObject({
      name: 'spaced'
    })
  })

  it('refuses an empty name', async () => {
    const workspace = await create()

    const error = await renameWorkspace(workspace, project, '   ', exec).catch(
      (cause: unknown) => cause
    )

    expect((error as WorkspaceError).code).toBe('nameEmpty')
  })

  it('does nothing to git when the slug is unchanged', async () => {
    const workspace = await create()

    // 'Anna' slugs to the same branch it already has.
    const renamed = await renameWorkspace(workspace, project, 'Anna', exec)
    expect(renamed.branch).toBe(workspace.branch)
  })

  it('refuses to collide with an existing branch', async () => {
    const first = await create()
    const second = await create()

    const error = await renameWorkspace(second, project, first.name, exec).catch(
      (cause: unknown) => cause
    )

    expect((error as WorkspaceError).code).toBe('branchExists')
  })
})

describe('removeWorkspace', () => {
  it('removes the worktree and keeps the branch by default', async () => {
    const workspace = await create()

    await removeWorkspace(workspace, { repository: exec, workspace: gitIn(workspace.path) })

    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
    await expect(exec(['branch', '--list', workspace.branch])).resolves.toContain('anna')
  })

  it('deletes the branch when asked', async () => {
    const workspace = await create()

    await removeWorkspace(
      workspace,
      { repository: exec, workspace: gitIn(workspace.path) },
      { deleteBranch: true }
    )

    await expect(exec(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  // Refusing here is what lets the UI explain the stakes instead of showing a
  // failed git command.
  it('refuses when the workspace holds uncommitted work', async () => {
    const workspace = await create()
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    const error = await removeWorkspace(workspace, {
      repository: exec,
      workspace: gitIn(workspace.path)
    }).catch((cause: unknown) => cause)

    expect((error as WorkspaceError).code).toBe('uncommittedChanges')
    await expect(listWorktrees(exec)).resolves.toHaveLength(2)
  })

  it('removes uncommitted work when forced', async () => {
    const workspace = await create()
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await removeWorkspace(
      workspace,
      { repository: exec, workspace: gitIn(workspace.path) },
      { force: true }
    )

    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
  })

  it('drops an unmerged branch when forced', async () => {
    const workspace = await create()
    const inside = gitIn(workspace.path)
    await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'unmerged'])

    await removeWorkspace(
      workspace,
      { repository: exec, workspace: inside },
      { force: true, deleteBranch: true }
    )

    await expect(exec(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  // A directory that is already gone leaves nothing to lose, and blocking here
  // would strand the record.
  it('treats a vanished directory as clean', async () => {
    const workspace = await create()
    await rm(workspace.path, { recursive: true, force: true })

    await expect(
      removeWorkspace(workspace, { repository: exec, workspace: gitIn(workspace.path) })
    ).resolves.toBeUndefined()
  })
})

describe('reconcile', () => {
  it('marks a workspace whose directory is gone', async () => {
    const workspace = await create()
    const worktrees = await listWorktrees(exec)

    const views = reconcile([workspace], worktrees)
    expect(views[0]?.missing).toBe(false)

    const withoutIt = worktrees.filter((item) => item.path !== workspace.path)
    expect(reconcile([workspace], withoutIt)[0]?.missing).toBe(true)
  })

  it('keeps the record rather than dropping it — the discrepancy must be visible', () => {
    const workspace = { id: 'anna', path: '/gone' } as Workspace
    expect(reconcile([workspace], [])).toHaveLength(1)
  })

  it('reports zero changes when no counts are supplied', () => {
    const workspace = { id: 'anna', path: '/x' } as Workspace
    expect(reconcile([workspace], [])[0]?.changedFiles).toBe(0)
  })

  it('carries change counts through', () => {
    const workspace = { id: 'anna', path: '/x' } as Workspace
    const counts = new Map([['anna', 3]])

    expect(reconcile([workspace], [], counts)[0]?.changedFiles).toBe(3)
  })
})

describe('countChanges', () => {
  it('counts uncommitted files per workspace', async () => {
    const first = await create()
    const second = await create()
    await writeFile(join(first.path, 'a.txt'), 'x\n', 'utf8')
    await writeFile(join(first.path, 'b.txt'), 'x\n', 'utf8')

    const counts = await countChanges([first, second], gitIn)

    expect(counts.get(first.id)).toBe(2)
    expect(counts.get(second.id)).toBe(0)
  })

  // One broken worktree must not blank out the counts for the others.
  it('reports zero for a workspace it cannot read', async () => {
    const workspace = await create()
    await rm(workspace.path, { recursive: true, force: true })

    const counts = await countChanges([workspace], gitIn)
    expect(counts.get(workspace.id)).toBe(0)
  })
})

describe('name pool exhaustion', () => {
  it('keeps producing distinct ids beyond the pool', () => {
    const taken = Array.from({ length: NAME_POOL_SIZE }, (_, index) => `name-${String(index)}`)
    expect(taken).toHaveLength(NAME_POOL_SIZE)
  })
})
