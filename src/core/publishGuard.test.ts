import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type GitExec, gitIn } from './git.js'
import {
  agentEnv,
  PUBLISH_DENY_RULES,
  PUBLISH_REFUSAL,
  PUSH_NOWHERE,
  refusesPublish,
  refusesPublishTool
} from './publishGuard.js'
import { pushTargets } from './remotes.js'

const REWRITE = `url.${PUSH_NOWHERE}.pushInsteadOf`

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
    'env git push',
    'command git push',
    'sudo -u me git push',
    'nohup git push &',
    'timeout 30 git push',
    'git --git-dir .git --work-tree . push',
    'git send-pack origin',
    'git http-push origin',
    'gi\\t push',
    // A line continued with a backslash is one command.
    'git \\\n  push origin HEAD',
    'gh pr \\\n  create --fill',
    // A chain whose first command was allowed let the push through, reported
    // against the CLI: every part is read here.
    'git add . && git commit -m x && git push',
    'npm test || git push',
    'echo $(git push)',
    'echo `git push`',
    'git commit -m "fixed $(git push)"',
    '(cd .. && git push)',
    // Code handed to another program.
    "bash -c 'git push'",
    'bash -lc "git push origin HEAD"',
    `bash -c "sh -c 'git push'"`,
    'eval "git push"',
    "npx -c 'gh pr merge 1 --squash'",
    `python3 -c "import subprocess; subprocess.run(['git', 'push'])"`,
    `python3.12 -c 'import os; os.system("gh pr create --fill")'`,
    `node -e "require('child_process').execSync('git push')"`,
    `tsx -e 'execSync("gh pr create")'`,
    `deno eval 'Deno.run({ cmd: ["git", "push"] })'`,
    `awk 'BEGIN { system("gh pr create --fill") }'`,
    'bash <<EOF\ngit push\nEOF',
    "python3 - <<'PY'\nimport os; os.system('git push')\nPY",
    // Arguments that arrive from stdin, unseen.
    'echo origin | xargs git push',
    'echo push | xargs git',
    'echo create | xargs gh pr',
    'echo "pr merge 12" | xargs gh',
    // gh.
    'gh pr create',
    'gh pr create --title t --body b',
    "$'gh' pr create --fill",
    'gh -R owner/repo pr create',
    'gh pr merge 5 --squash',
    'gh pr close 5',
    'gh pr ready 5',
    'gh pr reopen 5',
    'gh alias set pc "pr create --fill"',
    'gh api -X POST repos/o/r/pulls',
    'gh api --method=PUT repos/o/r/pulls/5/merge',
    'gh api -XPATCH repos/o/r/pulls/5',
    'gh api repos/o/r/pulls -f title=t -f head=x',
    'gh api -X POST repos/o/r/git/refs -f ref=refs/heads/x',
    'gh api -X PUT repos/o/r/contents/a.txt -f content=eA==',
    `gh api graphql -f query='mutation { createPullRequest(input: {}) { clientMutationId } }'`,
    'gh api graphql -F query=@q.gql',
    'gh api repos/o/r/pulls -X',
    // Writes to GitHub's API from another client.
    'curl -X PUT -H "Authorization: token x" https://api.github.com/repos/o/r/pulls/1/merge',
    'curl -d \'{"title":"t"}\' https://api.github.com/repos/o/r/pulls',
    'http POST https://api.github.com/repos/o/r/pulls title=t',
    'hub pull-request -m x',
    'hub push',
    // The environment's rewrite, worked around: each measured to succeed.
    'GIT_CONFIG_COUNT=0 git status',
    'export GIT_CONFIG_COUNT=0',
    'unset GIT_CONFIG_COUNT',
    'env -u GIT_CONFIG_COUNT git status',
    'env --unset=GIT_CONFIG_COUNT git status',
    'env -i git status',
    "git -c 'url.https://github.com/.pushInsteadOf=https://github.com/' fetch",
    'git --config-env=url.x.pushInsteadOf=VAR fetch',
    'git config remote.origin.pushurl https://github.com/o/r.git',
    'git config set remote.origin.url https://github.com/o/r.git',
    'git config --add url.x.insteadOf y',
    'git remote set-url origin https://github.com/o/r.git',
    'git remote add mine https://github.com/o/r.git',
    // An alias names a command the reading cannot see; the user's own pre-push hook is theirs.
    'git -c alias.p=push p',
    'git config alias.p push',
    'git -c core.hooksPath=/dev/null commit -m x',
    // How the app's own push is carried, and with whose credentials.
    'git config core.sshCommand "ssh -i key"',
    'git config remote.origin.receivepack "cat > /tmp/x"',
    'git config http.proxy http://proxy.example',
    'git config http.https://github.com/.proxy http://proxy.example',
    'git config credential.helper store'
  ])('refuses %s', (command) => {
    expect(refusesPublish(command)).toBe(PUBLISH_REFUSAL)
  })

  // Ordinary work. Each was refused by a reading that looked for words
  // anywhere in the text, and an agent refused its ordinary work learns to
  // work round the guard.
  it.each([
    'git',
    'git status',
    'git log --oneline --grep push',
    'git log -S insteadOf',
    'git commit -m "push the button"',
    `git add . && git commit -m "docs: say git push is the app's"`,
    "git commit -m \"$(cat <<'EOF'\nfeat: stop git push from the agent\n\ngh pr merge is the user's\nEOF\n)\"",
    'git commit -F - <<EOF\ngit push is refused\nEOF',
    'git fetch origin main',
    'git pull --ff-only',
    'git merge origin/main',
    'git stash push -m wip',
    'git remote -v',
    'git remote get-url --push origin',
    'git config --get core.hooksPath',
    'git config remote.origin.url',
    'git config --get-regexp alias',
    'git config set user.name me',
    'git config set',
    'grep -rn GIT_CONFIG src',
    'grep -rn pushInsteadOf src/core',
    'cat docs/pushurl.md',
    'grep -rn "pullRequest" .',
    "find . -name '*pullRequest*'",
    'node node_modules/.bin/vitest run src/core/pullRequests.test.ts',
    'python3 scripts/gen.py --out pull_requests.json',
    'python3 -m pytest',
    'bash scripts/release.sh',
    'gh pr view 5',
    'gh pr checks 5',
    'gh pr diff 5',
    'gh pr list',
    'gh alias list',
    'gh run view --job 123 --log-failed',
    'gh api',
    'gh api repos/o/r/pulls/5',
    'gh api -X GET repos/o/r/pulls -f state=open',
    'gh api repos/o/r/pulls/1/comments -f body=thanks',
    'gh api -X POST repos/o/r/pulls/1/comments/2/replies -f body=done',
    'gh api graphql -f query=\'mutation { resolveReviewThread(input: {threadId: "x"}) { thread { id } } }\'',
    "gh api graphql -f query='query { viewer { login } }'",
    'curl -s https://api.github.com/repos/o/r/pulls',
    'curl -d x=1 https://example.com/form',
    'hub browse',
    'npm test',
    'npm run check && git add -A && git commit -m "fix: x"',
    "bash -c 'npm test'",
    'echo FOO | xargs echo',
    'FOO=1 BAR=2',
    'echo "unterminated'
  ])('lets %s run', (command) => {
    expect(refusesPublish(command)).toBeNull()
  })

  it('reads four levels of nested code deep and stops after that', () => {
    const quote = (text: string): string => `bash -c '${text.replaceAll("'", `'"'"'`)}'`
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
    'mcp__github__update_pull_request',
    'mcp__github__update_pull_request_branch',
    'mcp__github__push_files',
    'mcp__plugin_github_github__create_or_update_file',
    'mcp__github__delete_file',
    'mcp__gh__create_branch',
    'mcp__github__create_pull_request_with_copilot',
    'mcp__github__pull_request_write'
  ])('refuses %s', (name) => {
    expect(refusesPublishTool(name)).toBe(PUBLISH_REFUSAL)
  })

  it.each([
    'mcp__github__get_pull_request',
    'mcp__github__list_pull_requests',
    'mcp__github__add_issue_comment',
    'mcp__github__create_issue',
    'Read'
  ])('lets %s run', (name) => {
    expect(refusesPublishTool(name)).toBeNull()
  })
})

