import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { boardCard } from '../../test/board.js'
import { BoardColumn, type BoardColumnProps } from './BoardColumn.js'

function renderColumn(props: Partial<BoardColumnProps> = {}): BoardColumnProps {
  const all: BoardColumnProps = { status: 'backlog', cards: [], ...props }
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
})
