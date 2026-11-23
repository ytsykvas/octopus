import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import i18n, { DEFAULT_LANGUAGE } from '../../i18n/index.js'
import { boardCard } from '../../test/board.js'
import { BoardCardTile, type BoardCardTileProps } from './BoardCardTile.js'

function renderTile(props: Partial<BoardCardTileProps> = {}): BoardCardTileProps {
  const all: BoardCardTileProps = { card: boardCard(), ...props }
  render(
    <ul>
      <BoardCardTile {...all} />
    </ul>
  )
  return all
}

describe('BoardCardTile', () => {
  it('shows the title', () => {
    renderTile()

    expect(screen.getByRole('listitem')).toHaveTextContent('Fix login')
  })

  it('shows the priority as a labelled icon', () => {
    renderTile({ card: boardCard({ meta: { links: [], runs: [], priority: 'urgent' } }) })

    expect(screen.getByRole('img', { name: 'Urgent' })).toBeInTheDocument()
  })

  it('shows no icon without a priority', () => {
    renderTile()

    expect(screen.queryAllByRole('img')).toEqual([])
  })

  it('names the tag in its own colour', () => {
    renderTile({ card: boardCard({ meta: { links: [], runs: [], tag: 'fix' } }) })

    expect(screen.getByText('Fix')).toHaveStyle({ '--project-color': 'var(--project-amber)' })
  })

  it('counts the comments', () => {
    renderTile({ card: boardCard({ comments: 2 }) })

    expect(screen.getByRole('img', { name: '2 comments' })).toBeInTheDocument()
  })

  it('counts one comment in the singular', () => {
    renderTile({ card: boardCard({ comments: 1 }) })

    expect(screen.getByRole('img', { name: '1 comment' })).toBeInTheDocument()
  })

  it('warns of a header it could not read', () => {
    renderTile({ card: boardCard({ malformed: true }) })

    expect(
      screen.getByRole('img', {
        name: 'The header of this file could not be read; its fields are not shown.'
      })
    ).toBeInTheDocument()
  })

  it('warns of a file that is not UTF-8 text', () => {
    renderTile({ card: boardCard({ notText: true, malformed: true }) })

    expect(
      screen.getByRole('img', {
        name: 'This file is not UTF-8 text. It is shown by its file name and is not changed here.'
      })
    ).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /header/ })).toBeNull()
  })

  it('has no second line when there is nothing for it', () => {
    renderTile()

    expect(screen.getByRole('listitem')).toHaveTextContent(/^Fix login$/)
  })

  it('names the folder of a loose card', () => {
    renderTile({ card: boardCard({ ref: 'ideas/x.md', loose: true, title: 'x' }) })

    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('x')
    expect(item).toHaveTextContent('ideas')
  })

  it('names no folder for a loose card at the project root', () => {
    renderTile({ card: boardCard({ ref: 'notes.md', loose: true, title: 'Notes' }) })

    expect(screen.getByRole('listitem')).toHaveTextContent(/^Notes$/)
  })

  it('names no folder for a card in a status folder', () => {
    renderTile({ card: boardCard() })

    expect(screen.getByRole('listitem')).toHaveTextContent(/^Fix login$/)
  })

  describe('in Ukrainian', () => {
    // Unmounted first: switching back under a mounted tile re-renders it outside act.
    afterEach(async () => {
      cleanup()
      await i18n.changeLanguage(DEFAULT_LANGUAGE)
    })

    it('counts comments in all three Ukrainian forms', async () => {
      await act(async () => {
        await i18n.changeLanguage('uk')
      })

      renderTile({ card: boardCard({ ref: 'backlog/a.md', comments: 1 }) })
      renderTile({ card: boardCard({ ref: 'backlog/b.md', comments: 2 }) })
      renderTile({ card: boardCard({ ref: 'backlog/c.md', comments: 5 }) })

      expect(screen.getByRole('img', { name: '1 коментар' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: '2 коментарі' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: '5 коментарів' })).toBeInTheDocument()
    })
  })
})
