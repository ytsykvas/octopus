import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { gitCommand, parseCommand } from './shellCommand.js'

/**
 * Keeps an agent on its workspace's branch.
 *
 * A workspace is one branch and one pull request: the request, the Changes tab
 * and the push button are all found by the branch's name. An agent that ran
 * `git checkout -b` inside one left all three empty while the work went to a
 * request the app could not see — which happened, three times in one session,
 * with the rule written in the instructions it had read. So it is refused
 * rather than asked for.
 *
 * Read from the command's text, which is all a hook is given. The forms below
 * are the ones an agent reaches for; a switch buried in a script it runs is out
 * of reach, and the Changes tab's warning about HEAD is what catches that.
 */

/** `git checkout` flags that always leave the branch. */
const CHECKOUT_LEAVES = new Set(['-b', '-B', '--orphan', '--detach'])
/** `git switch` flags that make or leave for another branch. */
const SWITCH_LEAVES = new Set(['-c', '-C', '--create', '--force-create', '--orphan', '--detach'])
/** `git branch` flags that rename — and the branch renamed is the one the app tracks. */
const BRANCH_RENAMES = new Set(['-m', '-M', '--move'])

/** The words that name something to move to: `-` alone is "the previous branch". */
function targets(args: readonly string[]): string[] {
  return args.filter((arg) => arg === '-' || !arg.startsWith('-'))
}

/** The value of `--head x`, `--head=x` or `-H x`, if the command has one. */
function headOf(args: readonly string[]): string | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith('--head=')) return arg.slice('--head='.length)
    if (arg === '--head' || arg === '-H') return args[index + 1]
  }
  return undefined
}

function partLeaves(
  argv: readonly string[],
  branch: string,
  isPath: (arg: string) => boolean
): boolean {
  if (argv[0] === 'gh' && argv[1] === 'pr' && argv[2] === 'create') {
    const head = headOf(argv.slice(3))
    return head !== undefined && head !== branch
  }

  const git = gitCommand(argv)
  switch (git?.command) {
    case 'checkout':
      if (git.args.some((arg) => CHECKOUT_LEAVES.has(arg))) return true
      // After `--` everything is a path: this is putting files back.
      if (git.args.includes('--')) return false
      // `checkout` does both jobs, so a word that is a file here is a restore.
      return targets(git.args).some((target) => target !== branch && !isPath(target))
    case 'switch':
      return (
        git.args.some((arg) => SWITCH_LEAVES.has(arg)) ||
        targets(git.args).some((target) => target !== branch)
      )
    case 'branch':
      return git.args.some((arg) => BRANCH_RENAMES.has(arg))
    default:
      return false
  }
}

/**
 * Whether a shell command would take the worktree off `branch`, rename it, or
 * open a pull request from another one.
 *
 * Going back to `branch` is allowed: that is how a worktree already moved is
 * put right.
 */
export function leavesBranch(
  command: string,
  branch: string,
  isPath: (arg: string) => boolean
): boolean {
  return parseCommand(command).segments.some((argv) => partLeaves(argv, branch, isPath))
}

/** What the agent is told, as the reason its command was refused. */
export function branchGuardMessage(branch: string): string {
  return (
    `This workspace is one branch and one pull request: ${branch}. ` +
    'Octopus keeps you on it — commit here rather than creating or switching branches, ' +
    'and leave separate work for another Octopus workspace.'
  )
}

/**
 * The refusal for a command run in the worktree at `root`, or null to let it run.
 *
 * `branch` is asked each time rather than passed once: a workspace renamed
 * while its conversation runs has a new branch, and a null means it is gone.
 */
export function branchGuard(
  branch: () => string | null,
  root: string
): (command: string) => string | null {
  return (command) => {
    const current = branch()
    if (current === null) return null

    const isPath = (arg: string): boolean => existsSync(join(root, arg))
    return leavesBranch(command, current, isPath) ? branchGuardMessage(current) : null
  }
}
