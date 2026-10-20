import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { branchGuard, branchGuardMessage, leavesBranch } from './branchGuard.js'

const BRANCH = 'octopus/gwen'
/** `src/a.ts` is a file in the worktree; nothing else is. */
const isPath = (arg: string): boolean => arg === 'src/a.ts' || arg === '.'

describe('leavesBranch', () => {
  it.each([
    'git checkout -b feat/x',
    'git checkout -B feat/x',
    'git checkout --orphan fresh',
    'git checkout --detach',
    'git checkout feat/x',
    'git checkout -',
    'git switch feat/x',
    'git switch -c feat/x',
    'git switch --detach',
    'git branch -m renamed',
    'git branch -M renamed',
    // Wherever it sits in a line, and however git is invoked.
    'npm run check && git checkout -b feat/x',
    'git status; git switch feat/x',
    'git -C /some/where checkout -b feat/x',
    'env git checkout -b feat/x',
    '/usr/bin/git switch feat/x',
    'git --git-dir .git --work-tree . checkout -b feat/x',
    'git -c core.pager=cat switch feat/x',
    'git --no-pager checkout feat/x',
    "git checkout -b 'feat/x'"
  ])('refuses %s', (command) => {
    expect(leavesBranch(command, BRANCH, isPath)).toBe(true)
  })

  it.each([
    // Back to the workspace's own branch: how a moved worktree is put right.
    'git checkout octopus/gwen',
    'git switch octopus/gwen',
    // Putting files back, which is the other job `checkout` does.
    'git checkout src/a.ts',
    'git checkout .',
    'git checkout -- missing.ts',
    'git checkout HEAD -- src/a.ts',
    'git branch',
    'git branch --show-current',
    'git branch -d old',
    'gh pr view',
    'git status',
    'git',
    'git --no-pager',
    'npm test',
    ''
  ])('lets %s run', (command) => {
    expect(leavesBranch(command, BRANCH, isPath)).toBe(false)
  })
})

describe('branchGuard', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopus-guard-'))
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'a.ts'), '')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('refuses with the reason, naming the branch', () => {
    const refuse = branchGuard(() => BRANCH, dir)

    expect(refuse('git checkout -b feat/x')).toBe(branchGuardMessage(BRANCH))
    expect(branchGuardMessage(BRANCH)).toContain(BRANCH)
  })

  // The disk is what tells a file from a branch.
  it('lets a file in the worktree be checked out, and nothing else', () => {
    const refuse = branchGuard(() => BRANCH, dir)

    expect(refuse('git checkout src/a.ts')).toBeNull()
    expect(refuse('git checkout src/b.ts')).not.toBeNull()
  })

  // Asked each time, so a rename moves the branch the guard allows.
  it('follows the branch as it is now', () => {
    let branch = BRANCH
    const refuse = branchGuard(() => branch, dir)

    branch = 'octopus/renamed'

    expect(refuse('git checkout octopus/renamed')).toBeNull()
    expect(refuse('git checkout octopus/gwen')).not.toBeNull()
  })

  it('refuses nothing once the workspace is gone', () => {
    expect(branchGuard(() => null, dir)('git checkout -b feat/x')).toBeNull()
  })
})
