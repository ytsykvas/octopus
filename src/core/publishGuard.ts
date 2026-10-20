import { commandName, gitCommand, parseCommand } from './shellCommand.js'

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
 * 1. `refusesPublish` reads the command text, inside quotes too, before it runs.
 * 2. `PUBLISH_DENY_RULES` are the CLI's own deny rules: they hold in every mode
 *    and catch the plain forms should the reading above ever miss one.
 * 3. `agentEnv` makes every `git push` the agent's process tree makes fail,
 *    whatever wrote it — a script on disk, `python -c`, `/usr/bin/git`.
 *
 * Without an OS sandbox, an agent set on getting round all three can: it can
 * clear the environment it was given. What the layers guarantee is that it
 * never happens by accident, and that every known way round is refused by name.
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

/** `gh` options that take their value as the next word. */
const GH_VALUE_OPTIONS = new Set(['-R', '--repo', '--hostname'])

/** Programs whose argument is more shell, or a program — read for what it mentions. */
const OPAQUE = new Set([
  'bash',
  'sh',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'eval',
  'source',
  '.',
  'exec',
  'xargs',
  'python',
  'python3',
  'node',
  'deno',
  'bun',
  'perl',
  'ruby',
  'php',
  'osascript'
])

/**
 * Text that touches the mechanism `agentEnv` relies on, or a push URL.
 *
 * Measured against git 2.54: `GIT_CONFIG_COUNT=0`, a longer `pushInsteadOf`
 * passed with `-c`, and an explicit `pushurl` each take a push past the
 * environment. None has a use in a workspace's work, so all are refused.
 */
const TAMPERS = /insteadof|pushurl|git_config|hookspath/iu

/** What a publishing command looks like inside a script or string the shell will run. */
const MENTIONS = [
  /\bgit\b[\s\S]*\b(?:push|send-pack)\b/u,
  /\bgh\b[\s\S]*\bpr\b[\s\S]*\b(?:create|merge|close|reopen|ready)\b/u,
  /pull_?request|createPullRequest|mergePullRequest|\/pulls\b/iu
]

/** How far into nested quotes the reading goes: `bash -c "sh -c '…'"` is two. */
const MAX_DEPTH = 4

/** The positional words after `gh`, its own `-R repo` style options skipped. */
function ghWords(args: readonly string[]): string[] {
  const positional: string[] = []
  let value = false
  for (const arg of args) {
    if (value) value = false
    else if (GH_VALUE_OPTIONS.has(arg)) value = true
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  return positional
}

/** The HTTP method `gh api` will use: GET unless told, or unless it is given fields. */
function ghApiMethod(args: readonly string[]): string {
  for (const [at, arg] of args.entries()) {
    if (arg === '-X' || arg === '--method') return (args[at + 1] ?? '').toUpperCase()
    if (arg.startsWith('--method=')) return arg.slice('--method='.length).toUpperCase()
    if (arg.startsWith('-X') && arg.length > 2) return arg.slice(2).toUpperCase()
  }
  const sendsFields = args.some((arg) => /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)/u.test(arg))
  return sendsFields ? 'POST' : 'GET'
}

function ghPublishes(args: readonly string[]): boolean {
  const [group, action] = ghWords(args)
  if (group === 'pr') return action !== undefined && GH_PR_PUBLISHES.has(action)
  if (group !== 'api') return false

  // GraphQL is always a POST, so the query is what says whether it writes.
  if (action === 'graphql') return args.some((arg) => /\bmutation\b/u.test(arg))
  return ghApiMethod(args) !== 'GET'
}

/** Whether one simple command publishes, wherever in it `git` or `gh` starts. */
function segmentPublishes(argv: readonly string[]): boolean {
  return argv.some((word, at) => {
    const name = commandName(word)
    if (name === 'gh') return ghPublishes(argv.slice(at + 1))
    const git = gitCommand(argv, at)
    if (git === null) return false
    if (GIT_PUBLISHES.has(git.command)) return true
    // `git remote set-url --push` writes the push URL `TAMPERS` cannot see.
    return git.command === 'remote' && git.args.includes('--push')
  })
}

