import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readConductorConfig } from './conductorConfig.js'
import { RepoConfigError } from './repoConfig.js'

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'octopus-conductor-'))
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** Writes one file into the fake checkout, making its directory on the way. */
async function put(relative: string, contents: string): Promise<void> {
  const path = join(repo, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

describe('readConductorConfig', () => {
  it('answers with nothing for a repository that has no Conductor settings', async () => {
    await expect(readConductorConfig(repo)).resolves.toBeNull()
  })

  it('reads the three scripts as command lines, untouched', async () => {
    /*
     * The string form is already a command line. `$CONDUCTOR_PORT` has to reach
     * the shell as a variable reference, so anything that quoted this would
     * turn the whole line into the name of a program.
     */
    await put(
      '.conductor/settings.toml',
      [
        '[scripts]',
        'setup = "bash .conductor/setup.sh"',
        'run = "bin/rails server -b 0.0.0.0 -p $CONDUCTOR_PORT"',
        'archive = "bash .conductor/archive.sh"'
      ].join('\n')
    )

    const from = join('.conductor', 'settings.toml')
    const config = await readConductorConfig(repo)
    expect(config?.scripts).toEqual({
      setup: { command: 'bash .conductor/setup.sh', name: null, path: from },
      run: { command: 'bin/rails server -b 0.0.0.0 -p $CONDUCTOR_PORT', name: null, path: from },
      archive: { command: 'bash .conductor/archive.sh', name: null, path: from }
    })
  })

  it('lets the machine-local file replace one key and leave the rest alone', async () => {
    await put(
      '.conductor/settings.toml',
      '[scripts]\nsetup = "shared setup"\narchive = "shared archive"\n'
    )
    await put('.conductor/settings.local.toml', '[scripts]\nsetup = "local setup"\n')

    const config = await readConductorConfig(repo)
    // Shallow, per top-level key: `scripts` is replaced whole, which is what
    // Conductor documents — so the archive line goes with it.
    expect(config?.scripts.setup?.command).toBe('local setup')
    expect(config?.scripts.archive).toBeUndefined()
    expect(config?.scripts.setup?.path).toBe(join('.conductor', 'settings.local.toml'))
  })

  it('names the file a script really came from, not the last file read', async () => {
    /*
     * The shape a real checkout has: a machine-local file that sets nothing but
     * `[git]`. Reporting it as the source of the scripts would send the reader
     * to a file that does not mention one.
     */
    await put('.conductor/settings.toml', '[scripts]\nsetup = "shared setup"\n')
    await put('.conductor/settings.local.toml', '[git]\narchive_on_merge = true\n')

    const config = await readConductorConfig(repo)
    // The winning layer is named on the script itself, which is the only
    // place a reader is sent — the module answered with the whole list of
    // contributing files too, and nothing ever read it.
    expect(config?.scripts.setup?.path).toBe(join('.conductor', 'settings.toml'))
  })

  it('falls back to the legacy JSON only when there is no TOML', async () => {
    await put('conductor.json', JSON.stringify({ scripts: { setup: 'from json' } }))
    await expect(readConductorConfig(repo)).resolves.toMatchObject({
      scripts: { setup: { command: 'from json', name: null, path: 'conductor.json' } }
    })

    await put('.conductor/settings.toml', '[scripts]\nsetup = "from toml"\n')
    await expect(readConductorConfig(repo)).resolves.toMatchObject({
      scripts: { setup: { command: 'from toml', name: null } }
    })
  })

  it('treats a script set to nothing as one the repository does not name', async () => {
    // An empty string is how a repository turns off something its parent
    // settings file set, and it must not become a command that runs nothing.
    await put('.conductor/settings.toml', '[scripts]\nsetup = ""\nrun = ""\narchive = ""\n')

    expect((await readConductorConfig(repo))?.scripts).toEqual({})
  })

  it('keeps the keys it understands and drops the ones it does not', async () => {
    // Conductor ships often. A key from a later version is not a reason to
    // refuse the ones this build does understand.
    await put(
      '.conductor/settings.toml',
      '[scripts]\nsetup = "install"\nrun_mode = "concurrent"\n\n[git]\narchive_on_merge = true\n'
    )

    const config = await readConductorConfig(repo)
    expect(config?.scripts.setup?.command).toBe('install')
    expect(config?.scripts).not.toHaveProperty('run_mode')
  })

  describe('named run entries', () => {
    it('builds a command line from an argv, quoting each part', async () => {
      /*
       * The object form is not shell-parsed by Conductor, so it has to be
       * quoted on the way into a line that a shell will parse — otherwise an
       * argument with a space in it becomes two.
       */
      await put(
        '.conductor/settings.toml',
        [
          '[scripts.run.dev]',
          'command = "bin/rails"',
          'args = ["server", "--name", "it\'s mine"]',
          '',
          '[scripts.run.dev.options]',
          'cwd = "apps/web"'
        ].join('\n')
      )

      expect((await readConductorConfig(repo))?.scripts.run).toEqual({
        command: "cd 'apps/web' && exec 'bin/rails' 'server' '--name' 'it'\\''s mine'",
        name: 'dev',
        path: join('.conductor', 'settings.toml')
      })
    })

    it('prefers the entry marked default', async () => {
      await put(
        '.conductor/settings.toml',
        '[scripts.run.one]\ncommand = "first"\n\n[scripts.run.two]\ncommand = "second"\ndefault = true\n'
      )

      const config = await readConductorConfig(repo)
      expect(config?.scripts.run?.name).toBe('two')
    })

    it('skips an entry this machine could not run when nothing is marked default', async () => {
      await put(
        '.conductor/settings.toml',
        [
          '[scripts.run.cloud]',
          'command = "cloud"',
          'available_in = "cloud"',
          '',
          '[scripts.run.here]',
          'command = "here"',
          'available_in = ["local", "cloud"]'
        ].join('\n')
      )

      const config = await readConductorConfig(repo)
      expect(config?.scripts.run?.name).toBe('here')
    })

    it('takes the first when every entry belongs somewhere else', async () => {
      await put(
        '.conductor/settings.toml',
        '[scripts.run.a]\ncommand = "a"\navailable_in = "cloud"\n\n[scripts.run.b]\ncommand = "b"\navailable_in = "cloud"\n'
      )

      expect((await readConductorConfig(repo))?.scripts.run?.name).toBe('a')
    })

    it('has no server script when no entry names a command', async () => {
      // `args` without a `command` — which is what an entry with nothing to run
      // actually looks like. The published schema is `additionalProperties:
      // false`, so a field invented for a fixture is a state Conductor's own
      // validator would reject and this parser would never meet.
      await put('.conductor/settings.toml', '[scripts.run.empty]\nargs = ["--flag"]\n')

      const config = await readConductorConfig(repo)
      expect(config?.scripts.run).toBeUndefined()
    })
  })

  describe('prompts', () => {
    it('maps the four that have a counterpart here', async () => {
      await put(
        '.conductor/settings.toml',
        [
          '[prompts]',
          'code_review = "review this"',
          'create_pr = "open one"',
          'fix_errors = "fix them"',
          'resolve_merge_conflicts = "resolve"'
        ].join('\n')
      )

      expect((await readConductorConfig(repo))?.prompts).toEqual({
        review: 'review this',
        pullRequest: 'open one',
        fixChecks: 'fix them',
        resolveConflicts: 'resolve'
      })
    })

    it('never takes `general`, which would add to the system prompt', async () => {
      /*
       * §12.3: octopus adds nothing to the system prompt. Importing a general
       * prompt would make it start doing so without saying it had.
       */
      await put('.conductor/settings.toml', '[prompts]\ngeneral = "be nice"\n')

      expect((await readConductorConfig(repo))?.prompts).toEqual({})
    })

    it('ignores one that says nothing', async () => {
      await put('.conductor/settings.toml', '[prompts]\ncode_review = "   "\n')

      expect((await readConductorConfig(repo))?.prompts).toEqual({})
    })
  })

  describe('the files a repository declares', () => {
    /*
     * Read and shown, never followed. A repository that declares its gitignored
     * files through `file_include_globs` alone — no `cp` in its setup script,
     * never converted — comes up here unable to run, and the declaration was on
     * disk the whole time with nothing saying so.
     */
    it('reads the declared list, one path per line', async () => {
      await put(
        '.conductor/settings.toml',
        ['file_include_globs = """', '.env', 'config/master.key', '"""'].join('\n')
      )

      const config = await readConductorConfig(repo)

      expect(config?.files).toEqual([
        { glob: '.env', pattern: false },
        { glob: 'config/master.key', pattern: false }
      ])
      expect(config?.filesPath).toBe('.conductor/settings.toml')
    })

    /* `carryInto` hands each entry to `copyFile`, so a glob names a file that
       does not exist. Marked rather than dropped: the declaration is real and
       the reader should know octopus will not act on it. */
    it('marks an entry a pattern rather than pretending it would be copied', async () => {
      await put(
        '.conductor/settings.toml',
        ['file_include_globs = """', '.env', 'config/*.key', 'certs/**', 'a[0-9].pem', '"""'].join(
          '\n'
        )
      )

      const config = await readConductorConfig(repo)

      expect(config?.files.map((file) => file.pattern)).toEqual([false, true, true, true])
    })

    it('drops comments and blank lines, as the carry list does', async () => {
      await put(
        '.conductor/settings.toml',
        ['file_include_globs = """', '# what a workspace needs', '', '  .env  ', '"""'].join('\n')
      )

      await expect(readConductorConfig(repo)).resolves.toMatchObject({
        files: [{ glob: '.env', pattern: false }]
      })
    })

    it('says nothing where the repository declares nothing', async () => {
      await put('.conductor/settings.toml', '[scripts]\nsetup = "make"')

      await expect(readConductorConfig(repo)).resolves.toMatchObject({ files: [], filesPath: '' })
    })

    // The merge is per top-level key, so the machine-local file replaces the
    // committed list rather than adding to it — as it does for the scripts.
    it('takes the list from the file that wins the key', async () => {
      await put('.conductor/settings.toml', 'file_include_globs = """\n.env\n"""')
      await put('.conductor/settings.local.toml', 'file_include_globs = """\n.env.local\n"""')

      const config = await readConductorConfig(repo)

      expect(config?.files).toEqual([{ glob: '.env.local', pattern: false }])
      expect(config?.filesPath).toBe('.conductor/settings.local.toml')
    })
  })

  describe('refusing what it should not read', () => {
    it('names the file that could not be parsed', async () => {
      await put('.conductor/settings.toml', 'scripts = [[[')

      await expect(readConductorConfig(repo)).rejects.toMatchObject({
        code: 'repoConfigMalformed',
        params: { path: join('.conductor', 'settings.toml') }
      })
    })

    it('refuses a file that does not describe settings at all', async () => {
      await put('conductor.json', '["not", "an", "object"]')

      await expect(readConductorConfig(repo)).rejects.toBeInstanceOf(RepoConfigError)
    })

    it('refuses a value of the wrong shape', async () => {
      await put('.conductor/settings.toml', '[scripts]\nsetup = 3\n')

      await expect(readConductorConfig(repo)).rejects.toMatchObject({
        code: 'repoConfigMalformed'
      })
    })

    it('refuses a file too large to be worth reading', async () => {
      await put('.conductor/settings.toml', `# ${'x'.repeat(300 * 1024)}\n`)

      await expect(readConductorConfig(repo)).rejects.toMatchObject({
        code: 'repoConfigTooLarge'
      })
    })

    it('refuses a settings directory that is a symbolic link', async () => {
      // Otherwise a file from outside the checkout is presented under a path
      // inside it, which is the guarantee `.octopus/` already keeps.
      const outside = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
      await writeFile(join(outside, 'settings.toml'), '[scripts]\nsetup = "x"\n', 'utf8')
      await symlink(outside, join(repo, '.conductor'))

      await expect(readConductorConfig(repo)).rejects.toMatchObject({
        code: 'repoConfigSymlink'
      })

      await rm(outside, { recursive: true, force: true })
    })
  })
})
