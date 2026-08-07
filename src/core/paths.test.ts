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
  it('кладе теку даних у домашню теку користувача', () => {
    expect(rootDir(HOME)).toBe(join(HOME, '.maestro'))
  })

  it('типово бере домашню теку поточного користувача', () => {
    expect(rootDir()).toBe(join(homedir(), '.maestro'))
  })
})

describe('файли верхнього рівня', () => {
  it('конфіг лежить у корені даних', () => {
    expect(configFile(ROOT)).toBe(join(ROOT, 'config.json'))
  })

  it('стан лежить у корені даних', () => {
    expect(stateFile(ROOT)).toBe(join(ROOT, 'state.json'))
  })

  it('тимчасовий файл стану сусідить зі станом — інакше rename не буде атомарним', () => {
    expect(stateTempFile(ROOT)).toBe(join(ROOT, 'state.json.tmp'))
  })

  it('типово спираються на rootDir', () => {
    const root = rootDir()
    expect(configFile()).toBe(join(root, 'config.json'))
    expect(stateFile()).toBe(join(root, 'state.json'))
    expect(stateTempFile()).toBe(join(root, 'state.json.tmp'))
  })
})

describe('шляхи проєкту', () => {
  it('метадані проєкту відокремлені від воркспейсів', () => {
    expect(projectDir(PROJECT, ROOT)).toBe(join(ROOT, 'projects', PROJECT))
  })

  it('скрипти лежать усередині теки проєкту', () => {
    expect(projectScriptsDir(PROJECT, ROOT)).toBe(join(ROOT, 'projects', PROJECT, 'scripts'))
  })

  it('setup.sh і run.sh лежать поруч у теці скриптів', () => {
    const scripts = projectScriptsDir(PROJECT, ROOT)
    expect(setupScript(PROJECT, ROOT)).toBe(join(scripts, 'setup.sh'))
    expect(runScript(PROJECT, ROOT)).toBe(join(scripts, 'run.sh'))
  })

  it('типово спираються на rootDir', () => {
    const root = rootDir()
    expect(projectDir(PROJECT)).toBe(join(root, 'projects', PROJECT))
    expect(projectScriptsDir(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts'))
    expect(setupScript(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts', 'setup.sh'))
    expect(runScript(PROJECT)).toBe(join(root, 'projects', PROJECT, 'scripts', 'run.sh'))
  })
})

describe('шляхи воркспейсів', () => {
  it('воркспейси згруповані за проєктом', () => {
    expect(workspacesDir(PROJECT, ROOT)).toBe(join(ROOT, 'workspaces', PROJECT))
  })

  it('кожен воркспейс має власну теку — це корінь git worktree', () => {
    expect(workspacePath(PROJECT, 'kyiv', ROOT)).toBe(join(ROOT, 'workspaces', PROJECT, 'kyiv'))
  })

  it('воркспейси не змішуються з метаданими проєкту', () => {
    expect(workspacePath(PROJECT, 'kyiv', ROOT)).not.toContain(join(ROOT, 'projects'))
  })

  it('типово спираються на rootDir', () => {
    const root = rootDir()
    expect(workspacesDir(PROJECT)).toBe(join(root, 'workspaces', PROJECT))
    expect(workspacePath(PROJECT, 'kyiv')).toBe(join(root, 'workspaces', PROJECT, 'kyiv'))
  })
})
