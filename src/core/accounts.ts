/**
 * Status of the external accounts the application depends on.
 *
 * Two services matter: Claude (the agent runs on its authentication) and
 * GitHub (pull requests and checks). Both are queried through their own CLI,
 * so the app never handles credentials itself — they stay in the keychain
 * where those tools put them.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { z } from 'zod'

const run = promisify(execFile)

/**
 * Runs an external command.
 *
 * A parameter so account checks can be tested without the real CLIs being
 * installed or signed in.
 */
export type CommandExec = (command: string, args: readonly string[]) => Promise<string>

export const defaultExec: CommandExec = async (command, args) => {
  const { stdout } = await run(command, [...args], { timeout: 15_000 })
  return stdout
}

/** Fields we use from `claude auth status`; the rest is ignored. */
const ClaudeStatusSchema = z.object({
  loggedIn: z.boolean(),
  email: z.string().optional(),
  authMethod: z.string().optional(),
  subscriptionType: z.string().optional(),
  orgName: z.string().optional()
})

/** Fields we use from `gh api user`. */
const GitHubUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable().optional()
})

export interface ClaudeAccount {
  readonly connected: boolean
  readonly email: string | null
  readonly authMethod: string | null
  readonly subscriptionType: string | null
  readonly orgName: string | null
}

export interface GitHubAccount {
  readonly connected: boolean
  readonly login: string | null
  readonly name: string | null
}

export interface AccountsStatus {
  readonly claude: ClaudeAccount
  readonly github: GitHubAccount
}

const DISCONNECTED_CLAUDE: ClaudeAccount = {
  connected: false,
  email: null,
  authMethod: null,
  subscriptionType: null,
  orgName: null
}

const DISCONNECTED_GITHUB: GitHubAccount = { connected: false, login: null, name: null }

/**
 * Reads the Claude account state.
 *
 * A missing CLI, a failing command or unparsable output all mean the same
 * thing to the user — not connected — so they collapse into one result
 * rather than surfacing as an error.
 */
export async function checkClaudeAccount(exec: CommandExec = defaultExec): Promise<ClaudeAccount> {
  let raw: string
  try {
    raw = await exec('claude', ['auth', 'status'])
  } catch {
    return DISCONNECTED_CLAUDE
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DISCONNECTED_CLAUDE
  }

  const result = ClaudeStatusSchema.safeParse(parsed)
  if (!result.success || !result.data.loggedIn) return DISCONNECTED_CLAUDE

  return {
    connected: true,
    email: result.data.email ?? null,
    authMethod: result.data.authMethod ?? null,
    subscriptionType: result.data.subscriptionType ?? null,
    orgName: result.data.orgName ?? null
  }
}

/** Reads the GitHub account state through `gh`. */
export async function checkGitHubAccount(exec: CommandExec = defaultExec): Promise<GitHubAccount> {
  let raw: string
  try {
    raw = await exec('gh', ['api', 'user'])
  } catch {
    return DISCONNECTED_GITHUB
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DISCONNECTED_GITHUB
  }

  const result = GitHubUserSchema.safeParse(parsed)
  if (!result.success) return DISCONNECTED_GITHUB

  return {
    connected: true,
    login: result.data.login,
    name: result.data.name ?? null
  }
}

/** Both accounts at once — they are independent, so the checks run in parallel. */
export async function checkAccounts(exec: CommandExec = defaultExec): Promise<AccountsStatus> {
  const [claude, github] = await Promise.all([checkClaudeAccount(exec), checkGitHubAccount(exec)])
  return { claude, github }
}

/** Which account a sign-in or sign-out request refers to. */
export const AccountKindSchema = z.enum(['claude', 'github'])
export type AccountKind = z.infer<typeof AccountKindSchema>

export const AuthActionSchema = z.enum(['login', 'logout'])
export type AuthAction = z.infer<typeof AuthActionSchema>

/** A rejected sign-in request — the arguments were not what the contract allows. */
export class InvalidAuthRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAuthRequestError'
  }
}

/**
 * The command that signs a user in.
 *
 * Both CLIs prompt for input here, so this one is meant to run in a terminal
 * the user can type into.
 *
 * Arguments are validated at runtime rather than trusted from their types.
 * They arrive over IPC, where TypeScript guarantees nothing: a compromised or
 * simply buggy renderer can send anything, and the result ends up in a command
 * line. This is the same boundary rule the rest of the core follows (§11.3).
 */
export function signInCommand(kind: unknown): readonly string[] {
  return [cliFor(kind), 'auth', 'login']
}

/**
 * The command that signs a user out.
 *
 * Unlike signing in, this asks nothing — provided `gh` is told which account
 * to drop, which it otherwise prompts for. That is why signing out runs
 * silently instead of opening a terminal.
 *
 * `login` is only used for GitHub and is validated as a plain account name;
 * anything unexpected is dropped rather than passed to a command line.
 */
export function signOutCommand(kind: unknown, login?: string | null): SignOutCommand {
  const cli = cliFor(kind)
  if (cli === 'claude') return { command: 'claude', args: ['auth', 'logout'] }

  const args = ['auth', 'logout', '--hostname', 'github.com']
  return {
    command: 'gh',
    args: isPlainAccountName(login) ? [...args, '--user', login] : args
  }
}

/** Command and arguments kept apart, so no indexed access is needed to run it. */
export interface SignOutCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** GitHub account names are alphanumerics and hyphens; nothing else is accepted. */
function isPlainAccountName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(value)
}

function cliFor(kind: unknown): 'claude' | 'gh' {
  const parsed = AccountKindSchema.safeParse(kind)
  if (!parsed.success) {
    throw new InvalidAuthRequestError(`Unknown account: ${JSON.stringify(kind)}`)
  }
  return parsed.data === 'claude' ? 'claude' : 'gh'
}

/**
 * Runs a sign-out and reports whether the account is gone afterwards.
 *
 * Verifying by re-reading the status rather than trusting the exit code: the
 * CLIs can report success while leaving an account behind, and the UI should
 * show what is actually true.
 */
export async function signOut(
  kind: AccountKind,
  login: string | null,
  exec: CommandExec = defaultExec
): Promise<boolean> {
  const { command, args } = signOutCommand(kind, login)

  try {
    await exec(command, args)
  } catch {
    // Fall through: the check below decides, not the exit code.
  }

  const account =
    kind === 'claude' ? await checkClaudeAccount(exec) : await checkGitHubAccount(exec)
  return !account.connected
}
