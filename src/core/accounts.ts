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

/**
 * An executor that gives up after `timeout` milliseconds.
 *
 * A factory rather than one constant, because how long is worth waiting depends
 * on who is waiting. A check running behind the Settings card can take its
 * time; one behind a button press cannot.
 */
export function execWithin(timeout: number): CommandExec {
  return async (command, args) => {
    const { stdout } = await run(command, [...args], { timeout })
    return stdout
  }
}

export const defaultExec: CommandExec = execWithin(15_000)

/**
 * How long a check behind a button press may take.
 *
 * Short because the answer is not the point of the click — it decides whether
 * the repository picker opens or Settings does, and a check that has not
 * answered in three seconds has told us enough to act on. Fifteen left the
 * button disabled and reading "Checking GitHub…" for a quarter of a minute on
 * a bad connection.
 */
export const BUTTON_TIMEOUT_MS = 3_000

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

/**
 * Fields we use from `gh auth status --json hosts`.
 *
 * The prose form of the same command prints `Token scopes: 'gist', 'repo'`,
 * and parsing that would break on the next release that reflows a line. The
 * JSON form is a documented output format, so it is the one read here.
 *
 * Everything is optional because an older `gh` answers with fewer fields, and
 * the caller treats a missing one as "we were not told" rather than as "there
 * are none".
 */
const GitHubStatusSchema = z.object({
  hosts: z.record(
    z.string(),
    z.array(z.object({ active: z.boolean().optional(), scopes: z.string().optional() }))
  )
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
  /**
   * Whether this token can see the account's organisations — `null` when we
   * could not be told.
   *
   * The answer rather than the scope list it is read from, because the list is
   * the only thing this would carry over IPC and nothing on the other side has
   * a second use for it.
   *
   * `null` covers three cases deliberately: an older `gh` with no `--json` on
   * `auth status`, a call that failed, and an answer naming no scopes at all —
   * which is what a fine-grained token gives, and such a token can reach an
   * organisation without holding a single classic scope. Reading any of those
   * as `false` would put a confident wrong sentence on screen; `null` says
   * nothing, which is the only honest answer to a question nobody answered.
   */
  readonly seesOrganisations: boolean | null
}

/**
 * The scope an account needs before GitHub will name its organisations.
 *
 * Without it `gh` answers as though the account belonged to none, which looks
 * exactly like belonging to none.
 */
const ORGANISATION_SCOPE = 'read:org'

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

const DISCONNECTED_GITHUB: GitHubAccount = {
  connected: false,
  login: null,
  name: null,
  seesOrganisations: null
}

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

/**
 * Reads the scopes on the token `gh` is signed in with.
 *
 * `null` for anything short of a clear answer — see `GitHubAccount.scopes` for
 * why an empty result is not reported as an empty list.
 */
export async function readTokenScopes(exec: CommandExec = defaultExec): Promise<string[] | null> {
  let raw: string
  try {
    // `--active` because a host can hold several accounts and only one of them
    // is the token `gh api` will use; the hostname because everything else in
    // this module is github.com only.
    raw = await exec('gh', [
      'auth',
      'status',
      '--active',
      '--hostname',
      'github.com',
      '--json',
      'hosts'
    ])
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = GitHubStatusSchema.safeParse(parsed)
  if (!result.success) return null

  const [account] = Object.values(result.data.hosts).flat()
  const scopes = (account?.scopes ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope) => scope !== '')

  return scopes.length > 0 ? scopes : null
}

/**
 * Reads the GitHub account state through `gh`.
 *
 * The two calls run together rather than one after the other: the second is
 * only ever read beside the first, and this check sits behind a button with a
 * three-second budget that a second round trip would have spent twice.
 */
export async function checkGitHubAccount(exec: CommandExec = defaultExec): Promise<GitHubAccount> {
  const [raw, scopes] = await Promise.all([
    exec('gh', ['api', 'user']).catch(() => null),
    readTokenScopes(exec)
  ])

  if (raw === null) return DISCONNECTED_GITHUB

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
    name: result.data.name ?? null,
    seesOrganisations: scopes === null ? null : scopes.includes(ORGANISATION_SCOPE)
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
