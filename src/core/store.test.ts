import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InvalidFileError } from './persist.js'
import {
  addProject,
  addWorkspace,
  assignPort,
  EMPTY_STATE,
  findProject,
  loadState,
  migrate,
  PORT_RANGE_END,
  PORT_RANGE_START,
  type Project,
  removeProject,
  removeWorkspace,
  renameProject,
  saveState,
  type State,
  StateConflictError,
  updateWorkspace,
  type Workspace,
  workspacesOfProject
} from './store.js'

const project: Project = {
  id: 'planner',
  name: 'planner',
  repoPath: '/repos/planner',
  baseBranch: 'main',
  branchPrefix: 'ytsykvas'
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    // Ids are `<project>/<name>`; see the migration tests for the old format.
    id: 'planner/kyiv',
    projectId: 'planner',
    name: 'kyiv',
    branch: 'ytsykvas/kyiv',
    path: '/ws/planner/kyiv',
    status: 'idle',
    sessionId: null,
    port: 3100,
    createdAt: '2026-08-07T12:00:00.000Z',
    ownerId: null,
    ...overrides
  }
}

const withProject: State = addProject(EMPTY_STATE, project)

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-store-'))
  file = join(dir, 'state.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('load and save', () => {
  it('starts empty on first run', async () => {
    await expect(loadState(file)).resolves.toEqual(EMPTY_STATE)
  })

  it('reads saved state back without loss', async () => {
    const state = addWorkspace(withProject, makeWorkspace())
    await saveState(state, file, `${file}.tmp`)
    await expect(loadState(file)).resolves.toEqual(state)
  })

  it('throws on a corrupt file rather than silently emptying the workspace list', async () => {
    await writeFile(file, '{ broken', 'utf8')
    await expect(loadState(file)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('refuses a workspace whose port is outside the allowed range', async () => {
    const broken = { ...withProject, workspaces: [makeWorkspace({ port: 80 })] }
    await expect(saveState(broken, file, `${file}.tmp`)).rejects.toBeInstanceOf(InvalidFileError)
  })
})

describe('migration', () => {
  // Ids used to be the bare name, which collided once two projects each had
  // an `anna`. Old records are rewritten so only one format is ever in play.
  it('qualifies a bare workspace id with its project', () => {
    const legacy: State = {
      ...withProject,
      workspaces: [makeWorkspace({ id: 'kyiv' })]
    }

    expect(migrate(legacy).workspaces[0]?.id).toBe('planner/kyiv')
  })

  it('leaves an already qualified id alone', () => {
    const current: State = {
      ...withProject,
      workspaces: [makeWorkspace({ id: 'planner/kyiv' })]
    }

    expect(migrate(current).workspaces[0]?.id).toBe('planner/kyiv')
  })

  it('runs on load', async () => {
    const legacy = { ...withProject, workspaces: [makeWorkspace({ id: 'kyiv' })] }
    await writeFile(file, JSON.stringify(legacy), 'utf8')

    const loaded = await loadState(file)
    expect(loaded.workspaces[0]?.id).toBe('planner/kyiv')
  })

  it('keeps everything else untouched', () => {
    const legacy: State = { ...withProject, workspaces: [makeWorkspace({ id: 'kyiv' })] }
    const migrated = migrate(legacy)

    expect(migrated.projects).toEqual(legacy.projects)
    expect(migrated.workspaces[0]?.branch).toBe('ytsykvas/kyiv')
  })
})

describe('assignPort', () => {
  it('returns the same port for the same workspace', () => {
    expect(assignPort('kyiv')).toBe(assignPort('kyiv'))
  })

  it('stays within the allowed range', () => {
    for (const id of ['kyiv', 'lviv', 'osaka', 'a', 'a-very-long-workspace-name']) {
      const port = assignPort(id)
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START)
      expect(port).toBeLessThanOrEqual(PORT_RANGE_END)
    }
  })

  it('skips ports already taken', () => {
    const first = assignPort('kyiv')
    expect(assignPort('kyiv', [first])).not.toBe(first)
  })

  it('usually gives different workspaces different ports', () => {
    expect(assignPort('kyiv')).not.toBe(assignPort('lviv'))
  })

  it('throws when the whole range is taken', () => {
    const span = PORT_RANGE_END - PORT_RANGE_START + 1
    const all = Array.from({ length: span }, (_, i) => PORT_RANGE_START + i)
    expect(() => assignPort('kyiv', all)).toThrow(StateConflictError)
  })
})

describe('projects', () => {
  it('is added and found by id', () => {
    expect(findProject(withProject, 'planner')).toEqual(project)
  })

  it('does not find an unknown project', () => {
    expect(findProject(withProject, 'missing')).toBeUndefined()
  })

  it('treats a repeated id as a conflict', () => {
    expect(() => addProject(withProject, project)).toThrow(StateConflictError)
  })

  it('treats the same repository under another id as a conflict too', () => {
    const twin = { ...project, id: 'other' }
    expect(() => addProject(withProject, twin)).toThrow(StateConflictError)
  })

  it('is renamed without touching anything else', () => {
    const renamed = renameProject(withProject, 'planner', 'Weekly planner')
    const project = renamed.projects[0]

    expect(project?.name).toBe('Weekly planner')
    expect(project?.id).toBe('planner')
    expect(project?.repoPath).toBe('/repos/planner')
  })

  it('trims whitespace around a new name', () => {
    expect(renameProject(withProject, 'planner', '  Spaced  ').projects[0]?.name).toBe('Spaced')
  })

  it('refuses an empty name', () => {
    expect(() => renameProject(withProject, 'planner', '   ')).toThrow(StateConflictError)
  })

  it('refuses to rename a project that does not exist', () => {
    expect(() => renameProject(withProject, 'missing', 'Name')).toThrow(StateConflictError)
  })

  it('does not mutate the previous state', () => {
    renameProject(withProject, 'planner', 'Changed')
    expect(withProject.projects[0]?.name).toBe('planner')
  })

  it('leaves other projects alone', () => {
    const two = addProject(withProject, { ...project, id: 'esl', repoPath: '/repos/esl' })
    const renamed = renameProject(two, 'esl', 'ESL')

    expect(renamed.projects.find((item) => item.id === 'esl')?.name).toBe('ESL')
    expect(renamed.projects.find((item) => item.id === 'planner')?.name).toBe('planner')
  })

  it('removes the project workspaces too, leaving no orphans', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const after = removeProject(state, 'planner')
    expect(after.projects).toHaveLength(0)
    expect(after.workspaces).toHaveLength(0)
  })

  it('removing a missing project breaks nothing', () => {
    expect(removeProject(withProject, 'missing').projects).toHaveLength(1)
  })
})

