import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TaskView } from '@core/backgroundTasks.js'
import type { AgentEvent, WorkflowAgent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { agentsOf, task } from '../../test/tasks.js'
import { AgentMap } from './AgentMap.js'
import { AgentLogContext, type Agents, AgentsContext } from './agentTasks.js'

const AT = '2026-10-20T10:00:00.000Z'
const agent = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })

interface Actions {
  readonly onStop: ReturnType<typeof vi.fn>
  readonly onShow: ReturnType<typeof vi.fn>
  readonly onClear: ReturnType<typeof vi.fn>
}

/** The map with every group opened, which is where most of these start. */
async function renderMap(
  tasks: readonly TaskView[],
  entries: readonly ChatEntry[] = []
): Promise<Actions> {
  const actions = renderFolded(tasks, entries)
  await unfold()
  return actions
}

/** The map as it opens: every group folded. */
function renderFolded(tasks: readonly TaskView[], entries: readonly ChatEntry[] = []): Actions {
  const actions = { onStop: vi.fn(), onShow: vi.fn(), onClear: vi.fn() }
  render(mapOf(tasks, entries, actions))
  return actions
}

async function unfold(): Promise<void> {
  for (const group of screen.queryAllByRole('button', { expanded: false })) {
    await userEvent.click(group)
  }
}

/** A group's header, by the name it starts with. */
const group = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name}`) })

function mapOf(
  tasks: readonly TaskView[],
  entries: readonly ChatEntry[] = [],
  actions: Partial<Pick<Agents, 'onStop' | 'onShow' | 'onClear'>> = {}
): React.JSX.Element {
  return (
    <AgentsContext.Provider value={agentsOf(tasks, actions)}>
      <AgentLogContext.Provider value={entries}>
        <AgentMap />
      </AgentLogContext.Provider>
    </AgentsContext.Provider>
  )
}

/** A row by its name; its status word follows it. */
const row = (name: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${name}, `) })

