import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  agentEnv,
  PUBLISH_DENY_RULES,
  PUBLISH_REFUSAL,
  refusesPublish,
  refusesPublishTool
} from './publishGuard.js'

const run = promisify(execFile)

describe('refusesPublish', () => {
  it.each([
    'git push',
    'git push origin octopus/gwen',
    'git push --force-with-lease',
    // The forms the CLI's own deny rules are documented not to match.
    'git -C . push origin main',
    'git -c push.default=current push origin main',
    "git 'push' origin main",
    '/usr/bin/git push',
    '/opt/homebrew/bin/git push',
    'env git push',
    'command git push',
    'sudo git push',
    'nohup git push &',
    'FOO=1 git push',
    'git --git-dir .git --work-tree . push',
    'git --no-pager push',
    'git send-pack origin',
    // A backslash outside quotes only escapes the next character.
    'gi\\t push',
    // A chain whose first command was allowed let the push through, reported
    // against the CLI: every part is read here.
    'git add . && git commit -m x && git push',
    'npm run check; git push',
    'npm test || git push',
    'echo $(git push)',
    'echo `git push`',
    'git commit -m "fixed $(git push)"',
    '(cd .. && git push)',
    // A program that is more shell.
    "bash -c 'git push'",
    'sh -c "git push origin HEAD"',
    `bash -c "sh -c 'git push'"`,
    'eval "git push"',
    'echo origin | xargs git push',
    `python3 -c "import subprocess; subprocess.run(['git', 'push'])"`,
    `node -e "require('child_process').execSync('git push')"`,
    // gh.
    'gh pr create',
    'gh pr create --title t --body b',
    'gh pr create --head octopus/gwen',
    'gh -R owner/repo pr create',
    'gh pr merge 5 --squash',
    'gh pr close 5',
    'gh pr ready 5',
    'gh pr reopen 5',
    'gh api -X POST repos/o/r/pulls',
    'gh api --method=PUT repos/o/r/pulls/5/merge',
    'gh api -XPATCH repos/o/r/pulls/5',
    // A method flag left without its value is not read as a GET.
    'gh api repos/o/r/pulls -X',
    'gh api repos/o/r/pulls -f title=t -f head=x',
    `gh api graphql -f query='mutation { createPullRequest(input: {}) { clientMutationId } }'`,
    // The environment's rewrite, worked around: each measured to succeed.
    'GIT_CONFIG_COUNT=0 git push',
    'env -u GIT_CONFIG_COUNT git status',
    "git -c 'url.https://github.com/.pushInsteadOf=https://github.com/' fetch",
    'git config remote.origin.pushurl https://github.com/o/r.git',
    'git remote set-url --push origin https://github.com/o/r.git',
    'git -c core.hooksPath=/dev/null commit -m x'
  ])('refuses %s', (command) => {
    expect(refusesPublish(command)).toBe(PUBLISH_REFUSAL)
  })

  it.each([
    'git status',
    'git log --oneline --grep push',
    'git commit -m "push the button"',
    "git commit -m 'gh pr create is the user'\"'\"'s'",
    'git fetch origin main',
    'git pull --ff-only',
    'git merge origin/main',
    'git stash push -m wip',
    'git remote -v',
    'git remote get-url origin',
    'gh pr view 5',
    'gh pr checks 5',
    'gh pr diff 5',
    'gh pr list',
    'gh run view --job 123 --log-failed',
    'gh api repos/o/r/pulls/5',
    'gh api -X GET repos/o/r/pulls -f state=open',
    "gh api graphql -f query='query { viewer { login } }'",
    'npm test',
    'npm run check && git add -A && git commit -m "fix: x"',
    "bash -c 'npm test'",
    'python3 -m pytest',
    'echo "unterminated'
  ])('lets %s run', (command) => {
    expect(refusesPublish(command)).toBeNull()
  })

  it('reads four levels of quoting deep and stops after that', () => {
    // Each level is one double-quoted `$(…)`, so the push is only ever seen by
    // reading inside the quotes — once per level.
    const quote = (text: string): string => `"$(${text.replace(/[\\"$`]/gu, '\\$&')})"`
    const wrapped = (levels: number): string =>
      Array.from({ length: levels }).reduce<string>((text) => quote(text), 'git push')

    expect(refusesPublish(wrapped(4))).toBe(PUBLISH_REFUSAL)
    expect(refusesPublish(wrapped(5))).toBeNull()
  })
})

