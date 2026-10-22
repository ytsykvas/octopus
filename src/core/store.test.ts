import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { NotesBodySchema } from './notes.js'

import { InvalidFileError } from './persist.js'
import {
  addChat,
  type AgentCommand,
  AgentModelSchema,
  addProject,
  addWorkspace,
  type Chat,
  allChatsOfWorkspace,
  chatsOfWorkspace,
  closedChatsOfWorkspace,
  knownUnchanged,
  expiredClosedChats,
  EMPTY_STATE,
  findChat,
  findProject,
  loadState,
  migrate,
  modelsUnchanged,
  skillsRemembered,
  PROJECT_COLORS,
  type Project,
  ProjectSchema,
  editProject,
  ProjectEditSchema,
  recordApproval,
  rememberModels,
  rememberSkills,
  removeProject,
  reorderProjects,
  removeWorkspace,
  updateProject,
  saveState,
  type State,
  StateConflictError,
  removeChat,
  updateChat,
  updateWorkspace,
  type Workspace,
  workspacesOfProject,
  type ProjectPatch,
  ProjectPatchSchema,
  workspaceStatusFrom
} from './store.js'

const project: Project = {
  id: 'planner',
  name: 'planner',
  repoPath: '/repos/planner',
  baseBranch: 'main',
  branchPrefix: 'ytsykvas',
  envFile: '.env',
  approvedSettings: [],
  approvedScripts: [],
  envProfile: 'default',
  trustRepoScripts: false,
  trustRepository: false,
  preferLocal: [],
  disabledSkillDefaults: [],
  color: 'blue'
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
    port: 3100,
    createdAt: '2026-08-07T12:00:00.000Z',
    branchSince: null,
    envProfile: null,
    writers: {},
    notes: '',
    envFileApplied: null,
    ownerId: null,
    ...overrides
  }
}

