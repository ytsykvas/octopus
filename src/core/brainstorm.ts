/**
 * Not a chat: nothing of it is kept, and its agent has no tool that writes. The user's hooks still
 * run, as in any session; the cards are written by the board from what the person approved.
 */
import { randomUUID } from 'node:crypto'

import { createSdkMcpServer, type SettingSource, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

import {
  ABANDONED,
  type AgentSession,
  type PermissionAsk,
  type PermissionOutcome,
  type QueryFn,
  READ_ONLY_TOOLS,
  startSession
} from './agent.js'
import { CARD_PRIORITIES, type CardDetail } from './boardSchema.js'
import type { EffortChoice } from './chats.js'
import { CodedError } from './codedError.js'
import { type AgentEvent, isEphemeral } from './events.js'
import {
  ASK_USER_QUESTION,
  type QuestionAnswer,
  readQuestions,
  type UserQuestions,
  withAnswers
} from './questions.js'
import {
  EDIT_PROPOSAL_SHAPE,
  PROPOSAL_SERVER,
  PROPOSE_EDIT,
  PROPOSE_EDIT_TOOL,
  PROPOSE_TASKS,
  PROPOSE_TASKS_TOOL,
  TASK_PROPOSAL_SHAPE
} from './taskProposal.js'
import type { ChatEntry } from './transcript.js'
import { WORKSPACE_KINDS } from './workspaceKinds.js'

/** What the agent is told when it reaches for any other tool; it reads a refusal as instruction. */
export const READ_ONLY =
  'This conversation only plans tasks: it reads, asks and proposes, and changes nothing.'

/** What the tool answers, so the agent's turn ends on the proposal rather than going past it. */
export const PROPOSAL_SHOWN =
  'The proposal is in front of the person now. Stop here and wait for their reply.'

const shown = (): Promise<{ content: { type: 'text'; text: string }[] }> =>
  Promise.resolve({ content: [{ type: 'text', text: PROPOSAL_SHOWN }] })

/** Stateless, so one definition serves every brainstorm's server; the window draws the call. */
export const proposeTasks = tool(
  PROPOSE_TASKS,
  'Show the person the tasks you propose for the board. They edit them, ask for changes or create them; nothing is written until they do.',
  TASK_PROPOSAL_SHAPE,
  shown
)
export const proposeEdit = tool(
  PROPOSE_EDIT,
  'Show the person the whole new version of the task. They edit it, ask for changes or apply it; nothing is written until they do.',
  EDIT_PROPOSAL_SHAPE,
  shown
)

/** What a brainstorm ends in: new tasks, or one card's new version. Each has its own tool. */
const PROPOSALS = {
  tasks: { definition: proposeTasks, tool: PROPOSE_TASKS_TOOL },
  edit: { definition: proposeEdit, tool: PROPOSE_EDIT_TOOL }
} as const
export type BrainstormPurpose = keyof typeof PROPOSALS

/** `randomUUID`'s, as a brainstorm id crosses IPC. */
export const BrainstormIdSchema = z.uuid()

export type BrainstormErrorCode = 'brainstormGone'

export class BrainstormError extends CodedError<BrainstormErrorCode> {
  override readonly name = 'BrainstormError'
}

/** One line of a brainstorm's log: a message sent, or something the agent did. */
export interface BrainstormEntry {
  readonly brainstormId: string
  readonly entry: ChatEntry
}

export interface BrainstormFacts {
  readonly project: string
  /** The project's folder in the board folder, or null while the board holds nothing yet. */
  readonly boardDir: string | null
  /** The `taskCards` instruction in effect: how this project writes a task. */
  readonly convention: string
  readonly idea: string
}

const ASKING =
  '2. Where a decision is mine, ask with AskUserQuestion: several questions at once, each with options.'

// An empty instruction is how a project says "nothing extra" (`repoInstruction`).
function conventionPart(convention: string): string[] {
  const text = convention.trim()
  return text === '' ? [] : [`# How this project wants tasks written\n\n${text}`]
}

const BOARD_PART = `# The board\n\n- Priorities: ${CARD_PRIORITIES.join(', ')}\n- Tags: ${WORKSPACE_KINDS.join(', ')}`

/** Shown whole in the log, as the pull request's and Help's are: octopus adds no system prompt. */
export function brainstormMessage({
  project,
  boardDir,
  convention,
  idea
}: BrainstormFacts): string {
  const reads = boardDir === null ? '' : ' and the tasks already on the board'
  const board =
    boardDir === null
      ? '.'
      : `, and the board's tasks in ${boardDir}. If one already covers the idea, say so rather than proposing it again.`
  return [
    `I want to turn an idea into tasks on the board of ${project}. This conversation only reads: you can read the code in this checkout${reads}, ask me questions and propose tasks. You cannot change a file, and no task is written until I create it.`,
    [
      `1. Read the code the idea touches${board}`,
      ASKING,
      `3. When you are ready, call ${PROPOSE_TASKS} with the tasks and a short summary of why they are split this way, then stop. I may edit the proposal, ask for changes or create the tasks.`
    ].join('\n'),
    ...conventionPart(convention),
    BOARD_PART,
    `# The idea\n\n${idea.trim()}`
  ].join('\n\n')
}

export interface CardEditFacts {
  readonly project: string
  /** The card's file, where the agent can read it whole. */
  readonly file: string
  readonly convention: string
  readonly card: Pick<CardDetail, 'description' | 'thread'> & {
    readonly meta: Pick<CardDetail['meta'], 'priority' | 'tag'>
  }
  readonly request: string
}

export function cardEditMessage({
  project,
  file,
  convention,
  card,
  request
}: CardEditFacts): string {
  const comments = card.thread.map((comment) => `### ${comment.at}\n\n${comment.text.trim()}`)
  return [
    `I want to rework one task on the board of ${project}: ${file}. This conversation only reads: you can read the code in this checkout and the tasks on the board, ask me questions and propose the task's new version. You cannot change a file, and the task is not rewritten until I apply it.`,
    [
      '1. Read the task below and the code it touches.',
      ASKING,
      `3. When you are ready, call ${PROPOSE_EDIT} with the whole new version of the task and a short summary of what changed, then stop. I may edit it, ask for changes or apply it.`
    ].join('\n'),
    ...conventionPart(convention),
    BOARD_PART,
    `# The task as it stands\n\n- Priority: ${card.meta.priority ?? 'none'}\n- Tag: ${card.meta.tag ?? 'none'}\n\n${card.description.trim()}`,
    ...(comments.length === 0 ? [] : [`# Its comments\n\n${comments.join('\n\n')}`]),
    `# What I want changed\n\n${request.trim()}`
  ].join('\n\n')
}

export interface BrainstormStart {
  readonly purpose: BrainstormPurpose
  /** The project's own checkout: there is no workspace yet. */
  readonly cwd: string
  readonly settingSources: readonly SettingSource[]
  /** The board's folder, when it exists, so its tasks can be read. */
  readonly additionalDirectories: readonly string[]
  readonly model: string | null
  readonly effort: EffortChoice
  readonly message: string
}

export interface BrainstormHooks {
  readonly query: QueryFn
  readonly now: () => string
  readonly onEntry: (entry: BrainstormEntry) => void
  readonly onDiagnostic: (error: unknown) => void
}

export interface Brainstorms {
  /** A new one with its first message sent; any other is closed first, as there is one panel. */
  start: (start: BrainstormStart) => Promise<string>
  send: (id: string, text: string) => void
  /** An answer to a question that is no longer open is dropped: it was answered or withdrawn. */
  answer: (id: string, requestId: string, answers: readonly QuestionAnswer[]) => void
  stop: (id: string) => Promise<void>
  close: (id: string) => Promise<void>
  closeAll: () => Promise<void>
}

interface Question {
  readonly asked: UserQuestions
  readonly resolve: (outcome: PermissionOutcome) => void
}

interface Live {
  readonly session: AgentSession
  readonly questions: Map<string, Question>
  /** A message went and neither a result nor an error has ended its turn. */
  turnOpen: boolean
}

export function createBrainstorms(hooks: BrainstormHooks): Brainstorms {
  const live = new Map<string, Live>()

  function said(brainstormId: string, event: AgentEvent): void {
    hooks.onEntry({ brainstormId, entry: { role: 'agent', at: hooks.now(), event } })
  }

  function requireLive(id: string): Live {
    const found = live.get(id)
    if (found === undefined)
      throw new BrainstormError('brainstormGone', {}, 'This brainstorm has ended')
    return found
  }

  function letGo(id: string): Live | undefined {
    const found = live.get(id)
    live.delete(id)
    // An open question holds `canUseTool`, and with it the turn, until it is answered.
    for (const question of found?.questions.values() ?? [])
      question.resolve({ allow: false, message: ABANDONED })
    found?.questions.clear()
    return found
  }

  function askPerson(id: string, live: Live, ask: PermissionAsk): Promise<PermissionOutcome> {
    // Null for every other tool. `tools` offers none that writes, but the user's settings are
    // still read, and a rule there must not decide for this conversation.
    const asked = readQuestions(ask.toolName, ask.input)
    if (asked === null) return Promise.resolve({ allow: false, message: READ_ONLY })
    const requestId = randomUUID()
    return new Promise((resolve) => {
      live.questions.set(requestId, { asked, resolve })
      ask.signal.addEventListener(
        'abort',
        () => {
          if (!live.questions.delete(requestId)) return
          said(id, { type: 'permission_withdrawn', requestId })
          resolve({ allow: false, message: ABANDONED })
        },
        { once: true }
      )
      said(id, { type: 'permission_request', requestId, toolName: ask.toolName, input: ask.input })
    })
  }

  function send(id: string, text: string): void {
    const record = requireLive(id)
    record.turnOpen = true
    hooks.onEntry({ brainstormId: id, entry: { role: 'user', at: hooks.now(), text } })
    record.session.send(text)
  }

  async function close(id: string): Promise<void> {
    await letGo(id)?.session.close()
  }

  async function closeAll(): Promise<void> {
    await Promise.all([...live.keys()].map(close))
  }

  return {
    async start(start) {
      await closeAll()
      const id = randomUUID()
      const proposal = PROPOSALS[start.purpose]
      const proposals = createSdkMcpServer({
        name: PROPOSAL_SERVER,
        version: '1.0.0',
        tools: [proposal.definition]
      })
      const record: Live = {
        session: startSession(
          {
            cwd: start.cwd,
            resume: null,
            resumeAt: null,
            settingSources: start.settingSources,
            permissionMode: 'default',
            model: start.model,
            effort: start.effort,
            allowedTools: [...READ_ONLY_TOOLS, proposal.tool],
            additionalDirectories: start.additionalDirectories,
            pushTargets: [],
            env: {},
            skillOverrides: {},
            autoCompactWindow: null,
            agentProgressSummaries: false,
            confined: {
              tools: [...READ_ONLY_TOOLS, ASK_USER_QUESTION],
              servers: { [PROPOSAL_SERVER]: proposals }
            }
          },
          {
            query: hooks.query,
            onEvent: (event) => {
              if (
                event.type === 'result' ||
                (event.type === 'error' && event.code !== 'background')
              )
                record.turnOpen = false
              // The streamed text and the rate limit draw nothing in a brainstorm's log.
              if (!isEphemeral(event)) said(id, event)
            },
            askPermission: (ask) => askPerson(id, record, ask),
            // `strictMcpConfig` leaves only octopus's own server, which never asks.
            askElicitation: () => Promise.resolve({ action: 'decline' }),
            // After an error the SDK threw, or between turns, too: only a turn cut short is news.
            onEnd: () => {
              letGo(id)
              if (record.turnOpen)
                said(id, {
                  type: 'error',
                  message: 'Claude Code ended without a result or an error',
                  code: 'endedQuietly'
                })
            },
            onDiagnostic: hooks.onDiagnostic
          }
        ),
        questions: new Map(),
        turnOpen: false
      }
      live.set(id, record)
      send(id, start.message)
      return id
    },

    send,

    answer(id, requestId, answers) {
      const { questions } = requireLive(id)
      const question = questions.get(requestId)
      if (question === undefined) return
      questions.delete(requestId)
      said(id, { type: 'question_answered', requestId, answers: [...answers] })
      question.resolve({ allow: true, updatedInput: withAnswers(question.asked, answers) })
    },

    async stop(id) {
      await requireLive(id).session.interrupt()
    },

    close,

    closeAll
  }
}
