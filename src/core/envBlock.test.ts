import { describe, expect, it } from 'vitest'

import { checkEnvBody, substituteEnv, withoutMarkers, type WorkspaceValues } from './envBlock.js'

/** The values a workspace stands for while the block is written. */
function values(): WorkspaceValues {
  return {
    path: '/workspaces/planner/anna',
    envFile: '.env',
    rootPath: '/Users/test/planner',
    workspaceName: 'anna',
    port: 3100
  }
}

describe('substituteEnv', () => {
  /*
   * The block is one text for the whole project and the port is the one thing
   * that differs per workspace, so without this a value naming the port could
   * not be written at all.
   */
  it('puts the workspace\u2019s own port where the block asks for it', () => {
    expect(substituteEnv('URL=http://localhost:$OCTOPUS_PORT/auth', values())).toBe(
      'URL=http://localhost:3100/auth'
    )
  })

  it('reads the braced form too, since both get typed', () => {
    expect(substituteEnv('URL=http://localhost:${OCTOPUS_PORT}/auth', values())).toBe(
      'URL=http://localhost:3100/auth'
    )
  })

  it('knows the rest of the block of ports', () => {
    expect(substituteEnv('API=$OCTOPUS_PORT_1', values())).toBe('API=3101')
  })

  it('knows the checkout and the workspace by name', () => {
    expect(
      substituteEnv('DB=planner_$OCTOPUS_WORKSPACE_NAME\nROOT=$OCTOPUS_ROOT_PATH', values())
    ).toBe('DB=planner_anna\nROOT=/Users/test/planner')
  })

  /*
   * The reason only our own names are recognised. A value in an env file is
   * frequently a password and a password frequently contains a `$`; mangling
   * one silently is the worst way to lose an afternoon.
   */
  it('leaves a password holding a dollar exactly as it was typed', () => {
    const password = 'PASSWORD=p$ssw0rd$HOME${weird}'

    expect(substituteEnv(password, values())).toBe(password)
  })

  it('leaves a name of ours it does not recognise alone', () => {
    expect(substituteEnv('X=$OCTOPUS_NOTHING', values())).toBe('X=$OCTOPUS_NOTHING')
  })

  it('changes nothing in a block that asks for nothing', () => {
    expect(substituteEnv('MYSQL_HOST=dev.example', values())).toBe('MYSQL_HOST=dev.example')
  })
})

describe('checkEnvBody', () => {
  it('is happy with an ordinary block', () => {
    expect(checkEnvBody('# a comment\n\nMYSQL_HOST=dev.example\nAPI_KEY=secret\n')).toEqual([])
  })

  it('accepts the export form, which dotenv reads', () => {
    expect(checkEnvBody('export API_KEY=secret')).toEqual([])
  })

  // The four caught here are the four that fail silently. A line that is not an
  // assignment does nothing at all.
  it('catches a line that assigns nothing', () => {
    expect(checkEnvBody('MYSQL_HOST dev.example')).toEqual([
      { line: 1, reason: 'noAssignment', subject: 'MYSQL_HOST dev.example' }
    ])
  })

  it('catches a key no parser would accept', () => {
    expect(checkEnvBody('MY KEY=1')).toEqual([
      { line: 2 - 1, reason: 'badName', subject: 'MY KEY' }
    ])
  })

  // Last wins, which is the same rule that puts the block at the end of the
  // file — so the earlier line does nothing and nobody would notice.
  it('catches a key written twice', () => {
    expect(checkEnvBody('A=1\nA=2')).toEqual([{ line: 2, reason: 'duplicate', subject: 'A' }])
  })

  it('catches a mistyped variable of ours', () => {
    expect(checkEnvBody('URL=http://localhost:$OCTOPUS_PORTT')).toEqual([
      { line: 1, reason: 'unknownVariable', subject: 'OCTOPUS_PORTT' }
    ])
  })

  it('catches a mistyped variable in the braced form too', () => {
    expect(checkEnvBody('URL=${OCTOPUS_PORTT}')).toEqual([
      { line: 1, reason: 'unknownVariable', subject: 'OCTOPUS_PORTT' }
    ])
  })

  it('says nothing about the ones it does substitute', () => {
    expect(checkEnvBody('URL=$OCTOPUS_PORT/$OCTOPUS_PORT_9/${OCTOPUS_WORKSPACE_NAME}')).toEqual([])
  })

  // A password is a value, and a `$` in one is not a variable of ours.
  it('says nothing about a dollar that is not one of our names', () => {
    expect(checkEnvBody('PASSWORD=p$ssw0rd$HOME')).toEqual([])
  })

  it('leaves comments and blank lines alone', () => {
    expect(checkEnvBody('\n   \n# MYSQL_HOST dev\n')).toEqual([])
  })

  it('counts lines from one, as the editor shows them', () => {
    expect(checkEnvBody('A=1\n\nnonsense')).toEqual([
      { line: 3, reason: 'noAssignment', subject: 'nonsense' }
    ])
  })

  it('reports every problem, not the first', () => {
    expect(checkEnvBody('nonsense\nMY KEY=1')).toHaveLength(2)
  })

  // A key that is already wrong is not also a duplicate: one complaint per
  // line is what somebody can act on.
  it('does not stack a duplicate on top of a bad name', () => {
    expect(checkEnvBody('MY KEY=1\nMY KEY=2')).toEqual([
      { line: 1, reason: 'badName', subject: 'MY KEY' },
      { line: 2, reason: 'badName', subject: 'MY KEY' }
    ])
  })
})

describe('a marker pasted into the body', () => {
  /*
   * Easiest to do by copying a workspace's env back into the box. Left in,
   * `withoutBlock` cuts at the closing one, promotes the rest of the block to
   * somebody else's content and appends a fresh block below it — the file grew
   * a line on every run.
   */
  it('is warned about, which the comment skip used to swallow', () => {
    expect(checkEnvBody('A=1\n# >>> octopus: project overrides\nB=2\n# <<< octopus')).toEqual([
      { line: 2, reason: 'marker', subject: '# >>> octopus: project overrides' },
      { line: 4, reason: 'marker', subject: '# <<< octopus' }
    ])
  })

  it('is taken out, because the warning is only advisory', () => {
    expect(withoutMarkers('A=1\n# >>> octopus: project overrides\nB=2\n# <<< octopus\n')).toBe(
      'A=1\nB=2\n'
    )
  })

  it('leaves an ordinary comment alone', () => {
    expect(withoutMarkers('# mine\nA=1')).toBe('# mine\nA=1')
    expect(checkEnvBody('# mine\nA=1')).toEqual([])
  })
})
