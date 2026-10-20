import { ghWords, gitCommand, parseCommand, programs } from './shellCommand.js'

/**
 * Keeps the agent from publishing: pushing, or opening, merging or closing a
 * pull request.
 *
 * Publishing is the user's, through the pull request pane, which runs `git` and
 * `gh` itself (`pullRequests.ts`). An agent that pushed on its own finished a
 * conversation with work on the remote nobody had looked at — and a line in the
 * instructions saying not to is read, and then not always kept.
 *
 * Three layers, each catching what the one before cannot, because none of them
 * is a boundary on its own:
 *
 * 1. `refusesPublish` reads the programs a command runs before it runs.
 * 2. `PUBLISH_DENY_RULES` are the CLI's own deny rules: they hold in every mode
 *    and catch the plain forms should the reading above ever miss one.
 * 3. `agentEnv` makes a `git push` to any of the workspace's remotes fail,
 *    whatever wrote it — a script on disk, `python -c`, `/usr/bin/git`.
 *
 * The reading is structural on purpose. One that looked for words anywhere in
 * the text refused commit messages, `grep` and a test file named after pull
 * requests, and an agent refused its ordinary work learns to work round the
 * guard. Without an OS sandbox, an agent set on getting round all three can;
 * what the layers guarantee is that it never happens by accident.
 */

/** What the agent is told, as the reason its command was refused. */
export const PUBLISH_REFUSAL =
  'Octopus does not let the agent publish. Pushing, and opening, merging or closing a pull ' +
  'request, belong to the user, through the pull request pane. Commit your work here, say it ' +
  'is ready, and stop.'

/** git commands that send commits to a remote. */
const GIT_PUBLISHES = new Set(['push', 'send-pack', 'http-push'])

/** `gh pr` commands that change the request rather than read it. */
const GH_PR_PUBLISHES = new Set(['create', 'merge', 'close', 'reopen', 'ready'])

/** `hub` commands that publish. */
const HUB_PUBLISHES = new Set(['push', 'pull-request', 'merge'])

/** MCP tool names, after the last `__`, that publish and do not follow `MCP_PUBLISHING`. */
const MCP_PUBLISHES = new Set(['create_pull_request_with_copilot', 'pull_request_write'])

/** A publishing MCP action, as GitHub's server spells them: `merge_pull_request`, `push_files`. */
const MCP_PUBLISHING =
  /^(?:create|merge|update|push|delete|close)_(?:.+_)?(?:pull_request|branch|file|ref)s?$/u

/** Shells, whose code is more shell. `npx -c` hands its argument to one. */
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'npx'])

/** Interpreters of other languages, whose code is read for what it names. */
const LANGUAGES = /^(?:python[\d.]*|node|tsx|ts-node|deno|bun|perl|ruby|php|osascript)$/u

/** awk runs its first argument as a program, and `system()` reaches a shell from it. */
const AWKS = new Set(['awk', 'gawk', 'mawk', 'nawk'])

/** The flag that hands an interpreter its code inline: `-c`, `-lc`, `-e`, `--eval`. */
const CODE_FLAG = /^-(?:[a-zA-Z]*[ce]|p|r|E|-eval|-print|-command)$/u

/** HTTP clients, refused only for writes to GitHub's API. */
const HTTP_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'xh'])

/** Flags that give an HTTP client a body, which makes its request a write. */
const CURL_DATA =
  /^(?:-d|--data.*|-F|--form.*|--json|-T|--upload-file|--post-data.*|--post-file.*)$/u
const GH_DATA = /^(?:-[fF]|--field|--raw-field|--input)(?:=.*)?$/u

/** REST endpoints whose writes publish code or a pull request's state. Comments and reviews are not among them. */
const API_PUBLISHES =
  /(?:^|\/)(?:pulls(?:\/\d+(?:\/(?:merge|update-branch))?)?|merges|git\/refs(?:\/.*)?|contents(?:\/.*)?)\/?$/u

