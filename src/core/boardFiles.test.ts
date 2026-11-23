import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type BoardLayout,
  findLayout,
  firstNamed,
  guardRef,
  listBoard,
  readCard
} from './boardFiles.js'
import { sameName, statusOfFolder } from './boardNames.js'
import { type BoardCard, BoardError } from './boardSchema.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-board-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function given(path: string, contents: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

/** '# ', a Ukrainian greeting and a newline, in CP1251: not UTF-8. */
const CP1251 = Buffer.from([0x23, 0x20, 0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2, 0x0a])
const BAR =
  '---\npriority: high\n---\n# Bar screens\n\nBody\n\n<!-- octopus:comments -->\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n'
const NO_META = { links: [], runs: [] }

/** Every case the scan must keep or skip, under `Planner` — a case the project `planner` must still find. */
async function plannerTree(): Promise<string> {
  const p = join(root, 'Planner')
  await given(join(p, 'backlog', 'Fix login.md'), '# Fix login\n')
  await given(join(p, 'backlog', 'cp1251.md'), CP1251)
  await given(join(p, 'backlog', '.hidden.md'), '# Hidden\n')
  await given(join(p, 'backlog', 'a.md.ab12.tmp'), '# Temp\n')
  await given(join(p, 'In-Progress', 'bar.md'), BAR)
  await given(join(p, 'In-Progress', 'deep', 'too-deep.md'), '# Too deep\n')
  await mkdir(join(p, 'done'))
  await given(join(p, 'notes.md'), 'no heading here\n')
  await given(join(p, 'Upper.MD'), '# Upper\n')
  await given(join(p, '_draft.md'), '# Draft\n')
  await given(join(p, 'todo.txt'), 'not a card\n')
  await given(join(p, 'ideas', 'x.md'), '# Idea X\n')
  await given(join(p, 'ideas', 'readme.txt'), 'not markdown\n')
  await given(join(p, '_attachments', 'bar', 'mockup.png'), 'png')
  await given(join(p, '.DS_Store'), 'x')
  await given(join(root, 'outside.md'), '# Outside\n')
  await symlink(join(root, 'outside.md'), join(p, 'backlog', 'linked.md'))
  await symlink(join(root, 'outside.md'), join(p, 'linked-top.md'))
  return p
}

/** Every entry under root, with each file's sha256 and every mtime: equal before and after = nothing written. */
async function snapshot(): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const lines = await Promise.all(
    entries.map(async (entry) => {
      const path = join(entry.parentPath, entry.name)
      const hash = entry.isFile()
        ? createHash('sha256')
            .update(await readFile(path))
            .digest('hex')
        : '-'
      return `${relative(root, path)} ${hash} ${String((await lstat(path)).mtimeMs)}`
    })
  )
  return lines.sort()
}

/** Runs `body` with `path` closed to everyone, and opens it again whatever happens. */
async function lockedWhile(path: string, open: number, body: () => Promise<void>): Promise<void> {
  await chmod(path, 0o000)
  try {
    await body()
  } finally {
    await chmod(path, open)
  }
}

const refsOf = (cards: readonly BoardCard[]): string[] => cards.map((card) => card.ref).sort()

const cardAt = (cards: readonly BoardCard[], ref: string): BoardCard | undefined =>
  cards.find((card) => card.ref === ref)

describe('firstNamed', () => {
  it('takes the first matching name in name order', () => {
    expect(firstNamed(['Planner', 'other', 'planner'], (name) => sameName(name, 'planner'))).toBe(
      'planner'
    )
  })

  it('takes the first of two folders of one status', () => {
    expect(
      firstNamed(['in-progress', 'In Progress'], (name) => statusOfFolder(name) === 'in progress')
    ).toBe('In Progress')
  })

  it('answers null when nothing matches', () => {
    expect(firstNamed(['other'], (name) => sameName(name, 'planner'))).toBeNull()
  })
})

