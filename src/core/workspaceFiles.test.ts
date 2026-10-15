/**
 * Driven against a real directory and a real repository: what is under test is
 * where a path lands on disk and what git says about it, and a fake of either
 * would be testing the guess.
 */

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type GitExec, gitIn } from './git.js'
import { type Workspace, WorkspaceSchema } from './store.js'
import {
  MAX_DIRECTORY_ENTRIES,
  MAX_VIEW_BYTES,
  readWorkspaceDirectory,
  readWorkspaceFile
} from './workspaceFiles.js'
import { WorkspaceError } from './workspaces.js'

const run = promisify(execFile)

let dir: string
let outside: string
let workspace: Workspace
let exec: GitExec

async function git(...args: string[]): Promise<void> {
  await run('git', args, { cwd: dir })
}

async function commit(): Promise<void> {
  await git('add', '-A')
  await git('commit', '-q', '-m', 'commit')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-files-'))
  outside = await mkdtemp(join(tmpdir(), 'octopus-outside-'))
  await git('init', '-q', '--initial-branch=main')
  await git('config', 'user.email', 'test@example.com')
  await git('config', 'user.name', 'Test')
  workspace = WorkspaceSchema.parse({
    id: 'ws-1',
    projectId: 'project-1',
    name: 'anna',
    branch: 'main',
    path: dir,
    status: 'idle',
    port: 3000,
    createdAt: '2026-10-15T10:00:00.000Z',
    ownerId: 'owner-1'
  })
  exec = gitIn(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('readWorkspaceDirectory', () => {
  it('lists a folder folders first, hiding what the tree never shows', async () => {
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(dir, 'node_modules', 'b.js'), '', 'utf8')
    await writeFile(join(dir, 'node_modules', 'a.js'), '', 'utf8')
    await writeFile(join(dir, 'node_modules', '.DS_Store'), '', 'utf8')

    await expect(readWorkspaceDirectory(workspace, 'node_modules')).resolves.toEqual({
      entries: [
        { name: 'pkg', kind: 'directory' },
        { name: 'a.js', kind: 'file' },
        { name: 'b.js', kind: 'file' }
      ],
      truncated: false
    })
  })

  // pnpm's node_modules is mostly links. Each must say what it points at, or a
  // linked package would draw as a file nobody can open.
  it('follows a link to learn its kind, and draws a dangling one as a file', async () => {
    await mkdir(join(dir, 'node_modules', 'real'), { recursive: true })
    await symlink(join(dir, 'node_modules', 'real'), join(dir, 'node_modules', 'linked'))
    await symlink(join(dir, 'nowhere'), join(dir, 'node_modules', 'dangling'))
    await writeFile(join(dir, 'node_modules', 'real', 'index.js'), '', 'utf8')
    await symlink(
      join(dir, 'node_modules', 'real', 'index.js'),
      join(dir, 'node_modules', 'main.js')
    )

    const listing = await readWorkspaceDirectory(workspace, 'node_modules')

    expect(listing.entries).toEqual([
      { name: 'linked', kind: 'directory' },
      { name: 'real', kind: 'directory' },
      { name: 'dangling', kind: 'file' },
      { name: 'main.js', kind: 'file' }
    ])
  })

  it('stops at the cap and says so', async () => {
    await mkdir(join(dir, 'big'))
    await Promise.all(
      Array.from({ length: MAX_DIRECTORY_ENTRIES + 1 }, (_, index) =>
        writeFile(join(dir, 'big', `f${String(index)}`), '', 'utf8')
      )
    )

    const listing = await readWorkspaceDirectory(workspace, 'big')

    expect(listing.entries).toHaveLength(MAX_DIRECTORY_ENTRIES)
    expect(listing.truncated).toBe(true)
  })

  it('refuses a folder outside the worktree, by climbing or through a link', async () => {
    await symlink(outside, join(dir, 'escape'))

    await expect(readWorkspaceDirectory(workspace, '..')).rejects.toBeInstanceOf(WorkspaceError)
    await expect(readWorkspaceDirectory(workspace, 'escape')).rejects.toMatchObject({
      code: 'worktreeMissing'
    })
  })

  it('refuses a file, which is not a folder to list', async () => {
    await writeFile(join(dir, 'a.txt'), '', 'utf8')

    await expect(readWorkspaceDirectory(workspace, 'a.txt')).rejects.toMatchObject({
      code: 'worktreeMissing'
    })
  })
})

describe('readWorkspaceFile', () => {
  it('reads a text file, without its byte-order mark', async () => {
    await writeFile(join(dir, 'a.ts'), '﻿const a = 1\n', 'utf8')

    await expect(readWorkspaceFile(workspace, 'a.ts', exec)).resolves.toEqual({
      kind: 'text',
      text: 'const a = 1\n',
      bytes: 15
    })
  })

  it('declines a binary file by the rule git uses', async () => {
    await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]))

    await expect(readWorkspaceFile(workspace, 'image.png', exec)).resolves.toEqual({
      kind: 'binary',
      bytes: 4
    })
  })

  // Sparse, so the test does not write a megabyte to prove it is not read.
  it('declines a file past the cap before reading it', async () => {
    await writeFile(join(dir, 'huge.log'), '', 'utf8')
    await truncate(join(dir, 'huge.log'), MAX_VIEW_BYTES + 1)

    await expect(readWorkspaceFile(workspace, 'huge.log', exec)).resolves.toEqual({
      kind: 'tooLarge',
      bytes: MAX_VIEW_BYTES + 1,
      limit: MAX_VIEW_BYTES
    })
  })

  it('answers missing for a folder, which is not a file to show', async () => {
    await mkdir(join(dir, 'src'))

    await expect(readWorkspaceFile(workspace, 'src', exec)).resolves.toEqual({ kind: 'missing' })
  })

  it('answers missing for a link out of the worktree, rather than reading through it', async () => {
    await writeFile(join(outside, 'secret'), 'key\n', 'utf8')
    await symlink(join(outside, 'secret'), join(dir, 'innocent.txt'))
    await commit()

    await expect(readWorkspaceFile(workspace, 'innocent.txt', exec)).resolves.toEqual({
      kind: 'missing'
    })
  })

  it('never asks git about a path that climbs out of the worktree', async () => {
    const calls: string[][] = []
    const spy: GitExec = (args) => {
      calls.push([...args])
      return Promise.resolve('')
    }

    await expect(readWorkspaceFile(workspace, '../elsewhere.txt', spy)).resolves.toEqual({
      kind: 'missing'
    })
    expect(calls).toEqual([])
  })

  describe('a file gone from disk', () => {
    it('shows the version HEAD still has', async () => {
      await writeFile(join(dir, 'gone.ts'), 'was here\n', 'utf8')
      await commit()
      await unlink(join(dir, 'gone.ts'))

      await expect(readWorkspaceFile(workspace, 'gone.ts', exec)).resolves.toEqual({
        kind: 'deleted',
        text: 'was here\n'
      })
    })

    // A name is not a pattern. `z?` as a pattern also matches `z1`, which
    // sorts first and would be the record read.
    it('reads a name with pattern characters literally', async () => {
      await writeFile(join(dir, 'z1'), 'other\n', 'utf8')
      await writeFile(join(dir, 'z?'), 'questioned\n', 'utf8')
      await commit()
      await unlink(join(dir, 'z?'))

      await expect(readWorkspaceFile(workspace, 'z?', exec)).resolves.toEqual({
        kind: 'deleted',
        text: 'questioned\n'
      })
    })

    it('carries no text when the version in HEAD is binary', async () => {
      await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x00, 0x47]))
      await commit()
      await unlink(join(dir, 'image.png'))

      await expect(readWorkspaceFile(workspace, 'image.png', exec)).resolves.toEqual({
        kind: 'deleted',
        text: null
      })
    })

    it('carries no text when the version in HEAD is past the cap', async () => {
      await writeFile(join(dir, 'huge.txt'), 'x'.repeat(MAX_VIEW_BYTES + 1), 'utf8')
      await commit()
      await unlink(join(dir, 'huge.txt'))

      await expect(readWorkspaceFile(workspace, 'huge.txt', exec)).resolves.toEqual({
        kind: 'deleted',
        text: null
      })
    })

    it('answers missing for a folder HEAD has, which is not a file', async () => {
      await mkdir(join(dir, 'src'))
      await writeFile(join(dir, 'src', 'a.ts'), 'a\n', 'utf8')
      await commit()
      await rm(join(dir, 'src'), { recursive: true })

      await expect(readWorkspaceFile(workspace, 'src', exec)).resolves.toEqual({
        kind: 'missing'
      })
    })

    it('answers missing for a path HEAD never had', async () => {
      await writeFile(join(dir, 'a.ts'), 'a\n', 'utf8')
      await commit()

      await expect(readWorkspaceFile(workspace, 'never.ts', exec)).resolves.toEqual({
        kind: 'missing'
      })
    })

    it('answers missing in a repository with no commits yet', async () => {
      await expect(readWorkspaceFile(workspace, 'never.ts', exec)).resolves.toEqual({
        kind: 'missing'
      })
    })
  })
})