/** GraphQL mutations that publish. `resolveReviewThread` and replies are not among them. */
const GRAPHQL_PUBLISHES =
  /\b(?:createPullRequest|mergePullRequest|closePullRequest|reopenPullRequest|updatePullRequest|enablePullRequestAutoMerge|createRef|updateRef|createCommitOnBranch)\b/u

/**
 * Config keys that touch what `agentEnv` relies on, or where a push goes.
 *
 * Measured against git 2.54: a longer `pushInsteadOf`, an explicit `pushurl`
 * and an alias each take a push past the environment; `core.hooksPath` would
 * turn off the user's own pre-push hook. The rest decide how the app's own push
 * after a pull request prompt is carried, and with whose credentials — that
 * push runs in this worktree once the agent's turn is over. None has a use in
 * a workspace's work.
 */
const TAMPERED_KEY =
  /^(?:url\..+\.(?:push)?insteadof|remote\..+\.(?:url|pushurl|receivepack|proxy)|core\.(?:hookspath|sshcommand|gitproxy)|http\.(?:.+\.)?(?:proxy|extraheader)|credential\..+|alias\..+|include\.path|includeif\..+\.path)$/iu

/** `git config` options that take their value as the next word. */
const CONFIG_VALUE_OPTIONS = new Set([
  '-f',
  '--file',
  '--blob',
  '--type',
  '--default',
  '--comment',
  '--value'
])

/** The prefix of the environment variables git reads `agentEnv`'s rewrite from. */
const GIT_CONFIG_VARIABLE = 'GIT_CONFIG'

/** Shell builtins that set or clear a variable for what runs after them. */
const VARIABLE_BUILTINS = new Set(['export', 'unset', 'declare', 'typeset', 'readonly'])

const alternatives = (words: Iterable<string>): string => [...words].join('|')

/** What a publishing command looks like inside code handed to another language. */
const MENTIONS = [
  new RegExp(`\\bgit\\b[\\s\\S]*\\b(?:${alternatives(GIT_PUBLISHES)})\\b`, 'u'),
  new RegExp(`\\bgh\\b[\\s\\S]*\\bpr\\b[\\s\\S]*\\b(?:${alternatives(GH_PR_PUBLISHES)})\\b`, 'u')
]

/** How far into nested code the reading goes: `bash -c "sh -c '…'"` is two. */
const MAX_DEPTH = 4

/** The HTTP method a request will use: told outright, or POST when it carries a body. */
function httpMethod(args: readonly string[], data: RegExp): string {
  for (const [at, arg] of args.entries()) {
    if (arg === '-X' || arg === '--request' || arg === '--method') {
      return args
        .slice(at + 1, at + 2)
        .join('')
        .toUpperCase()
    }
    const inline = /^(?:-X|--request=|--method=)(.+)$/u.exec(arg)
    if (inline) return inline.slice(1).join('').toUpperCase()
    if (/^(?:POST|PUT|PATCH|DELETE)$/u.test(arg)) return arg
  }
  return args.some((arg) => data.test(arg)) ? 'POST' : 'GET'
}

function ghPublishes(argv: readonly string[], at: number, piped: boolean): boolean {
  const [group, action] = ghWords(argv, at)
  const args = argv.slice(at + 1)
  // Under `xargs` the words still to come arrive from stdin, unseen.
  if (group === undefined) return piped
  if (group === 'pr') return action === undefined ? piped : GH_PR_PUBLISHES.has(action)
  if (group === 'alias') return action === 'set' || action === 'import'
  if (group !== 'api' || action === undefined) return false

  // A query read from a file cannot be checked, so it is not run.
  if (action === 'graphql') {
    return args.some((arg) => GRAPHQL_PUBLISHES.test(arg) || arg.startsWith('query=@'))
  }
  return httpMethod(args, GH_DATA) !== 'GET' && API_PUBLISHES.test(action.replace(/\?.*$/u, ''))
}

