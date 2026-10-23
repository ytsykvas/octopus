import { describe, expect, it } from 'vitest'

import { ScriptKindSchema } from './scripts.js'
import {
  BLOCK,
  PORT_VARIABLE,
  PROFILE_VARIABLE,
  SCRIPT_KINDS,
  SLUG_MAX_LENGTH,
  blockPorts,
  scriptEnv,
  workspaceEnv,
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
    // Length is what shell pipelines also preserve, and what a
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

describe('SCRIPT_KINDS', () => {
  it('is every kind the schema declares', () => {
    /*
     * One line, on the security path. This list decides which kinds
     * `resolveScripts` walks and therefore which enter `scriptsDigest` — so a
     * fourth kind added to the schema and forgotten here would be a script the
     * repository supplies and nobody is asked about.
     *
     * It lives here rather than beside the schema because the renderer needs it
     * as a value, and `scripts.ts` reaches `node:fs`.
     */
    expect([...SCRIPT_KINDS].sort()).toEqual([...ScriptKindSchema.options].sort())
  })
})

describe('blockPorts', () => {
  it('answers with the workspace port and the nine after it', () => {
    expect(blockPorts(3100)).toEqual([3100, 3101, 3102, 3103, 3104, 3105, 3106, 3107, 3108, 3109])
    expect(blockPorts(3100)).toHaveLength(BLOCK)
  })
})

describe('workspaceEnv', () => {
  // The agent may start the server, so it needs the ports the server gets.
  it('is what the server gets, the whole block of ports included', () => {
    const values = { rootPath: '/r', workspaceName: 'Fix login', port: 3110, profile: 'dev' }

    expect(workspaceEnv(values)).toEqual(scriptEnv('run', values))
    expect(workspaceEnv(values)).toMatchObject({ OCTOPUS_PORT_9: '3119' })
  })
})

describe('scriptEnv', () => {
  const values = {
    rootPath: '/repo',
    workspaceName: 'Fix login bug',
    port: 3110,
    profile: 'prod'
  }

  it('gives every kind the checkout, the name and the slug', () => {
    for (const kind of ['setup', 'run', 'archive'] as const) {
      expect(scriptEnv(kind, values)).toMatchObject({
        OCTOPUS_ROOT_PATH: '/repo',
        OCTOPUS_WORKSPACE_NAME: 'Fix login bug',
        OCTOPUS_WORKSPACE_SLUG: 'fix_login_bug'
      })
    }
  })

  it('tells every kind which set of variables is in effect', () => {
    // The build that pulls a dump is the one that needs it most, and the
    // cleanup that drops what the build made the next.
    for (const kind of SCRIPT_KINDS) {
      expect(scriptEnv(kind, values)[PROFILE_VARIABLE]).toBe('prod')
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
    // A range is documented and the arithmetic is left to the script; the
    // names are what make the other nine discoverable.
    const named = Object.keys(scriptEnv('run', values)).filter((key) =>
      key.startsWith(PORT_VARIABLE)
    )
    expect(named).toHaveLength(BLOCK)
  })
})
