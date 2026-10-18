import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  catalog,
  connectOfficialMarketplace,
  installPlugin,
  listInstalled,
  pluginCli,
  PluginError,
  refreshOfficialMarketplace,
  setPluginEnabled,
  uninstallPlugin,
  type CliOutput,
  type PluginCli
} from './plugins.js'

let home: string

beforeEach(async () => {
  // `realpath` because macOS's temp directory is a symlink, and the script
  // below answers with the resolved working directory.
  home = await realpath(await mkdtemp(join(tmpdir(), 'octopus-plugins-')))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

interface Call {
  readonly args: readonly string[]
  readonly cwd: string | undefined
}

type Answer = string | CliOutput | (() => string)

/**
 * A CLI answering from a table, keyed by its arguments as one string — or by
 * the arguments and ` @<cwd>`, for an answer that depends on where it runs.
 *
 * The answers are the shapes `claude plugin … --json` printed under a
 * throwaway `HOME` (CLI 2.1.299), trimmed to what each test reads.
 */
function fakeCli(answers: Record<string, Answer>): {
  cli: PluginCli
  calls: Call[]
} {
  const calls: Call[] = []
  const cli: PluginCli = (args, cwd) => {
    calls.push({ args, cwd })
    const command = args.join(' ')
    const answer =
      (cwd === undefined ? undefined : answers[`${command} @${cwd}`]) ?? answers[command]
    if (answer === undefined) return Promise.reject(new Error(`unexpected: ${command}`))
    if (typeof answer === 'object') return Promise.resolve(answer)

    return Promise.resolve({ stdout: typeof answer === 'string' ? answer : answer(), stderr: '' })
  }

  return { cli, calls }
}

const line = (result: Record<string, unknown>): string => `${JSON.stringify(result)}\n`

async function writeJson(path: string, body: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(body), 'utf8')
}

describe('the installed list', () => {
  it('reads every row and what each one brings', async () => {
    const commits = join(home, 'cache', 'commit-commands')
    const context7 = join(home, 'cache', 'context7')
    await mkdir(join(commits, 'commands'), { recursive: true })
    await mkdir(join(commits, 'skills'), { recursive: true })
    await writeJson(join(commits, '.claude-plugin', 'plugin.json'), {
      name: 'commit-commands',
      description: 'Commit, push and open a pull request',
      author: { name: 'Anthropic', email: 'support@anthropic.com' },
      homepage: 'https://example.com/commit-commands'
    })
    await writeJson(join(context7, '.claude-plugin', 'plugin.json'), {
      name: 'context7',
      author: 'Upstash'
    })

    const { cli } = fakeCli({
      'plugin list --json': JSON.stringify([
        {
          id: 'commit-commands@claude-plugins-official',
          version: 'ea10b213686c',
          scope: 'user',
          enabled: true,
          installPath: commits,
          installedAt: '2026-10-18T12:27:56.759Z',
          projectEnabled: false
        },
        {
          id: 'context7@claude-plugins-official',
          scope: 'project',
          enabled: false,
          installPath: context7,
          projectPath: '/work/site',
          mcpServers: { context7: { type: 'http', url: 'https://mcp.context7.com/mcp' } },
          errors: [
            'MCP server failed to start',
            { message: 'hook refused' },
            { code: 7 },
            { message: 3 }
          ]
        }
      ])
    })

    await expect(listInstalled(cli)).resolves.toEqual([
      {
        id: 'commit-commands@claude-plugins-official',
        name: 'commit-commands',
        marketplace: 'claude-plugins-official',
        version: 'ea10b213686c',
        scope: 'user',
        enabled: true,
        projectPath: null,
        description: 'Commit, push and open a pull request',
        author: 'Anthropic',
        homepage: 'https://example.com/commit-commands',
        components: ['skills', 'commands'],
        errors: []
      },
      {
        id: 'context7@claude-plugins-official',
        name: 'context7',
        marketplace: 'claude-plugins-official',
        version: null,
        scope: 'project',
        enabled: false,
        projectPath: '/work/site',
        description: null,
        author: 'Upstash',
        homepage: null,
        components: ['mcp'],
        errors: ['MCP server failed to start', 'hook refused', '{"code":7}', '{"message":3}']
      }
    ])
  })

  it('reads the kinds a manifest declares and the files beside it', async () => {
    const path = join(home, 'cache', 'kitchen-sink')
    await mkdir(join(path, 'hooks'), { recursive: true })
    await writeFile(join(path, '.mcp.json'), '{}', 'utf8')
    await writeFile(join(path, '.lsp.json'), '{}', 'utf8')
    await writeJson(join(path, '.claude-plugin', 'plugin.json'), { agents: ['./agents/x.md'] })

    const { cli } = fakeCli({
      'plugin list --json': JSON.stringify([
        { id: 'sink@market', scope: 'user', enabled: true, installPath: path }
      ])
    })
    const [row] = await listInstalled(cli)

    expect(row?.components).toEqual(['agents', 'hooks', 'mcp', 'lsp'])
  })

  it('reads servers and hooks declared only in the manifest', async () => {
    const path = join(home, 'cache', 'declared')
    await writeJson(join(path, '.claude-plugin', 'plugin.json'), {
      hooks: {},
      mcpServers: {},
      lspServers: {}
    })

    const { cli } = fakeCli({
      'plugin list --json': JSON.stringify([
        { id: 'declared@market', scope: 'user', enabled: true, installPath: path }
      ])
    })
    const [row] = await listInstalled(cli)

    expect(row?.components).toEqual(['hooks', 'mcp', 'lsp'])
  })

  /*
   * A manifest is a detail beside a row that stands without it: broken JSON,
   * the wrong shape or no folder at all costs the description, never the row.
   */
  it('keeps a row whose files cannot be read', async () => {
    const broken = join(home, 'cache', 'broken')
    const wrong = join(home, 'cache', 'wrong')
    await mkdir(join(broken, '.claude-plugin'), { recursive: true })
    await writeFile(join(broken, '.claude-plugin', 'plugin.json'), '{ not json', 'utf8')
    await writeJson(join(wrong, '.claude-plugin', 'plugin.json'), { description: 42 })

    const { cli } = fakeCli({
      'plugin list --json': JSON.stringify([
        { id: 'broken@m', scope: 'user', enabled: true, installPath: broken },
        { id: 'wrong@m', scope: 'user', enabled: true, installPath: wrong },
        { id: 'gone@m', scope: 'user', enabled: true, installPath: join(home, 'nowhere') },
        { id: 'pathless', scope: 'managed', enabled: true }
      ])
    })
    const rows = await listInstalled(cli)

    expect(rows.map((row) => [row.name, row.marketplace, row.description, row.components])).toEqual(
      [
        ['broken', 'm', null, []],
        ['wrong', 'm', null, []],
        ['gone', 'm', null, []],
        ['pathless', '', null, []]
      ]
    )
  })

  it('skips a manifest too large to be one', async () => {
    const path = join(home, 'cache', 'huge')
    await mkdir(join(path, '.claude-plugin'), { recursive: true })
    const padding = ' '.repeat(8 * 1024 * 1024)
    await writeFile(
      join(path, '.claude-plugin', 'plugin.json'),
      `{"description":"huge"${padding}}`,
      'utf8'
    )

    const { cli } = fakeCli({
      'plugin list --json': JSON.stringify([
        { id: 'huge@m', scope: 'user', enabled: true, installPath: path }
      ])
    })
    const [row] = await listInstalled(cli)

    expect(row?.description).toBeNull()
  })

  it('refuses a listing that is not one', async () => {
    const { cli } = fakeCli({ 'plugin list --json': '{"installed":"nope"}' })

    await expect(listInstalled(cli)).rejects.toMatchObject({
      code: 'pluginOutputUnreadable',
      params: { message: '{"installed":"nope"}' }
    })
  })

  it('refuses output that is not JSON at all', async () => {
    const { cli } = fakeCli({ 'plugin list --json': 'Error: something broke\n' })

    await expect(listInstalled(cli)).rejects.toBeInstanceOf(PluginError)
    await expect(listInstalled(cli)).rejects.toMatchObject({
      code: 'pluginOutputUnreadable',
      params: { message: 'Error: something broke' }
    })
  })
})

describe('the store', () => {
  const official = (location: string): Record<string, unknown> => ({
    name: 'claude-plugins-official',
    source: 'github',
    repo: 'anthropics/claude-plugins-official',
    installLocation: location
  })

  /*
   * The store is Anthropic's catalog only: a marketplace added from a
   * terminal, and the built-in directory `--available` also lists, are left
   * out on purpose.
   */
  it('offers only the official marketplace, with what its own file adds', async () => {
    const location = join(home, 'marketplaces', 'official')
    await writeJson(join(location, '.claude-plugin', 'marketplace.json'), {
      name: 'claude-plugins-official',
      plugins: [
        {
          name: 'context7',
          category: 'development',
          author: { name: 'Upstash' },
          homepage: 'https://context7.com',
          keywords: ['docs', 'mcp']
        },
        { name: 'figma', author: 'Figma', tags: ['design'] },
        { name: 42 },
        { description: 'no name' }
      ]
    })

    const { cli } = fakeCli({
      'plugin marketplace list --json': JSON.stringify([
        { name: 'team-tools', source: 'git' },
        official(location)
      ]),
      'plugin list --available --json': JSON.stringify({
        installed: [],
        available: [
          { pluginId: 'lint@team-tools', name: 'lint', marketplaceName: 'team-tools' },
          {
            pluginId: 'context7@claude-plugins-official',
            name: 'context7',
            description: 'Up-to-date documentation lookup',
            marketplaceName: 'claude-plugins-official',
            source: './external_plugins/context7',
            installCount: 412_000
          },
          {
            pluginId: 'figma@claude-plugins-official',
            name: 'figma',
            marketplaceName: 'claude-plugins-official',
            version: '2.2.157',
            source: { source: 'url', url: 'https://example.com/figma.git' }
          },
          {
            pluginId: 'lonely@claude-plugins-official',
            name: 'lonely',
            marketplaceName: 'claude-plugins-official'
          },
          {
            pluginId: 'figma@anthropic-plugin-directory',
            name: 'figma',
            marketplaceName: 'anthropic-plugin-directory'
          }
        ]
      })
    })

    await expect(catalog(cli)).resolves.toEqual({
      officialConnected: true,
      plugins: [
        {
          id: 'context7@claude-plugins-official',
          name: 'context7',
          marketplace: 'claude-plugins-official',
          description: 'Up-to-date documentation lookup',
          version: null,
          installs: 412_000,
          category: 'development',
          author: 'Upstash',
          homepage: 'https://context7.com',
          keywords: ['docs', 'mcp']
        },
        {
          id: 'figma@claude-plugins-official',
          name: 'figma',
          marketplace: 'claude-plugins-official',
          description: null,
          version: '2.2.157',
          installs: null,
          category: null,
          author: 'Figma',
          homepage: null,
          keywords: ['design']
        },
        {
          id: 'lonely@claude-plugins-official',
          name: 'lonely',
          marketplace: 'claude-plugins-official',
          description: null,
          version: null,
          installs: null,
          category: null,
          author: null,
          homepage: null,
          keywords: []
        }
      ]
    })
  })

  /*
   * Measured: with no marketplace connected, `--available` still lists some
   * 3,500 entries from the built-in directory. None of them is the store, and
   * nor is a marketplace added from a terminal, so the listing is not even
   * started.
   */
  it('has nothing to offer, and says why, without the official marketplace', async () => {
    const { cli, calls } = fakeCli({
      'plugin marketplace list --json': JSON.stringify([{ name: 'team-tools', source: 'git' }])
    })

    await expect(catalog(cli)).resolves.toEqual({ officialConnected: false, plugins: [] })
    expect(calls).toHaveLength(1)
  })

  /*
   * Measured on 2.1.299: `available` drops a plugin once it is installed for
   * every project — the store lost the card the moment the install worked.
   */
  it('keeps an installed plugin in the store, from its marketplace’s own entry', async () => {
    const location = join(home, 'marketplaces', 'official')
    await writeJson(join(location, '.claude-plugin', 'marketplace.json'), {
      plugins: [
        {
          name: 'explanatory-output-style',
          description: 'Explains as it goes',
          category: 'learning'
        }
      ]
    })

    const { cli } = fakeCli({
      'plugin marketplace list --json': JSON.stringify([official(location)]),
      'plugin list --available --json': JSON.stringify({
        installed: [
          // Twice — a project's install and the user's — and listed once.
          { id: 'explanatory-output-style@claude-plugins-official', scope: 'local' },
          { id: 'explanatory-output-style@claude-plugins-official', scope: 'user' },
          { id: 'undescribed@claude-plugins-official', scope: 'user' },
          { id: 'lint@team-tools', scope: 'user' },
          { id: 'context7@claude-plugins-official', scope: 'local' }
        ],
        available: [
          {
            pluginId: 'context7@claude-plugins-official',
            name: 'context7',
            marketplaceName: 'claude-plugins-official',
            installCount: 5
          }
        ]
      })
    })

    const { plugins } = await catalog(cli)

    expect(plugins.map((plugin) => [plugin.id, plugin.description, plugin.installs])).toEqual([
      ['context7@claude-plugins-official', null, 5],
      ['explanatory-output-style@claude-plugins-official', 'Explains as it goes', null],
      ['undescribed@claude-plugins-official', null, null]
    ])
    expect(plugins[1]?.category).toBe('learning')
  })

  it.each([
    ['no location', null],
    ['a location that has gone', 'missing']
  ])('still offers the marketplace when its own file has %s', async (_, location) => {
    const marketplace =
      location === null
        ? { name: 'claude-plugins-official', source: 'github' }
        : official(join(home, location))
    const { cli } = fakeCli({
      'plugin marketplace list --json': JSON.stringify([marketplace]),
      'plugin list --available --json': JSON.stringify({
        available: [
          {
            pluginId: 'lint@claude-plugins-official',
            name: 'lint',
            marketplaceName: 'claude-plugins-official'
          }
        ]
      })
    })
    const store = await catalog(cli)

    expect(store.officialConnected).toBe(true)
    expect(store.plugins.map((plugin) => [plugin.id, plugin.category])).toEqual([
      ['lint@claude-plugins-official', null]
    ])
  })

  it('still offers the marketplace when its own file is not a catalog', async () => {
    const location = join(home, 'marketplaces', 'odd')
    await writeJson(join(location, '.claude-plugin', 'marketplace.json'), { plugins: 'none' })

    const { cli } = fakeCli({
      'plugin marketplace list --json': JSON.stringify([official(location)]),
      'plugin list --available --json': JSON.stringify({
        available: [
          {
            pluginId: 'a@claude-plugins-official',
            name: 'a',
            marketplaceName: 'claude-plugins-official'
          }
        ]
      })
    })

    await expect(catalog(cli)).resolves.toMatchObject({
      plugins: [{ id: 'a@claude-plugins-official' }]
    })
  })
})

describe('installing', () => {
  it('installs into the user scope', async () => {
    const { cli, calls } = fakeCli({
      'plugin install context7@claude-plugins-official --scope user --json': line({
        command: 'install',
        outcome: 'ok',
        plugin: 'context7@claude-plugins-official',
        scope: 'user',
        message: '✔ Successfully installed plugin'
      })
    })

    await expect(installPlugin(cli, 'context7@claude-plugins-official')).resolves.toEqual({
      kind: 'installed'
    })
    expect(calls).toEqual([
      {
        args: [
          'plugin',
          'install',
          'context7@claude-plugins-official',
          '--scope',
          'user',
          '--json'
        ],
        cwd: undefined
      }
    ])
  })

  /*
   * Measured: a second install of the same plugin is not a refusal — it is
   * `ok`, with the versions beside it.
   */
  it('counts a plugin already there as installed', async () => {
    const { cli } = fakeCli({
      'plugin install a@m --scope user --json': line({
        outcome: 'ok',
        installedVersion: '1.0.0',
        availableVersion: '1.0.0'
      })
    })

    await expect(installPlugin(cli, 'a@m')).resolves.toEqual({ kind: 'installed' })
  })

  it('reads the result from the last line, below anything printed first', async () => {
    const { cli } = fakeCli({
      'plugin install a@m --scope user --json': `Cloning…\n${line({ outcome: 'ok' })}\n`
    })

    await expect(installPlugin(cli, 'a@m')).resolves.toEqual({ kind: 'installed' })
  })

  it('reports the command a person has to see first, then installs with its digest', async () => {
    const sha = 'a'.repeat(64)
    const { cli, calls } = fakeCli({
      'plugin install runner@m --scope user --json': line({
        outcome: 'failed',
        failureCode: 'needs_consent',
        message: 'This plugin runs a command',
        shownCommand: { kind: 'command_source', command: 'npx -y runner', sha256: sha }
      }),
      [`plugin install runner@m --scope user --accept-command ${sha} --json`]: line({
        outcome: 'ok'
      })
    })

    await expect(installPlugin(cli, 'runner@m')).resolves.toEqual({
      kind: 'needsConsent',
      command: 'npx -y runner',
      sha256: sha
    })
    await expect(installPlugin(cli, 'runner@m', sha)).resolves.toEqual({ kind: 'installed' })
    expect(calls.at(-1)?.args).toContain('--accept-command')
  })

  it('shows a command that is not a string as written', async () => {
    const sha = 'b'.repeat(64)
    const { cli } = fakeCli({
      'plugin install a@m --scope user --json': line({
        outcome: 'failed',
        shownCommand: { command: ['node', 'x.js'], sha256: sha }
      }),
      'plugin install b@m --scope user --json': line({
        outcome: 'failed',
        shownCommand: { sha256: sha }
      })
    })

    await expect(installPlugin(cli, 'a@m')).resolves.toMatchObject({ command: '["node","x.js"]' })
    await expect(installPlugin(cli, 'b@m')).resolves.toMatchObject({ command: '' })
  })

  it('fails with the CLI’s own sentence', async () => {
    const { cli } = fakeCli({
      'plugin install nope@m --scope user --json': line({
        outcome: 'failed',
        failureCode: 'not_found',
        message: 'Plugin "nope" not found in marketplace "m"'
      })
    })

    await expect(installPlugin(cli, 'nope@m')).rejects.toMatchObject({
      code: 'pluginActionFailed',
      params: { message: 'Plugin "nope" not found in marketplace "m"' }
    })
  })

  it('falls back to the failure code, then the outcome, when there is no sentence', async () => {
    const { cli } = fakeCli({
      'plugin install a@m --scope user --json': line({ outcome: 'failed', failureCode: 'boom' }),
      'plugin install b@m --scope user --json': line({ outcome: 'cancelled' })
    })

    await expect(installPlugin(cli, 'a@m')).rejects.toMatchObject({ params: { message: 'boom' } })
    await expect(installPlugin(cli, 'b@m')).rejects.toMatchObject({
      params: { message: 'cancelled' }
    })
  })

  it('refuses a result line that is not one', async () => {
    const { cli } = fakeCli({
      'plugin install a@m --scope user --json': '{"command":"install"}\n',
      'plugin install b@m --scope user --json': ''
    })

    await expect(installPlugin(cli, 'a@m')).rejects.toMatchObject({
      code: 'pluginOutputUnreadable'
    })
    await expect(installPlugin(cli, 'b@m')).rejects.toMatchObject({
      code: 'pluginOutputUnreadable'
    })
  })
})

describe('switching and removing', () => {
  /** What `plugin list` answers with one plugin installed where a test needs it. */
  const listed = (...items: Record<string, unknown>[]): string =>
    JSON.stringify(items.map((item) => ({ id: 'a@m', enabled: true, ...item })))

  it('switches a plugin in its own scope, from its own project', async () => {
    const project = join(home, 'site')
    await mkdir(project)
    const { cli, calls } = fakeCli({
      'plugin list --json': listed({ scope: 'project', projectPath: project }, { scope: 'user' }),
      'plugin disable a@m --scope project --json': line({ outcome: 'ok' }),
      'plugin enable a@m --scope user --json': line({ outcome: 'ok' })
    })

    await setPluginEnabled(cli, 'a@m', false, { scope: 'project', projectPath: project })
    await setPluginEnabled(cli, 'a@m', true, { scope: 'user' })

    expect(calls.filter((call) => call.args[1] !== 'list')).toEqual([
      { args: ['plugin', 'disable', 'a@m', '--scope', 'project', '--json'], cwd: project },
      { args: ['plugin', 'enable', 'a@m', '--scope', 'user', '--json'], cwd: undefined }
    ])
  })

  /*
   * Measured: disabling a disabled plugin exits 1 with `outcome: "failed"`
   * and `alreadyInGoalState: true`. The switch ended where it was asked to.
   */
  it('counts a plugin already in that state as done', async () => {
    const { cli } = fakeCli({
      'plugin list --json': listed({ scope: 'user' }),
      'plugin disable a@m --scope user --json': line({
        command: 'disable',
        outcome: 'failed',
        failureCode: 'already_in_goal_state',
        alreadyInGoalState: true,
        message: 'Plugin "a@m" is already disabled'
      })
    })

    await expect(setPluginEnabled(cli, 'a@m', false, { scope: 'user' })).resolves.toBeUndefined()
  })

  it('fails a switch the CLI refused', async () => {
    const { cli } = fakeCli({
      'plugin list --json': listed({ scope: 'user' }),
      'plugin enable a@m --scope user --json': line({
        outcome: 'failed',
        alreadyInGoalState: false,
        message: 'blocked by policy'
      })
    })

    await expect(setPluginEnabled(cli, 'a@m', true, { scope: 'user' })).rejects.toMatchObject({
      code: 'pluginActionFailed',
      params: { message: 'blocked by policy' }
    })
  })

  it('removes a plugin from its scope and project', async () => {
    const project = join(home, 'site')
    await mkdir(project)
    const { cli, calls } = fakeCli({
      'plugin list --json': listed({ scope: 'local', projectPath: project }),
      'plugin uninstall a@m --scope local --json': line({ outcome: 'ok', keptData: false })
    })

    await uninstallPlugin(cli, 'a@m', { scope: 'local', projectPath: project })

    expect(calls.at(-1)).toEqual({
      args: ['plugin', 'uninstall', 'a@m', '--scope', 'local', '--json'],
      cwd: project
    })
  })

  it('fails a removal the CLI refused', async () => {
    const { cli } = fakeCli({
      'plugin list --json': listed({ scope: 'user' }),
      'plugin uninstall a@m --scope user --json': line({ outcome: 'failed', message: 'no' })
    })

    await expect(uninstallPlugin(cli, 'a@m', { scope: 'user' })).rejects.toMatchObject({
      code: 'pluginActionFailed'
    })
  })

  /*
   * The target comes from the window, and its path becomes the CLI's working
   * directory — where it writes `.claude/settings*.json`. Only a place Claude
   * Code already recorded the plugin in may be named.
   */
  it('refuses a target the plugin is not installed in, and runs nothing', async () => {
    const elsewhere = join(home, 'elsewhere')
    await mkdir(elsewhere)
    const { cli, calls } = fakeCli({
      'plugin list --json': listed(
        { scope: 'project', projectPath: join(home, 'site') },
        { id: 'b@m', scope: 'user' }
      )
    })

    for (const target of [
      { scope: 'project', projectPath: elsewhere },
      { scope: 'local', projectPath: join(home, 'site') },
      { scope: 'user' }
    ] as const) {
      await expect(setPluginEnabled(cli, 'a@m', false, target)).rejects.toMatchObject({
        code: 'pluginNotInstalled',
        params: { id: 'a@m', scope: target.scope }
      })
    }
    await expect(uninstallPlugin(cli, 'a@m', { scope: 'user' })).rejects.toMatchObject({
      code: 'pluginNotInstalled'
    })
    expect(calls.every((call) => call.args[1] === 'list')).toBe(true)
  })

  /*
   * `spawn` reports a working directory that is gone as the binary missing —
   * `spawn …/claude ENOENT` — and the window would have said Claude Code is not
   * installed.
   */
  it('says a project is gone rather than that the CLI is', async () => {
    const gone = join(home, 'deleted')
    const { cli, calls } = fakeCli({
      'plugin list --json': listed({ scope: 'local', projectPath: gone })
    })

    await expect(
      uninstallPlugin(cli, 'a@m', { scope: 'local', projectPath: gone })
    ).rejects.toMatchObject({ code: 'pluginProjectMissing', params: { path: gone } })
    expect(calls.map((call) => call.args[1])).toEqual(['list'])
  })
})

describe('the state of a project install', () => {
  /*
   * Measured on 2.1.299: a `local` install that is on in its project lists as
   * `enabled: false` from home. Read from home alone, every project row would
   * show its switch off.
   */
  it('is read in its own project', async () => {
    const project = join(home, 'site')
    await mkdir(project)
    const row = { id: 'a@m', scope: 'local', projectPath: project }
    const { cli, calls } = fakeCli({
      'plugin list --json': JSON.stringify([
        { ...row, enabled: false },
        { id: 'b@m', scope: 'project', projectPath: project, enabled: false },
        { id: 'c@m', scope: 'user', enabled: true }
      ]),
      [`plugin list --json @${project}`]: JSON.stringify([
        { ...row, enabled: true },
        { id: 'c@m', scope: 'user', enabled: true }
      ])
    })

    const rows = await listInstalled(cli)

    expect(rows.map((plugin) => [plugin.id, plugin.enabled])).toEqual([
      ['a@m', true],
      // Not in its project's own listing: what home said stands.
      ['b@m', false],
      ['c@m', true]
    ])
    // One listing per project, not one per row.
    expect(calls.map((call) => call.cwd)).toEqual([undefined, project])
  })

  it('keeps what home said for a project that is gone', async () => {
    const { cli, calls } = fakeCli({
      'plugin list --json': JSON.stringify([
        { id: 'a@m', scope: 'local', projectPath: join(home, 'gone'), enabled: false }
      ])
    })

    await expect(listInstalled(cli)).resolves.toMatchObject([{ id: 'a@m', enabled: false }])
    expect(calls).toHaveLength(1)
  })
})

describe('marketplaces', () => {
  it('connects the official marketplace by its repository', async () => {
    const { cli, calls } = fakeCli({
      'plugin marketplace add anthropics/claude-plugins-official --json': line({
        command: 'marketplace-add',
        outcome: 'ok',
        marketplace: 'claude-plugins-official'
      })
    })

    await connectOfficialMarketplace(cli)

    expect(calls).toHaveLength(1)
  })

  // By name: `marketplace update` with none has no JSON result to read.
  it('updates the official marketplace by name', async () => {
    const { cli, calls } = fakeCli({
      'plugin marketplace update claude-plugins-official --json': line({ outcome: 'ok' })
    })

    await expect(refreshOfficialMarketplace(cli)).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('reports an update that failed', async () => {
    const { cli } = fakeCli({
      'plugin marketplace update claude-plugins-official --json': line({
        outcome: 'failed',
        message: 'github is down'
      })
    })

    await expect(refreshOfficialMarketplace(cli)).rejects.toMatchObject({
      code: 'pluginActionFailed',
      params: { message: 'github is down' }
    })
  })
})

describe('the real CLI runner', () => {
  /** A stand-in for `claude`, as a shell script that does what it is told. */
  async function script(body: string): Promise<string> {
    const path = join(home, 'claude')
    await writeFile(path, `#!/bin/sh\n${body}\n`, 'utf8')
    await chmod(path, 0o755)
    return path
  }

  const PWD_AND_ARGS = 'echo "{\\"cwd\\":\\"$(pwd)\\",\\"args\\":\\"$*\\"}"'

  it('runs the binary with the arguments, from home unless told otherwise', async () => {
    const binary = await script(PWD_AND_ARGS)
    const project = join(home, 'project')
    await mkdir(project)
    const cli = pluginCli({ binary, home })

    await expect(cli(['plugin', 'list', '--json'])).resolves.toEqual({
      stdout: `{"cwd":"${home}","args":"plugin list --json"}\n`,
      stderr: ''
    })
    await expect(cli(['plugin', 'list'], project)).resolves.toMatchObject({
      stdout: `{"cwd":"${project}","args":"plugin list"}\n`
    })
  })

  it('starts from the home directory by default', async () => {
    const binary = await script(PWD_AND_ARGS)

    const { stdout } = await pluginCli({ binary })(['plugin'])

    expect(JSON.parse(stdout)).toMatchObject({ cwd: await realpath(homedir()) })
  })

  /*
   * Measured: a refusal exits 1 and prints its result line all the same.
   * Treating the exit code as the answer would lose the only explanation.
   */
  it('answers with stdout when the CLI exits non-zero', async () => {
    const binary = await script('echo \'{"outcome":"failed"}\'\necho "✘ Failed" >&2\nexit 1')

    await expect(pluginCli({ binary, home })(['plugin', 'disable', 'a@m'])).resolves.toEqual({
      stdout: '{"outcome":"failed"}\n',
      stderr: '✘ Failed\n'
    })
  })

  it('fails with stderr when there is no stdout to read', async () => {
    const binary = await script('echo "unknown command" >&2\nexit 2')

    await expect(pluginCli({ binary, home })(['plugin'])).rejects.toMatchObject({
      code: 'pluginCliUnavailable',
      params: { message: 'unknown command' }
    })
  })

  /*
   * A hung clone prints `Cloning…` and then nothing. What arrived before the
   * deadline is half an answer, and reading it as one reported a timeout as
   * unreadable output.
   */
  it('says it timed out, whatever was printed before', async () => {
    const binary = await script('echo "Cloning…"\nsleep 5')

    await expect(
      pluginCli({ binary, home, timeoutMs: 300 })(['plugin', 'install', 'a@m'])
    ).rejects.toMatchObject({ code: 'pluginTimedOut', params: { seconds: '0' } })
  })

  it('fails when the output runs past what it may print', async () => {
    const binary = await script('echo "0123456789012345678901234567890123456789"')

    await expect(pluginCli({ binary, home, maxOutput: 8 })(['plugin'])).rejects.toMatchObject({
      code: 'pluginCliUnavailable',
      params: { message: 'printed more than 8 bytes' }
    })
  })

  it('fails when something else stopped it part-way', async () => {
    const binary = await script('echo "{\\"outcome\\":"\nkill -9 $$')

    await expect(pluginCli({ binary, home })(['plugin'])).rejects.toMatchObject({
      code: 'pluginCliUnavailable',
      params: { message: 'stopped by SIGKILL' }
    })
  })

  it('fails with the start error when the binary will not run', async () => {
    await expect(
      pluginCli({ binary: join(home, 'absent'), home })(['plugin'])
    ).rejects.toMatchObject({
      code: 'pluginCliUnavailable',
      params: { message: expect.stringContaining('ENOENT') as unknown }
    })
  })

  it('fails without trying when there is no binary at all', async () => {
    await expect(pluginCli({ binary: null, home })(['plugin'])).rejects.toMatchObject({
      code: 'pluginCliUnavailable'
    })
  })

  it('finds the bundled binary by default', () => {
    expect(pluginCli()).toBeTypeOf('function')
  })
})
