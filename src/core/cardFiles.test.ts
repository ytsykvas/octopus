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
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addAttachments,
  attachmentPath,
  isAttachmentName,
  listAttachments,
  removeAttachment
} from './cardFiles.js'
import { type BoardLayout, findLayout } from './boardFiles.js'

const run = promisify(execFile)

let root: string
let layout: BoardLayout
let src: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-attach-'))
  await given(join(root, 'planner', 'backlog', 'A.md'), '# A\n')
  layout = await findLayout(root, 'planner')
  src = join(root, 'picked')
  await mkdir(src)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function given(path: string, contents = ''): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents)
}

async function lockedWhile(path: string, open: number, body: () => Promise<void>): Promise<void> {
  await chmod(path, 0o000)
  try {
    await body()
  } finally {
    await chmod(path, open)
  }
}

const files = (...names: string[]): string => join(layout.dir, '_attachments', 'A', ...names)

async function picked(name: string, contents = name): Promise<string> {
  const path = join(src, name)
  await given(path, contents)
  return path
}

async function addOne(name: string): Promise<string[]> {
  await addAttachments(layout, 'backlog/A.md', [await picked(name)])
  return readdir(files())
}

describe('isAttachmentName', () => {
  it('accepts a plain file name', () => {
    for (const name of ['mockup.png', 'Знімок екрана.png', 'x'.repeat(255)]) {
      expect(isAttachmentName(name)).toBe(true)
    }
  })

  it('refuses what the list would hide or that climbs', () => {
    for (const name of [
      '',
      '.',
      '..',
      'a/b',
      'a\\b',
      'a\u0000b',
      '.env',
      '_x',
      'x.tmp',
      'x'.repeat(256)
    ]) {
      expect(isAttachmentName(name)).toBe(false)
    }
  })
})

describe('listAttachments', () => {
  it('lists nothing for a card with no folder', async () => {
    await expect(listAttachments(layout, 'backlog/A.md')).resolves.toEqual([])
  })

  it("lists a card's files in name order, without hidden ones", async () => {
    for (const name of ['shot 10.png', 'shot 9.png', '.DS_Store', 'x.tmp']) await given(files(name))
    await mkdir(files('sub'))

    await expect(listAttachments(layout, 'backlog/A.md')).resolves.toEqual([
      'shot 9.png',
      'shot 10.png'
    ])
  })

  it('lists nothing through a folder linked out of the board', async () => {
    await given(join(root, 'elsewhere', 'A', 'a.txt'))
    await symlink(join(root, 'elsewhere'), join(layout.dir, '_attachments'))

    await expect(listAttachments(layout, 'backlog/A.md')).resolves.toEqual([])
  })

  it('lists nothing when the folder is a file', async () => {
    await given(files())

    await expect(listAttachments(layout, 'backlog/A.md')).resolves.toEqual([])
  })

  it('names the folder of files when it cannot be read', async () => {
    await mkdir(files(), { recursive: true })

    await lockedWhile(files(), 0o755, async () => {
      await expect(listAttachments(layout, 'backlog/A.md')).rejects.toMatchObject({
        code: 'boardFolderUnreadable',
        params: { path: files() }
      })
    })
  })

  it('refuses a card outside the board', async () => {
    await expect(listAttachments(layout, '../x.md')).rejects.toMatchObject({ code: 'cardOutside' })
  })
})