function gitTampers(options: readonly string[], command: string, args: readonly string[]): boolean {
  const keyOf = (setting: string): string => setting.replace(/=.*$/su, '')
  const passed = options.flatMap((option, at) =>
    option === '-c'
      ? options.slice(at + 1, at + 2)
      : option.startsWith('--config-env=')
        ? [option.replace('--config-env=', '')]
        : []
  )
  if (passed.some((setting) => TAMPERED_KEY.test(keyOf(setting)))) return true

  if (command === 'remote') return args[0] === 'set-url' || args[0] === 'add'
  if (command !== 'config') return false

  // Left to right, so an option's value is consumed and never read as anything else.
  const positional: string[] = []
  const flags: string[] = []
  let value = false
  for (const arg of args) {
    if (value) value = false
    else if (CONFIG_VALUE_OPTIONS.has(arg)) value = true
    else if (arg.startsWith('-')) flags.push(arg)
    else positional.push(arg)
  }
  // From the flags left after the scan: `--file --get` names a file called `--get`.
  const reads =
    flags.some((flag) => /^(?:--get.*|--list|-l)$/u.test(flag)) ||
    positional[0] === 'get' ||
    positional[0] === 'list' ||
    (positional.length === 1 && !flags.some((flag) => /^--(?:unset|add|replace)/u.test(flag)))
  // Any word shaped like a refused key: which word git takes for the key is
  // what a reading of the options would have to get right, and need not.
  return !reads && args.some((arg) => TAMPERED_KEY.test(arg))
}

function envTampers(name: string, args: readonly string[]): boolean {
  if (VARIABLE_BUILTINS.has(name)) return args.some((arg) => arg.startsWith(GIT_CONFIG_VARIABLE))
  if (name !== 'env') return false
  return args.some(
    (arg, at) =>
      arg === '-i' ||
      arg === '--ignore-environment' ||
      arg === '-' ||
      arg.startsWith(`--unset=${GIT_CONFIG_VARIABLE}`) ||
      (arg === '-u' && (args[at + 1] ?? '').startsWith(GIT_CONFIG_VARIABLE))
  )
}

/** The code an interpreter at `argv[at]` is handed inline or on stdin, or null for a script on disk. */
function codeOf(
  words: readonly string[],
  stdin: readonly string[],
  at: number,
  name: string
): { shell: boolean; code: string[] } | null {
  const args = words.slice(at + 1)

  if (name === 'eval') return { shell: true, code: [args.join(' ')] }
  if (AWKS.has(name))
    return { shell: false, code: args.filter((arg) => !arg.startsWith('-')).slice(0, 1) }

  const shell = SHELLS.has(name)
  if (!shell && !LANGUAGES.test(name)) return null

  const flag = args.findIndex((arg) => CODE_FLAG.test(arg))
  if (flag !== -1) return { shell, code: args.slice(flag + 1, flag + 2) }
  if (name === 'deno' && args[0] === 'eval') return { shell, code: args.slice(1, 2) }
  return args.every((arg) => arg.startsWith('-')) ? { shell, code: [...stdin] } : null
}

/**
 * Whether one simple command publishes.
 *
 * `stdin` is every heredoc in the command line, not only this command's own:
 * `cat <<EOF | bash` hands one command's heredoc to the next through the pipe.
 */
function segmentPublishes(
  words: readonly string[],
  stdin: readonly string[],
  depth: number
): boolean {
  if (words.some((word) => /^GIT_CONFIG\w*=/u.test(word))) return true

  let piped = false
  for (const { at, name } of programs(words)) {
    const args = words.slice(at + 1)

    if (envTampers(name, args)) return true
    if (name === 'git') {
      const git = gitCommand(words, at)
      if (git === null) {
        if (piped) return true
      } else if (GIT_PUBLISHES.has(git.command) || gitTampers(git.options, git.command, git.args)) {
        return true
      }
    }
    if (name === 'gh' && ghPublishes(words, at, piped)) return true
    if (name === 'hub' && args.some((arg) => HUB_PUBLISHES.has(arg))) return true
    if (
      HTTP_CLIENTS.has(name) &&
      args.some((arg) => /api\.github\.com/iu.test(arg)) &&
      httpMethod(args, CURL_DATA) !== 'GET'
    ) {
      return true
    }

    const inline = codeOf(words, stdin, at, name)
    if (inline !== null) {
      const publishesIn = inline.shell
        ? (code: string): boolean => publishes(code, depth + 1)
        : (code: string): boolean => MENTIONS.some((pattern) => pattern.test(code))
      if (inline.code.some(publishesIn)) return true
    }
    if (name === 'xargs') piped = true
  }
  return false
}

