import { describe, expect, it } from 'vitest'

import type { LastRun } from '@core/runLog.js'
import type { HelpContext } from '@core/service.js'

import i18n from '../i18n/index.js'
import { formatClock } from './chat/format.js'
import { helpMessage } from './helpMessage.js'

const t = i18n.t.bind(i18n)

function context(overrides: Partial<HelpContext> = {}): HelpContext {
  return {
    rootPath: '/Users/someone/planner',
    envFile: '.env',
    profile: 'default',
    variableNames: ['DB_NAME', 'API_KEY'],
    envProblems: [],
    carry: ['.env', 'config/master.key'],
    scripts: {
      approved: true,
      digest: '',
      scripts: {
        run: {
          kind: 'run',
          source: 'repoOctopus',
          from: '.octopus/scripts/run.sh',
          path: '/w/.octopus/scripts/run.sh',
          contents: '#!/bin/sh\n'
        }
      }
    },
    lastRuns: [],
    ...overrides
  }
}

const ENDED = '2026-10-22T09:41:00.000Z'

const BUILD: LastRun = {
  purpose: 'setup',
  outcome: { kind: 'exited', at: ENDED, exitCode: 1 },
  output: 'error: no db'
}
const SERVER: LastRun = { purpose: 'run', outcome: { kind: 'running' }, output: 'listening' }

describe('helpMessage', () => {
  it('puts the instruction first and the facts under it', () => {
    const message = helpMessage('setupScripts', '  Set it up.\n', context(), t)

    expect(message).toBe(
      [
        'Set it up.',
        [
          '— What octopus knows about this workspace —',
          '',
          'Checkout ($OCTOPUS_ROOT_PATH): /Users/someone/planner',
          'Env file the env set is written into: .env',
          'Env set in effect: default',
          'Variables it gives the scripts (names only; the values stay in octopus): API_KEY, DB_NAME',
          '',
          'Scripts in effect:',
          '- setup: none',
          '- run: .octopus/scripts/run.sh',
          '- archive: none',
          '',
          'Files carried into the workspace before a run:',
          '- .env',
          '- config/master.key'
        ].join('\n')
      ].join('\n\n')
    )
  })

  // Setting up is about what is in place, not about a run that may never have happened.
  it('says nothing about runs when asked to set the project up', () => {
    expect(helpMessage('setupScripts', 'x', context({ lastRuns: [BUILD] }), t)).not.toContain(
      'error: no db'
    )
  })

  it('leaves the facts alone when the instruction was emptied', () => {
    expect(helpMessage('setupScripts', '   ', context(), t)).toMatch(/^— What octopus/)
  })

  it('says so where nothing is defined or carried', () => {
    const message = helpMessage('setupScripts', 'x', context({ variableNames: [], carry: [] }), t)

    expect(message).toContain('The env set in effect defines no variables.')
    expect(message).toContain('No files are carried into the workspace.')
  })

  it('says why Run is disabled where the repository’s scripts wait to be allowed', () => {
    const waiting = context({ scripts: { ...context().scripts, approved: false, digest: 'abc' } })

    expect(helpMessage('setupScripts', 'x', waiting, t)).toContain('not been allowed yet')
    expect(helpMessage('setupScripts', 'x', context(), t)).not.toContain('allowed')
  })

  it('names each problem in the env set, and the ones about text from the line by number alone', () => {
    const message = helpMessage(
      'setupScripts',
      'x',
      context({
        envProblems: [
          { line: 2, reason: 'noAssignment', subject: 'sk-live-pasted-token' },
          { line: 3, reason: 'badName', subject: 'DATABASE_URL: postgres://app:hunter2@db' },
          { line: 4, reason: 'duplicate', subject: 'A' },
          { line: 5, reason: 'unknownVariable', subject: 'OCTOPUS_PROT' },
          { line: 6, reason: 'marker', subject: '# >>> octopus' }
        ]
      }),
      t
    )

    expect(message).toContain(
      [
        'Problems in the env set:',
        '- line 2 is not an assignment',
        '- line 3: what comes before "=" is not a name a parser accepts',
        '- line 4: A is set twice, and only the last one counts',
        '- line 5: $OCTOPUS_PROT is not a variable octopus sets',
        '- line 6: an octopus marker was pasted in'
      ].join('\n')
    )
    expect(message).not.toContain('sk-live-pasted-token')
    expect(message).not.toContain('hunter2')
  })

  it('adds the build and then the server, each with its last lines fenced', () => {
    const message = helpMessage('diagnoseRun', 'Why?', context({ lastRuns: [BUILD, SERVER] }), t)

    const build = `Build ended at ${formatClock(ENDED)} with exit code 1. Its last lines:\n\n\`\`\`\nerror: no db\n\`\`\``
    const server = 'Server is still running. Its last lines so far:\n\n```\nlistening\n```'
    expect(message.endsWith(`\n\n${build}\n\n${server}`)).toBe(true)
  })

  it('tells a run a signal ended from one that failed, and one that printed nothing', () => {
    const stopped: LastRun = {
      purpose: 'run',
      outcome: { kind: 'exited', at: ENDED, exitCode: null },
      output: ''
    }

    expect(helpMessage('diagnoseRun', 'Why?', context({ lastRuns: [stopped] }), t)).toContain(
      `Server was ended by a signal at ${formatClock(ENDED)}. Its last lines:\n\n\`\`\`\n(it printed nothing)\n\`\`\``
    )
  })

  it('asks for a run first where there has been none', () => {
    expect(helpMessage('diagnoseRun', 'Why?', context(), t)).toMatch(
      /Nothing has been run in this workspace since octopus started\. .*$/
    )
  })
})
