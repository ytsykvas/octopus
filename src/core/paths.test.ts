import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  configFile,
  projectDir,
  projectScriptsDir,
  rootDir,
  runScript,
  setupScript,
  stateFile,
  stateTempFile,
  workspacePath,
  workspacesDir
} from './paths.js'

const HOME = join('/tmp', 'maestro-test-home')
const ROOT = join(HOME, '.maestro')
const PROJECT = 'planner'

describe('rootDir', () => {
  it('places application data inside the user home directory', () => {
    expect(rootDir(HOME)).toBe(join(HOME, '.maestro'))
  })

  it('defaults to the current user home directory', () => {
    expect(rootDir()).toBe(join(homedir(), '.maestro'))
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

  it('places setup.sh and run.sh side by side', () => {
    const scripts = projectScriptsDir(PROJECT, ROOT)
    expect(setupScript(PROJECT, ROOT)).toBe(join(scripts, 'setup.sh'))
    expect(runScript(PROJECT, ROOT)).toBe(join(scripts, 'run.sh'))
  })

  it('falls back to rootDir when no root is given', () => {
    const root = rootDir()
    expect(projectDir(PROJECT)).toBe(join(root, 'projects', PROJECT))
    expect(projectScriptsDir(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts'))
    expect(setupScript(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts', 'setup.sh'))
    expect(runScript(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts', 'run.sh'))
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
