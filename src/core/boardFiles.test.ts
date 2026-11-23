import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addComment,
  type BoardLayout,
  createCard,
  editCard,
  findCard,
  findLayout,
  firstNamed,
  guardRef,
  listBoard,
  moveCard,
  readCard,
  removeCard,
  renameCard,
  saveDescription,
  updateCard
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

const P = (): string => join(root, 'planner')
const card = (ref: string, contents: string | Buffer): Promise<void> =>
  given(join(P(), ref), contents)
const read = (ref: string): Promise<string> => readFile(join(P(), ref), 'utf8')
const bytesOf = (ref: string): Promise<Buffer> => readFile(join(P(), ref))
const mtime = async (ref: string): Promise<number> => (await lstat(join(P(), ref))).mtimeMs
const layoutOf = (): Promise<BoardLayout> => findLayout(root, 'planner')
const BROKEN = '---\npriority: high\ntag: [feature\n---\n# A\n'

describe('editCard', () => {
  it('writes the changed text', async () => {
    await card('backlog/a.md', '# A\n')

    await editCard(await layoutOf(), 'backlog/a.md', () => '# B\n')

    await expect(read('backlog/a.md')).resolves.toBe('# B\n')
  })

  it('writes nothing when the change gives the same text back', async () => {
    await card('backlog/a.md', '# A\n')
    await utimes(join(P(), 'backlog/a.md'), 1000, 1000)

    await editCard(await layoutOf(), 'backlog/a.md', (raw) => raw)

    await expect(mtime('backlog/a.md')).resolves.toBe(1_000_000)
  })

  it('leaves the file alone when the change throws', async () => {
    await card('backlog/a.md', '# A\n')

    await expect(
      editCard(await layoutOf(), 'backlog/a.md', () => {
        throw new Error('no')
      })
    ).rejects.toThrow('no')
    await expect(read('backlog/a.md')).resolves.toBe('# A\n')
  })

  // The size moves 4 → 13 bytes: an mtime within the same millisecond might not.
  it('refuses a file that changed while it was read', async () => {
    await card('backlog/a.md', '# A\n')

    await expect(
      editCard(await layoutOf(), 'backlog/a.md', () => {
        writeFileSync(join(P(), 'backlog/a.md'), '# Other text\n')
        return '# B\n'
      })
    ).rejects.toMatchObject({ code: 'cardChanged', params: { name: 'a.md' } })
    await expect(read('backlog/a.md')).resolves.toBe('# Other text\n')
  })

  it('refuses a file that is not UTF-8 and leaves its bytes', async () => {
    await card('backlog/cp1251.md', CP1251)
    const change = vi.fn((raw: string) => raw + 'x')

    await expect(editCard(await layoutOf(), 'backlog/cp1251.md', change)).rejects.toMatchObject({
      code: 'cardNotText',
      params: { name: 'cp1251.md' }
    })
    expect(change).not.toHaveBeenCalled()
    expect((await bytesOf('backlog/cp1251.md')).equals(CP1251)).toBe(true)
  })

  it('answers cardMissing for a file that is gone', async () => {
    await expect(editCard(await layoutOf(), 'backlog/gone.md', (raw) => raw)).rejects.toMatchObject(
      { code: 'cardMissing', params: { name: 'gone.md' } }
    )
  })

  it('passes on a failure that is not absence', async () => {
    await mkdir(join(P(), 'backlog', 'Folder.md'), { recursive: true })

    await expect(
      editCard(await layoutOf(), 'backlog/Folder.md', (raw) => raw)
    ).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('refuses a linked card before reading it', async () => {
    await given(join(root, 'outside.md'), '# Outside\n')
    await mkdir(join(P(), 'backlog'), { recursive: true })
    await symlink(join(root, 'outside.md'), join(P(), 'backlog', 'link.md'))

    await expect(
      editCard(await layoutOf(), 'backlog/link.md', () => '# Mine\n')
    ).rejects.toMatchObject({ code: 'cardOutside' })
    await expect(readFile(join(root, 'outside.md'), 'utf8')).resolves.toBe('# Outside\n')
  })
})

describe('createCard', () => {
  it('makes the project and status folder with the first card', async () => {
    const ref = await createCard(await layoutOf(), { status: 'backlog', title: 'Fix login' })

    expect(ref).toBe('backlog/Fix login.md')
    await expect(read(ref)).resolves.toBe('---\norder: 0\n---\n# Fix login\n')
    await expect(readdir(P())).resolves.toEqual(['backlog'])
  })

  it('makes only the status folder it writes into', async () => {
    await card('backlog/a.md', '# A\n')

    const ref = await createCard(await layoutOf(), { status: 'testing', title: 'X' })

    expect(ref).toBe('testing/X.md')
    expect((await readdir(P())).sort()).toEqual(['backlog', 'testing'])
  })

  it('puts the new card above the first ordered one', async () => {
    await card('backlog/a.md', '---\norder: 5\n---\n# A\n')

    const ref = await createCard(await layoutOf(), { status: 'backlog', title: 'B' })

    await expect(read(ref)).resolves.toBe('---\norder: 4\n---\n# B\n')
  })

  it('keeps a Cyrillic title readable in the file name', async () => {
    await expect(
      createCard(await layoutOf(), { status: 'backlog', title: 'Виправити логін' })
    ).resolves.toBe('backlog/Виправити логін.md')
  })

  it('adds -2 when the name is taken in any case', async () => {
    await card('backlog/fix LOGIN.md', '# fix LOGIN\n')

    await expect(
      createCard(await layoutOf(), { status: 'backlog', title: 'Fix login' })
    ).resolves.toBe('backlog/Fix login-2.md')
  })

  it('counts a loose file as taken', async () => {
    await card('Fix login.md', '# Fix login\n')

    await expect(
      createCard(await layoutOf(), { status: 'backlog', title: 'Fix login' })
    ).resolves.toBe('backlog/Fix login-2.md')
  })

  it('writes into a status folder spelled another way', async () => {
    await card('In-Progress/a.md', '# A\n')

    await expect(createCard(await layoutOf(), { status: 'in progress', title: 'X' })).resolves.toBe(
      'In-Progress/X.md'
    )
  })

  // Closed to reading, the file is skipped by the scan, so the name looks free — `wx` still sees it.
  it('refuses a file that appeared after the listing', async () => {
    await card('backlog/Fix login.md', 'old')
    const layout = await layoutOf()

    await lockedWhile(join(P(), 'backlog', 'Fix login.md'), 0o644, async () => {
      await expect(
        createCard(layout, { status: 'backlog', title: 'Fix login' })
      ).rejects.toMatchObject({ code: 'cardNameTaken', params: { name: 'Fix login.md' } })
    })
    await expect(read('backlog/Fix login.md')).resolves.toBe('old')
  })

  it('passes on a failure to write that is not a taken name', async () => {
    await card('backlog/a.md', '# A\n')
    const layout = await layoutOf()
    await chmod(join(P(), 'backlog'), 0o500)
    try {
      await expect(createCard(layout, { status: 'backlog', title: 'B' })).rejects.toMatchObject({
        code: 'EACCES'
      })
    } finally {
      await chmod(join(P(), 'backlog'), 0o755)
    }
  })

  it('refuses to write through a linked status folder', async () => {
    await mkdir(join(root, 'elsewhere'))
    await mkdir(P())
    await symlink(join(root, 'elsewhere'), join(P(), 'backlog'))

    await expect(
      createCard(await layoutOf(), { status: 'backlog', title: 'A' })
    ).rejects.toMatchObject({ code: 'cardOutside', params: { name: 'A.md' } })
    await expect(readdir(join(root, 'elsewhere'))).resolves.toEqual([])
  })
})

describe('updateCard', () => {
  async function updated(before: string, patch: Parameters<typeof updateCard>[2]): Promise<string> {
    await card('backlog/a.md', before)
    await updateCard(await layoutOf(), 'backlog/a.md', patch)
    return read('backlog/a.md')
  }

  it('adds a header to a file that had none', async () => {
    await expect(updated('# Fix login\n', { priority: 'high' })).resolves.toBe(
      '---\npriority: high\n---\n# Fix login\n'
    )
  })

  it('removes the header once its last key goes', async () => {
    await expect(updated('---\npriority: high\n---\n# A\n', { priority: null })).resolves.toBe(
      '# A\n'
    )
  })

  it('sets the tag and keeps a key it does not know', async () => {
    await expect(updated('---\nauthor: me\n---\n# A\n', { tag: 'fix' })).resolves.toBe(
      '---\nauthor: me\ntag: fix\n---\n# A\n'
    )
  })

  it('removes the tag', async () => {
    await expect(updated('---\ntag: fix\n---\n# A\n', { tag: null })).resolves.toBe('# A\n')
  })

  it('writes the links', async () => {
    await expect(updated('# A\n', { links: ['https://a.example'] })).resolves.toBe(
      '---\nlinks:\n  - https://a.example\n---\n# A\n'
    )
  })

  it('drops the links key for an empty list', async () => {
    await expect(
      updated('---\nlinks:\n  - https://a.example\n---\n# A\n', { links: [] })
    ).resolves.toBe('# A\n')
  })

  it('writes nothing for an empty patch', async () => {
    await card('backlog/a.md', '# A\n')
    await utimes(join(P(), 'backlog/a.md'), 1000, 1000)

    await updateCard(await layoutOf(), 'backlog/a.md', {})

    await expect(mtime('backlog/a.md')).resolves.toBe(1_000_000)
  })

  it('writes nothing when it removes a key that is not there', async () => {
    await card('backlog/a.md', '---\r\na: 1\r\n---\r\n# A\r\n')
    await utimes(join(P(), 'backlog/a.md'), 1000, 1000)

    await updateCard(await layoutOf(), 'backlog/a.md', { priority: null })

    await expect(read('backlog/a.md')).resolves.toBe('---\r\na: 1\r\n---\r\n# A\r\n')
    await expect(mtime('backlog/a.md')).resolves.toBe(1_000_000)
  })

  it('refuses a header it cannot read and keeps the bytes', async () => {
    await card('backlog/a.md', BROKEN)

    await expect(
      updateCard(await layoutOf(), 'backlog/a.md', { priority: 'low' })
    ).rejects.toMatchObject({ code: 'cardFrontmatterUnreadable', params: { name: 'a.md' } })
    await expect(read('backlog/a.md')).resolves.toBe(BROKEN)
  })
})

describe('renameCard', () => {
  it('replaces the heading line and keeps the file name', async () => {
    await card('backlog/old.md', '# Old\n\nBody\n')

    await renameCard(await layoutOf(), 'backlog/old.md', 'New')

    await expect(read('backlog/old.md')).resolves.toBe('# New\n\nBody\n')
  })
})

describe('saveDescription', () => {
  const base = '# A\n\nold\n'

  it('saves when the description is what the editor started from', async () => {
    await card('backlog/a.md', '# A\n\nold\n')

    await saveDescription(await layoutOf(), 'backlog/a.md', { text: '# A\n\nnew', base })

    await expect(read('backlog/a.md')).resolves.toBe('# A\n\nnew\n')
  })

  it('refuses when the description changed meanwhile', async () => {
    await card('backlog/a.md', '# A\n\nother\n')

    await expect(
      saveDescription(await layoutOf(), 'backlog/a.md', { text: '# A\n\nnew', base })
    ).rejects.toMatchObject({ code: 'cardChanged', params: { name: 'a.md' } })
    await expect(read('backlog/a.md')).resolves.toBe('# A\n\nother\n')
  })

  // The first comment puts a blank line between the description and the marker: blank lines at
  // the end are layout, not somebody's edit.
  it('is not a conflict when the description differs only in blank lines at its end', async () => {
    await card('backlog/a.md', '# A\n\nold\n')

    await saveDescription(await layoutOf(), 'backlog/a.md', {
      text: '# A\n\nnew',
      base: '# A\n\nold\n\n'
    })

    await expect(read('backlog/a.md')).resolves.toBe('# A\n\nnew\n')
  })

  it('overwrites when told to', async () => {
    await card('backlog/a.md', '# A\n\nother\n')

    await saveDescription(await layoutOf(), 'backlog/a.md', { text: '# A\n\nmine', base: null })

    await expect(read('backlog/a.md')).resolves.toBe('# A\n\nmine\n')
  })

  it('is not a conflict when only the header changed', async () => {
    await card('backlog/a.md', base)
    const layout = await layoutOf()

    await updateCard(layout, 'backlog/a.md', { priority: 'high' })
    await saveDescription(layout, 'backlog/a.md', { text: '# A\n\nnew', base })

    await expect(read('backlog/a.md')).resolves.toBe('---\npriority: high\n---\n# A\n\nnew\n')
  })

  it('is not a conflict when only a comment was added', async () => {
    await card('backlog/a.md', base)
    const layout = await layoutOf()

    await addComment(layout, 'backlog/a.md', 'hi', '2026-01-02T03:04:05.000Z')
    await saveDescription(layout, 'backlog/a.md', { text: '# A\n\nnew', base })

    const detail = await readCard(layout, 'backlog/a.md')
    expect(detail.thread).toEqual([{ at: '2026-01-02T03:04:05.000Z', text: 'hi' }])
    expect(detail.description.startsWith('# A\n\nnew')).toBe(true)
  })
})

describe('addComment', () => {
  it('adds the marker and the first comment', async () => {
    await card('backlog/a.md', '# A\n')

    await addComment(await layoutOf(), 'backlog/a.md', 'hi', '2026-01-02T03:04:05.000Z')

    await expect(read('backlog/a.md')).resolves.toBe(
      '# A\n\n<!-- octopus:comments -->\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n'
    )
  })

  it('appends under an existing thread', async () => {
    await card('backlog/a.md', '# A\n')
    const layout = await layoutOf()

    await addComment(layout, 'backlog/a.md', 'hi', '2026-01-02T03:04:05.000Z')
    await addComment(layout, 'backlog/a.md', 'second', '2026-01-03T00:00:00.000Z')

    expect((await readCard(layout, 'backlog/a.md')).thread).toEqual([
      { at: '2026-01-02T03:04:05.000Z', text: 'hi' },
      { at: '2026-01-03T00:00:00.000Z', text: 'second' }
    ])
  })
})

describe('moveCard', () => {
  const gone = async (ref: string): Promise<void> => {
    await expect(lstat(join(P(), ref))).rejects.toMatchObject({ code: 'ENOENT' })
  }

  it('moves a card into another status folder it makes', async () => {
    await card('backlog/Fix login.md', '# Fix login\n')

    const ref = await moveCard(await layoutOf(), 'backlog/Fix login.md', {
      status: 'done',
      index: 0
    })

    expect(ref).toBe('done/Fix login.md')
    await gone('backlog/Fix login.md')
    await expect(read(ref)).resolves.toBe('---\norder: 0\n---\n# Fix login\n')
  })

  it('reorders inside one folder without moving the file', async () => {
    await card('backlog/a.md', '---\norder: 1\n---\n# A\n')
    await card('backlog/b.md', '---\norder: 2\n---\n# B\n')

    const ref = await moveCard(await layoutOf(), 'backlog/b.md', { status: 'backlog', index: 0 })

    expect(ref).toBe('backlog/b.md')
    await expect(read('backlog/b.md')).resolves.toBe('---\norder: 0\n---\n# B\n')
    await expect(read('backlog/a.md')).resolves.toBe('---\norder: 1\n---\n# A\n')
  })

  // Its own place is no slot: counted, the card would land between itself and the next one.
  it('leaves the card out of its own column when it moves down', async () => {
    await card('backlog/a.md', '---\norder: 1\n---\n# A\n')
    await card('backlog/b.md', '---\norder: 2\n---\n# B\n')

    await moveCard(await layoutOf(), 'backlog/a.md', { status: 'backlog', index: 1 })

    await expect(read('backlog/a.md')).resolves.toBe('---\norder: 3\n---\n# A\n')
  })

  it('refuses to move into a linked status folder', async () => {
    await card('backlog/a.md', '# A\n')
    await mkdir(join(root, 'elsewhere'))
    await symlink(join(root, 'elsewhere'), join(P(), 'done'))

    await expect(
      moveCard(await layoutOf(), 'backlog/a.md', { status: 'done', index: 0 })
    ).rejects.toMatchObject({ code: 'cardOutside', params: { name: 'a.md' } })
    await expect(read('backlog/a.md')).resolves.toBe('# A\n')
    await expect(readdir(join(root, 'elsewhere'))).resolves.toEqual([])
  })

  it('refuses to replace a file of the same name', async () => {
    await card('backlog/Fix login.md', 'one')
    await card('done/Fix login.md', 'two')

    await expect(
      moveCard(await layoutOf(), 'backlog/Fix login.md', { status: 'done', index: 0 })
    ).rejects.toMatchObject({ code: 'cardNameTaken', params: { name: 'Fix login.md' } })
    await expect(read('backlog/Fix login.md')).resolves.toBe('one')
    await expect(read('done/Fix login.md')).resolves.toBe('two')
  })

  it('files a loose card into its status folder', async () => {
    await card('notes.md', '# Notes\n')

    await expect(
      moveCard(await layoutOf(), 'notes.md', { status: 'backlog', index: 0 })
    ).resolves.toBe('backlog/notes.md')
    await gone('notes.md')
  })

  it('gathers a card from the second folder of its status into the first', async () => {
    await mkdir(join(P(), 'In Progress'), { recursive: true })
    await card('in-progress/x.md', '# X\n')

    await expect(
      moveCard(await layoutOf(), 'in-progress/x.md', { status: 'in progress', index: 0 })
    ).resolves.toBe('In Progress/x.md')
    await gone('in-progress/x.md')
  })

  it('places a dropped card between its neighbours', async () => {
    await card('done/a.md', '---\norder: 1\n---\n# A\n')
    await card('done/b.md', '---\norder: 2\n---\n# B\n')
    await card('backlog/c.md', '# C\n')

    const ref = await moveCard(await layoutOf(), 'backlog/c.md', { status: 'done', index: 1 })

    await expect(read(ref)).resolves.toBe('---\norder: 1.5\n---\n# C\n')
    await expect(read('done/a.md')).resolves.toBe('---\norder: 1\n---\n# A\n')
    await expect(read('done/b.md')).resolves.toBe('---\norder: 2\n---\n# B\n')
  })

  it('moves a card whose header it cannot read and leaves its bytes', async () => {
    await card('backlog/bad.md', BROKEN)

    const ref = await moveCard(await layoutOf(), 'backlog/bad.md', { status: 'done', index: 0 })

    expect(ref).toBe('done/bad.md')
    await expect(read(ref)).resolves.toBe(BROKEN)
  })

  it('moves a file that is not UTF-8 and leaves its bytes', async () => {
    await card('backlog/cp1251.md', CP1251)

    const ref = await moveCard(await layoutOf(), 'backlog/cp1251.md', { status: 'done', index: 0 })

    expect(ref).toBe('done/cp1251.md')
    expect((await bytesOf(ref)).equals(CP1251)).toBe(true)
  })

  it('refuses to reorder a card whose header it cannot read', async () => {
    await card('backlog/bad.md', BROKEN)
    await card('backlog/a.md', '---\norder: 1\n---\n# A\n')

    await expect(
      moveCard(await layoutOf(), 'backlog/bad.md', { status: 'backlog', index: 0 })
    ).rejects.toMatchObject({ code: 'cardFrontmatterUnreadable' })
  })

  it('refuses to reorder a file that is not UTF-8', async () => {
    await card('backlog/cp1251.md', CP1251)

    await expect(
      moveCard(await layoutOf(), 'backlog/cp1251.md', { status: 'backlog', index: 0 })
    ).rejects.toMatchObject({ code: 'cardNotText' })
  })

  it('reports a failure to write the order once the file has moved', async () => {
    await card('backlog/c.md', '# C\n')
    const layout = await layoutOf()
    await chmod(join(P(), 'backlog', 'c.md'), 0o000)
    try {
      await expect(
        moveCard(layout, 'backlog/c.md', { status: 'done', index: 0 })
      ).rejects.toMatchObject({ code: 'EACCES' })
      await expect(lstat(join(P(), 'done', 'c.md'))).resolves.toBeDefined()
      await gone('backlog/c.md')
    } finally {
      await chmod(join(P(), 'done', 'c.md'), 0o644)
    }
  })

  it('passes on a failure to look at the target', async () => {
    await card('backlog/a.md', '# A\n')
    await mkdir(join(P(), 'done'))
    const layout = await layoutOf()

    await lockedWhile(join(P(), 'done'), 0o755, async () => {
      await expect(
        moveCard(layout, 'backlog/a.md', { status: 'done', index: 0 })
      ).rejects.toMatchObject({ code: 'EACCES' })
    })
    await expect(read('backlog/a.md')).resolves.toBe('# A\n')
  })

  it('answers cardMissing for a card that is gone', async () => {
    await expect(
      moveCard(await layoutOf(), 'backlog/gone.md', { status: 'done', index: 0 })
    ).rejects.toMatchObject({ code: 'cardMissing', params: { name: 'gone.md' } })
  })
})

describe('removeCard', () => {
  const discard = (): ReturnType<typeof vi.fn<(path: string) => Promise<void>>> =>
    vi.fn((path: string) => rm(path))

  it("hands the card's path to discard", async () => {
    await card('backlog/a.md', '# A\n')
    const trash = discard()

    await removeCard(await layoutOf(), 'backlog/a.md', trash)

    expect(trash).toHaveBeenCalledTimes(1)
    expect(trash).toHaveBeenCalledWith(join(P(), 'backlog/a.md'))
    await expect(lstat(join(P(), 'backlog/a.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('answers cardMissing and discards nothing', async () => {
    const trash = discard()

    await expect(removeCard(await layoutOf(), 'backlog/gone.md', trash)).rejects.toMatchObject({
      code: 'cardMissing'
    })
    expect(trash).not.toHaveBeenCalled()
  })

  it('refuses a linked card and discards nothing', async () => {
    await given(join(root, 'outside.md'), '# Outside\n')
    await mkdir(join(P(), 'backlog'), { recursive: true })
    await symlink(join(root, 'outside.md'), join(P(), 'backlog', 'link.md'))
    const trash = discard()

    await expect(removeCard(await layoutOf(), 'backlog/link.md', trash)).rejects.toMatchObject({
      code: 'cardOutside'
    })
    expect(trash).not.toHaveBeenCalled()
    await expect(readFile(join(root, 'outside.md'), 'utf8')).resolves.toBe('# Outside\n')
  })
})

describe('findCard', () => {
  const ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b'
  const withId = `---\nid: ${ID}\n---\n# X\n`

  it('finds a card by the id in its header', async () => {
    await card('done/x.md', withId)

    await expect(findCard(await layoutOf(), ID)).resolves.toBe('done/x.md')
  })

  it('takes the first by name of two cards with one id', async () => {
    await card('backlog/b.md', withId)
    await card('backlog/a.md', withId)

    await expect(findCard(await layoutOf(), ID)).resolves.toBe('backlog/a.md')
  })

  it('compares the paths with digits as numbers', async () => {
    await card('backlog/card10.md', withId)
    await card('backlog/card9.md', withId)

    await expect(findCard(await layoutOf(), ID)).resolves.toBe('backlog/card9.md')
  })

  it('answers null for an id nobody has', async () => {
    await card('backlog/b.md', withId)
    await card('backlog/a.md', withId)

    await expect(
      findCard(await layoutOf(), 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')
    ).resolves.toBeNull()
  })
})