describe('the agent map', () => {
  it('lists each agent with its kind, model, tokens, time and what it is doing', async () => {
    await renderMap([task()])

    expect(row('Audit route handlers')).toHaveAccessibleName('Audit route handlers, Working')
    // The lines under the name are read too, rather than lost behind a label.
    expect(row('Audit route handlers')).toHaveAccessibleDescription(
      'Explore · Haiku 5.5 · 18k tokens Reading src/routes/auth.ts'
    )
    expect(screen.getByText('Explore · Haiku 5.5 · 18k tokens')).toBeInTheDocument()
    expect(screen.getByText('Reading src/routes/auth.ts')).toBeInTheDocument()
    expect(screen.getByText('1 working')).toBeInTheDocument()
  })

  // Agents start agents, and a flat list would hide which one is whose.
  it('nests an agent under the one that started it, and commands apart', async () => {
    await renderMap([
      task(),
      task({ taskId: 't-2', parentTaskId: 't-1', description: 'Check token expiry' }),
      task({
        taskId: 't-3',
        kind: 'shell',
        subagentType: null,
        model: null,
        description: 'npm run dev',
        tokens: 0
      }),
      task({ taskId: 't-4', status: 'completed', description: 'Map the SDK', activity: null })
    ])

    const parent = row('Audit route handlers').closest('li')
    expect(parent).not.toBeNull()
    expect(within(parent as HTMLElement).getByText('Check token expiry')).toBeInTheDocument()

    const commands = screen.getByText('Background commands').closest('section')
    expect(within(commands!).getByText('npm run dev')).toBeInTheDocument()
    // Each group counts its own, the nested ones included.
    expect(group('Agents')).toHaveTextContent('2 working · 1 done')
    expect(group('Background commands')).toHaveTextContent('1 working')
    // An ended agent says no step: there is none under way.
    expect(row('Map the SDK')).toHaveAccessibleName('Map the SDK, Done')
  })

  it('says only how many are done when none is working, and nothing of the waiting', async () => {
    await renderMap([task({ status: 'failed', activity: null })])

    expect(screen.getByText('1 done')).toBeInTheDocument()
    expect(row('Audit route handlers')).toHaveAccessibleName('Audit route handlers, Failed')
  })

  it('lists commands alone when there are no agents', async () => {
    await renderMap([task({ kind: 'shell', description: 'sleep 60' })])

    expect(screen.getByText('Background commands')).toBeInTheDocument()
  })

  it('stops one that is working, and offers no Stop for one that is not', async () => {
    const { onStop } = await renderMap([
      task(),
      task({ taskId: 't-2', status: 'stopped', description: 'Old one' })
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Stop Audit route handlers' }))

    expect(onStop).toHaveBeenCalledWith('t-1')
    expect(screen.queryByRole('button', { name: 'Stop Old one' })).not.toBeInTheDocument()
  })

  it('names an agent waiting on an answer as waiting, in the list and opened', async () => {
    await renderMap([task({ waiting: true })])

    expect(row('Audit route handlers')).toHaveAccessibleName(
      'Audit route handlers, Needs your answer'
    )
    await userEvent.click(row('Audit route handlers'))
    expect(screen.getByText('Needs your answer')).toHaveClass('text-warning')
  })

  describe('its groups', () => {
    const tasks = [
      task(),
      task({ taskId: 't-2', status: 'completed', description: 'Map the SDK', activity: null }),
      task({ taskId: 't-3', kind: 'shell', description: 'npm run dev', status: 'completed' })
    ]

    // A long conversation runs dozens; the counts are what a glance wants.
    it('open folded, each header saying how it stands', async () => {
      renderFolded(tasks)

      expect(group('Agents')).toHaveAttribute('aria-expanded', 'false')
      expect(group('Agents')).toHaveTextContent('1 working · 1 done')
      expect(group('Background commands')).toHaveAttribute('aria-expanded', 'false')
      expect(group('Background commands')).toHaveTextContent('1 done')
      expect(screen.queryByText('Map the SDK')).not.toBeInTheDocument()

      await userEvent.click(group('Agents'))
      expect(row('Map the SDK')).toBeInTheDocument()
      expect(screen.queryByText('npm run dev')).not.toBeInTheDocument()

      await userEvent.click(group('Agents'))
      expect(screen.queryByText('Map the SDK')).not.toBeInTheDocument()
    })

    it('stay as they were when an opened agent goes back to the list', async () => {
      renderFolded(tasks)
      await userEvent.click(group('Agents'))

      await userEvent.click(row('Map the SDK'))
      await userEvent.click(screen.getByRole('button', { name: 'All agents' }))

      expect(group('Agents')).toHaveAttribute('aria-expanded', 'true')
      expect(group('Background commands')).toHaveAttribute('aria-expanded', 'false')
    })

    // Folded, the amber of a waiting row would be out of sight.
    it('say in the header that something in them is waiting on an answer', () => {
      renderFolded([task({ waiting: true }), task({ taskId: 't-2', kind: 'shell' })])

      expect(group('Agents')).toHaveAccessibleName(/Needs your answer/)
      expect(group('Agents').querySelector('.bg-warning')).not.toBeNull()
      expect(group('Background commands')).not.toHaveAccessibleName(/Needs your answer/)
    })

    // Nothing working, a column of green asks for a look nobody owes it.
    it('grey the ticks once nothing is working, and keep a failure red', async () => {
      await renderMap([
        task({ status: 'completed', activity: null }),
        task({ taskId: 't-2', status: 'failed', description: 'Broke' })
      ])

      expect(row('Audit route handlers').querySelector('.text-success')).toBeNull()
      expect(row('Audit route handlers').querySelector('.text-ink-faint')).not.toBeNull()
      expect(row('Broke').querySelector('.text-danger')).not.toBeNull()
    })

    it('keep the ticks green while something is working', async () => {
      await renderMap(tasks)
      expect(row('Map the SDK').querySelector('.text-success')).not.toBeNull()
    })

    it('offer to clear only what has ended, and clear just that', async () => {
      const { onClear } = renderFolded(tasks)

      await userEvent.click(screen.getByRole('button', { name: 'Clear finished' }))

      expect(onClear).toHaveBeenCalledWith(['t-2', 't-3'])
    })

    it('offer nothing to clear while all of it is working', () => {
      renderFolded([task()])
      expect(screen.queryByRole('button', { name: 'Clear finished' })).not.toBeInTheDocument()
    })
  })

  describe('a workflow', () => {
    const member = (overrides: Partial<WorkflowAgent>): WorkflowAgent => ({
      index: 1,
      label: 'src/a.ts',
      phase: 1,
      state: 'progress',
      model: 'claude-haiku-5-5',
      tokens: 15_366,
      toolCalls: 1,
      durationMs: null,
      lastTool: 'Read',
      ...overrides
    })

    // Its agents raise no events of their own; its progress is all there is.
    it('lists its agents phase by phase, with how many are still going', async () => {
      await renderMap([
        task({
          kind: 'workflow',
          subagentType: null,
          model: null,
          description: 'Audit every route',
          summary: 'Audit every route',
          workflow: {
            phases: [{ index: 1, title: 'read' }],
            agents: [
              member({}),
              member({ index: 2, label: 'src/b.ts', state: 'done' }),
              member({ index: 3, label: 'src/c.ts', state: 'failed', model: null, tokens: null }),
              member({ index: 4, label: 'src/d.ts', state: 'skipped', phase: 9 }),
              member({ index: 5, label: 'src/e.ts', state: 'stopped', phase: null })
            ]
          }
        })
      ])

      expect(screen.getByText('Workflow · 1 of 5 agents working · 18k tokens')).toBeInTheDocument()
      // Its summary is its description again, so it is not said twice.
      expect(screen.getAllByText('Audit every route')).toHaveLength(1)
      expect(screen.getByText('read')).toBeInTheDocument()
      // Agents in no phase the workflow named are gathered rather than lost.
      expect(screen.getByText('Agents', { selector: 'p' })).toBeInTheDocument()
      for (const [label, state] of [
        ['src/a.ts', 'Working'],
        ['src/b.ts', 'Done'],
        ['src/c.ts', 'Failed'],
        ['src/d.ts', 'Stopped'],
        ['src/e.ts', 'Stopped']
      ] as const) {
        const line = screen.getByText(label).closest('li')
        expect(within(line as HTMLElement).getByText(state)).toBeInTheDocument()
      }
      expect(screen.getAllByText('Haiku 5.5 · 15k')).toHaveLength(4)
      expect(screen.getByText('src/c.ts').closest('li')).not.toHaveTextContent('Haiku')
    })
  })

  describe('one agent opened', () => {
    const entries = [
      agent({
        type: 'tool_use',
        toolUseId: 'call-1',
        name: 'Agent',
        input: { description: 'Audit', prompt: 'Read every route handler.' }
      }),
      agent({
        type: 'tool_use',
        toolUseId: 'step-1',
        name: 'Read',
        input: { file_path: 'src/routes/auth.ts' },
        parentToolUseId: 'call-1'
      }),
      agent({
        type: 'tool_use',
        toolUseId: 'step-2',
        name: 'TodoWrite',
        input: { todos: [] },
        parentToolUseId: 'call-1'
      })
    ]

    it('says what it is, what it was asked and what it did', async () => {
      await renderMap(
        [task(), task({ taskId: 't-2', parentTaskId: 't-1', description: 'Nested' })],
        entries
      )

      await userEvent.click(row('Nested'))

      expect(screen.getByText('Started by').nextSibling).toHaveTextContent('Audit route handlers')

      await userEvent.click(screen.getByRole('button', { name: 'All agents' }))
      await userEvent.click(row('Audit route handlers'))

      for (const [label, value] of [
        ['Model', 'Haiku 5.5'],
        ['Type', 'Explore'],
        ['Tokens', '18k'],
        ['Tool calls', '3'],
        ['Started by', 'The conversation']
      ] as const) {
        expect(screen.getByText(label).nextSibling).toHaveTextContent(value)
      }
      expect(screen.getByText('Reading src/routes/auth.ts')).toBeInTheDocument()
      expect(screen.getByText('Read every route handler.')).toBeInTheDocument()
      expect(screen.getByText(/src\/routes\/auth\.ts$/, { selector: 'li' })).toBeInTheDocument()
    })

    it('shows the row in the log and stops the agent from its footer', async () => {
      const { onShow, onStop } = await renderMap([task()], entries)
      await userEvent.click(row('Audit route handlers'))

      await userEvent.click(screen.getByRole('button', { name: 'Show in conversation' }))
      await userEvent.click(screen.getByRole('button', { name: 'Stop agent' }))

      expect(onShow).toHaveBeenCalledWith('call-1')
      expect(onStop).toHaveBeenCalledWith('t-1')
    })

    // Once it is over, the report is what there is to read — as the agent wrote it.
    it('draws an ended one’s report as markdown, with nothing to stop', async () => {
      await renderMap(
        [
          task({
            status: 'completed',
            summary: 'Found **three** handlers.',
            model: null,
            tokens: 0,
            toolUses: 0
          })
        ],
        []
      )
      await userEvent.click(row('Audit route handlers'))

      expect(screen.getByText('three').tagName).toBe('STRONG')
      expect(screen.getByText('No steps yet.')).toBeInTheDocument()
      expect(screen.queryByText('Model')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Stop agent' })).not.toBeInTheDocument()
    })

    // A command has no prompt and no steps in the log, and one that ended has
    // nothing to show or stop.
    it('has no footer for a command that has ended and no call to show', async () => {
      await renderMap([
        task({
          kind: 'shell',
          subagentType: null,
          toolUseId: null,
          status: 'completed',
          activity: null,
          summary: null
        })
      ])
      await userEvent.click(row('Audit route handlers'))

      expect(screen.queryByRole('button', { name: 'Show in conversation' })).not.toBeInTheDocument()
      expect(screen.queryByText('Recent steps')).not.toBeInTheDocument()
    })

    it('stops a running command that has no call to show', async () => {
      const { onStop } = await renderMap([task({ kind: 'shell', toolUseId: null })])
      await userEvent.click(row('Audit route handlers'))

      await userEvent.click(screen.getByRole('button', { name: 'Stop agent' }))

      expect(onStop).toHaveBeenCalledWith('t-1')
    })

    it('goes back to the list when the agent it showed is gone', async () => {
      const { rerender } = render(mapOf([task()]))
      await unfold()
      await userEvent.click(row('Audit route handlers'))

      rerender(mapOf([task({ taskId: 't-9', description: 'Another' })]))

      expect(row('Another')).toBeInTheDocument()
    })
  })
})