describe('findLayout', () => {
  it('refuses an unset folder', async () => {
    await expect(findLayout('', 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnset',
      params: {}
    })
  })

  it('refuses a relative folder', async () => {
    await expect(findLayout('tasks', 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: 'tasks', reason: 'not an absolute path' }
    })
  })

  it('refuses a folder that is not there', async () => {
    await expect(findLayout(join(root, 'nope'), 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: join(root, 'nope'), reason: expect.stringContaining('ENOENT') }
    })
  })

  it('refuses a file in place of the folder', async () => {
    await given(join(root, 'file'), 'x')
    await expect(findLayout(join(root, 'file'), 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: join(root, 'file'), reason: 'not a folder' }
    })
  })

  it('refuses a board folder that is a link', async () => {
    await mkdir(join(root, 'real'))
    await symlink(join(root, 'real'), join(root, 'link'))
    await expect(findLayout(join(root, 'link'), 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: join(root, 'link'), reason: 'symbolic link' }
    })
  })

  it('refuses a board folder it cannot open', async () => {
    await lockedWhile(root, 0o755, async () => {
      await expect(findLayout(root, 'planner')).rejects.toMatchObject({
        code: 'boardFolderUnreadable',
        params: { path: root, reason: expect.stringContaining('EACCES') }
      })
    })
  })

  it('answers a project folder that is not there without making it', async () => {
    expect(await findLayout(root, 'planner')).toEqual({
      dir: join(root, 'planner'),
      exists: false,
      folders: {
        backlog: 'backlog',
        'in progress': 'in progress',
        testing: 'testing',
        staging: 'staging',
        done: 'done',
        blocked: 'blocked'
      }
    })
    expect(await readdir(root)).toEqual([])
  })

  it('reuses a project folder whose name differs only in case', async () => {
    await plannerTree()
    const layout = await findLayout(root, 'planner')
    expect(layout.dir).toBe(join(root, 'Planner'))
    expect(layout.exists).toBe(true)
  })

  it('reuses a status folder spelled another way', async () => {
    await plannerTree()
    const layout = await findLayout(root, 'planner')
    expect(layout.folders['in progress']).toBe('In-Progress')
    expect(layout.folders.backlog).toBe('backlog')
  })

  it('names a missing status folder by its status and makes nothing', async () => {
    await plannerTree()
    const before = await snapshot()
    const layout = await findLayout(root, 'planner')
    expect(layout.folders.testing).toBe('testing')
    expect(await snapshot()).toEqual(before)
  })

  it('finds a project folder whose name was written decomposed', async () => {
    await mkdir(join(root, 'Gro\u0308\u00dfe', 'backlog'), { recursive: true })
    const layout = await findLayout(root, 'Gr\u00f6\u00dfe')
    expect(layout.dir).toBe(join(root, 'Gro\u0308\u00dfe'))
    expect(await readdir(root)).toHaveLength(1)
  })

  it('refuses a project folder that is a link', async () => {
    await mkdir(join(root, 'elsewhere'))
    await symlink(join(root, 'elsewhere'), join(root, 'planner'))
    await expect(findLayout(root, 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: join(root, 'planner'), reason: 'symbolic link' }
    })
  })

  it('refuses a file where the project folder should be', async () => {
    await given(join(root, 'planner'), 'x')
    await expect(findLayout(root, 'planner')).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: join(root, 'planner'), reason: 'not a folder' }
    })
  })

  it('refuses a project folder it cannot open', async () => {
    await mkdir(join(root, 'planner'))
    await lockedWhile(join(root, 'planner'), 0o755, async () => {
      await expect(findLayout(root, 'planner')).rejects.toMatchObject({
        code: 'boardFolderUnreadable',
        params: { path: join(root, 'planner'), reason: expect.stringContaining('EACCES') }
      })
    })
  })

  it('takes no link, file or skipped folder for a status folder', async () => {
    await mkdir(join(root, 'planner', '_done'), { recursive: true })
    await given(join(root, 'elsewhere', 'a.md'), '# A\n')
    await symlink(join(root, 'elsewhere'), join(root, 'planner', 'backlog'))
    await given(join(root, 'planner', 'blocked'), 'x')
    const layout = await findLayout(root, 'planner')
    expect(layout.folders.done).toBe('done')
    expect(layout.folders.backlog).toBe('backlog')
    expect(layout.folders.blocked).toBe('blocked')
    expect(await listBoard(layout)).toEqual([])
    await expect(readCard(layout, 'backlog/a.md')).rejects.toMatchObject({
      code: 'cardOutside'
    })
  })
})