/** A chat of `makeWorkspace`'s workspace, for the tests about loading. */
function storedChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-1',
    workspaceId: 'planner/kyiv',
    agent: 'claude',
    status: 'idle',
    interrupted: false,
    title: null,
    sessionId: null,
    resumeAt: null,
    model: null,
    planModel: null,
    planEffort: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    autoCompactWindow: null,
    knownCommands: [],
    knownAgents: [],
    skillOverrides: {},
    closedAt: null,
    createdAt: '2026-08-07T12:00:00.000Z',
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

  it('reads a chosen icon back', async () => {
    const marked = updateProject(withProject, 'planner', { icon: 'rocket' })
    await saveState(marked, file, `${file}.tmp`)

    await expect(loadState(file)).resolves.toEqual(marked)
  })

  // A project copies the prefix as it was when it was added, so one stored
  // with a slash too many kept failing every workspace after the setting was
  // put right.
  it('reads a project’s stored branch prefix as git will take it', async () => {
    const stored = {
      ...withProject,
      projects: withProject.projects.map((one) => ({ ...one, branchPrefix: 'octo/' }))
    }
    await writeFile(file, JSON.stringify(stored), 'utf8')

    const loaded = await loadState(file)
    expect(loaded.projects[0]?.branchPrefix).toBe('octo')
  })

  // Every project on disk predates icons, and a state file that refused to load
  // over a missing key would lose the whole list.
  it('loads a project written before icons existed', async () => {
    await writeFile(file, JSON.stringify(withProject), 'utf8')

    const loaded = await loadState(file)
    expect(loaded.projects[0]?.icon).toBeUndefined()
  })

  /*
   * `running` describes a session, and no session survives the process that
   * held it. A conversation left mid-turn when the app quit would otherwise
   * come back claiming to be working, with nothing behind the claim and nothing
   * that would ever correct it — and its workspace along with it, since the
   * workspace's own status is derived from its conversations.
   */
  it('puts down a status the last run was carrying', async () => {
    const working = addChat(
      addWorkspace(withProject, makeWorkspace()),
      storedChat({ status: 'running' })
    )
    await saveState(working, file, `${file}.tmp`)

    const loaded = await loadState(file)
    expect(loaded.chats[0]?.status).toBe('idle')
    expect(loaded.workspaces[0]?.status).toBe('idle')
  })

  /*
   * Put down, but not as though it had finished: `idle` alone is drawn as done,
   * and a turn the quit cut off mid-command was announced as finished work.
   */
  it.each(['running', 'waiting_permission'] as const)(
    'remembers a turn left %s as interrupted',
    async (status) => {
      const working = addChat(addWorkspace(withProject, makeWorkspace()), storedChat({ status }))
      await saveState(working, file, `${file}.tmp`)

      const loaded = await loadState(file)
      expect(loaded.chats[0]?.interrupted).toBe(true)
    }
  )

  it.each(['idle', 'error'] as const)(
    'does not call a conversation left %s interrupted',
    async (status) => {
      const resting = addChat(addWorkspace(withProject, makeWorkspace()), storedChat({ status }))
      await saveState(resting, file, `${file}.tmp`)

      const loaded = await loadState(file)
      expect(loaded.chats[0]?.interrupted).toBe(false)
    }
  )

  it('leaves an error alone, which is a record rather than a session', async () => {
    const failed = addChat(
      addWorkspace(withProject, makeWorkspace()),
      storedChat({ status: 'error' })
    )
    await saveState(failed, file, `${file}.tmp`)

    const loaded = await loadState(file)
    expect(loaded.chats[0]?.status).toBe('error')
    expect(loaded.workspaces[0]?.status).toBe('error')
  })

  /*
   * The workspace's status is derived, so it has nothing of its own to keep.
   * A file whose workspace says `error` while every conversation in it is idle
   * was written by an older build — or by hand — and the conversations are what
   * the application acts on.
   */
  it('derives a workspace with no conversations back to idle', async () => {
    const failed = updateWorkspace(addWorkspace(withProject, makeWorkspace()), 'planner/kyiv', {
      status: 'error'
    })
    await saveState(failed, file, `${file}.tmp`)

    const loaded = await loadState(file)
    expect(loaded.workspaces[0]?.status).toBe('idle')
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

    expect(migrated.projects[0]?.name).toBe('planner')
    expect(migrated.workspaces[0]?.branch).toBe('ytsykvas/kyiv')
  })

  // A default in the schema would give every project written before colours
  // existed the same one, which is precisely what the colour is meant to avoid.
  it('gives colourless projects distinct colours', () => {
    const legacy = {
      version: 1 as const,
      projects: [
        { ...project, color: undefined },
        { ...project, id: 'esl', repoPath: '/repos/esl', color: undefined },
        { ...project, id: 'planner-2', repoPath: '/repos/planner-2', color: undefined }
      ],
      workspaces: [],
      chats: [],
      knownModels: [],
      knownSkills: [],
      usageWindows: null
    }

    const colours = migrate(legacy).projects.map((item) => item.color)
    expect(new Set(colours).size).toBe(3)
  })

  it('leaves a project that already has a colour alone', () => {
    const stored = {
      version: 1 as const,
      projects: [{ ...project, color: 'teal' as const }],
      workspaces: [],
      chats: [],
      knownModels: [],
      knownSkills: [],
      usageWindows: null
    }

    expect(migrate(stored).projects[0]?.color).toBe('teal')
  })

  // A colour already in use must not be handed out again to the project
  // sitting next to it in the same list.
  it('avoids a colour a neighbouring project already holds', () => {
    const stored = {
      version: 1 as const,
      projects: [
        { ...project, color: PROJECT_COLORS[0] },
        { ...project, id: 'esl', repoPath: '/repos/esl', color: undefined }
      ],
      workspaces: [],
      chats: [],
      knownModels: [],
      knownSkills: [],
      usageWindows: null
    }

    expect(migrate(stored).projects[1]?.color).not.toBe(PROJECT_COLORS[0])
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
    const renamed = updateProject(withProject, 'planner', { name: 'Weekly planner' })
    const project = renamed.projects[0]

    expect(project?.name).toBe('Weekly planner')
    expect(project?.id).toBe('planner')
    expect(project?.repoPath).toBe('/repos/planner')
  })

  it('changes the base branch new workspaces start from', () => {
    const updated = updateProject(withProject, 'planner', { baseBranch: 'develop' })
    expect(updated.projects[0]?.baseBranch).toBe('develop')
  })

  // The modal edits one field at a time, so a patch must not carry a stale
  // copy of the others back into the state.
  it('touches only the fields the patch carries', () => {
    const updated = updateProject(withProject, 'planner', { baseBranch: 'develop' })
    expect(updated.projects[0]?.name).toBe('planner')
  })

  /*
   * The same rule, asked of a patch that has been through the schema.
   *
   * The test above hands `updateProject` an object literal, which is not what
   * the boundary hands it: `ProjectPatchSchema.parse` is where a key the caller
   * left out acquires a value, and `updateProject` applies anything that is not
   * `undefined`. A patch of one field has to stay a patch of one field for the
   * spread's `!== undefined` guard to mean anything at all.
   */
  it('carries nothing a parsed patch was not given', () => {
    const stored: State = addProject(EMPTY_STATE, {
      ...project,
      envFile: '.env.local',
      envProfile: 'prod',
      trustRepoScripts: true,
      approvedScripts: ['a-digest']
    })

    const updated = updateProject(stored, 'planner', ProjectPatchSchema.parse({ color: 'teal' }))

    expect(updated.projects[0]).toMatchObject({
      color: 'teal',
      envFile: '.env.local',
      envProfile: 'prod',
      trustRepoScripts: true,
      approvedScripts: ['a-digest']
    })
  })

  /*
   * Every field the patch may carry, asserted to actually land.
   *
   * The bug this exists for has happened twice, with the same shape both
   * times: `updateProject` spreads its fields one by one — `...(name !==
   * undefined && { name })` — which is what stops a patch writing back stale
   * copies of what it does not carry, and pays for it by silently dropping a
   * field somebody added to the type and not to the spread. The colour picker
   * looked inert for a week for exactly this.
   *
   * A `Record` over the patch's own keys rather than a list, and that is the
   * whole point: a field added to `ProjectPatchSchema` fails to **compile**
   * here until it is given a value, and then fails to pass until the spread
   * applies it. Written as a list it could only ever hold what somebody
   * remembered to add — the same reasoning as `CODE_PARAMETERS` in
   * `useErrorMessage.test.tsx`.
   */
  const CHANGES: { readonly [K in keyof Required<ProjectPatch>]: NonNullable<ProjectPatch[K]> } = {
    name: 'Weekly planner',
    baseBranch: 'develop',
    color: 'teal',
    icon: 'rocket',
    envFile: 'config/.env',
    approvedSettings: ['a-digest'],
    approvedScripts: ['another-digest'],
    envProfile: 'prod',
    trustRepoScripts: true,
    trustRepository: true,
    repoPath: '/repos/moved'
  }

  it.each(Object.keys(CHANGES) as (keyof typeof CHANGES)[])(
    'applies %s rather than dropping it on the way through',
    (field) => {
      const updated = updateProject(withProject, 'planner', { [field]: CHANGES[field] })

      expect(updated.projects[0]?.[field]).toEqual(CHANGES[field])
    }
  )

  // The patch type grew a field and the update forgot to apply it, so the
  // colour picker looked like it did nothing at all.
  it('changes the colour', () => {
    const updated = updateProject(withProject, 'planner', { color: 'teal' })
    expect(updated.projects[0]?.color).toBe('teal')
  })

  it('changes the colour without disturbing the name or branch', () => {
    const updated = updateProject(withProject, 'planner', { color: 'amber' })

    expect(updated.projects[0]?.name).toBe('planner')
    expect(updated.projects[0]?.baseBranch).toBe('main')
  })

  it('marks the project with an icon', () => {
    const updated = updateProject(withProject, 'planner', { icon: 'rocket' })
    expect(updated.projects[0]?.icon).toBe('rocket')
  })

  // `null` is how the dialog says "back to the initials"; anything that treated
  // it as "no value supplied" would make the icon impossible to take off again.
  it('clears the icon when the patch carries null', () => {
    const marked = updateProject(withProject, 'planner', { icon: 'rocket' })
    const cleared = updateProject(marked, 'planner', { icon: null })

    expect(cleared.projects[0]?.icon).toBeNull()
  })

  it('keeps the icon when the patch says nothing about it', () => {
    const marked = updateProject(withProject, 'planner', { icon: 'rocket' })
    const renamed = updateProject(marked, 'planner', { name: 'Weekly planner' })

    expect(renamed.projects[0]?.icon).toBe('rocket')
  })

  it('accepts an empty patch as a no-op', () => {
    expect(updateProject(withProject, 'planner', {}).projects[0]).toEqual(withProject.projects[0])
  })

  it('trims whitespace around a new name', () => {
    expect(updateProject(withProject, 'planner', { name: '  Spaced  ' }).projects[0]?.name).toBe(
      'Spaced'
    )
  })

  it('trims whitespace around a base branch', () => {
    expect(
      updateProject(withProject, 'planner', { baseBranch: ' develop ' }).projects[0]?.baseBranch
    ).toBe('develop')
  })

  it('refuses an empty name', () => {
    expect(() => updateProject(withProject, 'planner', { name: '   ' })).toThrow(StateConflictError)
  })

  it('refuses an empty base branch', () => {
    expect(() => updateProject(withProject, 'planner', { baseBranch: '  ' })).toThrow(
      StateConflictError
    )
  })

  it('refuses to update a project that does not exist', () => {
    expect(() => updateProject(withProject, 'missing', { name: 'Name' })).toThrow(
      StateConflictError
    )
  })

  it('does not mutate the previous state', () => {
    updateProject(withProject, 'planner', { name: 'Changed' })
    expect(withProject.projects[0]?.name).toBe('planner')
  })

  it('leaves other projects alone', () => {
    const two = addProject(withProject, { ...project, id: 'esl', repoPath: '/repos/esl' })
    const renamed = updateProject(two, 'esl', { name: 'ESL' })

    expect(renamed.projects.find((item) => item.id === 'esl')?.name).toBe('ESL')
    expect(renamed.projects.find((item) => item.id === 'planner')?.name).toBe('planner')
  })

  it('removes the project workspaces too, leaving no orphans', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const after = removeProject(state, 'planner')
    expect(after.projects).toHaveLength(0)
    expect(after.workspaces).toHaveLength(0)
  })

  describe('reorderProjects', () => {
    const two = addProject(withProject, { ...project, id: 'esl', repoPath: '/repos/esl' })
    const three = addProject(two, { ...project, id: 'ledger', repoPath: '/repos/ledger' })
    const idsOf = (state: typeof three): string[] => state.projects.map((item) => item.id)

    it('puts the projects in the order given', () => {
      expect(idsOf(reorderProjects(three, ['ledger', 'planner', 'esl']))).toEqual([
        'ledger',
        'planner',
        'esl'
      ])
    })

    // The window's list can be a step behind: a project added since it was
    // read must not vanish, nor one removed since come back.
    it('keeps a project the list lacks, last, and ignores an id that is gone', () => {
      expect(idsOf(reorderProjects(three, ['gone', 'ledger', 'esl']))).toEqual([
        'ledger',
        'esl',
        'planner'
      ])
    })
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
    const after = updateWorkspace(state, 'planner/kyiv', { status: 'running', port: 3200 })
    expect(after.workspaces[0]).toMatchObject({
      status: 'running',
      port: 3200,
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

describe('chats', () => {
  function makeChat(overrides: Partial<Chat> = {}): Chat {
    return {
      id: 'chat-1',
      workspaceId: 'planner/kyiv',
      agent: 'claude',
      status: 'idle',
      interrupted: false,
      title: null,
      sessionId: null,
      resumeAt: null,
      model: null,
      planModel: null,
      planEffort: null,
      effort: 'medium',
      workingMode: 'default',
      planMode: false,
      autoCompactWindow: null,
      knownCommands: [],
      knownAgents: [],
      skillOverrides: {},
      closedAt: null,
      createdAt: '2026-08-11T09:00:00.000Z',
      ...overrides
    }
  }

  const withWorkspace: State = addWorkspace(withProject, makeWorkspace())

  it('starts with none', () => {
    expect(chatsOfWorkspace(withWorkspace, 'planner/kyiv')).toEqual([])
  })

  it('adds a chat to its workspace', () => {
    const state = addChat(withWorkspace, makeChat())

    expect(chatsOfWorkspace(state, 'planner/kyiv')).toHaveLength(1)
    expect(findChat(state, 'chat-1')).toEqual(makeChat())
  })

  it('answers nothing for an id it does not have', () => {
    expect(findChat(withWorkspace, 'chat-nothing')).toBeUndefined()
  })

  // A chat with nowhere to run is a bug in the caller, not a state to render.
  it('refuses a chat whose workspace does not exist', () => {
    expect(() => addChat(withProject, makeChat())).toThrow(StateConflictError)
  })

  it('refuses to add the same chat twice', () => {
    const state = addChat(withWorkspace, makeChat())

    expect(() => addChat(state, makeChat())).toThrow(StateConflictError)
  })

  // The session id is what makes a conversation survive a restart, so writing
  // it back is the single most important update this makes.
  it('records the session id', () => {
    const state = updateChat(addChat(withWorkspace, makeChat()), 'chat-1', {
      sessionId: 'sess-9'
    })

    expect(findChat(state, 'chat-1')?.sessionId).toBe('sess-9')
  })

  it('leaves fields the patch does not mention alone', () => {
    const state = updateChat(addChat(withWorkspace, makeChat()), 'chat-1', {
      planMode: true
    })

    expect(findChat(state, 'chat-1')).toMatchObject({
      planMode: true,
      createdAt: '2026-08-11T09:00:00.000Z'
    })
  })

  it('leaves the other chats of the workspace alone', () => {
    const two = addChat(addChat(withWorkspace, makeChat()), makeChat({ id: 'chat-2' }))
    const state = updateChat(two, 'chat-2', { sessionId: 'sess-9' })

    expect(findChat(state, 'chat-1')?.sessionId).toBeNull()
    expect(findChat(state, 'chat-2')?.sessionId).toBe('sess-9')
  })

  it('refuses to update a chat that is not there', () => {
    expect(() => updateChat(withWorkspace, 'chat-nothing', { model: 'x' })).toThrow(
      StateConflictError
    )
  })

  it('keeps two workspaces of the same project apart', () => {
    const both = addWorkspace(
      withWorkspace,
      makeWorkspace({ id: 'planner/lviv', name: 'lviv', branch: 'ytsykvas/lviv', port: 3101 })
    )
    const state = addChat(
      addChat(both, makeChat()),
      makeChat({ id: 'chat-2', workspaceId: 'planner/lviv' })
    )

    expect(chatsOfWorkspace(state, 'planner/lviv').map((chat) => chat.id)).toEqual(['chat-2'])
  })

  // A transcript outliving its workspace would be unreachable: nothing in the
  // state points at it any more.
  it('goes when its workspace goes', () => {
    const state = removeWorkspace(addChat(withWorkspace, makeChat()), 'planner/kyiv')

    expect(state.chats).toEqual([])
  })

  it('goes when its project goes', () => {
    const state = removeProject(addChat(withWorkspace, makeChat()), 'planner')

    expect(state.chats).toEqual([])
  })

  // A conversation saved before a window could be chosen left it to the agent,
  // which is what null says. Without the default the reader would throw, and
  // the app would not open.
  it('loads a conversation written before its compaction window could be chosen', async () => {
    const older: Record<string, unknown> = { ...storedChat() }
    delete older.autoCompactWindow
    await writeFile(
      file,
      JSON.stringify({ ...withProject, workspaces: [makeWorkspace()], chats: [older] }),
      'utf8'
    )

    const loaded = await loadState(file)
    expect(loaded.chats[0]?.autoCompactWindow).toBeNull()
  })

  // A state file written before chats existed must still load; that is why the
  // field carries a default rather than a version bump.
  it('loads a state file that predates chats', async () => {
    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project], workspaces: [] }),
      'utf8'
    )

    await expect(loadState(file)).resolves.toMatchObject({ chats: [] })
  })
})

