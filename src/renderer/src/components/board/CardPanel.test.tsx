import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { boardCard, boardController, cardDetail, refusal } from '../../test/board.js'
import { workspaceView } from '../../test/workspaces.js'
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
    failure: null,
    board: boardController(),
    draft: null,
    onDraft: vi.fn(),
    width: 420,
    onWidth: vi.fn(),
    onClose: vi.fn(),
    onMove: vi.fn(),
    onRemove: vi.fn(),
    linked: null,
    onRun: vi.fn(() => Promise.resolve()),
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

  it('cannot copy a file that is not UTF-8', () => {
    renderPanel({
      card: boardCard({ notText: true }),
      detail: cardDetail({ notText: true, description: '' })
    })

    expect(screen.getByRole('button', { name: 'Copy description' })).toBeDisabled()
  })

  it('says why the card could not be read', () => {
    renderPanel({ detail: null, failure: refusal('cardOutside', { name: 'x.md' }) })

    expect(screen.getByText('“x.md” is not inside the board folder.')).toBeInTheDocument()
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

  it('renames on a double-click', async () => {
    const user = userEvent.setup()
    const { board } = renderPanel()

    await user.dblClick(screen.getByRole('heading', { name: 'Fix login' }))
    const name = screen.getByTitle('Enter to save, Escape to cancel')
    await user.clear(name)
    await user.type(name, 'Fix sign-in{Enter}')

    expect(board.rename).toHaveBeenCalledWith('backlog/Fix login.md', 'Fix sign-in')
    expect(screen.queryByTitle('Enter to save, Escape to cancel')).toBeNull()
  })

  it('sends nothing for an unchanged name', async () => {
    const user = userEvent.setup()
    const { board } = renderPanel()

    await user.dblClick(screen.getByRole('heading', { name: 'Fix login' }))
    expect(screen.getByTitle('Enter to save, Escape to cancel')).toHaveValue('Fix login')
    await user.keyboard('{Enter}')

    expect(board.rename).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Fix login' })).toBeInTheDocument()
  })

  it('leaves the name alone on Escape', async () => {
    const user = userEvent.setup()
    const { board } = renderPanel()

    await user.dblClick(screen.getByRole('heading', { name: 'Fix login' }))
    expect(screen.getByTitle('Enter to save, Escape to cancel')).toHaveFocus()
    await user.keyboard('X{Escape}')

    expect(screen.getByRole('heading', { name: 'Fix login' })).toBeInTheDocument()
    expect(board.rename).not.toHaveBeenCalled()
  })

  it('saves the description through the board', async () => {
    const user = userEvent.setup()
    const { board } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Description' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(board.saveDescription).toHaveBeenCalledWith('backlog/Fix login.md', {
      text: '# Fix login\n\nThe form forgets the e-mail.\n!',
      base: '# Fix login\n\nThe form forgets the e-mail.\n'
    })
  })

  it('adds a comment through the board', async () => {
    const user = userEvent.setup()
    const { board } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Add a comment' }))
    await user.type(screen.getByRole('textbox', { name: 'Write a comment… ⌘↩ to post' }), 'Asked.')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(board.comment).toHaveBeenCalledWith('backlog/Fix login.md', 'Asked.')
  })

  it('shows the comments of a file that is not UTF-8', () => {
    renderPanel({
      card: boardCard({ notText: true }),
      detail: cardDetail({
        notText: true,
        description: '',
        thread: [{ at: '2026-11-21T14:05:00.000Z', text: 'First' }]
      })
    })

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('offers Run for a card not started here', async () => {
    const { onRun } = renderPanel()

    await userEvent.click(screen.getByRole('button', { name: 'Run' }))

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Open workspace' })).toBeNull()
  })

  it('offers to open the workspace started from the card here', async () => {
    const { onRun } = renderPanel({
      linked: workspaceView('anna', { card: '2f1c0b6e-5f0e-4d6e-9c55-0d6c1c2a7a11' })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Open workspace' }))

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
  })

  it('disables the button while the run is under way', async () => {
    let finish: () => void = () => undefined
    renderPanel({
      onRun: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
    })
    const button = screen.getByRole('button', { name: 'Run' })

    await userEvent.click(button)

    expect(button).toBeDisabled()
    act(() => {
      finish()
    })
    await waitFor(() => {
      expect(button).toBeEnabled()
    })
  })
})