describe('guardRef', () => {
  let layout: BoardLayout

  beforeEach(async () => {
    await plannerTree()
    layout = await findLayout(root, 'planner')
  })

  it("answers the card's absolute path", async () => {
    expect(await guardRef(layout, 'backlog/Fix login.md')).toBe(
      join(root, 'Planner', 'backlog/Fix login.md')
    )
  })

  it('refuses a ref that climbs out', async () => {
    await expect(guardRef(layout, '../outside.md')).rejects.toMatchObject({
      code: 'cardOutside',
      params: { name: 'outside.md' }
    })
  })

  it('refuses a ref three levels deep', async () => {
    await expect(guardRef(layout, 'In-Progress/deep/too-deep.md')).rejects.toMatchObject({
      code: 'cardOutside',
      params: { name: 'too-deep.md' }
    })
  })

  it('refuses a ref through a link', async () => {
    await expect(guardRef(layout, 'backlog/linked.md')).rejects.toMatchObject({
      code: 'cardOutside',
      params: { name: 'linked.md' }
    })
  })

  it('refuses a hidden or reserved segment', async () => {
    await expect(guardRef(layout, '_attachments/bar.md')).rejects.toMatchObject({
      code: 'cardOutside'
    })
    await expect(guardRef(layout, '.x/a.md')).rejects.toMatchObject({ code: 'cardOutside' })
  })

  it('passes a ref whose folders are not there yet', async () => {
    await rm(join(root, 'Planner'), { recursive: true })
    const empty = await findLayout(root, 'planner')
    expect(await guardRef(empty, 'backlog/New.md')).toBe(join(root, 'planner', 'backlog/New.md'))
  })
})

describe('listBoard', () => {
  let layout: BoardLayout

  beforeEach(async () => {
    await plannerTree()
    layout = await findLayout(root, 'planner')
  })

  it('reads a card in a status folder', async () => {
    expect(cardAt(await listBoard(layout), 'backlog/Fix login.md')).toEqual({
      ref: 'backlog/Fix login.md',
      status: 'backlog',
      loose: false,
      title: 'Fix login',
      meta: NO_META,
      malformed: false,
      notText: false,
      comments: 0
    })
  })

  it('reads a status folder spelled another way', async () => {
    expect(cardAt(await listBoard(layout), 'In-Progress/bar.md')).toEqual({
      ref: 'In-Progress/bar.md',
      status: 'in progress',
      loose: false,
      title: 'Bar screens',
      meta: { priority: 'high', links: [], runs: [] },
      malformed: false,
      notText: false,
      comments: 1
    })
  })

  it('shows the cards of two folders of one status in one column', async () => {
    await given(join(layout.dir, 'In Progress', 'second.md'), '# Second\n')
    const both = await findLayout(root, 'planner')
    const cards = await listBoard(both)
    expect(both.folders['in progress']).toBe('In Progress')
    expect(cardAt(cards, 'In-Progress/bar.md')).toMatchObject({
      status: 'in progress',
      loose: false
    })
    expect(cardAt(cards, 'In Progress/second.md')).toMatchObject({
      status: 'in progress',
      loose: false
    })
  })

  it('shows a file in the project folder as a loose backlog card', async () => {
    expect(cardAt(await listBoard(layout), 'notes.md')).toMatchObject({
      status: 'backlog',
      loose: true,
      title: 'notes'
    })
  })

  it('shows a file in another folder as a loose backlog card', async () => {
    expect(cardAt(await listBoard(layout), 'ideas/x.md')).toMatchObject({
      status: 'backlog',
      loose: true,
      title: 'Idea X'
    })
  })

  it('reads a card whose extension is upper case', async () => {
    expect(cardAt(await listBoard(layout), 'Upper.MD')).toMatchObject({
      loose: true,
      title: 'Upper'
    })
  })

  it('lists a file that is not UTF-8 by its name and no text', async () => {
    expect(cardAt(await listBoard(layout), 'backlog/cp1251.md')).toEqual({
      ref: 'backlog/cp1251.md',
      status: 'backlog',
      loose: false,
      title: 'cp1251',
      meta: NO_META,
      malformed: false,
      notText: true,
      comments: 0
    })
  })

  it('lists exactly the six cards of the fixture', async () => {
    expect(refsOf(await listBoard(layout))).toEqual([
      'In-Progress/bar.md',
      'Upper.MD',
      'backlog/Fix login.md',
      'backlog/cp1251.md',
      'ideas/x.md',
      'notes.md'
    ])
  })

  it('writes nothing while it reads', async () => {
    const before = await snapshot()
    await listBoard(layout)
    expect(await snapshot()).toEqual(before)
  })

  it('skips a file it cannot read', async () => {
    await lockedWhile(join(layout.dir, 'notes.md'), 0o644, async () => {
      const refs = refsOf(await listBoard(layout))
      expect(refs).toHaveLength(5)
      expect(refs).not.toContain('notes.md')
    })
  })

  it('skips a folder it cannot open and lists the rest', async () => {
    await lockedWhile(join(layout.dir, 'ideas'), 0o755, async () => {
      const refs = refsOf(await listBoard(layout))
      expect(refs).toHaveLength(5)
      expect(refs).not.toContain('ideas/x.md')
    })
  })

  it('answers an empty board for a project folder that is not there', async () => {
    await rm(join(root, 'Planner'), { recursive: true })
    await rm(join(root, 'outside.md'))
    expect(await listBoard(await findLayout(root, 'planner'))).toEqual([])
    expect(await readdir(root)).toEqual([])
  })

  it('answers boardFolderUnreadable when the project folder vanished', async () => {
    await rm(layout.dir, { recursive: true })
    await expect(listBoard(layout)).rejects.toMatchObject({
      code: 'boardFolderUnreadable',
      params: { path: layout.dir, reason: expect.stringContaining('ENOENT') }
    })
  })
})

