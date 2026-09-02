import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  chatsDir,
  chatTranscript,
  configFile,
  globalSkillsRoot,
  insideWorktree,
  projectDir,
  projectScript,
  projectScriptsDir,
  projectSkillsRoot,
  resolvesInside,
  rootDir,
  skillsDirOf,
  stateFile,
  stateTempFile,
  workspacePath,
  workspacesDir
} from './paths.js'

const HOME = join('/tmp', 'octopus-test-home')
const ROOT = join(HOME, '.octopus')
const PROJECT = 'planner'

describe('rootDir', () => {
  it('places application data inside the user home directory', () => {
    expect(rootDir(HOME)).toBe(join(HOME, '.octopus'))
  })

  it('defaults to the current user home directory', () => {
    expect(rootDir()).toBe(join(homedir(), '.octopus'))
  })
})

describe('top-level files', () => {
  it('keeps config in the data root', () => {
    expect(configFile(ROOT)).toBe(join(ROOT, 'config.json'))
  })

  it('keeps state in the data root', () => {
    expect(stateFile(ROOT)).toBe(join(ROOT, 'state.json'))
  })

  it('puts the temp file next to state, otherwise rename would not be atomic', () => {
    expect(stateTempFile(ROOT)).toBe(join(ROOT, 'state.json.tmp'))
  })

  it('falls back to rootDir when no root is given', () => {
    const root = rootDir()
    expect(configFile()).toBe(join(root, 'config.json'))
    expect(stateFile()).toBe(join(root, 'state.json'))
    expect(stateTempFile()).toBe(join(root, 'state.json.tmp'))
  })
})