describe('PUBLISH_DENY_RULES', () => {
  it('names every publishing git and gh pr command, bare and with arguments', () => {
    for (const rule of [
      'Bash(git push)',
      'Bash(git push *)',
      'Bash(git send-pack *)',
      'Bash(gh pr create)',
      'Bash(gh pr merge *)',
      'Bash(gh pr ready *)'
    ]) {
      expect(PUBLISH_DENY_RULES).toContain(rule)
    }
  })

  it('takes away the tool that starts an agent in the cloud', () => {
    expect(PUBLISH_DENY_RULES).toContain('RemoteTrigger')
  })
})

describe('agentEnv', () => {
  it('keeps the base and adds a rewrite for each network prefix and target', () => {
    const env = agentEnv({ PATH: '/bin' }, ['git@github-work:o/r.git'])
    const values = Object.entries(env)
      .filter(([key]) => key.startsWith('GIT_CONFIG_VALUE_'))
      .map(([, value]) => value)

    expect(env.PATH).toBe('/bin')
    expect(env.GIT_CONFIG_KEY_0).toBe(REWRITE)
    expect(values).toEqual(expect.arrayContaining(['https://', 'git@', 'git@github-work:o/r.git']))
    expect(values).not.toContain('/')
    expect(env.GIT_CONFIG_COUNT).toBe(String(values.length))
  })

  it('lists a target the network prefixes already hold once', () => {
    const once = agentEnv({}, [])
    expect(agentEnv({}, ['https://']).GIT_CONFIG_COUNT).toBe(once.GIT_CONFIG_COUNT)
  })

  it('appends to configuration already passed through the environment', () => {
    const env = agentEnv(
      { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'someone' },
      []
    )
    expect(env.GIT_CONFIG_KEY_0).toBe('user.name')
    expect(env.GIT_CONFIG_KEY_1).toBe(REWRITE)
  })

  it('starts at zero over a count that is not a number', () => {
    expect(agentEnv({ GIT_CONFIG_COUNT: 'many' }, []).GIT_CONFIG_KEY_0).toBe(REWRITE)
  })

  describe('against real git', () => {
    let root: string
    let remote: string
    let work: GitExec

    /** The workspace's git as the agent runs it. */
    const asAgent = async (): Promise<GitExec> => {
      const env = agentEnv(process.env, await pushTargets(work))
      const defined = Object.entries(env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
      return gitIn(join(root, 'work'), { env: Object.fromEntries(defined) })
    }

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'octopus-publish-'))
      remote = join(root, 'remote.git')
      await gitIn(root)(['init', '--bare', '-b', 'main', remote])
      await gitIn(root)(['clone', remote, 'work'])
      work = gitIn(join(root, 'work'))
      await work(['config', 'user.email', 'a@b.c'])
      await work(['config', 'user.name', 'a'])
      await writeFile(join(root, 'work', 'a.txt'), 'a\n')
      await work(['add', 'a.txt'])
      await work(['commit', '-m', 'a'])
    })

    afterEach(async () => {
      await rm(root, { recursive: true, force: true })
    })

    it('makes a push to the workspace remote fail, where the same push without it succeeds', async () => {
      await expect((await asAgent())(['push', 'origin', 'main'])).rejects.toThrow(
        /octopus-agent-push-disabled/u
      )
      await expect(work(['push', 'origin', 'main'])).resolves.toBeDefined()
    })

    it('leaves fetch alone', async () => {
      await expect((await asAgent())(['fetch', 'origin'])).resolves.toBeDefined()
    })

    it('leaves a push to some other local repository alone, as tests that make one need', async () => {
      const other = join(root, 'other.git')
      await gitIn(root)(['init', '--bare', '-b', 'main', other])
      await expect((await asAgent())(['push', other, 'main'])).resolves.toBeDefined()
    })

    // The user's own rule is the commonest way a push would otherwise go round:
    // git takes the longest prefix, so the network-wide rule alone loses to it.
    it('outranks a rewrite the user configured', async () => {
      await work(['remote', 'set-url', 'origin', 'https://github.com/o/r.git'])
      await work(['config', 'url.git@github.com:.pushInsteadOf', 'https://github.com/'])
      await expect((await asAgent())(['remote', 'get-url', '--push', 'origin'])).resolves.toMatch(
        new RegExp(`^${PUSH_NOWHERE}`, 'u')
      )
    })

    it('reaches a remote named through an ssh alias or a relative path', async () => {
      for (const url of ['github-work:o/r.git', '../remote.git']) {
        await work(['remote', 'set-url', 'origin', url])
        await expect((await asAgent())(['remote', 'get-url', '--push', 'origin'])).resolves.toMatch(
          new RegExp(`^${PUSH_NOWHERE}`, 'u')
        )
      }
    })

    it('does not reach an explicit pushurl, which is why the text guard refuses one', async () => {
      // The known limit, pinned so the documentation cannot promise more.
      await work(['config', 'remote.origin.pushurl', remote])
      await expect(
        (await asAgent())(['push', '--dry-run', 'origin', 'main'])
      ).resolves.toBeDefined()
      expect(refusesPublish('git config remote.origin.pushurl x')).toBe(PUBLISH_REFUSAL)
    })
  })
})
