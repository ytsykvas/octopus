import type { TFunction } from 'i18next'
import { ChevronLeft, Square } from 'lucide-react'
import { useContext, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isLive,
  liveCount,
  type TaskNode,
  type TaskView,
  taskTree,
  visibleTasks,
  workflowAgentStatus,
  workflowRunning
} from '@core/backgroundTasks.js'
import type { WorkflowAgent, WorkflowProgress } from '@core/events.js'

import { useNow } from '../../hooks/useNow.js'
import { named } from '../diff/invisible.js'
import { shown } from '../diff/shown.js'
import { activityOf, elapsedOf, formatElapsed, kindLabel, nameOf } from './agentFormat.js'
import { AgentGlyph, STATUS_TONES, statusLabel } from './AgentGlyph.js'
import { promptOf, stepsOf } from './agentSteps.js'
import { AgentLogContext, AgentsContext, useAgentTasks, useTaskById } from './agentTasks.js'
import { formatTokens } from './format.js'
import { Markdown } from './Markdown.js'
import { stepText } from './toolViews.js'

/** How many of an agent's last steps its detail lists. */
const RECENT_STEPS = 8

/**
 * How much of the window the map may take. The chip opens it upwards at this
 * height, so a workflow's agents arriving grow it away from the field rather
 * than off the screen.
 */
export const PANEL_MAX_SHARE = 0.6

const PANEL_MAX_HEIGHT = { maxHeight: `${String(PANEL_MAX_SHARE * 100)}vh` }

/**
 * Everything a conversation has running beside it, and what each is doing.
 *
 * A tree, because agents start agents: each sits under the one that started
 * it, the working ones first. Commands left running in the background are
 * listed apart below, since they are not agents and nobody looks for them
 * among agents. A row opens its detail in the same panel — what it was asked,
 * its last steps, a Stop — so reading one never loses the place in the rest.
 */
export function AgentMap(): React.JSX.Element {
  const { t } = useTranslation()
  const tasks = useAgentTasks()
  const [chosen, setChosen] = useState<string | null>(null)
  const now = useNow(tasks.some(isLive))

  const task = useTaskById(chosen)
  const parent = useTaskById(task?.parentTaskId ?? null)
  if (task !== undefined) {
    return (
      <AgentDetail
        task={task}
        parent={parent ?? null}
        now={now}
        onBack={() => {
          setChosen(null)
        }}
      />
    )
  }

  const tree = taskTree(tasks)
  const agents = tree.filter((node) => node.task.kind !== 'shell')
  const commands = tree.filter((node) => node.task.kind === 'shell')
  const working = liveCount(tasks)
  const ended = visibleTasks(tasks).length - working

  const rows = (nodes: readonly TaskNode[]): React.JSX.Element => (
    <ul className="flex flex-col">
      {nodes.map((node) => (
        <AgentRow key={node.task.taskId} node={node} now={now} onOpen={setChosen} />
      ))}
    </ul>
  )

  return (
    <div className="flex flex-col" style={PANEL_MAX_HEIGHT}>
      <div className="border-line flex items-baseline gap-2 border-b px-3 py-2">
        <span className="text-ink font-medium">{t('agents.title')}</span>
        <span className="text-ink-faint ml-auto text-[11px] tabular-nums">
          {[
            working > 0 ? t('agents.working', { count: working }) : null,
            ended > 0 ? t('agents.ended', { count: ended }) : null
          ]
            .filter((part) => part !== null)
            .join(' · ')}
        </span>
      </div>

      <div className="min-h-0 overflow-auto p-1">
        {agents.length > 0 && rows(agents)}

        {commands.length > 0 && (
          <div className={agents.length > 0 ? 'border-line mt-1 border-t pt-1' : ''}>
            <p className="section-label px-2 pt-1 pb-0.5">{t('agents.commands')}</p>
            {rows(commands)}
          </div>
        )}
      </div>
    </div>
  )
}

