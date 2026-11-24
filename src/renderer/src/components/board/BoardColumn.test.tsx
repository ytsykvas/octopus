import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardCard } from '@core/boardSchema.js'

import { boardCard, noDrag } from '../../test/board.js'
import { BoardColumn, type BoardColumnProps } from './BoardColumn.js'

function renderColumn(props: Partial<BoardColumnProps> = {}): BoardColumnProps {
  const all: BoardColumnProps = {
    status: 'backlog',
    cards: [],
    creating: false,
    onCreating: vi.fn(),
    onCreate: vi.fn(),
    openRef: null,
    onOpen: vi.fn(),
    marksOf: () => null,
    drag: noDrag(),
    ...props
  }
  render(<BoardColumn {...all} />)
  return all
}

function card(title: string, order?: number): ReturnType<typeof boardCard> {
  return boardCard({
    ref: `backlog/${title}.md`,
    title,
    meta: order === undefined ? { links: [], runs: [] } : { links: [], runs: [], order }
  })
}

describe('BoardColumn', () => {
  it('is a region named by its status', () => {
    renderColumn({ status: 'in progress', cards: [] })

    expect(
      within(screen.getByRole('region', { name: 'In progress' })).getByText('0')
    ).toBeInTheDocument()
  })

  it('says when it is empty', () => {
    renderColumn({ cards: [] })

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('No task has this status yet.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('lists the cards in the order given', () => {
    renderColumn({ cards: [card('A', 0), card('B', 1)] })

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['A', 'B'])
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('separates the cards sorted by name', () => {
    renderColumn({ cards: [card('A', 0), card('n')] })

    // In DOM order: the separator's own text is its label.
    const rows = Array.from(screen.getByRole('list').children, (row) => row.textContent)
    expect(rows).toEqual(['A', 'By name', 'n'])
    expect(screen.getByRole('separator', { name: 'By name' })).toBeInTheDocument()
  })

  it('draws no separator when every card has an order', () => {
    renderColumn({ cards: [card('A', 0), card('B', 1)] })

    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('draws no separator when no card has an order', () => {
    renderColumn({ cards: [card('A'), card('B')] })

    expect(screen.queryByRole('separator')).toBeNull()
  })

  it("asks for a new task's title", async () => {
    const { onCreating } = renderColumn()

    await userEvent.click(screen.getByRole('button', { name: 'New task' }))

    expect(onCreating).toHaveBeenCalledWith(true)
  })

  it('creates the task typed in', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    renderColumn({
      creating: true,
      onCreating: (creating) => calls.push(`creating ${String(creating)}`),
      onCreate: (title) => calls.push(`create ${title}`)
    })

    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Fix login{Enter}')

    expect(calls).toEqual(['creating false', 'create Fix login'])
  })

  it('creates nothing from an empty title', async () => {
    const user = userEvent.setup()
    const { onCreating, onCreate } = renderColumn({ creating: true })

    await user.type(screen.getByRole('textbox', { name: 'Task title' }), '{Enter}')

    expect(onCreate).not.toHaveBeenCalled()
    expect(onCreating).toHaveBeenCalledWith(false)
  })

  it('drops the field on Escape', async () => {
    const user = userEvent.setup()
    const { onCreating, onCreate } = renderColumn({ creating: true })

    await user.type(screen.getByRole('textbox', { name: 'Task title' }), 'Fix{Escape}')

    expect(onCreating).toHaveBeenCalledWith(false)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows the field in an empty column instead of the empty state', () => {
    renderColumn({ cards: [], creating: true })

    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing here')).toBeNull()
  })

  it('marks the open card', () => {
    renderColumn({ cards: [card('A'), card('B')], openRef: 'backlog/B.md' })

    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'A' })).not.toHaveAttribute('aria-current')
  })

  it('opens the card clicked', async () => {
    const { onOpen } = renderColumn({ cards: [card('A'), card('B')] })

    await userEvent.click(screen.getByRole('button', { name: 'B' }))

    expect(onOpen).toHaveBeenCalledWith('backlog/B.md')
  })

  it('asks each card for its marks', () => {
    const fix = card('Fix login')
    const marksOf = vi.fn((asked: BoardCard) => <span>{`mark of ${asked.title}`}</span>)

    renderColumn({ cards: [fix], marksOf })

    expect(screen.getByText('mark of Fix login')).toBeInTheDocument()
    expect(marksOf).toHaveBeenCalledWith(fix)
  })

  it('shows the field above the cards', () => {
    renderColumn({ cards: [card('A', 0), card('B', 1)], creating: true })

    const [first] = screen.getAllByRole('listitem')
    expect(first).toContainElement(screen.getByRole('textbox', { name: 'Task title' }))
  })

  it('draws the drop line in an empty column a card is over', () => {
    renderColumn({ status: 'testing', cards: [], drag: { ...noDrag(), overColumn: 'testing' } })

    expect(
      within(screen.getByRole('region', { name: 'Testing' })).getByTestId('drop-line')
    ).toHaveAttribute('data-edge', 'above')
  })

  it('draws no drop line for a card over another column', () => {
    renderColumn({ status: 'testing', cards: [], drag: { ...noDrag(), overColumn: 'done' } })

    expect(screen.queryByTestId('drop-line')).toBeNull()
  })
})
