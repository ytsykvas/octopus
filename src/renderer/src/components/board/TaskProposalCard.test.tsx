import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_COLUMNS } from '@core/boardColumns.js'

import { refusal } from '../../test/board.js'
import { editorText } from '../../test/editor.js'
import type { DraftTask } from './proposalDraft.js'
import { TaskProposalCard, type TaskProposalCardProps } from './TaskProposalCard.js'

const A: DraftTask = {
  key: 0,
  title: 'Read issues',
  description: 'Import them.',
  priority: null,
  tag: null,
  status: 'backlog'
}
const B: DraftTask = { ...A, key: 1, title: 'Write issues back', description: '' }

function renderCard(props: Partial<TaskProposalCardProps> = {}): TaskProposalCardProps {
  const all: TaskProposalCardProps = {
    purpose: 'tasks',
    summary: 'Two tasks: the import ships on its own.',
    tasks: [A, B],
    onTasks: vi.fn(),
    columns: DEFAULT_COLUMNS,
    writing: false,
    failure: null,
    onWrite: vi.fn(),
    ...props
  }
  render(<TaskProposalCard {...all} />)
  return all
}

function Stateful(): React.JSX.Element {
  const [tasks, setTasks] = useState<DraftTask[]>([A, B])
  return (
    <TaskProposalCard
      purpose="tasks"
      summary="Two tasks."
      tasks={tasks}
      onTasks={setTasks}
      columns={DEFAULT_COLUMNS}
      writing={false}
      failure={null}
      onWrite={vi.fn()}
    />
  )
}

const row = (title: string): HTMLElement =>
  screen.getByRole('heading', { name: title }).closest('li') as HTMLElement

describe('TaskProposalCard', () => {
  it('shows the summary and every task, and creates them all', async () => {
    const { onWrite } = renderCard()

    expect(screen.getByRole('region', { name: 'Proposal' })).toBeInTheDocument()
    expect(screen.getByText('Two tasks: the import ships on its own.')).toBeInTheDocument()
    expect(screen.getByText('Import them.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create 2 tasks' }))

    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('renames a task on a double click and keeps it on Escape', async () => {
    const { onTasks } = renderCard()

    await userEvent.dblClick(screen.getByRole('heading', { name: 'Read issues' }))
    await userEvent.keyboard('{Escape}')
    expect(onTasks).not.toHaveBeenCalled()
    await userEvent.dblClick(screen.getByRole('heading', { name: 'Read issues' }))
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.type(screen.getByRole('textbox'), 'Import issues{Enter}')

    expect(onTasks).toHaveBeenCalledWith([{ ...A, title: 'Import issues' }, B])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('sets a priority, a tag and a column', async () => {
    const { onTasks } = renderCard({ tasks: [A] })

    await userEvent.click(screen.getByRole('button', { name: 'No priority' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
    await userEvent.click(screen.getByRole('button', { name: 'No tag' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Bug' }))
    await userEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }))

    expect(onTasks).toHaveBeenNthCalledWith(1, [{ ...A, priority: 'high' }])
    expect(onTasks).toHaveBeenNthCalledWith(2, [{ ...A, tag: 'bug' }])
    expect(onTasks).toHaveBeenNthCalledWith(3, [{ ...A, status: 'done' }])
  })

  it('moves a task and leaves one out', async () => {
    const { onTasks } = renderCard()

    expect(within(row('Read issues')).getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(
      within(row('Write issues back')).getByRole('button', { name: 'Move down' })
    ).toBeDisabled()
    await userEvent.click(within(row('Read issues')).getByRole('button', { name: 'Move down' }))
    await userEvent.click(within(row('Write issues back')).getByRole('button', { name: 'Move up' }))
    await userEvent.click(within(row('Read issues')).getByRole('button', { name: 'Leave out' }))

    expect(onTasks).toHaveBeenNthCalledWith(1, [B, A])
    expect(onTasks).toHaveBeenNthCalledWith(2, [B, A])
    expect(onTasks).toHaveBeenNthCalledWith(3, [B])
  })

  it('keeps an open editor with its task when the task moves', async () => {
    render(<Stateful />)

    await userEvent.click(
      within(row('Read issues')).getByRole('button', { name: 'Edit description' })
    )
    await userEvent.click(within(row('Read issues')).getByRole('button', { name: 'Move down' }))

    const field = within(row('Read issues')).getByRole('textbox', { name: 'Description' })
    expect(editorText(field)).toBe('Import them.')
    expect(within(row('Write issues back')).queryByRole('textbox')).toBeNull()
  })

  it('edits a description and gives an edit up', async () => {
    const { onTasks } = renderCard({ tasks: [A] })

    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    const field = screen.getByRole('textbox', { name: 'Description' })
    expect(editorText(field)).toBe('Import them.')
    await userEvent.type(field, ' Once.', { skipClick: true })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onTasks).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), ' Once.', {
      skipClick: true
    })
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onTasks).toHaveBeenCalledWith([{ ...A, description: 'Import them. Once.' }])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps a description open while a code block is left open in it', async () => {
    const { onTasks } = renderCard({ tasks: [A] })

    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    const field = screen.getByRole('textbox', { name: 'Description' })
    await userEvent.type(field, '{Enter}```', { skipClick: true })
    expect(editorText(field)).toBe('Import them.\n```')
    expect(screen.getByText(/A code block is left open/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled()
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onTasks).not.toHaveBeenCalled()

    await userEvent.type(field, '{Enter}```', { skipClick: true })
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onTasks).toHaveBeenCalledWith([{ ...A, description: 'Import them.\n```\n```' }])
  })

  it('takes a description on ⌘↩ and gives it up on Escape', async () => {
    const { onTasks } = renderCard({ tasks: [A] })

    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), '?', {
      skipClick: true
    })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onTasks).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Description' }), '!', {
      skipClick: true
    })
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onTasks).toHaveBeenCalledWith([{ ...A, description: 'Import them.!' }])
  })

  it('says when every task is left out, and creates nothing', () => {
    renderCard({ tasks: [] })

    expect(
      screen.getByText('Every task is left out. Ask for another proposal, or close.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create 0 tasks' })).toBeDisabled()
  })

  it('waits for a write and shows why one failed', () => {
    renderCard({ writing: true, failure: refusal('cardNameTaken', { name: 'Read issues.md' }) })

    expect(screen.getByRole('button', { name: 'Create 2 tasks' })).toBeDisabled()
    expect(screen.getByText(/Read issues\.md/)).toBeInTheDocument()
  })

  it('edits one card with no column, order or leaving out, and applies it', async () => {
    const { onWrite } = renderCard({ purpose: 'edit', tasks: [A] })

    expect(screen.queryByRole('button', { name: 'Backlog' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move up' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Leave out' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))

    expect(onWrite).toHaveBeenCalledTimes(1)
  })
})
