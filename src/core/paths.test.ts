import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  chatsDir,
  chatTranscript,
  configFile,
  globalSkillsRoot,
  pluginManifest,
  projectDir,
  projectScript,
  projectScriptsDir,
  projectSkillsRoot,
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
   * The shape the SDK looks for in a local plugin: a manifest in
   * `.claude-plugin`, and the skills one level down in `skills`. Asserted
   * together because a store where only one of the two is right loads nothing
   * and says nothing about why.
   */
  it('gives either store the shape a local plugin has', () => {
    for (const root of [globalSkillsRoot(ROOT), projectSkillsRoot(PROJECT, ROOT)]) {
      expect(skillsDirOf(root)).toBe(join(root, 'skills'))
      expect(pluginManifest(root)).toBe(join(root, '.claude-plugin', 'plugin.json'))
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
