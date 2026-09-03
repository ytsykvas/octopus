import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createProject,
  orderBaseBranches,
  inspectRepository,
  removeProjectData,
  ProjectValidationError,
  uniqueProjectId
} from './projects.js'
import { addProject, EMPTY_STATE, type State } from './store.js'

const run = promisify(execFile)

let dir: string

async function initRepo(path: string, branch = 'main'): Promise<void> {
  await run('git', ['init', '-q', `--initial-branch=${branch}`], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: path })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-projects-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('inspectRepository', () => {
  it('recognises a ready repository', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)

    const info = await inspectRepository(repo)
    expect(info.name).toBe('planner')
    expect(info.baseBranch).toBe('main')
    expect(info.root).toContain('planner')
  })

  it('binds to the root even when a subdirectory was picked', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)
    const nested = join(repo, 'src', 'deep')
    await mkdir(nested, { recursive: true })

    const fromRoot = await inspectRepository(repo)
    const fromNested = await inspectRepository(nested)
    expect(fromNested.root).toBe(fromRoot.root)
    expect(fromNested.name).toBe('planner')
  })

  it('reports a plain directory with a machine-readable code', async () => {
    const error = await inspectRepository(dir).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ProjectValidationError)
    expect((error as ProjectValidationError).code).toBe('notARepository')
  })

  it('rejects a repository without any commit', async () => {
    const repo = join(dir, 'empty')
    await mkdir(repo)
    await run('git', ['init', '-q'], { cwd: repo })

    const error = await inspectRepository(repo).catch((cause: unknown) => cause)
    expect((error as ProjectValidationError).code).toBe('emptyRepository')
  })

  it('rejects when no base branch can be inferred', async () => {
    const repo = join(dir, 'detached')
    await mkdir(repo)
    await initRepo(repo, 'trunk')
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repo })
    await run('git', ['branch', '-m', 'trunk', 'unconventional'], { cwd: repo })
    await run('git', ['checkout', '-q', stdout.trim()], { cwd: repo })
    await run('git', ['branch', '-D', 'unconventional'], { cwd: repo })

    const error = await inspectRepository(repo).catch((cause: unknown) => cause)
    expect((error as ProjectValidationError).code).toBe('noBaseBranch')
  })

  it('passes the offending path along for the message', async () => {
    const error = await inspectRepository(dir).catch((cause: unknown) => cause)
    expect((error as ProjectValidationError).params.path).toBe(dir)
  })
})

describe('uniqueProjectId', () => {
  it('keeps a free identifier as is', () => {
    expect(uniqueProjectId('planner', [])).toBe('planner')
  })

  it('appends a suffix when the identifier is taken', () => {
    expect(uniqueProjectId('planner', ['planner'])).toBe('planner-2')
  })

  it('keeps searching until a free one is found', () => {
    expect(uniqueProjectId('app', ['app', 'app-2', 'app-3'])).toBe('app-4')
  })
})

describe('createProject', () => {
  it('assembles a project record from a directory', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)

    const project = await createProject(repo, 'ytsykvas', EMPTY_STATE)
    expect(project).toMatchObject({
      id: 'planner',
      name: 'planner',
      baseBranch: 'main',
      branchPrefix: 'ytsykvas'
    })
  })

  it('refuses a repository that is already added', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)

    const first = await createProject(repo, 'ytsykvas', EMPTY_STATE)
    const state: State = addProject(EMPTY_STATE, first)

    const error = await createProject(repo, 'ytsykvas', state).catch((cause: unknown) => cause)
    expect((error as ProjectValidationError).code).toBe('duplicateProject')
    expect((error as ProjectValidationError).params.name).toBe('planner')
  })

  it('separates identifiers of same-named repositories in different directories', async () => {
    const first = join(dir, 'a', 'app')
    const second = join(dir, 'b', 'app')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await initRepo(first)
    await initRepo(second)

    const one = await createProject(first, 'ytsykvas', EMPTY_STATE)
    const state = addProject(EMPTY_STATE, one)
    const two = await createProject(second, 'ytsykvas', state)

    expect(one.id).toBe('app')
    expect(two.id).toBe('app-2')
  })

  it('normalises the repository name into an identifier', async () => {
    const repo = join(dir, 'Family Shopping')
    await mkdir(repo)
    await initRepo(repo)

    const project = await createProject(repo, 'ytsykvas', EMPTY_STATE)
    expect(project.id).toBe('family-shopping')
    expect(project.name).toBe('Family Shopping')
  })
})