/** One task, the line under it, and the tasks it started. */
function AgentRow({
  node,
  now,
  onOpen
}: {
  readonly node: TaskNode
  readonly now: number
  readonly onOpen: (taskId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { onStop, modelName } = useContext(AgentsContext)
  const { task, children } = node
  const running = task.status === 'running'
  const name = nameOf(task)
  // A workflow's summary is its own description over again.
  const step = running ? activityOf(task) : null
  const activity = step === name ? null : step
  const id = useId()

  return (
    <li className="flex flex-col">
      <div className="group relative">
        <button
          type="button"
          onClick={() => {
            onOpen(task.taskId)
          }}
          // Named by what it is and how it stands, and described by the lines
          // under it — read as one run, the spans would come out glued together.
          aria-label={`${name}, ${t(statusLabel(task))}`}
          aria-describedby={activity === null ? `${id}-meta` : `${id}-meta ${id}-activity`}
          className="row focus-ring flex w-full min-w-0 flex-col gap-0.5 px-2 py-1.5 text-left"
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <AgentGlyph task={task} />
            <span
              className={`min-w-0 flex-1 truncate ${running ? 'text-ink' : 'text-ink-soft'}`}
              title={named(name)}
            >
              {shown(name)}
            </span>
            <span
              className={`text-ink-soft shrink-0 text-[11px] tabular-nums ${
                running ? 'group-focus-within:invisible group-hover:invisible' : ''
              }`}
            >
              {formatElapsed(elapsedOf(task, now))}
            </span>
          </span>

          <span id={`${id}-meta`} className="text-ink-faint w-full truncate pl-5 text-[11px]">
            {metaOf(task, t, modelName)}
          </span>

          {activity !== null && (
            <span
              id={`${id}-activity`}
              className="text-ink-soft w-full truncate pl-5 font-mono text-[11px]"
              title={named(activity)}
            >
              {shown(activity)}
            </span>
          )}
        </button>

        {/* Where the time is, once the pointer is on the row: the two are never
            wanted at once, and a Stop beside every row would be a column of
            red nobody asked about. */}
        {running && (
          <button
            type="button"
            onClick={() => {
              onStop(task.taskId)
            }}
            aria-label={t('agents.stop', { name })}
            title={t('agents.stop', { name })}
            className="text-ink-faint hover:text-danger focus-ring absolute top-1.5 right-1.5 rounded p-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <Square aria-hidden size={10} strokeWidth={2.5} />
          </button>
        )}
      </div>

      {task.workflow !== null && <WorkflowAgents progress={task.workflow} />}

      {children.length > 0 && (
        <ul className="border-line ml-[13px] flex flex-col border-l pl-1">
          {children.map((child) => (
            <AgentRow key={child.task.taskId} node={child} now={now} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  )
}

/** Kind, model and tokens — or, for a workflow, how many of its agents are still going. */
function metaOf(task: TaskView, t: TFunction, modelName: (model: string) => string): string {
  const agents = task.workflow?.agents ?? []
  return [
    kindLabel(task, t),
    task.model === null ? null : modelName(task.model),
    agents.length > 0
      ? t('agents.workflowAgents', { running: workflowRunning(agents), count: agents.length })
      : null,
    task.tokens > 0
      ? t('agents.tokens', { count: task.tokens, tokens: formatTokens(task.tokens) })
      : null
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/**
 * A workflow's agents, phase by phase.
 *
 * They raise no task events of their own, so they are not rows that open —
 * one line each, with what the workflow's own progress says of them.
 */
function WorkflowAgents({ progress }: { readonly progress: WorkflowProgress }): React.JSX.Element {
  const { t } = useTranslation()

  const groups = [
    ...progress.phases.map((phase) => ({
      key: String(phase.index),
      title: phase.title,
      agents: progress.agents.filter((agent) => agent.phase === phase.index)
    })),
    {
      key: 'none',
      title: t('agents.workflowNoPhase'),
      agents: progress.agents.filter(
        (agent) => !progress.phases.some((phase) => phase.index === agent.phase)
      )
    }
  ].filter((group) => group.agents.length > 0)

  return (
    <div className="border-line mb-1 ml-[13px] flex flex-col border-l pl-1">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col">
          <p className="text-ink-faint px-2 pt-1 text-[11px]">{shown(group.title)}</p>
          <ul className="flex flex-col">
            {group.agents.map((agent) => (
              <WorkflowAgentRow key={agent.index} agent={agent} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function WorkflowAgentRow({ agent }: { readonly agent: WorkflowAgent }): React.JSX.Element {
  const { t } = useTranslation()
  const { modelName } = useContext(AgentsContext)
  const status = workflowAgentStatus(agent)
  const meta = [
    agent.model === null ? null : modelName(agent.model),
    agent.tokens === null ? null : formatTokens(agent.tokens)
  ]
    .filter((part) => part !== null)
    .join(' · ')

  return (
    <li className="flex min-w-0 items-center gap-2 px-2 py-0.5 text-[11px]">
      <AgentGlyph task={{ status, waiting: false }} />
      <span className="sr-only">{t(statusLabel({ status, waiting: false }))}</span>
      <span className="text-ink-soft min-w-0 flex-1 truncate font-mono" title={named(agent.label)}>
        {shown(agent.label)}
      </span>
      {meta !== '' && <span className="text-ink-faint shrink-0 tabular-nums">{meta}</span>}
    </li>
  )
}

/** One agent opened: what it was asked, where it has got to, and a Stop. */
function AgentDetail({
  task,
  parent,
  now,
  onBack
}: {
  readonly task: TaskView
  readonly parent: TaskView | null
  readonly now: number
  readonly onBack: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { onStop, onShow, modelName } = useContext(AgentsContext)
  const entries = useContext(AgentLogContext)
  const name = nameOf(task)
  const running = task.status === 'running'
  const { toolUseId } = task
  const prompt = toolUseId === null ? null : promptOf(entries, toolUseId)
  const steps = toolUseId === null ? [] : stepsOf(entries, toolUseId, RECENT_STEPS)
  const words = running ? activityOf(task) : task.summary

  const facts: readonly (readonly [string, string])[] = [
    ...(task.model === null ? [] : [[t('agents.detailModel'), modelName(task.model)] as const]),
    [t('agents.detailType'), kindLabel(task, t)],
    [t('agents.detailElapsed'), formatElapsed(elapsedOf(task, now))],
    ...(task.tokens > 0 ? [[t('agents.detailTokens'), formatTokens(task.tokens)] as const] : []),
    ...(task.toolUses > 0 ? [[t('agents.detailToolUses'), String(task.toolUses)] as const] : []),
    [t('agents.detailSpawnedBy'), parent === null ? t('agents.mainAgent') : nameOf(parent)]
  ]

  return (
    <div className="flex flex-col" style={PANEL_MAX_HEIGHT}>
      <div className="border-line border-b px-1.5 py-1">
        <button
          type="button"
          onClick={onBack}
          className="text-ink-faint hover:text-ink focus-ring inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px]"
        >
          <ChevronLeft aria-hidden size={12} />
          {t('agents.back')}
        </button>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-auto px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <span className="pt-1">
            <AgentGlyph task={task} />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="text-ink font-medium break-words">{shown(name)}</p>
            <p
              className={`text-[11px] ${task.waiting ? 'text-warning' : STATUS_TONES[task.status]}`}
            >
              {t(statusLabel(task))}
            </p>
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-faint">{label}</dt>
              <dd className="text-ink-soft min-w-0 truncate tabular-nums">{shown(value)}</dd>
            </div>
          ))}
        </dl>

        {/* While it works, the step under way in the CLI's words; once it has
            ended, the report, which is the agent's own markdown. */}
        {words !== null &&
          (running ? (
            <p className="text-ink-soft font-mono text-[11px] break-words">{shown(words)}</p>
          ) : (
            <div className="text-ink-soft max-h-40 overflow-auto text-[12px]">
              <Markdown text={words} />
            </div>
          ))}

        {prompt !== null && (
          <section aria-label={t('agents.prompt')} className="flex flex-col gap-1">
            <h4 className="section-label">{t('agents.prompt')}</h4>
            <p className="bg-surface border-line text-ink-soft max-h-28 overflow-auto rounded-[var(--radius-control)] border px-2 py-1.5 text-[12px] whitespace-pre-wrap wrap-anywhere">
              {shown(prompt)}
            </p>
          </section>
        )}

        {task.kind === 'agent' && (
          <section aria-label={t('agents.steps')} className="flex flex-col gap-1">
            <h4 className="section-label">{t('agents.steps')}</h4>
            {steps.length === 0 ? (
              <p className="text-ink-faint text-[11px]">{t('agents.noSteps')}</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {steps.map((step) => {
                  const text = stepText(step.name, step.input)
                  return (
                    <li
                      key={step.toolUseId}
                      className="text-ink-soft truncate font-mono text-[11px]"
                      title={named(text)}
                    >
                      {shown(text)}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {(toolUseId !== null || running) && (
        <div className="border-line flex items-center gap-3 border-t px-3 py-2">
          {toolUseId !== null && (
            <button
              type="button"
              onClick={() => {
                onShow(toolUseId)
              }}
              className="text-accent focus-ring rounded text-[11px] hover:underline"
            >
              {t('agents.showInChat')}
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => {
                onStop(task.taskId)
              }}
              className="text-danger focus-ring ml-auto inline-flex items-center gap-1 rounded text-[11px] hover:underline"
            >
              <Square aria-hidden size={9} strokeWidth={2.5} />
              {t('agents.stopAgent')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
