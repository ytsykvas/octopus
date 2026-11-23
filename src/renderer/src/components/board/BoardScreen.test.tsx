import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { BoardListing } from '@core/boardSchema.js'

import type { Result } from '../../../../preload/index.js'
import {
  boardCard,
  boardListing,
  boardProject,
  givenBoard,
  ok,
  refusal,
  renderScreen
} from '../../test/board.js'
import { held } from '../../test/held.js'
import { octopus } from '../../test/octopus.js'

describe('BoardScreen', () => {
  it('draws nothing before the config arrives', () => {
    const { container } = renderScreen({ boardFolder: null })

    expect(container).toBeEmptyDOMElement()
    expect(octopus().board.list).not.toHaveBeenCalled()
  })

  it('asks for a folder first', async () => {
    const { props } = renderScreen({ boardFolder: '' })

    expect(screen.getByText('Choose where tasks live')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose folder…' }))
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(octopus().board.list).not.toHaveBeenCalled()
  })

  it('asks for a project once a folder is set', () => {
    renderScreen({ project: null })

    expect(screen.getByText('No project selected')).toBeInTheDocument()
    expect(screen.getByText('Pick a project on the far left to see its board.')).toBeInTheDocument()
  })

  it('draws neither columns nor a message while the first read is out', async () => {
    const answer = held<Result<BoardListing>>()
    vi.mocked(octopus().board.list).mockReturnValueOnce(answer.promise)

    renderScreen()

    expect(screen.queryAllByRole('region')).toEqual([])
    expect(screen.queryByText('The board could not be read')).toBeNull()
    await act(async () => {
      answer.resolve(ok(boardListing([])))
      await answer.promise
    })
  })

  it('says the board could not be read and offers to retry', async () => {
    vi.mocked(octopus().board.list)
      .mockResolvedValueOnce(
        refusal('boardFolderUnreadable', { path: '/tmp/board', reason: 'EACCES' })
      )
      .mockResolvedValueOnce(ok(boardListing([])))

    renderScreen()

    expect(await screen.findByText('The board could not be read')).toBeInTheDocument()
    expect(
      screen.getByText('The board folder /tmp/board cannot be used: EACCES')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByRole('region')).toHaveLength(6)
  })

  it('lays out six columns in order', async () => {
    givenBoard([])

    renderScreen()

    const columns = await screen.findAllByRole('region')
    expect(columns.map((column) => column.getAttribute('aria-label'))).toEqual([
      'Backlog',
      'In progress',
      'Testing',
      'Staging',
      'Done',
      'Blocked'
    ])
  })

  it('shows an empty board for a project with no folder yet', async () => {
    givenBoard([])

    renderScreen()

    expect(await screen.findAllByText('Nothing here')).toHaveLength(6)
  })

  it('puts every card under its status', async () => {
    givenBoard([
      boardCard({ ref: 'backlog/A.md', status: 'backlog', title: 'A' }),
      boardCard({ ref: 'done/B.md', status: 'done', title: 'B' })
    ])

    renderScreen()

    expect(
      await within(await screen.findByRole('region', { name: 'Done' })).findByText('B')
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Backlog' })).getByText('A')
    ).toBeInTheDocument()
  })

  it('puts a loose card under Backlog', async () => {
    givenBoard([boardCard({ ref: 'notes.md', loose: true, title: 'Notes' })])

    renderScreen()

    expect(
      await within(await screen.findByRole('region', { name: 'Backlog' })).findByText('Notes')
    ).toBeInTheDocument()
  })

  it("writes the folder it reads into the title bar's slot", async () => {
    vi.mocked(octopus().board.list).mockResolvedValue(
      ok({ folder: '/tmp/board/Planner', cards: [] })
    )
    const slot = document.createElement('span')

    renderScreen({ titleSlot: slot })

    await waitFor(() => {
      expect(slot).toHaveTextContent(/^\/tmp\/board\/Planner$/)
    })
  })

  it('creates a task in the column it was asked in', async () => {
    givenBoard([])
    const user = userEvent.setup()
    renderScreen()
    const testing = await screen.findByRole('region', { name: 'Testing' })

    await user.click(within(testing).getByRole('button', { name: 'New task' }))
    await user.type(within(testing).getByRole('textbox', { name: 'Task title' }), 'New{Enter}')

    expect(octopus().board.create).toHaveBeenCalledWith('planner', {
      status: 'testing',
      title: 'New'
    })
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    await waitFor(() => {
      expect(octopus().board.list).toHaveBeenCalledTimes(2)
    })
  })

  it('shows the new card once the board is read again', async () => {
    givenBoard([])
    const user = userEvent.setup()
    renderScreen()
    const testing = await screen.findByRole('region', { name: 'Testing' })
    givenBoard([boardCard({ ref: 'testing/New.md', status: 'testing', title: 'New' })])

    await user.click(within(testing).getByRole('button', { name: 'New task' }))
    await user.type(within(testing).getByRole('textbox', { name: 'Task title' }), 'New{Enter}')

    expect(await within(testing).findByText('New')).toBeInTheDocument()
  })

  it('moves the field to the column whose + was pressed', async () => {
    givenBoard([])
    const user = userEvent.setup()
    renderScreen()
    const backlog = await screen.findByRole('region', { name: 'Backlog' })
    const testing = screen.getByRole('region', { name: 'Testing' })

    await user.click(within(backlog).getByRole('button', { name: 'New task' }))
    await user.type(within(backlog).getByRole('textbox', { name: 'Task title' }), 'A')
    await user.click(within(testing).getByRole('button', { name: 'New task' }))

    expect(octopus().board.create).toHaveBeenCalledWith('planner', {
      status: 'backlog',
      title: 'A'
    })
    expect(within(testing).getByRole('textbox', { name: 'Task title' })).toHaveFocus()
    expect(within(backlog).queryByRole('textbox', { name: 'Task title' })).toBeNull()
    await waitFor(() => {
      expect(octopus().board.list).toHaveBeenCalledTimes(2)
    })
  })

  it('drops the new-task field when the project changes', async () => {
    givenBoard([])
    const user = userEvent.setup()
    const { rerender } = renderScreen()
    const testing = await screen.findByRole('region', { name: 'Testing' })
    await user.click(within(testing).getByRole('button', { name: 'New task' }))

    rerender({ project: boardProject({ id: 'ledger', name: 'ledger' }) })

    expect(await screen.findAllByRole('region')).toHaveLength(6)
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
  })
})
