import { describe, expect, it } from 'vitest'

import {
  checkEnvBody,
  envSecrets,
  parseEnvBody,
  substituteEnv,
  withoutMarkers,
  type WorkspaceValues
} from './envBlock.js'

/** The values a workspace stands for while the block is written. */
function values(): WorkspaceValues {
  return {
    path: '/workspaces/planner/anna',
    envFile: '.env',
    rootPath: '/Users/test/planner',
    workspaceName: 'anna',
    port: 3100,
    profile: 'dev'
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

  it('knows which set of variables is in effect', () => {
    // So one text can still differ by set where only the name has to.
    expect(substituteEnv('SENTRY_ENV=$OCTOPUS_ENV_PROFILE', values())).toBe('SENTRY_ENV=dev')
    expect(checkEnvBody('SENTRY_ENV=$OCTOPUS_ENV_PROFILE')).toEqual([])
  })

  /*
   * The whole point of the slug being a variable rather than a note in the
   * hint. A block is static text with no shell around it, so a name the user
   * typed as a sentence has to arrive already safe or not at all.
   */
  it('knows the workspace by a name an identifier can hold', () => {
    expect(
      substituteEnv('DB=planner_$OCTOPUS_WORKSPACE_SLUG', {
        ...values(),
        workspaceName: 'Fix login bug'
      })
    ).toBe('DB=planner_fix_login_bug')
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

/** A full line of a key as PEM wraps it: base64, 64 characters. */
const KEY_LINE = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj'

/** A key pasted without its quotes, its last line ending in base64's padding. */
const UNQUOTED_KEY = `KEY=-----BEGIN KEY-----\n${KEY_LINE}\nq3ZxYpabcDEFgh==`

describe('parseEnvBody', () => {
  it('reads one name and value per line', () => {
    expect(parseEnvBody('DUMP_URL=s3://staging/latest.sql\nMYSQL_HOST=dev.example')).toEqual({
      DUMP_URL: 's3://staging/latest.sql',
      MYSQL_HOST: 'dev.example'
    })
  })

  it('leaves out blank lines, comments, and our markers', () => {
    expect(
      parseEnvBody('# >>> octopus: project overrides\n\n# staging\nA=1\n# <<< octopus')
    ).toEqual({ A: '1' })
  })

  it('accepts export, and spaces around the equals sign', () => {
    expect(parseEnvBody('export A=1\n  B = 2  ')).toEqual({ A: '1', B: '2' })
  })

  it('keeps everything after the first equals sign', () => {
    // A connection string is the ordinary case of a value holding one.
    expect(parseEnvBody('DATABASE_URL=postgres://u:p@h/db?sslmode=require&a=b')).toEqual({
      DATABASE_URL: 'postgres://u:p@h/db?sslmode=require&a=b'
    })
  })

  it('takes a quoted value between its quotes, # and all', () => {
    expect(parseEnvBody('A="pa#ss word" # note\nB=\'x y\'')).toEqual({
      A: 'pa#ss word',
      B: 'x y'
    })
  })

  it('cuts an unquoted value at its first #, as dotenv does', () => {
    // The value a script sees has to be the value the app reads out of the
    // same file, and both dotenvs stop there.
    expect(parseEnvBody('A=abc # note\nB=pa#ss')).toEqual({ A: 'abc', B: 'pa' })
  })

  /*
   * The server starts with these in its environment, and dotenv never replaces
   * a variable already there — so anything read differently here would beat the
   * right value in the file. Each of these is read differently, so each is left
   * to the file.
   */
  it('leaves out a value spanning lines, and every line inside it', () => {
    const pem = 'KEY="-----BEGIN KEY-----\nMIIBabc==\n-----END KEY-----"\nAFTER=1'
    expect(parseEnvBody(pem)).toEqual({ AFTER: '1' })
  })

  it('leaves out a value whose single or backtick quote does not close on its line', () => {
    expect(parseEnvBody("A='x\nB=inside'\nC=1")).toEqual({ C: '1' })
    expect(parseEnvBody('A=`x\nB=inside`\nC=1')).toEqual({ C: '1' })
  })

  it('leaves out a backtick-quoted value', () => {
    expect(parseEnvBody('A=`tick`\nB=1')).toEqual({ B: '1' })
  })

  it('leaves out an escape in double quotes, which dotenv turns into a newline', () => {
    expect(parseEnvBody('PEM="a\\nb"\nB=1')).toEqual({ B: '1' })
  })

  it('leaves out a reference to another variable, which dotenv-expand fills in', () => {
    expect(parseEnvBody('A=${HOME}/x\nB="$HOME"\nC=1')).toEqual({ C: '1' })
  })

  it('keeps a $ in single quotes, which nothing expands', () => {
    expect(parseEnvBody("PASSWORD='pa$$word'")).toEqual({ PASSWORD: 'pa$$word' })
  })

  it('leaves out text after a closing quote', () => {
    expect(parseEnvBody('A="x"y\nB=1')).toEqual({ B: '1' })
  })

  it('reads an empty value as empty', () => {
    expect(parseEnvBody('A=')).toEqual({ A: '' })
  })

  it('keeps the last of a name written twice', () => {
    expect(parseEnvBody('A=1\nA=2')).toEqual({ A: '2' })
  })

  it('leaves out a line that is not an assignment or has a name no parser accepts', () => {
    expect(parseEnvBody('just words\n1BAD=x\nGOOD=y')).toEqual({ GOOD: 'y' })
  })

  /*
   * The last line of a key pasted without its quotes, ending in base64's
   * padding, reads as a name with `=` or nothing after it — and would be listed
   * as a variable while being a piece of the key.
   */
  it('leaves out a line of base64 that ends in padding', () => {
    expect(parseEnvBody(UNQUOTED_KEY)).toEqual({ KEY: '-----BEGIN KEY-----' })
    expect(parseEnvBody(`${KEY_LINE}\nr4Zx=`)).toEqual({})
  })

  it('still reads an empty value after an assignment, a comment or the first line', () => {
    expect(parseEnvBody('SENTRY_DSN=\nA=1\nB=\n# note\nC=\nsentryDsn=')).toEqual({
      SENTRY_DSN: '',
      A: '1',
      B: '',
      C: '',
      sentryDsn: ''
    })
  })

  // Padding follows a line of a key and nothing else: these are what they say.
  it('reads a value of equals signs, or none, anywhere else', () => {
    expect(parseEnvBody('SEP==')).toEqual({ SEP: '=' })
    expect(parseEnvBody('oops\nEMPTY=')).toEqual({ EMPTY: '' })
    expect(parseEnvBody('my-var=1\nEMPTY=')).toEqual({ EMPTY: '' })
  })

  it('reads an empty value after a value spanning lines', () => {
    const pem = `KEY="-----BEGIN KEY-----\n${KEY_LINE}\n-----END KEY-----"\nEMPTY=\nNEXT=1`
    expect(parseEnvBody(pem)).toEqual({ EMPTY: '', NEXT: '1' })
  })

  // A key wrapped short still ends in a name base64 writes and a variable does not: mixed case.
  it('leaves out the padding of a key wrapped in short lines', () => {
    const short = 'KEY=-----BEGIN KEY-----\nMIIEvQIBADAN\nq3ZxYpabcDEFgh==\n-----END KEY-----'
    expect(parseEnvBody(short)).toEqual({ KEY: '-----BEGIN KEY-----' })
    expect(parseEnvBody('oops\nEMPTY=\nnote\nlower_case=')).toEqual({ EMPTY: '', lower_case: '' })
  })

  it('takes a line of base64 for a key from 40 characters, short of any width keys wrap at', () => {
    expect(parseEnvBody(`${'A'.repeat(39)}\nab=`)).toEqual({ ab: '' })
    expect(parseEnvBody(`${'A'.repeat(40)}\nab=`)).toEqual({})
  })

  it('reads lines that end in a carriage return', () => {
    expect(parseEnvBody('A=1\r\nB=2\r')).toEqual({ A: '1', B: '2' })
  })

  it('treats __proto__ as a name like any other', () => {
    // Assigned to a plain object it would set the prototype instead, and the
    // variable would silently not exist.
    const parsed = parseEnvBody('__proto__=x')

    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.entries(parsed)).toEqual([['__proto__', 'x']])
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

  /*
   * An absence is the whole of the wiring here: the checker builds its list of
   * known names from `scriptEnv`, so a name added there is understood without
   * an edit — and nothing but this would notice if that stopped being true.
   */
  it('says nothing about the slug, which it never had to be told about', () => {
    expect(checkEnvBody('DB=planner_$OCTOPUS_WORKSPACE_SLUG')).toEqual([])
    expect(checkEnvBody('DB=planner_$OCTOPUS_WORKSPACE_SLUGX')).toEqual([
      { line: 1, reason: 'unknownVariable', subject: 'OCTOPUS_WORKSPACE_SLUGX' }
    ])
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

describe('base64 padding in a block', () => {
  it('is not an assignment, so its text is never taken for a name', () => {
    expect(checkEnvBody(UNQUOTED_KEY)).toEqual([
      { line: 2, reason: 'noAssignment', subject: KEY_LINE },
      { line: 3, reason: 'noAssignment', subject: 'q3ZxYpabcDEFgh==' }
    ])
  })

  it('is not read after a typo or a bad name, where an empty value is one', () => {
    expect(checkEnvBody('oops\nEMPTY=')).toEqual([
      { line: 1, reason: 'noAssignment', subject: 'oops' }
    ])
    expect(checkEnvBody('my-var=1\nEMPTY=')).toEqual([
      { line: 1, reason: 'badName', subject: 'my-var' }
    ])
  })
})

describe('a value spanning lines', () => {
  const pem = `KEY="-----BEGIN KEY-----\n${KEY_LINE}\nq3ZxYpabcDEFgh==\n-----END KEY-----"\nEMPTY=`

  // Its lines are the value's: no `=`, or a `+` before one, is right in there.
  it('is checked as one assignment', () => {
    expect(checkEnvBody(pem)).toEqual([])
    expect(checkEnvBody("A='x\nab+cd=\n'")).toEqual([])
  })

  it('still has a marker inside it warned about', () => {
    expect(checkEnvBody('A="x\n# <<< octopus\ny"')).toEqual([
      { line: 2, reason: 'marker', subject: '# <<< octopus' }
    ])
  })
})

describe('envSecrets', () => {
  const secretValues = (body: string): string[] => [
    ...new Set(envSecrets(body).map(({ value }) => value))
  ]

  it('names every value, as written and as dotenv reads it', () => {
    expect(envSecrets('DB_PASSWORD=Pa$$w0rd123 # rotated\nexport TOKEN=abc')).toEqual([
      { name: 'DB_PASSWORD', value: 'Pa$$w0rd123 # rotated' },
      { name: 'DB_PASSWORD', value: 'Pa$$w0rd123' },
      { name: 'TOKEN', value: 'abc' },
      { name: 'TOKEN', value: 'abc' }
    ])
  })

  // Each of these is one `parseEnvBody` leaves to the file — and the file is what a script prints.
  it('keeps the values the parse leaves out', () => {
    expect(secretValues('A="sk-live\\nabc123456"')).toEqual([
      'sk-live\\nabc123456',
      'sk-live',
      'abc123456'
    ])
    expect(secretValues('B=`backtick-secret`')).toEqual(['backtick-secret'])
    expect(secretValues("C='single-quoted' # note")).toEqual(['single-quoted'])
  })

  it('keeps every line of a value spanning several, under the name that opened it', () => {
    expect(
      envSecrets('KEY="-----BEGIN KEY-----\nMIIEvQIBADAN\n-----END KEY-----"\nAFTER=1')
    ).toEqual([
      { name: 'KEY', value: '-----BEGIN KEY-----' },
      { name: 'KEY', value: 'MIIEvQIBADAN' },
      { name: 'KEY', value: '-----END KEY-----' },
      { name: 'AFTER', value: '1' },
      { name: 'AFTER', value: '1' }
    ])
  })

  it('keeps a value spanning lines under no name where its name is not one', () => {
    expect(envSecrets('my-key="first-line\nsecond-line"')).toEqual([
      { name: null, value: 'my-key="first-line' },
      { name: null, value: 'first-line' },
      { name: null, value: 'second-line' }
    ])
  })

  it('keeps a line that is no assignment whole, under no name', () => {
    expect(
      envSecrets(`${KEY_LINE}\nq3ZxYpabcDEFgh==\nDATABASE_URL: postgres://u:pw@db?ssl=on`)
    ).toEqual([
      { name: null, value: KEY_LINE },
      { name: null, value: 'q3ZxYpabcDEFgh==' },
      { name: null, value: 'DATABASE_URL: postgres://u:pw@db?ssl=on' },
      { name: null, value: 'on' },
      { name: null, value: 'on' }
    ])
  })

  it('skips blank lines, comments and our markers', () => {
    expect(envSecrets('\n# a comment\n# >>> octopus: project overrides\n# <<< octopus')).toEqual([])
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
