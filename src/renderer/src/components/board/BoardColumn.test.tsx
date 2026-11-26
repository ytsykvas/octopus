import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardCard } from '@core/boardSchema.js'

import { boardCard, noDrag, stillColumn } from '../../test/board.js'
import { BoardColumn, type BoardColumnProps } from './BoardColumn.js'

function renderColumn(props: Partial<BoardColumnProps> = {}): BoardColumnProps {
  const all: BoardColumnProps = {
    column: { kind: 'system', id: 'backlog' },
    cards: [],
    total: props.cards?.length ?? 0,
    filtering: false,
    creating: false,
    onCreating: vi.fn(),
    onCreate: vi.fn(),
    onBrainstorm: vi.fn(),
    openRef: null,
    onOpen: vi.fn(),
    onRename: vi.fn(),
    marksOf: () => null,
    drag: noDrag(),
    menu: [],
    reorder: stillColumn(),
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
    renderColumn({ column: { kind: 'system', id: 'in progress' }, cards: [] })

    expect(
      within(screen.getByRole('region', { name: 'In progress' })).getByText('0')
    ).toBeInTheDocument()
  })

  it('is named as somebody named the column they added', () => {
    renderColumn({ column: { kind: 'custom', id: 'Ideas', name: 'Ideas to try' }, cards: [] })

    expect(screen.getByRole('region', { name: 'Ideas to try' })).toBeInTheDocument()
  })

  it('offers its menu from the header', async () => {
    const onSelect = vi.fn()
    renderColumn({ menu: [{ id: 'right', label: 'Move right', onSelect }] })

    const trigger = screen.getByRole('button', { name: 'Actions for “Backlog”' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move right' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('is dragged by its header', () => {
    const reorder = stillColumn()
    renderColumn({ reorder })

    const title = screen.getByRole('heading', { name: 'Backlog' })
    expect(title.closest('header')).toHaveAttribute('draggable', 'true')
    fireEvent.dragStart(title)

    expect(reorder.props.onDragStart).toHaveBeenCalledTimes(1)
  })

  it.each(['above', 'below'] as const)(
    'draws the line on the %s side a dragged column would land against, and dims while dragged',
    (edge) => {
      renderColumn({ reorder: { ...stillColumn(), edge, dragging: true } })

      const column = screen.getByRole('region', { name: 'Backlog' })
      expect(within(column).getByTestId('drop-line')).toHaveAttribute('data-edge', edge)
      expect(column).toHaveClass('opacity-40')
    }
  )

  it('washes the backlog in the colour of the project', () => {
    renderColumn({ column: { kind: 'system', id: 'backlog' } })

    expect(screen.getByRole('region', { name: 'Backlog' })).toHaveClass('project-tinted')
  })

  it('leaves every other column plain', () => {
    renderColumn({ column: { kind: 'system', id: 'done' } })

    expect(screen.getByRole('region', { name: 'Done' })).not.toHaveClass('project-tinted')
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

  it('plans tasks with the agent', async () => {
    const { onBrainstorm } = renderColumn()

    await userEvent.click(screen.getByRole('button', { name: 'Create with the agent' }))

    expect(onBrainstorm).toHaveBeenCalledTimes(1)
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

  it('renames the card whose title was edited', async () => {
    const user = userEvent.setup()
    const { onRename } = renderColumn({ cards: [card('A'), card('B')] })

    await user.dblClick(screen.getByRole('button', { name: 'B' }))
    const field = screen.getByRole('textbox', { name: 'Task title' })
    await user.clear(field)
    await user.type(field, 'C{Enter}')

    expect(onRename).toHaveBeenCalledWith('backlog/B.md', 'C')
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
    renderColumn({
      column: { kind: 'system', id: 'testing' },
      cards: [],
      drag: { ...noDrag(), overColumn: 'testing' }
    })

    expect(
      within(screen.getByRole('region', { name: 'Testing' })).getByTestId('drop-line')
    ).toHaveAttribute('data-edge', 'above')
  })

  it('draws no drop line for a card over another column', () => {
    renderColumn({
      column: { kind: 'system', id: 'testing' },
      cards: [],
      drag: { ...noDrag(), overColumn: 'done' }
    })

    expect(screen.queryByTestId('drop-line')).toBeNull()
  })

  it('counts the shown tasks of all under a filter', () => {
    renderColumn({ cards: [card('A', 0)], total: 3, filtering: true })

    expect(
      within(screen.getByRole('region', { name: 'Backlog' })).getByText('1 of 3')
    ).toBeInTheDocument()
  })

  it('keeps the count plain without a filter', () => {
    renderColumn({ cards: [card('A', 0), card('B', 1)], total: 2, filtering: false })

    const region = screen.getByRole('region', { name: 'Backlog' })
    expect(within(region).getByText('2')).toBeInTheDocument()
    expect(within(region).queryByText(/of/)).toBeNull()
  })

  it('says the filter hid every task', () => {
    renderColumn({ cards: [], total: 2, filtering: true })

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('No tasks match the filter.')).toBeInTheDocument()
    expect(screen.queryByText('No task has this status yet.')).toBeNull()
  })

  it('keeps the new task field under a filter that hid everything', () => {
    renderColumn({ cards: [], total: 2, filtering: true, creating: true })

    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeInTheDocument()
    expect(screen.queryByText('No tasks match the filter.')).toBeNull()
  })
})
