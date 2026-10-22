import type { TFunction } from 'i18next'

import type { EnvProblem } from '@core/envBlock.js'
import type { InstructionKind } from '@core/instructions.js'
import type { LastRun, RunPurpose } from '@core/runLog.js'
import { SCRIPT_KINDS } from '@core/scriptEnv.js'
import type { HelpContext } from '@core/service.js'

import { formatClock } from './chat/format.js'

/** The two things Help can be asked, each an instruction kind of its own. */
export type HelpKind = Extract<InstructionKind, 'setupScripts' | 'diagnoseRun'>

function problemLine(problem: EnvProblem, t: TFunction): string {
  const { line, subject } = problem
  switch (problem.reason) {
    // Never the subject for these: it is text from the line, which may be a value.
    case 'noAssignment':
      return t('help.context.problemNoAssignment', { line })
    case 'badName':
      return t('help.context.problemBadName', { line })
    case 'duplicate':
      return t('help.context.problemDuplicate', { line, subject })
    case 'unknownVariable':
      return t('help.context.problemUnknownVariable', { line, subject })
    case 'marker':
      return t('help.context.problemMarker', { line })
  }
}

const STAGES = { setup: 'scripts.build', run: 'scripts.server' } as const satisfies Record<
  RunPurpose,
  string
>

function runHeader({ purpose, outcome }: LastRun, t: TFunction): string {
  const stage = t(STAGES[purpose])
  switch (outcome.kind) {
    case 'running':
      return t('help.context.lastRunRunning', { stage })
    case 'exited': {
      const at = formatClock(outcome.at)
      return outcome.exitCode === null
        ? t('help.context.lastRunStopped', { stage, at })
        : t('help.context.lastRun', { stage, at, code: outcome.exitCode })
    }
  }
}

function runPart(run: LastRun, t: TFunction): string {
  const output = run.output === '' ? t('help.context.noOutput') : run.output
  return `${runHeader(run, t)}\n\n\`\`\`\n${output}\n\`\`\``
}

/** What a workspace has in place: one block, the same for both kinds. */
function factsPart(context: HelpContext, t: TFunction): string {
  const { scripts } = context.scripts
  const names = [...context.variableNames].sort()

  const lines = [
    t('help.context.heading'),
    '',
    t('help.context.checkout', { path: context.rootPath }),
    t('help.context.envFile', { name: context.envFile }),
    t('help.context.profile', { name: context.profile }),
    names.length === 0
      ? t('help.context.noVariables')
      : t('help.context.variables', { names: names.join(', ') }),
    '',
    t('help.context.scripts'),
    ...SCRIPT_KINDS.map((kind) => {
      const script = scripts[kind]
      return script
        ? t('help.context.script', { kind, from: script.from })
        : t('help.context.scriptMissing', { kind })
    })
  ]

  // Only a repository's scripts wait to be allowed: nothing supplied is approved.
  if (!context.scripts.approved) lines.push(t('help.context.unapproved'))

  lines.push('')
  if (context.carry.length === 0) lines.push(t('help.context.noCarry'))
  else lines.push(t('help.context.carry'), ...context.carry.map((path) => `- ${path}`))

  if (context.envProblems.length > 0) {
    lines.push(
      '',
      t('help.context.problems'),
      ...context.envProblems.map((problem) => problemLine(problem, t))
    )
  }

  return lines.join('\n')
}

/**
 * The message Help puts in the composer: the instruction, then what octopus
 * knows that the agent could not find for itself.
 *
 * One message, as the pull request pane sends its prompts, so the whole of
 * what the agent is told is one thing the reader sees before sending it (§4).
 * An instruction emptied in the settings leaves the facts alone.
 */
export function helpMessage(
  kind: HelpKind,
  instruction: string,
  context: HelpContext,
  t: TFunction
): string {
  const parts = [instruction.trim(), factsPart(context, t)]

  if (kind === 'diagnoseRun') {
    const { lastRuns } = context
    if (lastRuns.length === 0) parts.push(t('help.context.noRun'))
    else parts.push(...lastRuns.map((run) => runPart(run, t)))
  }

  return parts.filter((part) => part !== '').join('\n\n')
}
