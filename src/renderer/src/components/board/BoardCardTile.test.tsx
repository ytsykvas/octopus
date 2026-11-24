import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n, { DEFAULT_LANGUAGE } from '../../i18n/index.js'
import { boardCard, noDrag } from '../../test/board.js'
import { BoardCardTile, type BoardCardTileProps } from './BoardCardTile.js'

function renderTile(props: Partial<BoardCardTileProps> = {}): BoardCardTileProps {
  const all: BoardCardTileProps = {
    card: boardCard(),
    open: false,
    onOpen: vi.fn(),
    onRename: vi.fn(),
    marks: null,
    drag: noDrag().cardProps('backlog/Fix login.md', 'backlog'),
    dropEdge: null,
    dragging: false,
    ...props
  }
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

  it('draws the marks on the second line', () => {
    renderTile({ marks: <span>Merged</span> })

    expect(
      within(screen.getByRole('button', { name: /Fix login/ })).getByText('Merged')
    ).toBeInTheDocument()
  })

  it('puts the marks after the tag and before the comments', () => {
    renderTile({
      card: boardCard({ meta: { links: [], runs: [], tag: 'fix' }, comments: 2 }),
      marks: <span>Merged</span>
    })

    expect(screen.getByRole('listitem')).toHaveTextContent(/^Fix loginFixMerged2$/)
  })

  it('names the folder of a loose card', () => {
    renderTile({ card: boardCard({ ref: 'ideas/x.md', loose: true, title: 'x' }) })

    expect(screen.getByRole('listitem')).toHaveTextContent(/^xideas$/)
  })

  it('names no folder for a loose card at the project root', () => {
    renderTile({ card: boardCard({ ref: 'notes.md', loose: true, title: 'Notes' }) })

    expect(screen.getByRole('listitem')).toHaveTextContent(/^Notes$/)
  })

  it('is a button named by its title', () => {
    renderTile()

    expect(screen.getByRole('button', { name: 'Fix login' })).toBeInTheDocument()
  })

  it('says it is the open one', () => {
    renderTile({ card: boardCard({ ref: 'backlog/A.md', title: 'A' }), open: true })
    renderTile({ card: boardCard({ ref: 'backlog/B.md', title: 'B' }), open: false })

    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'B' })).not.toHaveAttribute('aria-current')
  })

  it('opens on a click', async () => {
    const { onOpen } = renderTile()

    await userEvent.click(screen.getByRole('button', { name: 'Fix login' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('holds nothing interactive inside the button', () => {
    renderTile({
      card: boardCard({
        meta: { links: [], runs: [], priority: 'high', tag: 'bug' },
        comments: 2,
        malformed: true
      })
    })

    expect(within(screen.getByRole('button')).queryAllByRole('button')).toEqual([])
  })

  it('marks the tile being dragged', () => {
    renderTile({ card: boardCard({ ref: 'backlog/A.md', title: 'A' }), dragging: true })
    renderTile({ card: boardCard({ ref: 'backlog/B.md', title: 'B' }), dragging: false })

    const [dragged, still] = screen.getAllByRole('listitem')
    expect(dragged).toHaveAttribute('data-dragging', 'true')
    expect(still).not.toHaveAttribute('data-dragging')
  })

  it('draws the drop line beside the button, not in it', () => {
    renderTile({ dropEdge: 'below' })

    expect(screen.getByTestId('drop-line')).toHaveAttribute('data-edge', 'below')
    expect(within(screen.getByRole('button')).queryByTestId('drop-line')).toBeNull()
  })

  it('draws no drop line while nothing would land beside it', () => {
    renderTile({ dropEdge: null })

    expect(screen.queryByTestId('drop-line')).toBeNull()
  })

  it('lets the tile be dragged when the drag allows it', () => {
    renderTile({
      drag: { ...noDrag().cardProps('backlog/Fix login.md', 'backlog'), draggable: true }
    })

    expect(screen.getByRole('listitem')).toHaveAttribute('draggable', 'true')
  })

  it('announces its shortcuts and its ref', () => {
    renderTile()

    const button = screen.getByRole('button', { name: 'Fix login' })
    expect(button).toHaveAttribute(
      'aria-keyshortcuts',
      'Enter Alt+ArrowUp Alt+ArrowDown Meta+Backspace'
    )
    expect(button).toHaveAttribute('data-card-ref', 'backlog/Fix login.md')
  })

  it('renames on a double-click', async () => {
    const user = userEvent.setup()
    const { onRename } = renderTile()

    await user.dblClick(screen.getByRole('button', { name: 'Fix login' }))
    const field = screen.getByRole('textbox', { name: 'Task title' })
    expect(field).toHaveValue('Fix login')
    expect(field).toHaveFocus()
    await user.clear(field)
    await user.type(field, 'Fix sign-in{Enter}')

    expect(onRename).toHaveBeenCalledWith('Fix sign-in')
    expect(screen.getByRole('button', { name: 'Fix login' })).toBeInTheDocument()
  })

  it('keeps the title on Escape', async () => {
    const user = userEvent.setup()
    const { onRename } = renderTile()

    await user.dblClick(screen.getByRole('button', { name: 'Fix login' }))
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveFocus()
    await user.keyboard('X{Escape}')

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Fix login' })).toBeInTheDocument()
  })

  it('keeps the rest of the card around the field', async () => {
    const user = userEvent.setup()
    renderTile({
      card: boardCard({ meta: { links: [], runs: [], priority: 'urgent', tag: 'fix' } })
    })

    await user.dblClick(screen.getByRole('button'))

    const tile = screen.getByRole('listitem')
    expect(within(tile).getByRole('textbox', { name: 'Task title' })).toBeInTheDocument()
    expect(within(tile).getByRole('img', { name: 'Urgent' })).toBeInTheDocument()
    expect(within(tile).getByText('Fix')).toBeInTheDocument()
  })

  it('sends nothing for an unchanged title', async () => {
    const user = userEvent.setup()
    const { onRename } = renderTile()

    await user.dblClick(screen.getByRole('button', { name: 'Fix login' }))
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Fix login')
    await user.keyboard('{Enter}')

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Fix login' })).toBeInTheDocument()
  })

  it('cannot be dragged while its title is edited', async () => {
    const user = userEvent.setup()
    renderTile({
      drag: { ...noDrag().cardProps('backlog/Fix login.md', 'backlog'), draggable: true }
    })

    await user.dblClick(screen.getByRole('button', { name: 'Fix login' }))

    expect(screen.getByRole('listitem')).not.toHaveAttribute('draggable')
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
