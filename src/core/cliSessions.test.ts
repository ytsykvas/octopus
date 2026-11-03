import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  cliSessionsOf,
  type DeleteSessionFn,
  discardCliSessions,
  type ListSessionsFn
} from './cliSessions.js'

describe("the CLI's own sessions of a worktree", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopus-cli-sessions-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const listing =
    (sessions: readonly { sessionId: string; cwd?: string }[]): ListSessionsFn =>
    () =>
      Promise.resolve(sessions)

  // The SDK's default answers every worktree of the repository, which is
  // every other workspace of the project.
  it("asks for the worktree's own sessions only", async () => {
    const list = vi.fn<ListSessionsFn>(() => Promise.resolve([]))

    await cliSessionsOf(dir, list)

    expect(list).toHaveBeenCalledExactlyOnceWith({
      dir,
      includeWorktrees: false,
      includeProgrammatic: true
    })
  })

  // With CLAUDE_CODE_PROJECT_DIR_NAME set, the CLI files every directory's
  // sessions in one folder and the listing answers all of them.
  it('keeps only the sessions started in the worktree', async () => {
    const list = listing([
      { sessionId: 'a', cwd: dir },
      { sessionId: 'b', cwd: '/elsewhere' },
      { sessionId: 'c' }
    ])

    await expect(cliSessionsOf(dir, list)).resolves.toEqual(['a'])
  })

  // The CLI records the directory it resolved; the worktree may be reached
  // through a link — `/var` is `/private/var` on macOS.
  it('matches the worktree by its real path as well', async () => {
    const target = join(dir, 'target')
    await mkdir(target)
    const linked = join(dir, 'linked')
    await symlink(target, linked)
    const real = await realpath(target)

    await expect(cliSessionsOf(linked, listing([{ sessionId: 'a', cwd: real }]))).resolves.toEqual([
      'a'
    ])
  })

  it('falls back to the path as given when it cannot be resolved', async () => {
    const resolve = (): Promise<string> => Promise.reject(new Error('gone'))

    await expect(
      cliSessionsOf('/nowhere', listing([{ sessionId: 'a', cwd: '/nowhere' }]), resolve)
    ).resolves.toEqual(['a'])
  })

  // History is not a reason to keep a workspace somebody asked to remove.
  it('answers none when the listing fails', async () => {
    const list: ListSessionsFn = () => Promise.reject(new Error('unreadable'))

    await expect(cliSessionsOf(dir, list)).resolves.toEqual([])
  })

  it("deletes every id in the worktree's folder", async () => {
    const remove = vi.fn<DeleteSessionFn>(() => Promise.resolve())

    await discardCliSessions(dir, ['a', 'b'], remove)

    expect(remove.mock.calls).toEqual([
      ['a', { dir }],
      ['b', { dir }]
    ])
  })

  it('carries on past a session that cannot be deleted', async () => {
    const remove = vi
      .fn<DeleteSessionFn>()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce(undefined)

    await expect(discardCliSessions(dir, ['a', 'b'], remove)).resolves.toBeUndefined()
    expect(remove).toHaveBeenCalledTimes(2)
  })
})