describe('project paths', () => {
  it('keeps project metadata separate from workspaces', () => {
    expect(projectDir(PROJECT, ROOT)).toBe(join(ROOT, 'projects', PROJECT))
  })

  it('nests scripts inside the project directory', () => {
    expect(projectScriptsDir(PROJECT, ROOT)).toBe(join(ROOT, 'projects', PROJECT, 'scripts'))
  })

  it('places every named script side by side inside that directory', () => {
    const scripts = projectScriptsDir(PROJECT, ROOT)
    expect(projectScript(PROJECT, 'setup.sh', ROOT)).toBe(join(scripts, 'setup.sh'))
    expect(projectScript(PROJECT, 'run.sh', ROOT)).toBe(join(scripts, 'run.sh'))
  })

  it('falls back to rootDir when no root is given', () => {
    const root = rootDir()
    expect(projectDir(PROJECT)).toBe(join(root, 'projects', PROJECT))
    expect(projectScriptsDir(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts'))
    expect(projectScript(PROJECT, 'setup.sh')).toBe(
      join(root, 'projects', PROJECT, 'scripts', 'setup.sh')
    )
  })
})

describe('skill paths', () => {
  it('keeps the installation-wide store beside the projects, not inside one', () => {
    expect(globalSkillsRoot(ROOT)).toBe(join(ROOT, 'skills'))
    expect(globalSkillsRoot(ROOT)).not.toContain(join(ROOT, 'projects'))
  })

  it("nests a project's store inside that project's directory", () => {
    expect(projectSkillsRoot(PROJECT, ROOT)).toBe(join(ROOT, 'projects', PROJECT, 'skills'))
  })

  /*
   * The shape a session discovers skills in — a root with a `.claude/skills`
   * inside it — because that is what puts them under the same switch as the
   * checkout's own. A local plugin was tried and cannot be switched off.
   */
  it('gives either store the shape a working-directory root has', () => {
    for (const root of [globalSkillsRoot(ROOT), projectSkillsRoot(PROJECT, ROOT)]) {
      expect(skillsDirOf(root)).toBe(join(root, '.claude', 'skills'))
    }
  })

  it('falls back to rootDir when no root is given', () => {
    const root = rootDir()
    expect(globalSkillsRoot()).toBe(join(root, 'skills'))
    expect(projectSkillsRoot(PROJECT)).toBe(join(root, 'projects', PROJECT, 'skills'))
  })
})

describe('workspace paths', () => {
  it('groups workspaces by project', () => {
    expect(workspacesDir(PROJECT, ROOT)).toBe(join(ROOT, 'workspaces', PROJECT))
  })

  it('gives each workspace its own directory — the git worktree root', () => {
    expect(workspacePath(PROJECT, 'kyiv', ROOT)).toBe(join(ROOT, 'workspaces', PROJECT, 'kyiv'))
  })

  it('keeps workspaces out of the project metadata tree', () => {
    expect(workspacePath(PROJECT, 'kyiv', ROOT)).not.toContain(join(ROOT, 'projects'))
  })

  it('falls back to rootDir when no root is given', () => {
    const root = rootDir()
    expect(workspacesDir(PROJECT)).toBe(join(root, 'workspaces', PROJECT))
    expect(workspacePath(PROJECT, 'kyiv')).toBe(join(root, 'workspaces', PROJECT, 'kyiv'))
  })
})

describe('chat transcripts', () => {
  it('keeps every transcript in one directory', () => {
    expect(chatsDir(ROOT)).toBe(join(ROOT, 'chats'))
  })

  // Flat rather than nested under the workspace: a chat outlives the name its
  // workspace had when it started, and renaming must not strand the file.
  it('names the file after the chat and nothing else', () => {
    expect(chatTranscript('9f3c-1', ROOT)).toBe(join(ROOT, 'chats', '9f3c-1.jsonl'))
  })

  it('falls back to rootDir when no root is given', () => {
    const root = rootDir()
    expect(chatsDir()).toBe(join(root, 'chats'))
    expect(chatTranscript('9f3c-1')).toBe(join(root, 'chats', '9f3c-1.jsonl'))
  })
})

describe('insideWorktree', () => {
  it('accepts a path a diff or a carry list can name', () => {
    expect(insideWorktree('src/core/revert.ts')).toBe(true)
    expect(insideWorktree('a.txt')).toBe(true)
    expect(insideWorktree('config/.env')).toBe(true)
  })

  /*
   * Every caller joins the answer to a worktree and then hands it to something
   * that writes: a git argument, a file to delete, a block of credentials.
   */
  it('refuses one that is absolute, climbs out, or is nothing at all', () => {
    expect(insideWorktree('/etc/passwd')).toBe(false)
    expect(insideWorktree('../outside.txt')).toBe(false)
    expect(insideWorktree('a/../../outside.txt')).toBe(false)
    expect(insideWorktree('')).toBe(false)
  })
})

describe('resolvesInside', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'octopus-inside-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('accepts an ordinary file, and a link that stays in the worktree', async () => {
    await mkdir(join(root, 'tools'), { recursive: true })
    await writeFile(join(root, 'tools', 'guard.sh'), '#!/bin/sh\n', 'utf8')
    await symlink(join(root, 'tools', 'guard.sh'), join(root, 'linked.sh'))

    await expect(resolvesInside(root, 'tools/guard.sh')).resolves.toBe(true)
    await expect(resolvesInside(root, 'linked.sh')).resolves.toBe(true)
  })

  /*
   * The case the predicate exists for: the name is inside and the bytes are
   * somewhere else entirely, so reading it would show a file the worktree does
   * not contain.
   */
  it('refuses a link leading out of the worktree', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await writeFile(join(elsewhere, 'secret'), 'x', 'utf8')
    await symlink(join(elsewhere, 'secret'), join(root, 'out.sh'))

    await expect(resolvesInside(root, 'out.sh')).resolves.toBe(false)

    await rm(elsewhere, { recursive: true, force: true })
  })

  /*
   * The other way round from `unlinkedInside`, which treats an absent segment
   * as fine because its callers are about to create it. Here there is nothing
   * to resolve, and a link that cannot be followed is one nothing can vouch for.
   */
  it('refuses what is not there, and a link pointing at nothing', async () => {
    await symlink(join(root, 'never-written'), join(root, 'broken.sh'))

    await expect(resolvesInside(root, 'absent.sh')).resolves.toBe(false)
    await expect(resolvesInside(root, 'broken.sh')).resolves.toBe(false)
  })

  // A sibling directory whose name merely starts with the root's is outside it.
  it('is not fooled by a neighbour sharing the root name as a prefix', async () => {
    const neighbour = `${root}-next-door`
    await mkdir(neighbour, { recursive: true })
    await writeFile(join(neighbour, 'guard.sh'), 'x', 'utf8')
    await symlink(join(neighbour, 'guard.sh'), join(root, 'near.sh'))

    await expect(resolvesInside(root, 'near.sh')).resolves.toBe(false)

    await rm(neighbour, { recursive: true, force: true })
  })
})