describe('workspaces', () => {
  it('is added to an existing project', () => {
    expect(addWorkspace(withProject, makeWorkspace()).workspaces).toHaveLength(1)
  })

  it('is not added to a project that does not exist', () => {
    const orphan = makeWorkspace({ projectId: 'missing' })
    expect(() => addWorkspace(withProject, orphan)).toThrow(StateConflictError)
  })

  it('treats a repeated id as a conflict', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    expect(() => addWorkspace(state, makeWorkspace())).toThrow(StateConflictError)
  })

  it('treats two workspaces on one branch as a conflict, since git would not allow it', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const twin = makeWorkspace({ id: 'other', branch: 'ytsykvas/kyiv' })
    expect(() => addWorkspace(state, twin)).toThrow(StateConflictError)
  })

  // Two projects are two repositories, so the same branch name in each is two
  // different branches. Treating that as a conflict left every project after
  // the first unable to use the start of the name pool.
  it('allows the same branch name in another project', () => {
    const other = addProject(withProject, { ...project, id: 'esl', repoPath: '/repos/esl' })
    const state = addWorkspace(other, makeWorkspace())
    const twin = makeWorkspace({ id: 'esl/kyiv', projectId: 'esl' })

    expect(addWorkspace(state, twin).workspaces).toHaveLength(2)
  })

  it('are filtered by project', () => {
    const other = addProject(withProject, { ...project, id: 'esl', repoPath: '/repos/esl' })
    const state = addWorkspace(other, makeWorkspace())
    expect(workspacesOfProject(state, 'planner')).toHaveLength(1)
    expect(workspacesOfProject(state, 'esl')).toHaveLength(0)
  })

  it('updates only the fields passed in', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const after = updateWorkspace(state, 'planner/kyiv', { status: 'running', sessionId: 'sess-1' })
    expect(after.workspaces[0]).toMatchObject({
      status: 'running',
      sessionId: 'sess-1',
      branch: 'ytsykvas/kyiv'
    })
  })

  it('updating one workspace leaves its neighbours untouched', () => {
    const first = addWorkspace(withProject, makeWorkspace())
    const state = addWorkspace(
      first,
      makeWorkspace({ id: 'planner/lviv', name: 'lviv', branch: 'ytsykvas/lviv', port: 3200 })
    )

    const after = updateWorkspace(state, 'planner/lviv', { status: 'running' })

    expect(after.workspaces.find((w) => w.id === 'planner/lviv')?.status).toBe('running')
    expect(after.workspaces.find((w) => w.id === 'planner/kyiv')?.status).toBe('idle')
  })

  it('throws when updating a missing workspace instead of silently doing nothing', () => {
    expect(() => updateWorkspace(withProject, 'missing', { status: 'error' })).toThrow(
      StateConflictError
    )
  })

  it('does not mutate the previous state', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    updateWorkspace(state, 'planner/kyiv', { status: 'error' })
    expect(state.workspaces[0]?.status).toBe('idle')
  })

  it('is removed by id', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    expect(removeWorkspace(state, 'planner/kyiv').workspaces).toHaveLength(0)
  })

  it('removing a missing one breaks nothing', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    expect(removeWorkspace(state, 'missing').workspaces).toHaveLength(1)
  })
})