describe('addAttachments', () => {
  it('copies picked files and counts them', async () => {
    const sources = [await picked('one.txt', '1'), await picked('two.txt', '2')]

    await expect(addAttachments(layout, 'backlog/A.md', sources)).resolves.toBe(2)
    await expect(readFile(files('one.txt'), 'utf8')).resolves.toBe('1')
    await expect(readFile(files('two.txt'), 'utf8')).resolves.toBe('2')
  })

  it('never overwrites a file already there', async () => {
    await given(files('mockup.png'), 'old')

    await expect(
      addAttachments(layout, 'backlog/A.md', [await picked('mockup.png', 'new')])
    ).resolves.toBe(1)
    await expect(readFile(files('mockup.png'), 'utf8')).resolves.toBe('old')
    await expect(readFile(files('mockup-2.png'), 'utf8')).resolves.toBe('new')
  })

  it('numbers past every taken name', async () => {
    await given(files('mockup.png'))
    await given(files('mockup-2.png'))

    expect(await addOne('mockup.png')).toContain('mockup-3.png')
  })

  it('numbers two copies of one name in one go', async () => {
    await given(join(src, 'a', 'x.png'))
    await given(join(src, 'b', 'x.png'))

    await addAttachments(layout, 'backlog/A.md', [join(src, 'a', 'x.png'), join(src, 'b', 'x.png')])

    expect((await readdir(files())).sort()).toEqual(['x-2.png', 'x.png'])
  })

  it('treats names that differ only in case as taken', async () => {
    await given(files('Mockup.PNG'))

    expect(await addOne('mockup.png')).toContain('mockup-2.png')
  })

  it('cuts a long name to make room for its number', async () => {
    const long = `${'x'.repeat(251)}.png`
    await given(files(long))

    expect(await addOne(long)).toContain(`${'x'.repeat(249)}-2.png`)
  })

  it('keeps the quarantine of a downloaded file', async () => {
    const shot = await picked('shot.command')
    await run('/usr/bin/xattr', ['-w', 'com.apple.quarantine', '0083;6745a1b2;Safari;', shot])

    await addAttachments(layout, 'backlog/A.md', [shot])

    const { stdout } = await run('/usr/bin/xattr', [
      '-p',
      'com.apple.quarantine',
      files('shot.command')
    ])
    expect(stdout).toBe('0083;6745a1b2;Safari;\n')
  })

  it('removes a copy whose quarantine could not be kept', async () => {
    const exec = (_command: string, args: readonly string[]): Promise<string> =>
      args[0] === '-p'
        ? Promise.resolve('0083;6745a1b2;Safari;\n')
        : Promise.reject(new Error('xattr: denied'))

    await expect(
      addAttachments(layout, 'backlog/A.md', [await picked('shot.command')], exec)
    ).rejects.toThrow('xattr: denied')
    await expect(readdir(files())).resolves.toEqual([])
  })

  it('numbers a name with no extension', async () => {
    await given(files('README'))

    expect(await addOne('README')).toContain('README-2')
  })

  it('stores a decomposed name composed', async () => {
    expect(await addOne('Größe.png')).toEqual(['Größe.png'])
  })

  it('skips what is not a regular file, and makes no folder for nothing', async () => {
    await mkdir(join(src, 'dir'))
    await symlink(await picked('one.txt'), join(src, 'link'))

    await expect(
      addAttachments(layout, 'backlog/A.md', [join(src, 'dir'), join(src, 'link')])
    ).resolves.toBe(0)
    await expect(lstat(join(layout.dir, '_attachments'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips a relative path, even one that names a file from here', async () => {
    const near = relative(process.cwd(), await picked('one.txt'))

    await expect(addAttachments(layout, 'backlog/A.md', [near])).resolves.toBe(0)
  })

  it('skips a file the list would hide', async () => {
    const sources = [await picked('.env'), await picked('_x.png'), await picked('x.tmp')]

    await expect(addAttachments(layout, 'backlog/A.md', sources)).resolves.toBe(0)
    await expect(lstat(join(layout.dir, '_attachments'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('skips a picked file that is gone', async () => {
    await expect(addAttachments(layout, 'backlog/A.md', [join(src, 'gone.txt')])).resolves.toBe(0)
  })

  it('skips a picked file under a file, as gone', async () => {
    const file = await picked('one.txt')

    await expect(addAttachments(layout, 'backlog/A.md', [join(file, 'a.txt')])).resolves.toBe(0)
  })

  it('passes on a failure to look at a picked file', async () => {
    await given(join(src, 'locked', 'a.txt'))

    await lockedWhile(join(src, 'locked'), 0o755, async () => {
      await expect(
        addAttachments(layout, 'backlog/A.md', [join(src, 'locked', 'a.txt')])
      ).rejects.toMatchObject({ code: 'EACCES' })
    })
  })

  it('keeps what it copied before a failure', async () => {
    const sources = [await picked('ok.txt'), await picked('denied.txt')]

    await lockedWhile(join(src, 'denied.txt'), 0o644, async () => {
      await expect(addAttachments(layout, 'backlog/A.md', sources)).rejects.toMatchObject({
        code: 'EACCES'
      })
    })
    await expect(readdir(files())).resolves.toEqual(['ok.txt'])
  })

  it('refuses a card outside the board', async () => {
    await expect(addAttachments(layout, '../x.md', [])).rejects.toMatchObject({
      code: 'cardOutside'
    })
  })

  it('refuses a card that is not there, and makes no folder', async () => {
    await expect(
      addAttachments(layout, 'backlog/Gone.md', [await picked('one.txt')])
    ).rejects.toMatchObject({ code: 'cardMissing', params: { name: 'Gone.md' } })
    await expect(lstat(join(layout.dir, '_attachments'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to copy through a folder linked out of the board', async () => {
    await mkdir(join(root, 'elsewhere'))
    await symlink(join(root, 'elsewhere'), join(layout.dir, '_attachments'))

    await expect(
      addAttachments(layout, 'backlog/A.md', [await picked('one.txt')])
    ).rejects.toMatchObject({ code: 'cardOutside', params: { name: join('_attachments', 'A') } })
    await expect(readdir(join(root, 'elsewhere'))).resolves.toEqual([])
  })

  it('shares one folder between two cards of one name', async () => {
    await given(join(layout.dir, 'ideas', 'A.md'), '# A\n')

    await addAttachments(layout, 'backlog/A.md', [await picked('one.txt')])

    await expect(listAttachments(layout, 'ideas/A.md')).resolves.toEqual(['one.txt'])
  })
})

describe('attachmentPath', () => {
  it("answers the path of a card's file", async () => {
    await given(files('a.txt'))

    await expect(attachmentPath(layout, 'backlog/A.md', 'a.txt')).resolves.toBe(files('a.txt'))
  })

  it('refuses a name that climbs or hides', async () => {
    for (const name of ['../../x', '.env']) {
      await expect(attachmentPath(layout, 'backlog/A.md', name)).rejects.toMatchObject({
        code: 'cardOutside',
        params: { name }
      })
    }
  })

  it('refuses a file that is not there', async () => {
    await expect(attachmentPath(layout, 'backlog/A.md', 'nope.txt')).rejects.toMatchObject({
      code: 'cardMissing',
      params: { name: 'nope.txt' }
    })
  })

  it('refuses a folder linked out of the board', async () => {
    await given(join(root, 'elsewhere', 'a.txt'))
    await mkdir(join(layout.dir, '_attachments'))
    await symlink(join(root, 'elsewhere'), files())

    await expect(attachmentPath(layout, 'backlog/A.md', 'a.txt')).rejects.toMatchObject({
      code: 'cardOutside'
    })
  })

  it('refuses a card outside the board', async () => {
    await expect(attachmentPath(layout, '../x.md', 'a.txt')).rejects.toMatchObject({
      code: 'cardOutside'
    })
  })

  it('passes on a failure that is not absence', async () => {
    await given(files('a.txt'))

    await lockedWhile(files(), 0o755, async () => {
      await expect(attachmentPath(layout, 'backlog/A.md', 'a.txt')).rejects.toMatchObject({
        code: 'EACCES'
      })
    })
  })
})

describe('removeAttachment', () => {
  it("hands a card's file to discard and deletes nothing itself", async () => {
    await given(files('a.txt'), 'a')
    const discard = vi.fn(() => Promise.resolve())

    await removeAttachment(layout, 'backlog/A.md', 'a.txt', discard)

    expect(discard).toHaveBeenCalledTimes(1)
    expect(discard).toHaveBeenCalledWith(files('a.txt'))
    await expect(readFile(files('a.txt'), 'utf8')).resolves.toBe('a')
  })

  it('hands discard nothing for a name that climbs or a file that is gone', async () => {
    const discard = vi.fn(() => Promise.resolve())

    await expect(
      removeAttachment(layout, 'backlog/A.md', '../A.md', discard)
    ).rejects.toMatchObject({ code: 'cardOutside' })
    await expect(
      removeAttachment(layout, 'backlog/A.md', 'nope.txt', discard)
    ).rejects.toMatchObject({ code: 'cardMissing' })
    expect(discard).not.toHaveBeenCalled()
  })

  it('hands discard no folder, which the list never shows', async () => {
    await given(files('sub', 'inner.txt'))
    const discard = vi.fn(() => Promise.resolve())

    await expect(removeAttachment(layout, 'backlog/A.md', 'sub', discard)).rejects.toMatchObject({
      code: 'cardMissing',
      params: { name: 'sub' }
    })
    expect(discard).not.toHaveBeenCalled()
  })

  it('hands discard no link, which would reach out of the board', async () => {
    await given(join(root, 'elsewhere.txt'))
    await mkdir(files(), { recursive: true })
    await symlink(join(root, 'elsewhere.txt'), files('a.txt'))
    const discard = vi.fn(() => Promise.resolve())

    await expect(removeAttachment(layout, 'backlog/A.md', 'a.txt', discard)).rejects.toMatchObject({
      code: 'cardOutside'
    })
    expect(discard).not.toHaveBeenCalled()
  })

  it('hands discard nothing of a card that is gone, as an attach refuses it', async () => {
    await given(join(layout.dir, '_attachments', 'Gone', 'a.txt'))
    const discard = vi.fn(() => Promise.resolve())

    await expect(
      removeAttachment(layout, 'backlog/Gone.md', 'a.txt', discard)
    ).rejects.toMatchObject({ code: 'cardMissing', params: { name: 'Gone.md' } })
    expect(discard).not.toHaveBeenCalled()
  })
})
