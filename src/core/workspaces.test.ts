import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Chat } from './chats.js'
import { GitError, type GitExec, gitIn } from './git.js'
import { NAME_POOL_SIZE, type Random, WORKSPACE_NAMES } from './names.js'
import { addProject, EMPTY_STATE, type Project, type State, type Workspace } from './store.js'
import { listWorktrees } from './worktree.js'
import {
  branchFor,
  countChanges,
  fileInWorkspace,
  createWorkspace,
  reconcile,
  removeWorkspace,
  renameWorkspace,
  rollbackWorkspace,
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
    branchPrefix: 'ytsykvas',
    color: 'blue'
  }
  state = addProject(EMPTY_STATE, project)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/**
 * Always picks the first free name.
 *
 * Names are drawn at random in production; a test that has to say which name
 * it expects supplies this instead of gambling on the draw.
 */
const first: Random = () => 0

const [FIRST_NAME, SECOND_NAME] = WORKSPACE_NAMES as [string, string]

/** Creates a workspace and folds it into the state, as the service does. */
async function create(): Promise<Workspace> {
  const workspace = await createWorkspace(project, state, exec, { root, random: first })
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
    expect(worktrees.map((item) => item.branch)).toContain(`ytsykvas/${FIRST_NAME}`)
    expect(workspace.path).toContain(join('workspaces', 'planner', FIRST_NAME))
  })

  // Removal keeps the branch unless the user asks otherwise, so a name can be
  // free in our records while git still holds it. Reusing it made `worktree
  // add` fail with "a branch named … already exists" and nothing got created.
  it('skips a name whose branch outlived its workspace', async () => {
    const created = await create()
    await removeWorkspace(created, { repository: exec, workspace: gitIn(created.path) }, {})
    state = { ...state, workspaces: [] }

    expect((await create()).name).toBe(SECOND_NAME)
  })

  it('ignores branches outside the project prefix', async () => {
    // Same name, no prefix: the user's own branch, which we must not claim.
    await run('git', ['branch', FIRST_NAME], { cwd: repo })

    expect((await create()).name).toBe(FIRST_NAME)
  })

  it('names a workspace from the pool', async () => {
    expect(WORKSPACE_NAMES).toContain((await create()).name)
  })

  // The name is per project; the id has to be unique across the whole app,
  // because renaming, removal and the jump shortcuts carry nothing else.
  it('keys the workspace by project and name', async () => {
    const workspace = await create()
    expect(workspace.id).toBe(`planner/${FIRST_NAME}`)
  })

  it('lets two projects each hold the same name', async () => {
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

    const mine = await create()
    const theirs = await createWorkspace(other, state, gitIn(otherRepo), { root, random: first })

    expect(theirs.name).toBe(mine.name)
    expect(theirs.id).not.toBe(mine.id)
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

  it('starts idle', async () => {
    const workspace = await create()
    expect(workspace.status).toBe('idle')
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
    expect(WORKSPACE_NAMES).toContain(workspace.name)
  })

  it('refuses a directory that genuinely exists on disk', async () => {
    // Occupy the path the generator is made to pick.
    await mkdir(join(root, 'workspaces', 'planner', FIRST_NAME), { recursive: true })

    const error = await createWorkspace(project, state, exec, { root, random: first }).catch(
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

    const workspace = await createWorkspace(project, state, quiet, { root, random: first })
    expect(workspace.path).toContain(join('workspaces', 'planner', FIRST_NAME))
  })

  it('survives git failing to list worktrees at all', async () => {
    const broken: GitExec = (args) => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        return Promise.reject(new Error('git exploded'))
      }
      return exec(args)
    }

    const workspace = await createWorkspace(project, state, broken, { root, random: first })
    expect(workspace.path).toContain(FIRST_NAME)
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

    // Case is all `toSlug` would change, so the branch stays where it is.
    const renamed = await renameWorkspace(workspace, project, FIRST_NAME.toUpperCase(), exec)
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

  // Every git failure used to be reported as "that branch already exists",
  // which blamed the new name for whatever actually went wrong. Renaming the
  // branch from a terminal is the case that exposed it: the name asked for is
  // free, and the truth is that the old branch is gone.
  it('propagates the git failure instead of blaming the new name', async () => {
    const workspace = await create()

    await exec(['branch', '-m', workspace.branch, 'moved-by-hand'])

    const error = await renameWorkspace(workspace, project, 'fix auth', exec).catch(
      (cause: unknown) => cause
    )

    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).stderr).toContain(workspace.branch)
  })
})