describe('readCard', () => {
  let layout: BoardLayout

  beforeEach(async () => {
    await plannerTree()
    layout = await findLayout(root, 'planner')
  })

  it('reads the description and the thread', async () => {
    expect(await readCard(layout, 'In-Progress/bar.md')).toEqual({
      ref: 'In-Progress/bar.md',
      status: 'in progress',
      loose: false,
      title: 'Bar screens',
      meta: { priority: 'high', links: [], runs: [] },
      malformed: false,
      notText: false,
      comments: 1,
      description: '# Bar screens\n\nBody\n\n',
      thread: [{ at: '2026-01-02T03:04:05.000Z', text: 'hi' }]
    })
  })

  it('writes nothing while it reads', async () => {
    const before = await snapshot()
    await readCard(layout, 'In-Progress/bar.md')
    await readCard(layout, 'backlog/cp1251.md')
    expect(await snapshot()).toEqual(before)
  })

  it('reads a file that is not UTF-8 as no text', async () => {
    expect(await readCard(layout, 'backlog/cp1251.md')).toMatchObject({
      notText: true,
      title: 'cp1251',
      description: '',
      thread: []
    })
  })

  it('answers cardMissing for a file that is not there', async () => {
    const read = readCard(layout, 'backlog/Gone.md')
    await expect(read).rejects.toBeInstanceOf(BoardError)
    await expect(read).rejects.toMatchObject({ code: 'cardMissing', params: { name: 'Gone.md' } })
  })

  it('answers cardMissing when a folder of the ref is a file', async () => {
    await expect(readCard(layout, 'notes.md/x.md')).rejects.toMatchObject({
      code: 'cardMissing',
      params: { name: 'x.md' }
    })
  })

  it('passes on a failure that is not absence', async () => {
    await mkdir(join(layout.dir, 'backlog', 'Folder.md'))
    const read = readCard(layout, 'backlog/Folder.md')
    await expect(read).rejects.toMatchObject({ code: 'EISDIR' })
    await expect(read).rejects.not.toBeInstanceOf(BoardError)
  })

  it('refuses a ref through a link before reading', async () => {
    await expect(readCard(layout, 'backlog/linked.md')).rejects.toMatchObject({
      code: 'cardOutside'
    })
  })

  it('answers cardMissing in a project folder that is not there', async () => {
    await rm(join(root, 'Planner'), { recursive: true })
    const empty = await findLayout(root, 'planner')
    await expect(readCard(empty, 'backlog/a.md')).rejects.toMatchObject({
      code: 'cardMissing',
      params: { name: 'a.md' }
    })
  })
})
