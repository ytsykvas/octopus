import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { TaskView } from '@core/backgroundTasks.js'

import { agentsOf, task } from '../../test/tasks.js'
import { AgentsChip } from './AgentsChip.js'
import { AgentsContext, createAgentsStore, snapshotOf } from './agentTasks.js'

function chipOf(tasks: readonly TaskView[]): React.JSX.Element {
  return (
    <AgentsContext.Provider value={agentsOf(tasks)}>
      <AgentsChip />
    </AgentsContext.Provider>
  )
}

function renderChip(tasks: readonly TaskView[]): ReturnType<typeof render> {
  return render(chipOf(tasks))
}

const chip = (): HTMLElement => screen.getByRole('button', { expanded: false })

describe('the count of agents in the composer', () => {
  // Nothing has run: a count of nothing would be chrome claiming a reading.
  it('is not there until an agent has run, nor for housekeeping', () => {
    renderChip([task({ ambient: true })])

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('counts the agents at work, and wears the turning line while they are', () => {
    renderChip([
      task(),
      task({ taskId: 't-2' }),
      task({ taskId: 't-3', status: 'completed' }),
      task({ taskId: 't-4', kind: 'shell' })
    ])

    expect(chip()).toHaveTextContent('2 agents')
    expect(chip()).toHaveAttribute('title', '3 agents working — show what they are doing')
    expect(chip().querySelector('.agents-chip-line')).not.toBeNull()
  })

  // Once all are done it says how many there were, quietly: grey, still, no dot.
  it('says how many ran once they are all done, without a dot', () => {
    renderChip([task({ status: 'completed' }), task({ taskId: 't-2', status: 'failed' })])

    expect(chip()).toHaveTextContent('2 agents')
    expect(chip()).toHaveAttribute('title', 'The agents this conversation ran — show what they did')
    expect(chip()).toHaveClass('text-ink-faint')
    expect(chip().querySelector('.agents-chip-line')).toBeNull()
    expect(chip().querySelector('.rounded-full')).toBeNull()
  })

  it('wears the working dot while one works', () => {
    renderChip([task()])
    expect(chip().querySelector('.bg-accent')).not.toBeNull()
  })

  // Cleared from the map, the runs are still in the log's list — not the chip's.
  it('is not there once everything it counted was cleared', () => {
    const done = [task({ status: 'completed' })]
    render(
      <AgentsContext.Provider
        value={agentsOf([], { store: createAgentsStore(snapshotOf(done, [])) })}
      >
        <AgentsChip />
      </AgentsContext.Provider>
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('counts commands where commands are all there is', () => {
    renderChip([task({ kind: 'shell' })])
    expect(chip()).toHaveTextContent('1 command')
  })

  it('counts commands that have ended where they are all there is', () => {
    renderChip([task({ kind: 'shell', status: 'completed' })])
    expect(chip()).toHaveTextContent('1 command')
  })

  it('turns amber and says so when an agent is waiting on an answer', () => {
    renderChip([task({ waiting: true })])

    expect(chip()).toHaveAttribute('title', 'An agent is waiting for your answer')
    expect(chip().querySelector('.bg-warning')).not.toBeNull()
  })

  it('opens the agent map and closes it again', async () => {
    renderChip([task()])

    await userEvent.click(chip())
    expect(screen.getByRole('dialog', { name: 'Agents' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // The conversation was reset under an open map: the panel goes with the
  // count, and does not come back by itself with the next agent.
  it('closes the map when there is nothing left to list', async () => {
    const { rerender } = renderChip([task()])
    await userEvent.click(chip())

    rerender(chipOf([]))
    rerender(chipOf([task({ taskId: 't-2' })]))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chip()).toBeInTheDocument()
  })
})