function publishes(text: string, depth: number): boolean {
  if (depth > MAX_DEPTH) return false
  const { segments, substitutions } = parseCommand(text)
  const stdin = segments.flatMap((segment) => segment.heredocs)
  return (
    segments.some((segment) => segmentPublishes(segment.words, stdin, depth)) ||
    substitutions.some((inside) => publishes(inside, depth + 1))
  )
}

/** The refusal for a shell command that would publish, or null to let it run. */
export function refusesPublish(command: string): string | null {
  return publishes(command, 0) ? PUBLISH_REFUSAL : null
}

/** The refusal for an MCP tool that would publish, or null to let it run. */
export function refusesPublishTool(toolName: string): string | null {
  const action = toolName.slice(toolName.lastIndexOf('__') + 2)
  return MCP_PUBLISHES.has(action) || MCP_PUBLISHING.test(action) ? PUBLISH_REFUSAL : null
}

/**
 * The CLI's own deny rules for the plain forms, and the tool that starts an
 * agent in the cloud, where none of these layers reach.
 *
 * Redundant with `refusesPublish` by design: a deny rule holds in every
 * permission mode and is evaluated by the CLI, so a mistake in the reading
 * above still leaves these standing.
 */
export const PUBLISH_DENY_RULES: readonly string[] = [
  ...[...GIT_PUBLISHES].flatMap((command) => [`Bash(git ${command})`, `Bash(git ${command} *)`]),
  ...[...GH_PR_PUBLISHES].flatMap((action) => [`Bash(gh pr ${action})`, `Bash(gh pr ${action} *)`]),
  'RemoteTrigger'
]

/** Where every push URL is sent instead: a scheme git has no helper for. */
export const PUSH_NOWHERE = 'octopus-agent-push-disabled://'

/** The network forms a remote's URL can take. Local paths are left alone: pushing there publishes nothing. */
const NETWORK_PREFIXES = ['https://', 'http://', 'ssh://', 'git://', 'git@']

/**
 * The environment an agent runs in: the app's own, with every push to the
 * network, and to each of `targets`, rewritten to a URL git cannot open.
 *
 * Through `GIT_CONFIG_COUNT`, which git reads in every process the agent
 * starts and which writes nothing: the user's `.git/config` is shared with
 * their own work in the checkout (`worktree.ts`). `pushInsteadOf` changes the
 * URL for pushing alone, so `git fetch` goes where it always did.
 *
 * `targets` are the workspace's own remote URLs and the user's own rewrite
 * prefixes (`pushTargets`). git takes the longest matching prefix, and on a tie
 * the one read last — and these are read after every config file — so a rule
 * the user wrote, or a remote reached through an ssh alias, cannot route a push
 * past this one. Entries already in `base` are kept, and ours go after them.
 */
export function agentEnv(
  base: Readonly<Record<string, string | undefined>>,
  targets: readonly string[]
): Record<string, string | undefined> {
  const existing = Number.parseInt(base.GIT_CONFIG_COUNT ?? '', 10)
  const from = Number.isInteger(existing) && existing > 0 ? existing : 0
  const prefixes = [...new Set([...NETWORK_PREFIXES, ...targets])]

  const env: Record<string, string | undefined> = { ...base }
  for (const [offset, prefix] of prefixes.entries()) {
    env[`GIT_CONFIG_KEY_${String(from + offset)}`] = `url.${PUSH_NOWHERE}.pushInsteadOf`
    env[`GIT_CONFIG_VALUE_${String(from + offset)}`] = prefix
  }
  env.GIT_CONFIG_COUNT = String(from + prefixes.length)
  return env
}