function publishes(text: string, depth: number): boolean {
  if (TAMPERS.test(text)) return true

  const { segments, quoted } = parseCommand(text)
  if (segments.some(segmentPublishes)) return true

  // An interpreter's argument is a program this reading cannot follow, so it
  // is judged by what it names.
  const interpreted = segments.filter((argv) => argv.some((word) => OPAQUE.has(commandName(word))))
  if (interpreted.some((argv) => MENTIONS.some((pattern) => pattern.test(argv.join(' '))))) {
    return true
  }

  // A quoted string is read as a command only where the shell will run it:
  // under an interpreter, or holding `$(…)` or backticks. Everywhere else it is
  // data — `git commit -m "gh pr create is the user's"` publishes nothing.
  const runs = (inside: string): boolean => interpreted.length > 0 || /\$\(|`/u.test(inside)
  return depth < MAX_DEPTH && quoted.some((inside) => runs(inside) && publishes(inside, depth + 1))
}

/** The refusal for a shell command that would publish, or null to let it run. */
export function refusesPublish(command: string): string | null {
  return publishes(command, 0) ? PUBLISH_REFUSAL : null
}

/** MCP tool names, after the last `__`, that publish — GitHub's server spells them so. */
const MCP_PUBLISHES = new Set([
  'create_pull_request',
  'merge_pull_request',
  'update_pull_request_branch',
  'push_files',
  'create_or_update_file',
  'delete_file',
  'create_branch'
])

/** The refusal for an MCP tool that would publish, or null to let it run. */
export function refusesPublishTool(toolName: string): string | null {
  const action = toolName.slice(toolName.lastIndexOf('__') + 2)
  return MCP_PUBLISHES.has(action) ? PUBLISH_REFUSAL : null
}

/**
 * The CLI's own deny rules for the plain forms.
 *
 * Redundant with `refusesPublish` by design: a deny rule holds in every
 * permission mode and is evaluated by the CLI, so a mistake in the reading
 * above still leaves these standing.
 */
export const PUBLISH_DENY_RULES: readonly string[] = [
  'Bash(git push)',
  'Bash(git push *)',
  'Bash(gh pr create *)',
  'Bash(gh pr merge *)',
  'Bash(gh pr close *)',
  'Bash(gh pr ready *)',
  'Bash(gh pr reopen *)'
]

/** Where every push URL is sent instead: a scheme git has no helper for. */
const PUSH_NOWHERE = 'octopus-agent-push-disabled://'

/** Every URL form a remote can take, each rewritten for pushing only. */
const PUSH_PREFIXES = ['https://', 'http://', 'ssh://', 'git://', 'git@', 'file://', '/']

/**
 * The environment an agent runs in: the app's own, with every push rewritten
 * to a URL git cannot open.
 *
 * Through `GIT_CONFIG_COUNT`, which git reads in every process the agent
 * starts and which writes nothing: the user's `.git/config` is shared with
 * their own work in the checkout (`worktree.ts`). `pushInsteadOf` changes the
 * URL for pushing alone, so `git fetch` — which resolving a conflict needs —
 * goes where it always did. Entries already in `base` are kept, and ours go
 * after them.
 */
export function agentEnv(
  base: Readonly<Record<string, string | undefined>>
): Record<string, string | undefined> {
  const existing = Number.parseInt(base.GIT_CONFIG_COUNT ?? '', 10)
  const from = Number.isInteger(existing) && existing > 0 ? existing : 0

  const env: Record<string, string | undefined> = { ...base }
  for (const [offset, prefix] of PUSH_PREFIXES.entries()) {
    env[`GIT_CONFIG_KEY_${String(from + offset)}`] = `url.${PUSH_NOWHERE}.pushInsteadOf`
    env[`GIT_CONFIG_VALUE_${String(from + offset)}`] = prefix
  }
  env.GIT_CONFIG_COUNT = String(from + PUSH_PREFIXES.length)
  return env
}
