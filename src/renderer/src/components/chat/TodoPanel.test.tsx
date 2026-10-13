import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { Todo } from '@core/todos.js'

import { TodoPanel } from './TodoPanel.js'

const LIST: Todo[] = [
  { content: 'Write the test', status: 'completed', activeForm: 'Writing the test' },
  { content: 'Make it pass', status: 'in_progress', activeForm: 'Making it pass' },
  { content: 'Document it', status: 'pending', activeForm: 'Documenting it' }
]

describe('the agent task list above the field', () => {
  it('says how far it has got and what it is doing now', () => {
    render(<TodoPanel todos={LIST} />)

    expect(screen.getByText('Tasks')).toBeInTheDocument()
    expect(screen.getByText('1 of 3')).toBeInTheDocument()
    // The progressive form is how the agent says what it is doing.
    expect(screen.getByText('Making it pass')).toBeInTheDocument()
  })

  it('falls back to the plain wording for a list written without the other', () => {
    render(
      <TodoPanel todos={[{ content: 'Make it pass', status: 'in_progress', activeForm: '' }]} />
    )

    expect(screen.getByText('Make it pass')).toBeInTheDocument()
  })

  it('names nothing in particular while none is under way', () => {
    render(
      <TodoPanel todos={[{ content: 'Later', status: 'pending', activeForm: 'Doing later' }]} />
    )

    expect(screen.getByText('0 of 1')).toBeInTheDocument()
    expect(screen.queryByText('Doing later')).not.toBeInTheDocument()
  })

  it('opens to the whole list, each item with its state', async () => {
    const user = userEvent.setup()
    render(<TodoPanel todos={LIST} />)

    expect(screen.queryByText('Document it')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Tasks/ }))

    expect(screen.getByText('Write the test')).toBeInTheDocument()
    expect(screen.getByText('Document it')).toBeInTheDocument()
    // A reader hears the state, which the mark alone does not say.
    expect(screen.getAllByText('done').length).toBeGreaterThan(0)
    expect(screen.getAllByText('in progress').length).toBeGreaterThan(0)
    expect(screen.getAllByText('to do').length).toBeGreaterThan(0)
  })

  it('closes again', async () => {
    const user = userEvent.setup()
    render(<TodoPanel todos={LIST} />)

    await user.click(screen.getByRole('button', { name: /Tasks/ }))
    await user.click(screen.getByRole('button', { name: /Tasks/ }))

    expect(screen.queryByText('Document it')).not.toBeInTheDocument()
  })

  // A finished list pinned above the field would be a standing report on work
  // already in the log, taking the line the next message needs.
  it('is gone once everything is done', () => {
    const { container } = render(
      <TodoPanel todos={LIST.map((todo) => ({ ...todo, status: 'completed' as const }))} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('is absent without a list', () => {
    const { container } = render(<TodoPanel todos={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
