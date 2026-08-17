import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InvalidFileError } from './persist.js'
import {
  addChat,
  type AgentCommand,
  AgentModelSchema,
  addProject,
  addWorkspace,
  assignPort,
  type Chat,
  chatsOfWorkspace,
  commandsUnchanged,
  EMPTY_STATE,
  findChat,
  findProject,
  loadState,
  migrate,
  modelsUnchanged,
  PROJECT_COLORS,
  PORT_RANGE_END,
  PORT_RANGE_START,
  type Project,
  rememberModels,
  removeProject,
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
  workspaceStatusFrom
} from './store.js'

const project: Project = {
  id: 'planner',
  name: 'planner',
  repoPath: '/repos/planner',
  baseBranch: 'main',
  branchPrefix: 'ytsykvas',
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
    title: null,
    sessionId: null,
    model: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    knownCommands: [],
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
      knownModels: []
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
      knownModels: []
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
      knownModels: []
    }

    expect(migrate(stored).projects[1]?.color).not.toBe(PROJECT_COLORS[0])
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

  it('is stable for the same id, so a restart keeps the port', () => {
    expect(assignPort('planner/anna')).toBe(assignPort('planner/anna'))
  })

  it('stays in range for an id that is empty or non-Latin', () => {
    for (const id of ['', 'проєкт/гілка', '🎉']) {
      const port = assignPort(id)
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START)
      expect(port).toBeLessThanOrEqual(PORT_RANGE_END)
    }
  })

  // The hash collides long before the range fills; what matters is that a
  // collision walks on to a free port rather than handing out a taken one.
  it('never hands out a port already in use', () => {
    const ports = new Set<number>()

    for (let i = 0; i < 500; i++) {
      const port = assignPort(`planner/w-${String(i)}`, [...ports])
      expect(ports.has(port)).toBe(false)
      ports.add(port)
    }
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
      title: null,
      sessionId: null,
      model: null,
      effort: null,
      workingMode: 'default',
      planMode: false,
      knownCommands: [],
      createdAt: '2026-08-11T09:00:00.000Z'
    }
    await writeFile(file, JSON.stringify({ ...withProject, chats: [legacy] }), 'utf8')

    const state = await loadState(file)
    expect(state.chats[0]?.effort).toBe('medium')
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
    aliases: []
  }

  const chat: Chat = {
    id: 'chat-1',
    workspaceId: 'planner/kyiv',
    agent: 'claude',
    status: 'idle',
    title: null,
    sessionId: null,
    model: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    knownCommands: [],
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  // Asked on every session start, so without this every restart of every
  // conversation would rewrite the state file to the same bytes.
  it('recognises a list that says exactly the same thing', () => {
    expect(commandsUnchanged({ ...chat, knownCommands: [command] }, [command])).toBe(true)
    expect(commandsUnchanged(chat, [])).toBe(true)
  })

  it('notices a command added, removed or renamed', () => {
    const knowing = { ...chat, knownCommands: [command] }

    expect(commandsUnchanged(knowing, [])).toBe(false)
    expect(commandsUnchanged(knowing, [command, { ...command, name: 'rollback' }])).toBe(false)
    expect(commandsUnchanged(knowing, [{ ...command, description: 'Ship it now' }])).toBe(false)
  })
})

describe('what a workspace is doing, from its conversations', () => {
  function chatWith(id: string, status: Chat['status']): Chat {
    return storedChat({ id, status })
  }

  it('is idle when it holds none at all', () => {
    expect(workspaceStatusFrom([], 'idle')).toBe('idle')
  })

  it('is idle when every conversation is', () => {
    expect(workspaceStatusFrom([chatWith('a', 'idle'), chatWith('b', 'idle')], 'idle')).toBe('idle')
  })

  /*
   * The order is what the sidebar's single dot should say when they disagree.
   * A turn that has stopped and is waiting on an answer is the one state worth
   * crossing the window for, so it outranks work still going.
   */
  it('waits for an answer over anything else', () => {
    expect(
      workspaceStatusFrom(
        [chatWith('a', 'running'), chatWith('b', 'waiting_permission'), chatWith('c', 'error')],
        'idle'
      )
    ).toBe('waiting_permission')
  })

  // The dot says what is happening now; a failed turn is a record of something
  // that already happened.
  it('reports work in flight over a turn that failed', () => {
    expect(workspaceStatusFrom([chatWith('a', 'error'), chatWith('b', 'running')], 'idle')).toBe(
      'running'
    )
  })

  it('reports a failure when nothing is running', () => {
    expect(workspaceStatusFrom([chatWith('a', 'idle'), chatWith('b', 'error')], 'idle')).toBe(
      'error'
    )
  })

  // A decision about the workspace, which nothing a conversation does can
  // overrule.
  it('leaves an archived workspace archived', () => {
    expect(workspaceStatusFrom([chatWith('a', 'running')], 'archived')).toBe('archived')
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
