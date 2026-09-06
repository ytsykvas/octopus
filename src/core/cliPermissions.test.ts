import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readCliPermissions } from './cliPermissions.js'

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'octopus-cliperms-'))
  await mkdir(join(repo, '.claude'), { recursive: true })
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

const write = async (name: string, body: unknown): Promise<void> => {
  await writeFile(join(repo, '.claude', name), JSON.stringify(body), 'utf8')
}

describe('what Claude Code’s own settings allow', () => {
  it('has nothing to say about a checkout with no settings', async () => {
    await expect(readCliPermissions(repo)).resolves.toEqual([])
  })

  /*
   * Measured on a real checkout: the substantial lists are in the **committed**
   * `settings.json`, not the local file the note expected them in — thirteen
   * allows and four denies, none of which octopus could see.
   */
  it('reads the committed settings, allow and deny alike', async () => {
    await write('settings.json', {
      permissions: {
        allow: ['Bash(npm run:*)', 'Edit'],
        deny: ['Bash(git push --force:*)']
      }
    })

    await expect(readCliPermissions(repo)).resolves.toEqual([
      {
        scope: 'project',
        verdict: 'deny',
        rule: { toolName: 'Bash', ruleContent: 'git push --force:*' },
        from: '.claude/settings.json'
      },
      {
        scope: 'project',
        verdict: 'allow',
        rule: { toolName: 'Bash', ruleContent: 'npm run:*' },
        from: '.claude/settings.json'
      },
      {
        scope: 'project',
        verdict: 'allow',
        rule: { toolName: 'Edit', ruleContent: null },
        from: '.claude/settings.json'
      }
    ])
  })

  /* A refusal is the more important half and is drawn first: a reader looking
     for why something will not run needs it before a list of what will. */
  it('puts a refusal before a permission', async () => {
    await write('settings.json', { permissions: { allow: ['Edit'], deny: ['Read(./.env)'] } })

    const found = await readCliPermissions(repo)

    expect(found.map((entry) => entry.verdict)).toEqual(['deny', 'allow'])
  })

  /* Each rule says which file it came from, because that is where the reader
     has to go to change it — and a merged answer hides exactly that. */
  /*
   * The user's own file, which is the one octopus has no business editing at
   * all — and on this machine the one that carries a `defaultMode` and no list,
   * so it is easy to forget it can carry one.
   */
  it('reads the user’s own settings as well as the checkout’s', async () => {
    const home = await mkdtemp(join(tmpdir(), 'octopus-home-'))
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Edit'] } }),
      'utf8'
    )

    try {
      await expect(readCliPermissions(repo, home)).resolves.toEqual([
        {
          scope: 'user',
          verdict: 'allow',
          rule: { toolName: 'Edit', ruleContent: null },
          from: '~/.claude/settings.json'
        }
      ])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('names the file each rule came from', async () => {
    await write('settings.json', { permissions: { allow: ['Edit'] } })
    await write('settings.local.json', { permissions: { allow: ['Write'] } })

    const found = await readCliPermissions(repo)

    expect(found.map((entry) => [entry.scope, entry.from])).toEqual([
      ['project', '.claude/settings.json'],
      ['local', '.claude/settings.local.json']
    ])
  })

  /*
   * These files are somebody else's. Half-written JSON in a checkout is
   * ordinary rather than exotic, and this is a courtesy beside an interface
   * that works without it.
   */
  it('says nothing about a file it cannot read', async () => {
    await writeFile(join(repo, '.claude', 'settings.json'), '{ not json', 'utf8')

    await expect(readCliPermissions(repo)).resolves.toEqual([])
  })

  it('says nothing about settings shaped some other way', async () => {
    await write('settings.json', { permissions: { allow: 'everything' } })

    await expect(readCliPermissions(repo)).resolves.toEqual([])
  })

  it('reads a file that carries no permissions at all', async () => {
    await write('settings.json', { outputStyle: 'Proactive' })

    await expect(readCliPermissions(repo)).resolves.toEqual([])
  })

  /* A key added upstream must not stop the rest being read: these carry a dozen
     octopus has no business knowing about. */
  it('reads past the keys it does not know', async () => {
    await write('settings.json', {
      $schema: 'https://example.invalid',
      hooks: {},
      permissions: { defaultMode: 'auto', allow: ['Edit'] }
    })

    await expect(readCliPermissions(repo)).resolves.toMatchObject([{ verdict: 'allow' }])
  })

  it('drops a line that is not a rule rather than guessing at it', async () => {
    await write('settings.json', { permissions: { allow: ['', '(no tool)', 'Edit'] } })

    await expect(readCliPermissions(repo)).resolves.toMatchObject([{ rule: { toolName: 'Edit' } }])
  })

  it('says nothing about a file too large to be settings', async () => {
    await writeFile(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Edit'] }, padding: 'x'.repeat(300_000) }),
      'utf8'
    )

    await expect(readCliPermissions(repo)).resolves.toEqual([])
  })
})
