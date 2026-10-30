/**
 * Checks, against a live session, the two things the context panel and the
 * compaction rows take from the CLI on trust:
 *
 * - that `getContextUsage` still answers with a breakdown `contextBreakdown.ts`
 *   can read — its fixtures were written from `sdk.d.ts`, and the CLI is
 *   versioned apart from the package;
 * - that a `/compact` still reaches the log as a `compaction_summary`, which
 *   only the CLI's `PostCompact` hook carries (`compactionWatch` in `agent.ts`).
 *
 * Nothing in the test suite can: it never starts a session. Run after
 * upgrading `@anthropic-ai/claude-agent-sdk`:
 *
 *   npm run probe:compaction
 *
 * It needs the CLI's own login and costs two short turns and one compaction. It
 * works in a throwaway repository under the system's temporary directory, writes
 * the raw replies beside it for comparison with the fixtures, and exits non-zero
 * when either check fails.
 */

import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { startSession } from '../src/core/agent.js'
import { breakdownFrom } from '../src/core/contextBreakdown.js'

const run = promisify(execFile)
const repo = await realpath(await mkdtemp(join(tmpdir(), 'octopus-compaction-probe-')))
const replies = await realpath(await mkdtemp(join(tmpdir(), 'octopus-compaction-replies-')))
await writeFile(join(repo, 'CLAUDE.md'), '# Probe\n\nAnswer in one word.\n')
await run('git', ['init', '-q'], { cwd: repo })
await run('git', ['add', '-A'], { cwd: repo })
await run('git', ['commit', '-q', '-m', 'start'], { cwd: repo })

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

let live: Query | null = null
let stage: 'first turn' | 'compaction' = 'first turn'
let breakdownRead = false
const summaries: string[] = []

const finish = (): void => {
  const passed = breakdownRead && summaries.length > 0
  say(breakdownRead ? 'PASS: the context reply has a breakdown' : 'FAIL: no breakdown read')
  say(
    summaries.length > 0
      ? 'PASS: a /compact is announced with what was kept'
      : 'FAIL: no compaction_summary arrived'
  )
  say(`raw replies in ${replies}`)
  void session
    .close()
    .then(() => rm(repo, { recursive: true, force: true }))
    .then(() => {
      process.exit(passed ? 0 : 1)
    })
}

const afterFirstTurn = async (): Promise<void> => {
  if (live === null) return
  const reply: unknown = await live.getContextUsage()
  await writeFile(join(replies, 'context-usage.json'), JSON.stringify(reply, null, 2))
  const breakdown = breakdownFrom(reply)
  breakdownRead = breakdown !== null
  say(`breakdown: ${JSON.stringify(breakdown)}`)

  stage = 'compaction'
  session.send('/compact keep only the word banana')
}

const session = startSession(
  {
    cwd: repo,
    resume: null,
    resumeAt: null,
    settingSources: ['project'],
    permissionMode: 'default',
    model: null,
    effort: 'low',
    allowedTools: [],
    additionalDirectories: [],
    pushTargets: [],
    env: {},
    skillOverrides: {},
    autoCompactWindow: null,
    agentProgressSummaries: false
  },
  {
    // Kept so the raw reply can be written out beside the parsed one.
    query: (params) => {
      live = query(params)
      return live
    },
    onEvent: (event) => {
      if (event.type === 'compaction_summary') {
        summaries.push(event.summary)
        void writeFile(join(replies, 'compaction-summary.txt'), event.summary)
        say(`compaction_summary: ${event.summary.slice(0, 120)}…`)
      }
      if (event.type === 'error') say(`error: ${event.message}`)
      if (event.type === 'result' || event.type === 'error') {
        if (stage === 'first turn') void afterFirstTurn()
        else finish()
      }
    },
    askPermission: () => Promise.resolve({ allow: true }),
    askElicitation: () => Promise.resolve({ action: 'cancel' })
  }
)

session.send('Reply with the single word banana.')

setTimeout(() => {
  say('timed out waiting for the compaction')
  finish()
}, 240_000)