describe('the remembered skills', () => {
  const loop = { name: 'loop', description: 'Run it on a loop.', builtin: true }
  const docx = { name: 'docx', description: 'Word documents. (claude.ai sync)', builtin: false }

  it('starts empty', () => {
    expect(EMPTY_STATE.knownSkills).toEqual([])
  })

  /* The answer that follows a switch leaves the withheld skill out, and that
     is the one whose description the panel still needs. */
  it('keeps a skill the next answer leaves out', () => {
    const first = rememberSkills(EMPTY_STATE, [loop, docx])
    const second = rememberSkills(first, [docx])

    expect(second.knownSkills).toEqual([loop, docx])
  })

  it('takes the newest description of one it already had', () => {
    const first = rememberSkills(EMPTY_STATE, [loop])
    const second = rememberSkills(first, [{ ...loop, description: 'Loop, reworded.' }])

    expect(second.knownSkills).toEqual([{ ...loop, description: 'Loop, reworded.' }])
  })

  it('keeps only the fields it draws from', () => {
    const extra = { ...loop, argumentHint: '[interval]' }

    expect(rememberSkills(EMPTY_STATE, [extra]).knownSkills).toEqual([loop])
  })

  it('recognises an answer it holds already, and one that says something new', () => {
    const stored = rememberSkills(EMPTY_STATE, [loop, docx])

    expect(skillsRemembered(stored, [docx])).toBe(true)
    expect(skillsRemembered(stored, [])).toBe(true)
    expect(skillsRemembered(stored, [{ ...loop, description: 'New.' }])).toBe(false)
    expect(skillsRemembered(stored, [{ ...loop, builtin: false }])).toBe(false)
    expect(skillsRemembered(stored, [{ ...loop, name: 'schedule' }])).toBe(false)
  })
})

