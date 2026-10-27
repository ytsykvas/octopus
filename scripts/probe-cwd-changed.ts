/**
 * Checks, against a live session, that a `cd` in the agent's shell still
 * reaches the log as a `cwd_changed` event.
 *
 * Nothing in the test suite can: the SDK's `CwdChanged` callback runs only
 * beside a command hook for the same event in the session's settings
 * (`CWD_WATCH_SETTINGS` in `agent.ts`), which was measured rather than read
 * in any document, so an SDK upgrade may change it in either direction while
 * every test stays green. Run after upgrading `@anthropic-ai/claude-agent-sdk`:
 *
 *   npm run probe:cwd
 *
 * It needs the CLI's own login, works in a throwaway repository under the
 * system's temporary directory, and exits non-zero when the move went unsaid.
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { startSession } from '../src/core/agent.js'

const run = promisify(execFile)
const repo = await realpath(await mkdtemp(join(tmpdir(), 'octopus-cwd-probe-')))
await run('git', ['init', '-q'], { cwd: repo })
await run('git', ['commit', '-q', '--allow-empty', '-m', 'start'], { cwd: repo })
await mkdir(join(repo, 'sub'))

const moves: string[] = []
const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const finish = (ok: boolean): void => {
  const expected = [`${repo} -> ${join(repo, 'sub')}`, `${join(repo, 'sub')} -> ${repo}`]
  const passed = ok && moves.join('\n') === expected.join('\n')
  say(`CwdChanged fired ${String(moves.length)} time(s)${moves.length > 0 ? ':' : ''}`)
  for (const move of moves) say(`  ${move}`)
  say(passed ? 'PASS: a cd in the shell is still announced' : 'FAIL: a cd in the shell went unsaid')
  void session
    .close()
    .then(() => rm(repo, { recursive: true, force: true }))
    .then(() => {
      process.exit(passed ? 0 : 1)
    })
}

const session = startSession(
  {
    cwd: repo,
    resume: null,
    resumeAt: null,
    settingSources: [],
    permissionMode: 'default',
    model: null,
    effort: 'low',
    allowedTools: ['Bash'],
    additionalDirectories: [],
    pushTargets: [],
    env: {},
    skillOverrides: {},
    autoCompactWindow: null,
    agentProgressSummaries: false
  },
  {
    query,
    onEvent: (event) => {
      if (event.type === 'cwd_changed') moves.push(`${event.from} -> ${event.to}`)
      if (event.type === 'error') say(`error: ${event.message}`)
      if (event.type === 'result' || event.type === 'error')
        finish(event.type === 'result' && event.ok)
    },
    askPermission: () => Promise.resolve({ allow: true }),
    askElicitation: () => Promise.resolve({ action: 'cancel' })
  }
)

session.send(
  'Run exactly two Bash calls and nothing else: first `cd sub && pwd`, then `cd .. && pwd`. Then reply with the single word done.'
)

setTimeout(() => {
  say('timed out waiting for the turn to end')
  finish(false)
}, 180_000)
