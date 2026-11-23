import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { CardComment } from '@core/boardSchema.js'

import { held } from '../../test/held.js'
import { CardComments } from './CardComments.js'

const PLACEHOLDER = 'Write a comment… ⌘↩ to post'

function renderComments(
  thread: readonly CardComment[] = [],
  onAdd: (text: string) => Promise<boolean> = vi.fn(() => Promise.resolve(true))
): void {
  render(<CardComments thread={thread} onAdd={onAdd} />)
}

describe('CardComments', () => {
  it('says there are no comments', () => {
    renderComments()

    expect(screen.getByText('No comments.')).toBeInTheDocument()
  })

  it('lists the comments oldest first with their time', () => {
    renderComments([
      { at: '2026-11-21T14:05:00.000Z', text: 'First' },
      { at: '2026-11-22T09:30:00.000Z', text: 'Second' }
    ])

    const [first, second] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent(/^Nov 21, 2026, 4:05\sPMFirst$/)
    expect(second).toHaveTextContent(/^Nov 22, 2026, 11:30\sAMSecond$/)
  })

  it('renders a comment as markdown', () => {
    renderComments([{ at: '2026-11-21T14:05:00.000Z', text: '**done**' }])

    expect(screen.getByText('done').tagName).toBe('STRONG')
  })

  it('opens the field on demand', async () => {
    renderComments()
    expect(screen.queryByRole('textbox')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Add a comment' }))

    expect(screen.getByRole('textbox', { name: PLACEHOLDER })).toHaveFocus()
  })

  it('adds the comment and closes the field', async () => {
    const onAdd = vi.fn(() => Promise.resolve(true))
    const user = userEvent.setup()
    renderComments([], onAdd)

    await user.click(screen.getByRole('button', { name: 'Add a comment' }))
    await user.type(screen.getByRole('textbox', { name: PLACEHOLDER }), 'Asked.')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onAdd).toHaveBeenCalledWith('Asked.')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps the text when the comment was refused', async () => {
    const onAdd = vi.fn(() => Promise.resolve(false))
    const user = userEvent.setup()
    renderComments([], onAdd)

    await user.click(screen.getByRole('button', { name: 'Add a comment' }))
    await user.type(screen.getByRole('textbox', { name: PLACEHOLDER }), 'Asked.')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('textbox', { name: PLACEHOLDER })).toHaveValue('Asked.')
  })

  it('posts once while a comment is on its way', async () => {
    const answer = held<boolean>()
    const onAdd = vi.fn(() => answer.promise)
    const user = userEvent.setup()
    renderComments([], onAdd)

    await user.click(screen.getByRole('button', { name: 'Add a comment' }))
    await user.type(screen.getByRole('textbox', { name: PLACEHOLDER }), 'Asked.')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await act(async () => {
      answer.resolve(true)
      await answer.promise
    })

    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('closes the field on Escape', async () => {
    const onAdd = vi.fn(() => Promise.resolve(true))
    const user = userEvent.setup()
    renderComments([], onAdd)

    await user.click(screen.getByRole('button', { name: 'Add a comment' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a comment' })).toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