describe('the remembered model list', () => {
  const opus = { value: 'claude-opus-5', displayName: 'Opus 5', description: '' }
  const model = AgentModelSchema.parse(opus)

  it('starts empty', () => {
    expect(EMPTY_STATE.knownModels).toEqual([])
  })

  it('replaces the list rather than adding to it', () => {
    const first = rememberModels(EMPTY_STATE, [model])
    const second = rememberModels(first, [])

    expect(second.knownModels).toEqual([])
  })

  it('recognises a list that says exactly the same thing', () => {
    const stored = rememberModels(EMPTY_STATE, [model])

    expect(modelsUnchanged(stored, [model])).toBe(true)
    expect(modelsUnchanged(stored, [{ ...model, displayName: 'Opus five' }])).toBe(false)
  })

  // A state file from before the field existed has to load: the reader throws
  // on a mismatch, so a missing default would stop the app opening.
  it('loads a state written before models were remembered', async () => {
    await writeFile(file, JSON.stringify({ ...withProject, chats: [] }), 'utf8')

    await expect(loadState(file)).resolves.toMatchObject({ knownModels: [] })
  })

  it('loads a state written before skills were remembered', async () => {
    await writeFile(file, JSON.stringify({ ...withProject, chats: [] }), 'utf8')

    await expect(loadState(file)).resolves.toMatchObject({ knownSkills: [] })
  })

  /*
   * The reading the sidebar draws before the agent answers is stored, so every
   * field on a window is a stored field — which is easy to forget, because the
   * rest of `usage.ts` describes a live response.
   *
   * Added without defaults, `severity` and `binding` stopped the whole file
   * parsing: six errors for three windows, and octopus would not start at all.
   * This is the shape a real `state.json` held.
   */
  it('loads a usage reading written before the account was asked what it thought', async () => {
    const before = {
      ...withProject,
      chats: [],
      usageWindows: {
        limits: [
          { key: 'five_hour', label: null, utilization: 50, resetsAt: '2026-09-06T19:00:00Z' },
          { key: 'seven_day', label: null, utilization: 4, resetsAt: null }
        ],
        limitsApply: true,
        readAt: '2026-09-06T11:00:00.000Z'
      }
    }
    await writeFile(file, JSON.stringify(before), 'utf8')

    const state = await loadState(file)

    expect(state.usageWindows?.limits[0]).toMatchObject({ severity: null, binding: false })
    // The same file predates the age of the figures too: no field, and the
    // answer is "not known to be old", not a refusal to start.
    expect(state.usageWindows?.asOf).toBeNull()
  })

  /*
   * And a chat written while "the agent decides" was a choice, which is the
   * harder half: the field is present holding null, so no default answers for
   * it. The whole file would fail to load without the schema normalising it.
   */
  it('loads a chat written while no effort level was a choice', async () => {
    const legacy = {
      id: 'chat-1',
      workspaceId: 'planner/kyiv',
      agent: 'claude',
      status: 'idle',
      interrupted: false,
      title: null,
      sessionId: null,
      model: null,
      effort: null,
      workingMode: 'default',
      planMode: false,
      knownCommands: [],
      knownAgents: [],
      skillOverrides: {},
      createdAt: '2026-08-11T09:00:00.000Z'
    }
    await writeFile(file, JSON.stringify({ ...withProject, chats: [legacy] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.effort).toBe('medium')
  })

  // Auto mode is stored like any other working mode, and a chat left in it
  // has to come back in it.
  it('loads a chat left in auto mode', async () => {
    const chat = {
      id: 'chat-1',
      workspaceId: 'planner/kyiv',
      agent: 'claude',
      status: 'idle',
      title: null,
      sessionId: null,
      model: null,
      effort: 'medium',
      workingMode: 'auto',
      planMode: false,
      knownCommands: [],
      knownAgents: [],
      skillOverrides: {},
      createdAt: '2026-08-11T09:00:00.000Z'
    }
    await writeFile(file, JSON.stringify({ ...withProject, chats: [chat] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.workingMode).toBe('auto')
  })

  // Written before a conversation could be rewound: it never was, so there is
  // no cut waiting to be applied — and the file must still open.
  it('loads a chat written before a rewind could leave a cut waiting', async () => {
    const { resumeAt, ...older } = storedChat()
    expect(resumeAt).toBeNull()
    await writeFile(file, JSON.stringify({ ...withProject, chats: [older] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.resumeAt).toBeNull()
  })

  // Written before a cut-off turn was told apart from a finished one: it was
  // not interrupted — and the file must still open.
  it('loads a chat written before interruptions were remembered', async () => {
    const { interrupted, ...older } = storedChat()
    expect(interrupted).toBe(false)
    await writeFile(file, JSON.stringify({ ...withProject, chats: [older] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.interrupted).toBe(false)
  })

  // Written before the `@` list offered agents: it knows none until the next
  // session says — and the file must still open.
  it('loads a chat written before agents were remembered', async () => {
    const { knownAgents, ...older } = storedChat()
    expect(knownAgents).toEqual([])
    await writeFile(file, JSON.stringify({ ...withProject, chats: [older] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.knownAgents).toEqual([])
  })

  // Remembered before a command could be marked a skill: it reads as not one
  // until the next session says otherwise — and the file must still open.
  it('loads a remembered command written before skills were marked', async () => {
    const older = {
      ...storedChat(),
      knownCommands: [{ name: 'deploy', description: '', argumentHint: '', aliases: [] }]
    }
    await writeFile(file, JSON.stringify({ ...withProject, chats: [older] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.knownCommands).toEqual([
      { name: 'deploy', description: '', argumentHint: '', aliases: [], skill: false }
    ])
  })
})

/*
 * The commands are kept on the chat rather than beside the models above,
 * because their scope is the worktree: a project's own live in its
 * `.claude/commands/`, and two workspaces of one project sit on two branches.
 */
describe('the commands a chat remembers', () => {
  const command: AgentCommand = {
    name: 'deploy',
    description: 'Ship it',
    argumentHint: '<env>',
    aliases: [],
    skill: false
  }

  const chat: Chat = {
    id: 'chat-1',
    workspaceId: 'planner/kyiv',
    agent: 'claude',
    status: 'idle',
    interrupted: false,
    title: null,
    sessionId: null,
    resumeAt: null,
    model: null,
    planModel: null,
    planEffort: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    autoCompactWindow: null,
    knownCommands: [],
    knownAgents: [],
    skillOverrides: {},
    closedAt: null,
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  // Asked on every session start, so without this every restart of every
  // conversation would rewrite the state file to the same bytes.
  it('recognises a list that says exactly the same thing', () => {
    expect(
      knownUnchanged({ ...chat, knownCommands: [command] }, { knownCommands: [command] })
    ).toBe(true)
    expect(knownUnchanged(chat, { knownCommands: [] })).toBe(true)
  })

  it('notices a command added, removed or renamed', () => {
    const knowing = { ...chat, knownCommands: [command] }

    expect(knownUnchanged(knowing, { knownCommands: [] })).toBe(false)
    expect(
      knownUnchanged(knowing, { knownCommands: [command, { ...command, name: 'rollback' }] })
    ).toBe(false)
    expect(
      knownUnchanged(knowing, { knownCommands: [{ ...command, description: 'Ship it now' }] })
    ).toBe(false)
  })

  // The agents are kept the same way, and compared against their own list —
  // never against the commands, which a shared helper could easily do.
  it('compares the agents against the agents', () => {
    const reviewer = { name: 'reviewer', description: 'Reviews a change' }
    const knowing = { ...chat, knownCommands: [command], knownAgents: [reviewer] }

    expect(knownUnchanged(knowing, { knownAgents: [reviewer] })).toBe(true)
    expect(knownUnchanged(knowing, { knownAgents: [] })).toBe(false)
    expect(knownUnchanged(chat, { knownAgents: [] })).toBe(true)
  })
})

describe('what a workspace is doing, from its conversations', () => {
  function chatWith(id: string, status: Chat['status']): Chat {
    return storedChat({ id, status })
  }

  it('is idle when it holds none at all', () => {
    expect(workspaceStatusFrom([])).toBe('idle')
  })

  it('is idle when every conversation is', () => {
    expect(workspaceStatusFrom([chatWith('a', 'idle'), chatWith('b', 'idle')])).toBe('idle')
  })

  /*
   * The order is what the sidebar's single dot should say when they disagree.
   * A turn that has stopped and is waiting on an answer is the one state worth
   * crossing the window for, so it outranks work still going.
   */
  it('waits for an answer over anything else', () => {
    expect(
      workspaceStatusFrom([
        chatWith('a', 'running'),
        chatWith('b', 'waiting_permission'),
        chatWith('c', 'error')
      ])
    ).toBe('waiting_permission')
  })

  // The dot says what is happening now; a failed turn is a record of something
  // that already happened.
  it('reports work in flight over a turn that failed', () => {
    expect(workspaceStatusFrom([chatWith('a', 'error'), chatWith('b', 'running')])).toBe('running')
  })

  it('reports a failure when nothing is running', () => {
    expect(workspaceStatusFrom([chatWith('a', 'idle'), chatWith('b', 'error')])).toBe('error')
  })
})

describe('removing a conversation', () => {
  const twoChats = addChat(
    addChat(addWorkspace(withProject, makeWorkspace()), storedChat()),
    storedChat({ id: 'chat-2' })
  )

  it('drops the one asked for and leaves its siblings', () => {
    const left = removeChat(twoChats, 'chat-1')

    expect(left.chats.map((chat) => chat.id)).toEqual(['chat-2'])
  })

  /*
   * Unlike `updateChat`, which throws. Removal is idempotent, and the one
   * caller reaches here after closing a live session — exactly the window in
   * which the record can already have gone.
   */
  it('says nothing about an id that is not there', () => {
    expect(removeChat(twoChats, 'chat-9').chats).toHaveLength(2)
  })
})

describe('the env file a project writes its variables into', () => {
  // `.env` is only most stacks. Vite reads `.env.local` and would ignore
  // anything written beside it, so a project on one had nowhere to put them.
  it('is changed like any other editable field', () => {
    const next = updateProject(withProject, 'planner', { envFile: '.env.local' })

    expect(next.projects[0]?.envFile).toBe('.env.local')
  })

  it('drops the spaces around it', () => {
    const next = updateProject(withProject, 'planner', { envFile: '  .env.local  ' })

    expect(next.projects[0]?.envFile).toBe('.env.local')
  })

  it('refuses to be emptied, since the block has to go somewhere', () => {
    expect(() => updateProject(withProject, 'planner', { envFile: '   ' })).toThrow(
      expect.objectContaining({ code: 'envFileEmpty' })
    )
  })

  /*
   * It is joined to a worktree path, so it has to stay inside one — the same
   * rule the carry list applies to every line it reads. A block of credentials
   * written to an absolute path is a file nobody expected to be touched.
   */
  it('refuses a path that climbs out of the workspace', () => {
    // The code, not merely the class. Without one the refusal reaches the window
    // as its English sentence inside a localised frame, which is the one thing
    // that fallback is documented as being for logs alone.
    expect(() => updateProject(withProject, 'planner', { envFile: '../.env' })).toThrow(
      expect.objectContaining({ code: 'envFileEscapes', params: { path: '../.env' } })
    )
    expect(() => updateProject(withProject, 'planner', { envFile: '/etc/passwd' })).toThrow(
      expect.objectContaining({ code: 'envFileEscapes' })
    )
  })

  it('allows a file in a directory of the workspace', () => {
    const next = updateProject(withProject, 'planner', { envFile: 'config/.env' })

    expect(next.projects[0]?.envFile).toBe('config/.env')
  })

  // A project written before the field existed still loads, which is what a
  // default is for — the version stays at 1.
  it('falls back to .env for a project stored without one', () => {
    const stored = ProjectSchema.parse({
      id: 'planner',
      name: 'planner',
      repoPath: '/repos/planner',
      baseBranch: 'main',
      branchPrefix: 'ytsykvas'
    })

    expect(stored.envFile).toBe('.env')
  })
})

describe('trusting a repository', () => {
  /*
   * Every project in every state file predates the one switch, and the reader
   * throws on a mismatch — so a missing default would stop the app opening.
   * And it must not be read from the older scripts-only switch: that was a
   * decision about scripts, and carrying it over would extend it to hooks and
   * MCP servers nobody agreed to.
   */
  it('loads a project written before the switch, trusting nothing new', async () => {
    const older: Record<string, unknown> = { ...project, trustRepoScripts: true }
    delete older.trustRepository

    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [older], workspaces: [], chats: [] }),
      'utf8'
    )

    const state = await loadState(file)

    expect(state.projects[0]).toMatchObject({ trustRepository: false, trustRepoScripts: true })
  })
})

describe('choosing your own over the repository', () => {
  // Every project predates the list, and the reader throws on a mismatch.
  it('loads a project written before the choice existed, taking nothing as chosen', async () => {
    const older: Record<string, unknown> = { ...project }
    delete older.preferLocal

    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [older], workspaces: [], chats: [] }),
      'utf8'
    )

    expect((await loadState(file)).projects[0]?.preferLocal).toEqual([])
  })

  // Only the items that can come from a repository can be chosen against it.
  it('refuses an item that is not one', () => {
    expect(
      ProjectEditSchema.safeParse({ kind: 'preferLocal', item: 'script.lint', on: true }).success
    ).toBe(false)
  })

  // A list travels as one switch, never whole: a patch carrying one is a list
  // built from a stale copy, the bug the edit exists to prevent.
  it('takes no list in a patch', () => {
    expect(
      ProjectPatchSchema.parse({ preferLocal: ['script.setup'], disabledSkillDefaults: ['review'] })
    ).toEqual({})
  })

  // The carry list joined the items later; a project that chose its own keeps it.
  it('loads and accepts the carry list as an item', async () => {
    expect(ProjectPatchSchema.safeParse({ preferLocal: ['project.carry'] }).success).toBe(true)

    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        projects: [{ ...project, preferLocal: ['project.carry'] }],
        workspaces: [],
        chats: []
      }),
      'utf8'
    )

    expect((await loadState(file)).projects[0]?.preferLocal).toEqual(['project.carry'])
  })
})

describe('recording an approval', () => {
  const ledger: Project = { ...project, id: 'ledger', name: 'ledger', repoPath: '/repos/ledger' }

  it('adds the digest to the named list of that project alone', () => {
    const state = { ...EMPTY_STATE, projects: [project, ledger] }

    const next = recordApproval(state, 'planner', 'approvedSettings', 'abc')

    expect(next.projects[0]?.approvedSettings).toEqual(['abc'])
    expect(next.projects[0]?.approvedScripts).toEqual([])
    expect(next.projects[1]).toEqual(ledger)
  })

  // Built from the state it is given, so an approval recorded a moment ago is
  // kept rather than overwritten by a list read before it.
  it('keeps what the state already holds', () => {
    const state = { ...EMPTY_STATE, projects: [{ ...project, approvedScripts: ['first'] }] }

    const next = recordApproval(state, 'planner', 'approvedScripts', 'second')

    expect(next.projects[0]?.approvedScripts).toEqual(['first', 'second'])
  })
})

// The config's list edits one layer down — `ProjectEditSchema`.
describe('editing a list of a project', () => {
  const ledger: Project = { ...project, id: 'ledger', name: 'ledger', repoPath: '/repos/ledger' }

  it('switches a skill off by default for that project alone', () => {
    const state = { ...EMPTY_STATE, projects: [project, ledger] }

    const next = editProject(state, 'planner', {
      kind: 'skillDefault',
      key: 'review',
      enabled: false
    })

    expect(next.projects[0]?.disabledSkillDefaults).toEqual(['review'])
    expect(next.projects[1]).toEqual(ledger)
  })

  it('keeps what the record already holds', () => {
    const state = {
      ...EMPTY_STATE,
      projects: [
        { ...project, disabledSkillDefaults: ['ship'], preferLocal: ['project.envFile' as const] }
      ]
    }

    const skills = editProject(state, 'planner', {
      kind: 'skillDefault',
      key: 'review',
      enabled: false
    })
    const local = editProject(skills, 'planner', {
      kind: 'preferLocal',
      item: 'project.baseBranch',
      on: true
    })
    const back = editProject(local, 'planner', {
      kind: 'preferLocal',
      item: 'project.envFile',
      on: false
    })

    expect(back.projects[0]?.disabledSkillDefaults).toEqual(['ship', 'review'])
    expect(back.projects[0]?.preferLocal).toEqual(['project.baseBranch'])
  })

  it('refuses a project that is not there', () => {
    expect(() =>
      editProject(EMPTY_STATE, 'gone', { kind: 'skillDefault', key: 'review', enabled: true })
    ).toThrow(StateConflictError)
  })

  it('refuses an item that is not one octopus can prefer locally', () => {
    expect(
      ProjectEditSchema.safeParse({ kind: 'preferLocal', item: 'project.nothing', on: true })
        .success
    ).toBe(false)
  })
})

describe('pointing a project at another checkout', () => {
  const other: Project = { ...project, id: 'ledger', name: 'ledger', repoPath: '/repos/ledger' }

  it('records an absolute path', () => {
    const state = { ...EMPTY_STATE, projects: [project] }

    const next = updateProject(state, 'planner', { repoPath: '/repos/moved' })

    expect(next.projects[0]?.repoPath).toBe('/repos/moved')
  })

  it('refuses while the project still has a workspace', () => {
    /*
     * Each is a worktree registered in the *current* repository. Repoint and
     * git in the new one knows nothing about them: they read as missing and
     * cannot even be removed through the app.
     */
    const state = { ...EMPTY_STATE, projects: [project], workspaces: [makeWorkspace()] }

    expect(() => updateProject(state, 'planner', { repoPath: '/repos/moved' })).toThrow(
      StateConflictError
    )
  })

  it("refuses another project's repository", () => {
    const state = { ...EMPTY_STATE, projects: [project, other] }

    try {
      updateProject(state, 'planner', { repoPath: '/repos/ledger' })
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'repoPathTaken', params: { name: 'ledger' } })
    }
  })

  it('refuses a relative path and an empty one', () => {
    const state = { ...EMPTY_STATE, projects: [project] }

    expect(() => updateProject(state, 'planner', { repoPath: 'repos/moved' })).toThrow(
      StateConflictError
    )
    expect(() => updateProject(state, 'planner', { repoPath: '   ' })).toThrow(StateConflictError)
  })

  it('leaves a project alone that is not the one being pointed', () => {
    const state = { ...EMPTY_STATE, projects: [project, other], workspaces: [makeWorkspace()] }

    // The workspace belongs to `planner`, so `ledger` may still move.
    const next = updateProject(state, 'ledger', { repoPath: '/repos/moved' })

    expect(next.projects[1]?.repoPath).toBe('/repos/moved')
  })
})

describe('who wrote which file in a workspace', () => {
  it('starts empty', () => {
    expect(makeWorkspace().writers).toEqual({})
  })

  /*
   * Every workspace in every state file predates the field, and the reader
   * throws on a mismatch — so a missing default would not lose the attribution,
   * it would stop the app opening. That has happened once already, which is why
   * a field that can be absent carries a default rather than a version bump.
   */
  it('loads a workspace written before it was recorded', async () => {
    const older: Record<string, unknown> = { ...makeWorkspace() }
    delete older.writers

    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project], workspaces: [older], chats: [] }),
      'utf8'
    )

    const state = await loadState(file)

    expect(state.workspaces[0]?.writers).toEqual({})
  })
})

