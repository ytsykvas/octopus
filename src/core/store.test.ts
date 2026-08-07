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
  PORT_RANGE_END,
  PORT_RANGE_START,
  type Project,
  removeProject,
  removeWorkspace,
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
    id: 'kyiv',
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
  dir = await mkdtemp(join(tmpdir(), 'maestro-store-'))
  file = join(dir, 'state.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('завантаження та збереження', () => {
  it('на першому запуску стан порожній', async () => {
    await expect(loadState(file)).resolves.toEqual(EMPTY_STATE)
  })

  it('збережений стан читається без втрат', async () => {
    const state = addWorkspace(withProject, makeWorkspace())
    await saveState(state, file, `${file}.tmp`)
    await expect(loadState(file)).resolves.toEqual(state)
  })

  it('пошкоджений файл дає помилку, а не тихе обнулення списку воркспейсів', async () => {
    await writeFile(file, '{ поламано', 'utf8')
    await expect(loadState(file)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('не зберігає воркспейс із портом поза дозволеним діапазоном', async () => {
    const broken = { ...withProject, workspaces: [makeWorkspace({ port: 80 })] }
    await expect(saveState(broken, file, `${file}.tmp`)).rejects.toBeInstanceOf(InvalidFileError)
  })
})

describe('assignPort', () => {
  it('повертає той самий порт для того самого воркспейсу', () => {
    expect(assignPort('kyiv')).toBe(assignPort('kyiv'))
  })

  it('тримається дозволеного діапазону', () => {
    for (const id of ['kyiv', 'lviv', 'osaka', 'a', 'дуже-довга-назва-воркспейсу']) {
      const port = assignPort(id)
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START)
      expect(port).toBeLessThanOrEqual(PORT_RANGE_END)
    }
  })

  it('обходить зайняті порти', () => {
    const first = assignPort('kyiv')
    expect(assignPort('kyiv', [first])).not.toBe(first)
  })

  it('різні воркспейси зазвичай отримують різні порти', () => {
    expect(assignPort('kyiv')).not.toBe(assignPort('lviv'))
  })

  it('кидає помилку, коли весь діапазон зайнятий', () => {
    const span = PORT_RANGE_END - PORT_RANGE_START + 1
    const all = Array.from({ length: span }, (_, i) => PORT_RANGE_START + i)
    expect(() => assignPort('kyiv', all)).toThrow(StateConflictError)
  })
})

describe('проєкти', () => {
  it('додається і знаходиться за id', () => {
    expect(findProject(withProject, 'planner')).toEqual(project)
  })

  it('невідомий проєкт не знаходиться', () => {
    expect(findProject(withProject, 'немає')).toBeUndefined()
  })

  it('повторне додавання того самого id — конфлікт', () => {
    expect(() => addProject(withProject, project)).toThrow(StateConflictError)
  })

  it('той самий репозиторій під іншим id теж конфлікт', () => {
    const twin = { ...project, id: 'інший' }
    expect(() => addProject(withProject, twin)).toThrow(StateConflictError)
  })

  it('видалення прибирає й воркспейси проєкту — осиротілих не лишається', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const after = removeProject(state, 'planner')
    expect(after.projects).toHaveLength(0)
    expect(after.workspaces).toHaveLength(0)
  })

  it('видалення неіснуючого проєкту нічого не ламає', () => {
    expect(removeProject(withProject, 'немає').projects).toHaveLength(1)
  })
})

describe('воркспейси', () => {
  it('додається до наявного проєкту', () => {
    expect(addWorkspace(withProject, makeWorkspace()).workspaces).toHaveLength(1)
  })

  it('не додається до проєкту, якого немає', () => {
    const orphan = makeWorkspace({ projectId: 'немає' })
    expect(() => addWorkspace(withProject, orphan)).toThrow(StateConflictError)
  })

  it('повторний id — конфлікт', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    expect(() => addWorkspace(state, makeWorkspace())).toThrow(StateConflictError)
  })

  it('дві гілки з однаковою назвою — конфлікт, бо git цього не дозволить', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const twin = makeWorkspace({ id: 'інший', branch: 'ytsykvas/kyiv' })
    expect(() => addWorkspace(state, twin)).toThrow(StateConflictError)
  })

  it('фільтруються за проєктом', () => {
    const other = addProject(withProject, { ...project, id: 'esl', repoPath: '/repos/esl' })
    const state = addWorkspace(other, makeWorkspace())
    expect(workspacesOfProject(state, 'planner')).toHaveLength(1)
    expect(workspacesOfProject(state, 'esl')).toHaveLength(0)
  })

  it('оновлення змінює лише передані поля', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    const after = updateWorkspace(state, 'kyiv', { status: 'running', sessionId: 'sess-1' })
    expect(after.workspaces[0]).toMatchObject({
      status: 'running',
      sessionId: 'sess-1',
      branch: 'ytsykvas/kyiv'
    })
  })

  it('оновлення одного воркспейсу не зачіпає сусідів', () => {
    const first = addWorkspace(withProject, makeWorkspace())
    const state = addWorkspace(
      first,
      makeWorkspace({ id: 'lviv', name: 'lviv', branch: 'ytsykvas/lviv', port: 3200 })
    )

    const after = updateWorkspace(state, 'lviv', { status: 'running' })

    expect(after.workspaces.find((w) => w.id === 'lviv')?.status).toBe('running')
    expect(after.workspaces.find((w) => w.id === 'kyiv')?.status).toBe('idle')
  })

  it('оновлення неіснуючого воркспейсу — помилка, а не мовчазний no-op', () => {
    expect(() => updateWorkspace(withProject, 'немає', { status: 'error' })).toThrow(
      StateConflictError
    )
  })

  it('оновлення не мутує попередній стан', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    updateWorkspace(state, 'kyiv', { status: 'error' })
    expect(state.workspaces[0]?.status).toBe('idle')
  })

  it('видаляється за id', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    expect(removeWorkspace(state, 'kyiv').workspaces).toHaveLength(0)
  })

  it('видалення неіснуючого нічого не ламає', () => {
    const state = addWorkspace(withProject, makeWorkspace())
    expect(removeWorkspace(state, 'немає').workspaces).toHaveLength(1)
  })
})
