import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardListing, CardDetail } from '@core/boardSchema.js'

import type { Result } from '../../../../preload/index.js'
import {
  boardCard,
  boardListing,
  boardProject,
  cardDetail,
  givenBoard,
  ok,
  refusal,
  renderScreen
} from '../../test/board.js'
import { stubDialogElement } from '../../test/dialog.js'
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

  it('drops the new-task field when the board folder changes', async () => {
    givenBoard([])
    const user = userEvent.setup()
    const { rerender } = renderScreen()
    const testing = await screen.findByRole('region', { name: 'Testing' })
    await user.click(within(testing).getByRole('button', { name: 'New task' }))

    rerender({ boardFolder: '/tmp/other' })

    expect(await screen.findAllByRole('region')).toHaveLength(6)
    expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
  })

  describe('the card panel', () => {
    beforeAll(stubDialogElement)

    beforeEach(() => {
      givenBoard([boardCard()])
      vi.mocked(octopus().board.read).mockResolvedValue(ok(cardDetail()))
    })

    function twoCards(): void {
      givenBoard([
        boardCard({ ref: 'backlog/A.md', title: 'A' }),
        boardCard({ ref: 'backlog/B.md', title: 'B' })
      ])
    }

    function focusWindow(): void {
      act(() => {
        window.dispatchEvent(new Event('focus'))
      })
    }

    async function openPanel(user: UserEvent, title = 'Fix login'): Promise<HTMLElement> {
      await user.click(await screen.findByRole('button', { name: title }))
      return screen.findByRole('complementary', { name: title })
    }

    async function chooseStatus(
      user: UserEvent,
      panel: HTMLElement,
      status: string
    ): Promise<void> {
      await user.click(within(panel).getByRole('button', { name: 'Backlog' }))
      await user.click(screen.getByRole('menuitemradio', { name: status }))
    }

    async function askToDelete(user: UserEvent, panel: HTMLElement): Promise<HTMLElement> {
      await user.click(within(panel).getByRole('button', { name: 'More' }))
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      return screen.findByRole('dialog', { name: /^Delete “.+”\?$/ })
    }

    it('opens the panel of the clicked card', async () => {
      const user = userEvent.setup()
      renderScreen()

      await openPanel(user)

      expect(screen.getByRole('button', { name: 'Fix login' })).toHaveAttribute(
        'aria-current',
        'true'
      )
    })

    it('closes the panel', async () => {
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)

      await user.click(within(panel).getByRole('button', { name: 'Close' }))

      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it('opens the panel of a card just created', async () => {
      vi.mocked(octopus().board.create).mockResolvedValueOnce(ok('testing/New.md'))
      const user = userEvent.setup()
      renderScreen()
      const testing = await screen.findByRole('region', { name: 'Testing' })
      givenBoard([
        boardCard(),
        boardCard({ ref: 'testing/New.md', status: 'testing', title: 'New' })
      ])

      await user.click(within(testing).getByRole('button', { name: 'New task' }))
      await user.type(within(testing).getByRole('textbox', { name: 'Task title' }), 'New{Enter}')

      expect(await screen.findByRole('complementary', { name: 'New' })).toBeInTheDocument()
    })

    it('keeps the open panel when the creation was refused', async () => {
      vi.mocked(octopus().board.create).mockResolvedValueOnce(
        refusal('cardNameTaken', { name: 'New.md' })
      )
      const user = userEvent.setup()
      const { props } = renderScreen()
      await openPanel(user)
      const testing = screen.getByRole('region', { name: 'Testing' })

      await user.click(within(testing).getByRole('button', { name: 'New task' }))
      await user.type(within(testing).getByRole('textbox', { name: 'Task title' }), 'New{Enter}')

      await waitFor(() => {
        expect(props.onError).toHaveBeenCalledWith('A file named “New.md” is already there.')
      })
      expect(screen.getByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    })

    it('drops the panel of a card that left the listing, and shows it again when it is back', async () => {
      const user = userEvent.setup()
      renderScreen()
      await openPanel(user)

      givenBoard([])
      focusWindow()
      await waitFor(() => {
        expect(screen.queryByRole('complementary')).toBeNull()
      })
      expect(octopus().board.read).toHaveBeenCalledTimes(1)
      givenBoard([boardCard()])
      focusWindow()

      expect(await screen.findByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    })

    it('follows a card moved by its status menu', async () => {
      vi.mocked(octopus().board.move).mockResolvedValueOnce(ok('done/Fix login.md'))
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)
      givenBoard([boardCard({ ref: 'done/Fix login.md', status: 'done' })])

      await chooseStatus(user, panel, 'Done')

      const done = screen.getByRole('region', { name: 'Done' })
      expect(await within(done).findByRole('button', { name: 'Fix login' })).toHaveAttribute(
        'aria-current',
        'true'
      )
      expect(screen.getByRole('complementary', { name: 'Fix login' })).toBe(panel)
    })

    it('stays on the card when the move was refused', async () => {
      vi.mocked(octopus().board.move).mockResolvedValueOnce(
        refusal('cardMissing', { name: 'Fix login.md' })
      )
      const user = userEvent.setup()
      const { props } = renderScreen()
      const panel = await openPanel(user)

      await chooseStatus(user, panel, 'Done')

      await waitFor(() => {
        expect(props.onError).toHaveBeenCalledWith('“Fix login.md” is no longer on disk.')
      })
      expect(screen.getByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    })

    it('keeps the card opened meanwhile when a move finishes', async () => {
      twoCards()
      const sent = held<Result<string>>()
      vi.mocked(octopus().board.move).mockReturnValueOnce(sent.promise)
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user, 'A')
      await chooseStatus(user, panel, 'Done')

      await openPanel(user, 'B')
      await act(async () => {
        sent.resolve(ok('done/A.md'))
        await sent.promise
      })

      expect(screen.getByRole('complementary', { name: 'B' })).toBeInTheDocument()
    })

    it('keeps the panel closed when a move finishes after it', async () => {
      const sent = held<Result<string>>()
      vi.mocked(octopus().board.move).mockReturnValueOnce(sent.promise)
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)
      givenBoard([boardCard({ ref: 'done/Fix login.md', status: 'done' })])
      await chooseStatus(user, panel, 'Done')

      await user.click(within(panel).getByRole('button', { name: 'Close' }))
      await act(async () => {
        sent.resolve(ok('done/Fix login.md'))
        await sent.promise
      })

      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it('deletes the open card after asking and closes the panel', async () => {
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)

      const dialog = await askToDelete(user, panel)
      expect(dialog).toHaveAccessibleName('Delete “Fix login”?')
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(octopus().board.remove).toHaveBeenCalledWith('planner', 'backlog/Fix login.md')
      await waitFor(() => {
        expect(screen.queryByRole('complementary')).toBeNull()
      })
    })

    it('keeps the card when the question is cancelled', async () => {
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)

      const dialog = await askToDelete(user, panel)
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      expect(octopus().board.remove).not.toHaveBeenCalled()
      expect(screen.getByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    })

    it('keeps the panel when the delete was refused', async () => {
      vi.mocked(octopus().board.remove).mockResolvedValueOnce(
        refusal('cardMissing', { name: 'Fix login.md' })
      )
      const user = userEvent.setup()
      const { props } = renderScreen()
      const panel = await openPanel(user)

      const dialog = await askToDelete(user, panel)
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await waitFor(() => {
        expect(props.onError).toHaveBeenCalledWith('“Fix login.md” is no longer on disk.')
      })
      expect(screen.getByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    })

    it('keeps the card opened meanwhile when a delete finishes', async () => {
      twoCards()
      const sent = held<Result<undefined>>()
      vi.mocked(octopus().board.remove).mockReturnValueOnce(sent.promise)
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user, 'A')
      const dialog = await askToDelete(user, panel)
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      await openPanel(user, 'B')
      await act(async () => {
        sent.resolve(ok(undefined))
        await sent.promise
      })

      expect(screen.getByRole('complementary', { name: 'B' })).toBeInTheDocument()
    })

    it('forgets the open card when the project changes', async () => {
      const user = userEvent.setup()
      const { rerender } = renderScreen()
      await openPanel(user)

      rerender({ project: boardProject({ id: 'ledger', name: 'ledger' }) })

      expect(await screen.findAllByRole('region')).toHaveLength(6)
      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it('forgets the open card when the board folder changes', async () => {
      const user = userEvent.setup()
      const { rerender } = renderScreen()
      await openPanel(user)

      rerender({ boardFolder: '/tmp/other' })

      expect(await screen.findAllByRole('region')).toHaveLength(6)
      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it('keeps the description through a move', async () => {
      vi.mocked(octopus().board.move).mockResolvedValueOnce(ok('done/Fix login.md'))
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)
      await within(panel).findByRole('region', { name: 'Description' })
      const reread = held<Result<CardDetail>>()
      vi.mocked(octopus().board.read).mockReturnValueOnce(reread.promise)
      givenBoard([boardCard({ ref: 'done/Fix login.md', status: 'done' })])

      await chooseStatus(user, panel, 'Done')
      await within(panel).findByRole('button', { name: 'Done' })

      expect(within(panel).getByRole('region', { name: 'Description' })).toBeInTheDocument()
      await act(async () => {
        reread.resolve(ok(cardDetail({ ref: 'done/Fix login.md', status: 'done' })))
        await reread.promise
      })
    })

    it('shows nothing of the last card in the next one opened', async () => {
      twoCards()
      const user = userEvent.setup()
      renderScreen()
      const first = await openPanel(user, 'A')
      await within(first).findByRole('region', { name: 'Description' })
      await user.click(within(first).getByRole('button', { name: 'Close' }))
      const next = held<Result<CardDetail>>()
      vi.mocked(octopus().board.read).mockReturnValueOnce(next.promise)

      const panel = await openPanel(user, 'B')

      expect(within(panel).queryByRole('region', { name: 'Description' })).toBeNull()
      await act(async () => {
        next.resolve(ok(cardDetail({ ref: 'backlog/B.md', title: 'B' })))
        await next.promise
      })
    })

    it('says in the panel why the card could not be read', async () => {
      vi.mocked(octopus().board.read).mockResolvedValue(refusal('cardOutside', { name: 'x.md' }))
      const user = userEvent.setup()
      const { props } = renderScreen()

      const panel = await openPanel(user)

      expect(
        await within(panel).findByText('“x.md” is not inside the board folder.')
      ).toBeInTheDocument()
      expect(props.onError).not.toHaveBeenCalledWith('“x.md” is not inside the board folder.')
    })

    it('opens nothing on the next project for a card created on the last', async () => {
      const sent = held<Result<string>>()
      vi.mocked(octopus().board.create).mockReturnValueOnce(sent.promise)
      const user = userEvent.setup()
      const { rerender } = renderScreen()
      const testing = await screen.findByRole('region', { name: 'Testing' })
      givenBoard([
        boardCard(),
        boardCard({ ref: 'testing/New.md', status: 'testing', title: 'New' })
      ])
      await user.click(within(testing).getByRole('button', { name: 'New task' }))
      await user.type(within(testing).getByRole('textbox', { name: 'Task title' }), 'New{Enter}')

      rerender({ project: boardProject({ id: 'ledger', name: 'ledger' }) })
      await screen.findByRole('button', { name: 'New' })
      await act(async () => {
        sent.resolve(ok('testing/New.md'))
        await sent.promise
      })

      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it("leaves the next project's panel alone when a move on the last finishes", async () => {
      const sent = held<Result<string>>()
      vi.mocked(octopus().board.move).mockReturnValueOnce(sent.promise)
      const user = userEvent.setup()
      const { rerender } = renderScreen()
      await chooseStatus(user, await openPanel(user), 'Done')

      rerender({ project: boardProject({ id: 'ledger', name: 'ledger' }) })
      await openPanel(user)
      await act(async () => {
        sent.resolve(ok('done/Fix login.md'))
        await sent.promise
      })

      expect(screen.getByRole('complementary', { name: 'Fix login' })).toBeInTheDocument()
    })

    it('widens the panel', async () => {
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)

      within(panel).getByRole('separator', { name: 'Resize panel' }).focus()
      await user.keyboard('{ArrowLeft}')

      expect(within(panel).getByRole('separator', { name: 'Resize panel' })).toHaveAttribute(
        'aria-valuenow',
        '436'
      )
    })
  })
})