describe('the env file a workspace last wrote to', () => {
  // Every workspace predates the field, and the reader throws on a mismatch.
  it('loads a workspace written before it was recorded, as not recorded', async () => {
    const older: Record<string, unknown> = { ...makeWorkspace() }
    delete older.envFileApplied

    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project], workspaces: [older], chats: [] }),
      'utf8'
    )

    expect((await loadState(file)).workspaces[0]?.envFileApplied).toBeNull()
  })
})

describe('when a workspace came onto its branch', () => {
  it('loads a workspace written before it was recorded, as since its creation', async () => {
    const older: Record<string, unknown> = { ...makeWorkspace() }
    delete older.branchSince

    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project], workspaces: [older], chats: [] }),
      'utf8'
    )

    expect((await loadState(file)).workspaces[0]?.branchSince).toBeNull()
  })
})

describe('the note a workspace carries for its user', () => {
  it('starts empty', () => {
    expect(makeWorkspace().notes).toBe('')
  })

  /*
   * Every workspace in every state file predates the field, and the reader
   * throws on a mismatch — so a missing default would not lose the note, it
   * would stop the app opening. That has happened twice, which is why a field
   * that can be absent carries a default rather than a version bump.
   */
  it('loads a workspace written before there were notes', async () => {
    const older: Record<string, unknown> = { ...makeWorkspace() }
    delete older.notes

    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project], workspaces: [older], chats: [] }),
      'utf8'
    )

    const state = await loadState(file)

    expect(state.workspaces[0]?.notes).toBe('')
  })

  // The ceiling is not about the note: `commit` rewrites `state.json` whole, so
  // an unbounded one is paid for by every unrelated write in the file.
  it('refuses one past the ceiling', () => {
    expect(NotesBodySchema.safeParse('x'.repeat(16_000)).success).toBe(true)
    expect(NotesBodySchema.safeParse('x'.repeat(16_001)).success).toBe(false)
  })
})

