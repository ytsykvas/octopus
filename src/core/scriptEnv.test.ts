import { describe, expect, it } from 'vitest'

import {
  BLOCK,
  conductorEnv,
  PORT_VARIABLE,
  SLUG_MAX_LENGTH,
  blockPorts,
  scriptEnv,
  workspaceSlug
} from './scriptEnv.js'

describe('workspaceSlug', () => {
  it('leaves a name that is already an identifier alone', () => {
    // The default workspace names are all like this, which is why the trap it
    // guards stayed invisible until somebody renamed one.
    expect(workspaceSlug('ada')).toBe('ada')
  })

  it('lowercases and replaces everything that is not a letter or a digit', () => {
    expect(workspaceSlug('Fix login bug')).toBe('fix_login_bug')
    expect(workspaceSlug('dockly-portal.sign/in')).toBe('dockly_portal_sign_in')
  })

  it('replaces each character with exactly one underscore', () => {
    // Length is what the shell pipelines this mirrors also preserve, and what a
    // truncation limit is only meaningful against.
    const name = 'a b-c.d'
    expect(workspaceSlug(name)).toHaveLength(name.length)
  })

  it('counts a character outside the basic plane once', () => {
    // Two code units, one character. Without the `u` flag the replacement runs
    // per unit and produces two underscores.
    expect(workspaceSlug('a🐙b')).toBe('a_b')
  })

  it('truncates so a prefix still fits inside an identifier', () => {
    expect(workspaceSlug('x'.repeat(80))).toHaveLength(SLUG_MAX_LENGTH)
  })

  it('is never empty for a name that is not', () => {
    // `WorkspaceSchema.name` is `min(1)` and renaming trims, so this is the
    // whole of the invariant a cleanup script depends on: an empty slug would
    // name the shared database rather than the workspace's own.
    expect(workspaceSlug('!!!')).toBe('___')
  })
})

describe('blockPorts', () => {
  it('answers with the workspace port and the nine after it', () => {
    expect(blockPorts(3100)).toEqual([3100, 3101, 3102, 3103, 3104, 3105, 3106, 3107, 3108, 3109])
    expect(blockPorts(3100)).toHaveLength(BLOCK)
  })
})

describe('conductorEnv', () => {
  const values = {
    rootPath: '/repo',
    workspaceName: 'Fix login bug',
    port: 3110,
    defaultBranch: 'develop'
  }

  it("gives a Conductor script the slug as the workspace's name", () => {
    /*
     * Their scripts slugify whatever they are given before naming a database
     * with it. Handing them the slug makes that a no-op, so the name their
     * script drops and the name our env block wrote are one string.
     */
    expect(conductorEnv('setup', values)).toEqual({
      CONDUCTOR_ROOT_PATH: '/repo',
      CONDUCTOR_WORKSPACE_NAME: 'fix_login_bug',
      CONDUCTOR_DEFAULT_BRANCH: 'develop'
    })
  })

  it('gives the port to the server script alone, as we do', () => {
    expect(conductorEnv('run', values)).toMatchObject({ CONDUCTOR_PORT: '3110' })
    expect(conductorEnv('archive', values)).not.toHaveProperty('CONDUCTOR_PORT')
  })
})

describe('scriptEnv', () => {
  const values = { rootPath: '/repo', workspaceName: 'Fix login bug', port: 3110 }

  it('gives every kind the checkout, the name and the slug', () => {
    for (const kind of ['setup', 'run', 'archive'] as const) {
      expect(scriptEnv(kind, values)).toMatchObject({
        OCTOPUS_ROOT_PATH: '/repo',
        OCTOPUS_WORKSPACE_NAME: 'Fix login bug',
        OCTOPUS_WORKSPACE_SLUG: 'fix_login_bug'
      })
    }
  })

  it('gives the ports to the server script alone', () => {
    const serving = scriptEnv('run', values)
    expect(serving[PORT_VARIABLE]).toBe('3110')
    expect(serving[`${PORT_VARIABLE}_9`]).toBe('3119')

    // The other two are not serving, so a port would be a number they have no
    // business binding.
    expect(scriptEnv('setup', values)).not.toHaveProperty(PORT_VARIABLE)
    expect(scriptEnv('archive', values)).not.toHaveProperty(PORT_VARIABLE)
  })

  it('names every port it hands out', () => {
    // Conductor documents a range and leaves the arithmetic to the script; the
    // names are what make the other nine discoverable.
    const named = Object.keys(scriptEnv('run', values)).filter((key) =>
      key.startsWith(PORT_VARIABLE)
    )
    expect(named).toHaveLength(BLOCK)
  })
})
