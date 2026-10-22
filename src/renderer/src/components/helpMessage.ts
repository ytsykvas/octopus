import type { TFunction } from 'i18next'

import type { EnvProblem } from '@core/envBlock.js'
import type { InstructionKind } from '@core/instructions.js'
import type { LastRun } from '@core/runLog.js'
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

function runPart(run: LastRun, t: TFunction): string {
  const stage = t(run.purpose === 'setup' ? 'scripts.build' : 'scripts.server')
  const header =
    run.endedAt === null
      ? t('help.context.lastRunRunning', { stage })
      : run.exitCode === null
        ? t('help.context.lastRunStopped', { stage, at: formatClock(run.endedAt) })
        : t('help.context.lastRun', { stage, at: formatClock(run.endedAt), code: run.exitCode })
  const output = run.output === '' ? t('help.context.noOutput') : run.output

  return `${header}\n\n\`\`\`\n${output}\n\`\`\``
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
  lastRuns: readonly LastRun[],
  t: TFunction
): string {
  const runs =
    kind === 'diagnoseRun'
      ? lastRuns.length === 0
        ? [t('help.context.noRun')]
        : lastRuns.map((run) => runPart(run, t))
      : []

  return [instruction.trim(), factsPart(context, t), ...runs]
    .filter((part) => part !== '')
    .join('\n\n')
}