describe('closed conversations', () => {
  const workspace = makeWorkspace()
  const withChats = (...chats: Chat[]): State =>
    chats.reduce(addChat, addWorkspace(withProject, workspace))

  // The field has a default rather than a migration, so a state file from
  // before it must still load — `readJsonFile` throws on a mismatch rather than
  // falling back, and the app would not open at all.
  it('loads a chat written before conversations could be closed, as open', async () => {
    const older: Record<string, unknown> = { ...storedChat() }
    delete older.closedAt
    await writeFile(
      file,
      JSON.stringify({ version: 1, projects: [project], workspaces: [workspace], chats: [older] }),
      'utf8'
    )

    const state = await loadState(file)

    expect(state.chats).toMatchObject([{ id: 'chat-1', closedAt: null }])
    expect(chatsOfWorkspace(state, workspace.id)).toHaveLength(1)
  })

  it('keeps a closed conversation out of the tabs but not out of the workspace', () => {
    const state = withChats(
      storedChat({ id: 'open' }),
      storedChat({ id: 'shut', closedAt: '2026-08-20T10:00:00.000Z' })
    )

    expect(chatsOfWorkspace(state, workspace.id).map((chat) => chat.id)).toEqual(['open'])
    expect(allChatsOfWorkspace(state, workspace.id).map((chat) => chat.id)).toEqual([
      'open',
      'shut'
    ])
    expect(closedChatsOfWorkspace(state, workspace.id).map(({ chat }) => chat.id)).toEqual(['shut'])
  })

  // One that ended in an error must not keep the sidebar red for ever.
  it('does not let a closed conversation colour the workspace', () => {
    const chats = [
      storedChat({ id: 'open', status: 'idle' }),
      storedChat({ id: 'shut', status: 'error', closedAt: '2026-08-20T10:00:00.000Z' })
    ]

    expect(workspaceStatusFrom(chats)).toBe('idle')
  })

  it('lists the most recently closed first, and the later record on a tie', () => {
    const state = withChats(
      storedChat({ id: 'a', closedAt: '2026-08-20T10:00:00.000Z' }),
      storedChat({ id: 'b', closedAt: '2026-08-20T12:00:00.000Z' }),
      storedChat({ id: 'c', closedAt: '2026-08-20T10:00:00.000Z' })
    )

    expect(closedChatsOfWorkspace(state, workspace.id).map(({ chat }) => chat.id)).toEqual([
      'b',
      'c',
      'a'
    ])
  })

  it('expires only the ones past the keep limit, oldest first', () => {
    const closed = Array.from({ length: 22 }, (_unused, index) =>
      storedChat({
        id: `chat-${String(index)}`,
        closedAt: `2026-08-20T10:${String(index).padStart(2, '0')}:00.000Z`
      })
    )
    const state = withChats(...closed)

    expect(expiredClosedChats(state, workspace.id).map((chat) => chat.id)).toEqual([
      'chat-1',
      'chat-0'
    ])
  })
})