describe('refusesPublishTool', () => {
  it.each([
    'mcp__github__create_pull_request',
    'mcp__github__merge_pull_request',
    'mcp__github__push_files',
    'mcp__plugin_github_github__create_or_update_file',
    'mcp__gh__create_branch'
  ])('refuses %s', (name) => {
    expect(refusesPublishTool(name)).toBe(PUBLISH_REFUSAL)
  })

  it.each(['mcp__github__get_pull_request', 'mcp__github__list_pull_requests', 'Read'])(
    'lets %s run',
    (name) => {
      expect(refusesPublishTool(name)).toBeNull()
    }
  )
})

describe('PUBLISH_DENY_RULES', () => {
  it('names the plain push and every pull request command that publishes', () => {
    expect(PUBLISH_DENY_RULES).toEqual(
      expect.arrayContaining(['Bash(git push)', 'Bash(git push *)', 'Bash(gh pr create *)'])
    )
  })
})

describe('agentEnv', () => {
  it('keeps the base and adds the rewrite after nothing', () => {
    const env = agentEnv({ PATH: '/bin' })
    expect(env.PATH).toBe('/bin')
    expect(env.GIT_CONFIG_COUNT).toBe('7')
    expect(env.GIT_CONFIG_KEY_0).toBe('url.octopus-agent-push-disabled://.pushInsteadOf')
    expect(env.GIT_CONFIG_VALUE_0).toBe('https://')
  })

  it('appends to configuration already passed through the environment', () => {
    const env = agentEnv({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'someone'
    })
    expect(env.GIT_CONFIG_KEY_0).toBe('user.name')
    expect(env.GIT_CONFIG_KEY_1).toBe('url.octopus-agent-push-disabled://.pushInsteadOf')
    expect(env.GIT_CONFIG_COUNT).toBe('8')
  })

  it('starts at zero over a count that is not a number', () => {
    expect(agentEnv({ GIT_CONFIG_COUNT: 'many' }).GIT_CONFIG_KEY_0).toBe(
      'url.octopus-agent-push-disabled://.pushInsteadOf'
    )
  })

  describe('against real git', () => {
    let root: string
    let remote: string
    let work: string

    const git = (
      cwd: string,
      args: string[],
      env?: Record<string, string | undefined>
    ): Promise<{ stdout: string; stderr: string }> => run('git', args, { cwd, ...(env && { env }) })

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'octopus-publish-'))
      remote = join(root, 'remote.git')
      work = join(root, 'work')
      await run('git', ['init', '--bare', '-b', 'main', remote])
      await run('git', ['clone', remote, work])
      await git(work, ['config', 'user.email', 'a@b.c'])
      await git(work, ['config', 'user.name', 'a'])
      await writeFile(join(work, 'a.txt'), 'a\n')
      await git(work, ['add', 'a.txt'])
      await git(work, ['commit', '-m', 'a'])
    })

    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it('makes a push fail, where the same push without it succeeds', async () => {
      await expect(git(work, ['push', 'origin', 'main'], agentEnv(process.env))).rejects.toThrow(
        /octopus-agent-push-disabled/u
      )
      await expect(git(work, ['push', 'origin', 'main'])).resolves.toBeDefined()
    })

    it('makes a push to a URL written out in full fail too', async () => {
      await expect(
        git(work, ['push', `file://${remote}`, 'main'], agentEnv(process.env))
      ).rejects.toThrow(/octopus-agent-push-disabled/u)
    })

    it('leaves fetch alone', async () => {
      await expect(git(work, ['fetch', 'origin'], agentEnv(process.env))).resolves.toBeDefined()
    })

    it('does not reach an explicit pushurl, which is why the text guard refuses one', async () => {
      // The known limit, pinned so the documentation cannot promise more.
      await git(work, ['config', 'remote.origin.pushurl', remote])
      await expect(
        git(work, ['push', '--dry-run', 'origin', 'main'], agentEnv(process.env))
      ).resolves.toBeDefined()
      expect(refusesPublish('git config remote.origin.pushurl x')).toBe(PUBLISH_REFUSAL)
    })
  })
})