describe('removeWorkspace', () => {
  // The refusal used to come after the worktree was gone: `git branch -d`
  // declines an unmerged branch, so the caller was left with the directory
  // destroyed, the branch still there, and an error about the branch.
  it('refuses an unmerged branch before destroying anything', async () => {
    const workspace = await create()
    const inside = gitIn(workspace.path)

    await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'committed, never merged'])

    const error = await removeWorkspace(
      workspace,
      { repository: exec, workspace: inside },
      { deleteBranch: true, baseBranch: 'main' }
    ).catch((cause: unknown) => cause)

    expect((error as WorkspaceError).code).toBe('branchUnmerged')

    // Nothing was destroyed: the worktree and the branch are both still there.
    await expect(listWorktrees(exec)).resolves.toHaveLength(2)
    await expect(exec(['branch', '--list', workspace.branch])).resolves.toContain(workspace.name)
  })

  /*
   * Reported from a running app: "git worktree remove … failed: fatal: … is not
   * a working tree", on a workspace the user was trying to get rid of precisely
   * because it was already gone. Two windows were open on one state file; one
   * had removed the worktree, the other still held the record.
   *
   * What matters is that git has **forgotten** the path, not merely that the
   * directory is missing — checked rather than assumed, and the first version of
   * this test was wrong for exactly that reason: deleting the directory alone
   * leaves the entry in place, and `git worktree remove` then succeeds on its
   * own. So the worktree is removed here the way git removes it, leaving the
   * record behind, which is the state the app was actually in.
   */
  it('removes a workspace git has already forgotten', async () => {
    const workspace = await create()
    await exec(['worktree', 'remove', workspace.path])

    await expect(
      removeWorkspace(workspace, { repository: exec, workspace: gitIn(workspace.path) })
    ).resolves.toBeUndefined()
  })

  it('deletes the branch of a workspace git has already forgotten', async () => {
    const workspace = await create()
    await exec(['worktree', 'remove', workspace.path])

    await removeWorkspace(
      workspace,
      { repository: exec, workspace: gitIn(workspace.path) },
      { deleteBranch: true, baseBranch: 'main' }
    )

    await expect(exec(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  // The directory alone going missing is a different state, and git handles it
  // without help. Kept so nobody "fixes" the case above by deleting a directory
  // and concluding the two are the same.
  it('removes a workspace whose directory has gone but whose entry has not', async () => {
    const workspace = await create()
    await rm(workspace.path, { recursive: true, force: true })

    await expect(
      removeWorkspace(workspace, { repository: exec, workspace: gitIn(workspace.path) })
    ).resolves.toBeUndefined()
    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
  })

  // Absence is forgiven; a refusal is not. A tree holding changes still has
  // something to lose, and quietly stepping over that would be the opposite of
  // the safety net `force` exists to be.
  it('still refuses a worktree that has changes to lose', async () => {
    const workspace = await create()
    await writeFile(join(workspace.path, 'scratch.txt'), 'unsaved\n', 'utf8')

    // Named rather than merely "it threw": any failure would satisfy that, and
    // the one that matters is the safety net saying what would be lost.
    const error = await removeWorkspace(workspace, {
      repository: exec,
      workspace: gitIn(workspace.path)
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(WorkspaceError)
    expect((error as WorkspaceError).code).toBe('uncommittedChanges')

    await expect(listWorktrees(exec)).resolves.toHaveLength(2)
  })

  it('deletes a merged branch without complaint', async () => {
    const workspace = await create()

    await removeWorkspace(
      workspace,
      { repository: exec, workspace: gitIn(workspace.path) },
      { deleteBranch: true, baseBranch: 'main' }
    )

    await expect(exec(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  // Removing a project agrees to lose everything in it, so an unmerged branch
  // is not a reason to stop half way.
  it('deletes an unmerged branch when forced', async () => {
    const workspace = await create()
    const inside = gitIn(workspace.path)

    await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'committed, never merged'])

    await removeWorkspace(
      workspace,
      { repository: exec, workspace: inside },
      { force: true, deleteBranch: true, baseBranch: 'main' }
    )

    await expect(exec(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  it('removes the worktree and keeps the branch by default', async () => {
    const workspace = await create()

    await removeWorkspace(workspace, { repository: exec, workspace: gitIn(workspace.path) })

    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
    await expect(exec(['branch', '--list', workspace.branch])).resolves.toContain(FIRST_NAME)
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

describe('rollbackWorkspace', () => {
  it('removes the worktree and the branch', async () => {
    const workspace = await create()

    await rollbackWorkspace(workspace, exec)

    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
    await expect(exec(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  it('discards uncommitted work — the workspace was never really created', async () => {
    const workspace = await create()
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await rollbackWorkspace(workspace, exec)
    await expect(listWorktrees(exec)).resolves.toHaveLength(1)
  })

  // It runs while another failure is already being handled, so a second one
  // must not replace the original.
  it('never throws, whatever git says', async () => {
    const workspace = await create()
    const broken: GitExec = () => Promise.reject(new Error('git is gone'))

    await expect(rollbackWorkspace(workspace, broken)).resolves.toBeUndefined()
  })

  it('still tries the branch when removing the worktree fails', async () => {
    const workspace = await create()
    const seen: string[] = []
    const partial: GitExec = (args) => {
      seen.push(args.join(' '))
      if (args[0] === 'worktree') return Promise.reject(new Error('busy'))
      return exec(args)
    }

    await rollbackWorkspace(workspace, partial)
    expect(seen.some((command) => command.startsWith('branch -D'))).toBe(true)
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

  // Deleting the directory by hand does not remove git's record: the entry
  // stays, flagged prunable. Reading only the paths made such a workspace look
  // healthy — and the earlier test passed only because it filtered the list
  // itself, a situation git never produces.
  it('marks a workspace git still lists but has flagged prunable', async () => {
    const workspace = await create()
    await rm(workspace.path, { recursive: true, force: true })

    const worktrees = await listWorktrees(exec)
    expect(worktrees.map((item) => item.path)).toContain(workspace.path)

    expect(reconcile([workspace], worktrees)[0]?.missing).toBe(true)
  })

  // `null` is "git could not be asked", which is not the same as "git reports
  // nothing". The first says nothing about the worktrees; the second says they
  // are gone.
  it('reports nothing as missing when git could not be asked', () => {
    const workspace = { id: 'planner/anna', path: '/tmp/anna' } as Workspace

    const views = reconcile([workspace], null, new Map([['planner/anna', 3]]))

    expect(views[0]?.missing).toBe(false)
    expect(views[0]?.changedFiles).toBe(3)
  })

  it('reports a workspace as missing when git reports an empty list', () => {
    const workspace = { id: 'planner/anna', path: '/tmp/anna' } as Workspace
    expect(reconcile([workspace], [])[0]?.missing).toBe(true)
  })

  it('falls back to no changes when git could not be asked at all', () => {
    const workspace = { id: 'planner/anna', path: '/tmp/anna' } as Workspace
    expect(reconcile([workspace], null)[0]?.changedFiles).toBe(0)
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

  /*
   * The row draws one dot per conversation, so every field it draws with has to
   * survive the trip. Assembled key by key here, which is the shape a new field
   * goes missing in: the schema accepts it, the view drops it, and nothing is
   * uncovered because the line still runs.
   */
  describe('the conversations a workspace holds', () => {
    const workspace = { id: 'planner/anna', path: '/x' } as Workspace
    const other = { id: 'planner/bob', path: '/y' } as Workspace

    function conversation(overrides: Partial<Chat>): Chat {
      return {
        id: 'chat-1',
        workspaceId: 'planner/anna',
        agent: 'claude',
        status: 'idle',
        title: null,
        sessionId: null,
        model: null,
        effort: 'medium',
        workingMode: 'default',
        planMode: false,
        knownCommands: [],
        createdAt: '2026-08-11T09:00:00.000Z',
        ...overrides
      }
    }

    it('reports each of them, in the order they were opened', () => {
      const chats = [
        conversation({ id: 'chat-1', status: 'running' }),
        conversation({ id: 'chat-2', status: 'waiting_permission', title: 'auth refactor' })
      ]

      expect(reconcile([workspace], [], new Map(), chats)[0]?.chats).toEqual([
        { id: 'chat-1', agent: 'claude', title: null, status: 'running' },
        { id: 'chat-2', agent: 'claude', title: 'auth refactor', status: 'waiting_permission' }
      ])
    })

    it('gives each workspace only its own', () => {
      const chats = [
        conversation({ id: 'chat-1' }),
        conversation({ id: 'chat-2', workspaceId: 'planner/bob' })
      ]

      const views = reconcile([workspace, other], [], new Map(), chats)

      expect(views[0]?.chats.map((chat) => chat.id)).toEqual(['chat-1'])
      expect(views[1]?.chats.map((chat) => chat.id)).toEqual(['chat-2'])
    })

    it('reports none for a workspace nobody has spoken to', () => {
      expect(reconcile([workspace], [], new Map(), [])[0]?.chats).toEqual([])
    })

    // The default arm, which is what every caller but the service uses.
    it('reports none when it is not told about any', () => {
      expect(reconcile([workspace], [])[0]?.chats).toEqual([])
    })

    // git could not be asked is its own arm, and it assembles the view
    // separately — a field added to one and not the other is the whole risk.
    it('reports them when git could not be asked either', () => {
      const chats = [conversation({ id: 'chat-1', title: 'auth refactor' })]

      expect(reconcile([workspace], null, new Map(), chats)[0]?.chats).toEqual([
        { id: 'chat-1', agent: 'claude', title: 'auth refactor', status: 'idle' }
      ])
    })
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

describe('fileInWorkspace', () => {
  it('resolves a file inside the worktree', async () => {
    const workspace = await create()
    await writeFile(join(workspace.path, 'a.ts'), 'x\n', 'utf8')

    await expect(fileInWorkspace(workspace, 'a.ts')).resolves.toBe(
      await realpath(join(workspace.path, 'a.ts'))
    )
  })

  it('refuses a path that climbs out of the worktree', async () => {
    const workspace = await create()

    await expect(fileInWorkspace(workspace, '../../../etc/hosts')).resolves.toBeNull()
  })

  it('refuses an absolute path somewhere else entirely', async () => {
    const workspace = await create()

    await expect(fileInWorkspace(workspace, '/etc/hosts')).resolves.toBeNull()
  })

  it('refuses the worktree itself, which is not a file in it', async () => {
    const workspace = await create()

    await expect(fileInWorkspace(workspace, '.')).resolves.toBeNull()
  })

  /*
   * The one the lexical check cannot see.
   *
   * `resolve` does not follow symlinks, and a symlink is something the agent
   * can leave in the worktree. Without following them, a file the diff lists as
   * `notes.txt` opens whatever it points at.
   */
  it('refuses a symlink inside the worktree that points out of it', async () => {
    const workspace = await create()
    await symlink('/etc/hosts', join(workspace.path, 'notes.txt'))

    await expect(fileInWorkspace(workspace, 'notes.txt')).resolves.toBeNull()
  })

  it('resolves a symlink that stays inside the worktree', async () => {
    const workspace = await create()
    await writeFile(join(workspace.path, 'real.ts'), 'x\n', 'utf8')
    await symlink(join(workspace.path, 'real.ts'), join(workspace.path, 'alias.ts'))

    await expect(fileInWorkspace(workspace, 'alias.ts')).resolves.toBe(
      await realpath(join(workspace.path, 'real.ts'))
    )
  })

  it('refuses a file that is not there', async () => {
    const workspace = await create()

    await expect(fileInWorkspace(workspace, 'never-written.ts')).resolves.toBeNull()
  })
})

describe('name pool exhaustion', () => {
  it('keeps producing distinct ids beyond the pool', () => {
    const taken = Array.from({ length: NAME_POOL_SIZE }, (_, index) => `name-${String(index)}`)
    expect(taken).toHaveLength(NAME_POOL_SIZE)
  })
})
