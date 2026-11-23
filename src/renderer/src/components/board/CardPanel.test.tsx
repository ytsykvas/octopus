import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { boardCard, boardController, cardDetail } from '../../test/board.js'
import { CardPanel, type CardPanelProps } from './CardPanel.js'

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
})

// userEvent.setup() installs a clipboard of its own, so ours goes on afterwards.
function withClipboard(): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}

function renderPanel(props: Partial<CardPanelProps> = {}): CardPanelProps {
  const all: CardPanelProps = {
    card: boardCard(),
    detail: cardDetail(),
    board: boardController(),
    width: 420,
    onWidth: vi.fn(),
    onClose: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    ...props
  }
  render(<CardPanel {...all} />)
  return all
}

describe('CardPanel', () => {
  it('is a complementary region named by the card', () => {
    renderPanel()

    expect(screen.getByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Description' })).toBeInTheDocument()
  })

  it('moves the card to the status chosen', async () => {
    const { onMove } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }))

    expect(onMove).toHaveBeenCalledWith({ status: 'done', index: 0 })
  })

  it('marks the current status and sends nothing for it', async () => {
    const { onMove } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    const current = screen.getByRole('menuitemradio', { name: 'Backlog' })
    expect(current).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(current)

    expect(onMove).not.toHaveBeenCalled()
  })

  it('sets the priority', async () => {
    const { board } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'No priority' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))

    expect(board.update).toHaveBeenCalledWith('backlog/Fix login.md', { priority: 'high' })
  })

  it('clears the priority and sends nothing for the one it has', async () => {
    const { board } = renderPanel({
      card: boardCard({ meta: { links: [], runs: [], priority: 'high' } })
    })

    await userEvent.click(screen.getByRole('button', { name: 'High' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
    await userEvent.click(screen.getByRole('button', { name: 'High' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'No priority' }))

    expect(board.update).toHaveBeenCalledTimes(1)
    expect(board.update).toHaveBeenCalledWith('backlog/Fix login.md', { priority: null })
  })

  it('sets the tag', async () => {
    const { board } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'No tag' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Bug' }))

    expect(board.update).toHaveBeenCalledWith('backlog/Fix login.md', { tag: 'bug' })
  })

  it('shows the tag in its colour and clears it', async () => {
    const { board } = renderPanel({
      card: boardCard({ meta: { links: [], runs: [], tag: 'bug' } })
    })

    const trigger = screen.getByTitle('Tag')
    expect(trigger).toHaveAccessibleName('Bug')
    expect(screen.getByText('Bug')).toHaveStyle({ '--project-color': 'var(--project-red)' })
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Bug' }))
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'No tag' }))

    expect(board.update).toHaveBeenCalledTimes(1)
    expect(board.update).toHaveBeenCalledWith('backlog/Fix login.md', { tag: null })
  })

  it('offers every workspace tag', async () => {
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'No tag' }))

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(13)
  })

  it('asks to delete from the More menu', async () => {
    const { onRemove, board } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(board.remove).not.toHaveBeenCalled()
  })

  it('closes', async () => {
    const { onClose } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('widens from its left edge', async () => {
    const { onWidth } = renderPanel()

    screen.getByRole('separator', { name: 'Resize panel' }).focus()
    await userEvent.keyboard('{ArrowLeft}')

    expect(onWidth).toHaveBeenLastCalledWith(436)
  })

  it('copies the description', async () => {
    const user = withClipboard()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Copy description' }))

    expect(writeText).toHaveBeenCalledWith('# Fix login\n\nThe form forgets the e-mail.')
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('says when the copy was refused', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = withClipboard()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Copy description' }))

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
  })

  it('cannot copy before the description arrives', () => {
    renderPanel({ detail: null })

    expect(screen.getByRole('button', { name: 'Copy description' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: 'Description' })).toBeNull()
  })

  it('warns instead of describing a file that is not UTF-8', () => {
    renderPanel({
      card: boardCard({ notText: true }),
      detail: cardDetail({ notText: true, description: '' })
    })

    expect(
      screen.getByText(
        'This file is not UTF-8 text. It is shown by its file name and is not changed here.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Description' })).toBeNull()
  })
})