describe('orderBaseBranches', () => {
  // A real remote list is mostly dependabot noise; the branch anyone actually
  // works from would otherwise be somewhere in the middle of it.
  it('puts the usual base branches first', () => {
    const ordered = orderBaseBranches([
      'origin/dependabot/bundler/puma-8.0.1',
      'origin/develop',
      'origin/release/0.1.1',
      'origin/main'
    ])

    expect(ordered.slice(0, 2)).toEqual(['origin/main', 'origin/develop'])
  })

  it('ranks main above master above develop', () => {
    expect(orderBaseBranches(['origin/develop', 'origin/master', 'origin/main'])).toEqual([
      'origin/main',
      'origin/master',
      'origin/develop'
    ])
  })

  it('matches the last segment, so a bare local branch ranks too', () => {
    expect(orderBaseBranches(['feature/x', 'main'])[0]).toBe('main')
  })

  it('sorts the rest alphabetically', () => {
    expect(orderBaseBranches(['origin/zeta', 'origin/alpha'])).toEqual([
      'origin/alpha',
      'origin/zeta'
    ])
  })

  // A branch that merely contains the word must not jump the queue.
  it('does not promote a branch that only looks like one', () => {
    expect(orderBaseBranches(['origin/maintenance', 'origin/main'])[0]).toBe('origin/main')
  })

  it('leaves the input untouched', () => {
    const input = ['origin/zeta', 'origin/main']
    orderBaseBranches(input)
    expect(input).toEqual(['origin/zeta', 'origin/main'])
  })
})

describe('removeProjectData', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'octopus-projects-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('deletes everything the project kept on this machine', async () => {
    const scripts = join(root, 'projects', 'planner', 'scripts')
    await mkdir(scripts, { recursive: true })
    await writeFile(join(scripts, 'setup.sh'), '#!/bin/sh\n', 'utf8')
    await writeFile(join(root, 'projects', 'planner', 'env'), 'SECRET=1\n', 'utf8')

    /*
     * The skills go with the rest because they sit inside the same directory,
     * and this asserts it rather than assuming: a store left behind would be
     * invisible to the app and inherited whole by the next project to take
     * this id.
     */
    const skill = join(root, 'projects', 'planner', 'skills', 'skills', 'review')
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, 'SKILL.md'), '---\nname: review\n---\n', 'utf8')

    await removeProjectData('planner', root)

    await expect(stat(join(root, 'projects', 'planner'))).rejects.toThrow()
  })

  /*
   * The worktrees' own root, which nothing removed.
   *
   * `removeProjectById` says in its own comment that directories left behind
   * "are invisible to the app but still occupy names, and adding the project
   * back would collide with its own debris". Per-workspace removal is
   * best-effort by design — a worktree deleted from outside must not stop the
   * project going — so those directories stayed, and nothing ever cleared them.
   */
  it('deletes the worktree directories too, not only the project data', async () => {
    const worktree = join(root, 'workspaces', 'planner', 'anna')
    await mkdir(worktree, { recursive: true })
    await writeFile(join(worktree, 'README.md'), 'work\n', 'utf8')

    await removeProjectData('planner', root)

    await expect(stat(join(root, 'workspaces', 'planner'))).rejects.toThrow()
  })

  it('is content with a project that kept nothing', async () => {
    await expect(removeProjectData('planner', root)).resolves.toBeUndefined()
  })

  it('refuses an id that would name a directory somewhere else', async () => {
    /*
     * The id arrives from `state.json`, which is a file somebody can edit, and
     * this is a recursive delete. Refused rather than followed.
     */
    await expect(removeProjectData('../..', root)).rejects.toMatchObject({
      code: 'projectPathEscapes'
    })
    await expect(removeProjectData('a/b', root)).rejects.toMatchObject({
      code: 'projectPathEscapes'
    })
  })
})
