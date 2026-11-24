import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BoardCard,
  BoardListing,
  BoardStatus,
  CardDetail,
  CardMeta,
  CardRunEntry
} from '@core/boardSchema.js'

import type { Result } from '../../../../preload/index.js'
import {
  boardCard,
  boardListing,
  boardProject,
  BRANCH_REQUEST,
  cardDetail,
  draftStore,
  givenBoard,
  ok,
  refusal,
  renderScreen
} from '../../test/board.js'
import { stubDialogElement } from '../../test/dialog.js'
import { held } from '../../test/held.js'
import { octopus } from '../../test/octopus.js'
import { workspaceView } from '../../test/workspaces.js'
import { type BoardFilter, EMPTY_BOARD_FILTER } from './boardFilter.js'
import type { BoardScreenProps } from './BoardScreen.js'

const ID = '2f1c0b6e-5f0e-4d6e-9c55-0d6c1c2a7a11'
const ELSEWHERE: CardRunEntry = {
  started: '2026-11-21T12:00:00.000Z',
  device: 'device-two',
  machine: 'Mac-Two',
  branch: 'octopus/feature/anna'
}

const card = (ref: string, status: BoardStatus, order: number): BoardCard =>
  boardCard({
    ref,
    status,
    title: ref.slice(ref.indexOf('/') + 1, -'.md'.length),
    meta: { links: [], runs: [], order }
  })

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

    it("changes a task's status from the keyboard", async () => {
      const user = userEvent.setup()
      renderScreen()
      const panel = await openPanel(user)
      act(() => {
        within(panel).getByRole('button', { name: 'Backlog' }).focus()
      })

      await user.keyboard('{Enter}{ArrowDown}{Enter}')

      expect(octopus().board.move).toHaveBeenCalledWith('planner', 'backlog/Fix login.md', {
        status: 'in progress',
        index: 0
      })
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

    describe('an unsaved description', () => {
      beforeEach(() => {
        twoCards()
        vi.mocked(octopus().board.read).mockImplementation((_projectId, ref) =>
          Promise.resolve(
            ok(cardDetail({ ref, title: ref === 'backlog/A.md' ? 'A' : 'B', description: '# A\n' }))
          )
        )
      })

      async function typeInto(user: UserEvent, panel: HTMLElement): Promise<void> {
        await user.click(await within(panel).findByRole('button', { name: 'Edit' }))
        await user.type(within(panel).getByRole('textbox', { name: 'Description' }), '!')
      }

      it('keeps an unsaved description when the panel closes', async () => {
        const user = userEvent.setup()
        renderScreen({ ...draftStore() })
        const panel = await openPanel(user, 'A')
        await typeInto(user, panel)

        await user.click(within(panel).getByRole('button', { name: 'Close' }))
        const again = await openPanel(user, 'A')

        expect(await within(again).findByRole('textbox', { name: 'Description' })).toHaveValue(
          '# A\n!'
        )
      })

      it('keeps it when another card opens', async () => {
        const user = userEvent.setup()
        renderScreen({ ...draftStore() })
        await typeInto(user, await openPanel(user, 'A'))

        const other = await openPanel(user, 'B')
        await within(other).findByRole('button', { name: 'Edit' })
        expect(within(other).queryByRole('textbox', { name: 'Description' })).toBeNull()
        const again = await openPanel(user, 'A')

        expect(await within(again).findByRole('textbox', { name: 'Description' })).toHaveValue(
          '# A\n!'
        )
      })

      it('keeps it when the status changes', async () => {
        vi.mocked(octopus().board.move).mockResolvedValueOnce(ok('done/A.md'))
        const user = userEvent.setup()
        renderScreen({ ...draftStore() })
        const panel = await openPanel(user, 'A')
        await typeInto(user, panel)
        givenBoard([
          boardCard({ ref: 'done/A.md', status: 'done', title: 'A' }),
          boardCard({ ref: 'backlog/B.md', title: 'B' })
        ])

        await chooseStatus(user, panel, 'Done')
        await within(screen.getByRole('region', { name: 'Done' })).findByRole('button', {
          name: 'A'
        })

        expect(
          await within(screen.getByRole('complementary', { name: 'A' })).findByRole('textbox', {
            name: 'Description'
          })
        ).toHaveValue('# A\n!')
      })

      it('opens a card created where a deleted one was without its draft', async () => {
        vi.mocked(octopus().board.create).mockResolvedValueOnce(ok('backlog/A.md'))
        const user = userEvent.setup()
        renderScreen({ ...draftStore() })
        const panel = await openPanel(user, 'A')
        await typeInto(user, panel)
        givenBoard([boardCard({ ref: 'backlog/B.md', title: 'B' })])
        const dialog = await askToDelete(user, panel)
        await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
        await waitFor(() => {
          expect(screen.queryByRole('complementary')).toBeNull()
        })
        twoCards()

        const backlog = screen.getByRole('region', { name: 'Backlog' })
        await user.click(within(backlog).getByRole('button', { name: 'New task' }))
        await user.type(within(backlog).getByRole('textbox', { name: 'Task title' }), 'A{Enter}')
        const fresh = await screen.findByRole('complementary', { name: 'A' })

        await within(fresh).findByRole('button', { name: 'Edit' })
        expect(within(fresh).queryByRole('textbox', { name: 'Description' })).toBeNull()
      })

      it('carries the draft of a moved card to its new ref', async () => {
        vi.mocked(octopus().board.move).mockResolvedValueOnce(ok('done/A.md'))
        const user = userEvent.setup()
        const { props } = renderScreen()
        const panel = await openPanel(user, 'A')

        await chooseStatus(user, panel, 'Done')

        await waitFor(() => {
          expect(props.onDraftMoved).toHaveBeenCalledWith('backlog/A.md', 'done/A.md')
        })
      })
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

    describe('running a card', () => {
      async function openWith(
        meta: CardMeta,
        overrides: Partial<BoardScreenProps> = {}
      ): Promise<{ readonly user: UserEvent; readonly props: BoardScreenProps }> {
        givenBoard([boardCard({ meta })])
        vi.mocked(octopus().board.read).mockResolvedValue(ok(cardDetail({ meta })))
        const user = userEvent.setup()
        const { props } = renderScreen(overrides)
        await user.click(await screen.findByRole('button', { name: /^Fix login/ }))
        await screen.findByRole('complementary', { name: 'Fix login' })
        return { user, props }
      }

      it('asks before running a card still in work on another Mac', async () => {
        const { user, props } = await openWith({ links: [], runs: [ELSEWHERE] })

        await user.click(screen.getByRole('button', { name: 'Run' }))
        const question = await screen.findByRole('dialog', { name: 'Already in work on Mac-Two' })
        await user.click(within(question).getByRole('button', { name: 'Cancel' }))
        expect(props.onRun).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Run' }))
        await user.click(await screen.findByRole('button', { name: 'Start here' }))
        expect(props.onRun).toHaveBeenCalledWith('planner', 'backlog/Fix login.md')
      })

      it("runs at once a card whose open run is this Mac's", async () => {
        const { user, props } = await openWith({
          links: [],
          runs: [{ ...ELSEWHERE, device: 'device-one' }]
        })

        await user.click(screen.getByRole('button', { name: 'Run' }))

        expect(props.onRun).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      it('runs at once a card whose run elsewhere has ended', async () => {
        const { user, props } = await openWith({
          links: [],
          runs: [{ ...ELSEWHERE, ended: '2026-11-21T13:00:00.000Z' }]
        })

        await user.click(screen.getByRole('button', { name: 'Run' }))

        expect(props.onRun).toHaveBeenCalledTimes(1)
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      it('opens the workspace started here without asking', async () => {
        const { user, props } = await openWith(
          { id: ID, links: [], runs: [ELSEWHERE] },
          { workspaces: [workspaceView('anna', { card: ID })] }
        )

        await user.click(screen.getByRole('button', { name: 'Open workspace' }))

        expect(props.onRun).toHaveBeenCalledWith('planner', 'backlog/Fix login.md')
        expect(screen.queryByRole('dialog')).toBeNull()
      })

      it("lists this Mac's open run with no workspace here as removed", async () => {
        await openWith({
          links: [],
          runs: [{ ...ELSEWHERE, device: 'device-one', machine: 'Mac-One' }]
        })

        expect(screen.getByRole('region', { name: 'Runs' })).toHaveTextContent(
          'Mac-One · workspace removed'
        )
      })

      it('offers Run for a card a workspace here did not start', async () => {
        await openWith(
          { id: ID, links: [], runs: [] },
          { workspaces: [workspaceView('anna', { card: '7d3e9a10-2b4c-4f8e-8a1d-5c6b7e8f9a0b' })] }
        )

        expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Open workspace' })).toBeNull()
      })
    })
  })

  describe('the marks on a card', () => {
    const STARTED = boardCard({ meta: { id: ID, links: [], runs: [] } })

    it('marks a card with the workspace started from it', async () => {
      givenBoard([STARTED])
      renderScreen({
        workspaces: [workspaceView('anna', { card: ID, status: 'waiting_permission' })]
      })

      expect(await screen.findByRole('button', { name: /^Fix login/ })).toHaveTextContent(
        'Needs your answer'
      )
    })

    it('shows the pull request of that workspace', async () => {
      givenBoard([STARTED])
      renderScreen({
        workspaces: [workspaceView('anna', { card: ID })],
        requests: new Map([['ytsykvas/anna', BRANCH_REQUEST]])
      })

      expect(
        within(await screen.findByRole('button', { name: /^Fix login/ })).getByRole('img', {
          name: 'Pull request #7 — checks passed'
        })
      ).toBeInTheDocument()
    })

    it('does not mark a card with a workspace started from another card', async () => {
      givenBoard([STARTED])
      renderScreen({
        workspaces: [workspaceView('anna', { card: '7d3e9a10-2b4c-4f8e-8a1d-5c6b7e8f9a0b' })]
      })

      expect(await screen.findByRole('button', { name: /^Fix login/ })).toHaveTextContent(
        /^Fix login$/
      )
    })

    it('marks a card in work on another Mac', async () => {
      givenBoard([boardCard({ meta: { links: [], runs: [ELSEWHERE] } })])
      renderScreen()

      expect(await screen.findByText('In work on Mac-Two')).toBeInTheDocument()
    })

    it('marks as removed a run this Mac left open with no workspace here', async () => {
      givenBoard([
        boardCard({ meta: { links: [], runs: [{ ...ELSEWHERE, device: 'device-one' }] } })
      ])
      renderScreen()

      expect(await screen.findByText('Workspace removed')).toBeInTheDocument()
    })
  })

  describe('dragging a card', () => {
    interface Transfer {
      readonly types: string[]
      effectAllowed: string
      dropEffect: string
      setData: (type: string, value: string) => void
    }

    // jsdom has no DataTransfer, and `clientY` given to fireEvent never reaches a plain Event.
    function transfer(): Transfer {
      const types: string[] = []
      return {
        types,
        effectAllowed: 'none',
        dropEffect: 'none',
        setData: (type) => {
          types.push(type)
        }
      }
    }

    function dragOverAt(target: HTMLElement, clientY: number, data: Transfer): void {
      const event = createEvent.dragOver(target, { dataTransfer: data })
      Object.defineProperty(event, 'clientY', { value: clientY })
      fireEvent(target, event)
    }

    function li(name: string): HTMLElement {
      const item = screen.getByRole('button', { name }).closest('li')
      if (item === null) throw new Error(`No list item for ${name}`)
      return item
    }

    const column = (name: string): HTMLElement => screen.getByRole('region', { name })

    beforeEach(async () => {
      givenBoard([
        card('backlog/a.md', 'backlog', 1),
        card('backlog/b.md', 'backlog', 2),
        card('in progress/p.md', 'in progress', 1)
      ])
      renderScreen()
      await screen.findAllByRole('region')
    })

    it('draws the drop line under a card the pointer is in the lower half of', () => {
      const data = transfer()
      vi.spyOn(li('p'), 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40 } as DOMRect)

      fireEvent.dragStart(li('a'), { dataTransfer: data })
      dragOverAt(li('p'), 30, data)

      expect(within(li('p')).getByTestId('drop-line')).toHaveAttribute('data-edge', 'below')
      expect(li('a')).toHaveAttribute('data-dragging', 'true')
    })

    it('draws the drop line in an empty column', () => {
      const data = transfer()

      fireEvent.dragStart(li('a'), { dataTransfer: data })
      fireEvent.dragOver(column('Testing'), { dataTransfer: data })

      expect(within(column('Testing')).getByTestId('drop-line')).toHaveAttribute(
        'data-edge',
        'above'
      )
    })

    it('moves the file when a card is dropped on an empty column', async () => {
      const data = transfer()
      vi.mocked(octopus().board.move).mockResolvedValue(ok('testing/a.md'))

      fireEvent.dragStart(li('a'), { dataTransfer: data })
      fireEvent.dragOver(column('Testing'), { dataTransfer: data })
      fireEvent.drop(column('Testing'), { dataTransfer: data })

      expect(octopus().board.move).toHaveBeenCalledWith('planner', 'backlog/a.md', {
        status: 'testing',
        index: 0
      })
      await waitFor(() => {
        expect(octopus().board.list).toHaveBeenCalledTimes(2)
      })
    })

    it('keeps the panel on a card dragged to another column', async () => {
      const user = userEvent.setup()
      vi.mocked(octopus().board.read).mockResolvedValue(
        ok(cardDetail({ ref: 'backlog/a.md', title: 'a' }))
      )
      await user.click(screen.getByRole('button', { name: 'a' }))
      await screen.findByRole('complementary', { name: 'a' })
      vi.mocked(octopus().board.move).mockResolvedValue(ok('testing/a.md'))
      givenBoard([
        card('testing/a.md', 'testing', 1),
        card('backlog/b.md', 'backlog', 2),
        card('in progress/p.md', 'in progress', 1)
      ])
      const data = transfer()

      fireEvent.dragStart(li('a'), { dataTransfer: data })
      fireEvent.drop(column('Testing'), { dataTransfer: data })

      expect(
        await within(column('Testing')).findByRole('button', { name: 'a' })
      ).toBeInTheDocument()
      expect(screen.getByRole('complementary', { name: 'a' })).toBeInTheDocument()
    })

    it('leaves a file dragged in from Finder alone', () => {
      const finder = { types: ['Files'], files: [] }

      // Not cancelled: the browser then shows the file cannot be dropped, and never fires drop.
      expect(fireEvent.dragOver(li('a'), { dataTransfer: finder })).toBe(true)
      expect(fireEvent.dragOver(column('Done'), { dataTransfer: finder })).toBe(true)
      expect(screen.queryByTestId('drop-line')).toBeNull()
      expect(octopus().board.move).not.toHaveBeenCalled()
    })

    it('takes the line away when the pointer leaves the column for the panel', () => {
      const data = transfer()
      fireEvent.dragStart(li('a'), { dataTransfer: data })
      fireEvent.dragOver(column('Testing'), { dataTransfer: data })

      const leave = createEvent.dragLeave(column('Testing'), { dataTransfer: data })
      Object.defineProperty(leave, 'relatedTarget', { value: document.body })
      fireEvent(column('Testing'), leave)

      expect(screen.queryByTestId('drop-line')).toBeNull()
    })
  })

  describe('the keyboard', () => {
    beforeAll(stubDialogElement)

    const L0 = boardListing([
      card('backlog/a.md', 'backlog', 1),
      card('backlog/b.md', 'backlog', 2),
      card('in progress/p.md', 'in progress', 1)
    ])

    const button = (name: string): HTMLElement => screen.getByRole('button', { name })
    const region = (name: string): HTMLElement => screen.getByRole('region', { name })

    function focus(name: string): void {
      act(() => {
        button(name).focus()
      })
    }

    async function show(
      cards: readonly BoardCard[] = L0.cards,
      overrides: Partial<BoardScreenProps> = {}
    ): Promise<UserEvent> {
      givenBoard(cards)
      const user = userEvent.setup()
      renderScreen(overrides)
      await screen.findAllByRole('region')
      return user
    }

    async function openPanel(user: UserEvent, name: string): Promise<HTMLElement> {
      await user.click(button(name))
      return screen.findByRole('complementary', { name })
    }

    it('walks down a column with J and back up with the arrow', async () => {
      const user = await show()
      focus('a')

      await user.keyboard('j')
      expect(button('b')).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(button('a')).toHaveFocus()
    })

    it('crosses to the next column and back', async () => {
      const user = await show()
      focus('b')

      await user.keyboard('{ArrowRight}')
      expect(button('p')).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(button('a')).toHaveFocus()
    })

    it('starts at the first task when nothing is focused', async () => {
      const user = await show()

      await user.keyboard('j')

      expect(button('a')).toHaveFocus()
    })

    it('opens the focused task with Enter and closes it with Escape', async () => {
      const user = await show()
      focus('a')

      await user.keyboard('{Enter}')
      expect(await screen.findByRole('complementary', { name: 'a' })).toBeInTheDocument()
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('complementary')).toBeNull()
      expect(button('a')).toHaveFocus()
    })

    it('gives the focus back to the task it closes', async () => {
      const user = await show()
      await openPanel(user, 'a')
      act(() => {
        button('a').blur()
      })

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('complementary')).toBeNull()
      expect(button('a')).toHaveFocus()
    })

    it('lets go of the focused task with Escape', async () => {
      const user = await show()
      focus('a')

      await user.keyboard('{Escape}')

      expect(document.body).toHaveFocus()
      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it('moves the open task along with the focus', async () => {
      const user = await show()
      await openPanel(user, 'a')

      await user.keyboard('j')

      expect(await screen.findByRole('complementary', { name: 'b' })).toBeInTheDocument()
    })

    it('keeps the panel as it is when J has nowhere to go', async () => {
      const user = await show()
      await openPanel(user, 'b')

      await user.keyboard('j')

      expect(button('b')).toHaveFocus()
      expect(screen.getByRole('complementary', { name: 'b' })).toBeInTheDocument()
      expect(octopus().board.read).toHaveBeenCalledTimes(1)
    })

    it('keeps an unsaved description when J opens the next task', async () => {
      vi.mocked(octopus().board.read).mockImplementation((_projectId, ref) =>
        Promise.resolve(ok(cardDetail({ ref, title: ref === 'backlog/a.md' ? 'a' : 'b' })))
      )
      const user = await show(L0.cards, { ...draftStore() })
      await openPanel(user, 'a')
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      await user.type(screen.getByRole('textbox', { name: 'Description' }), '!')
      focus('a')

      await user.keyboard('j')
      await screen.findByRole('complementary', { name: 'b' })
      expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull()
      await user.keyboard('k')

      await screen.findByRole('complementary', { name: 'a' })
      const field = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Description' })
      expect(field.value).toMatch(/!$/)
    })

    it('moves a task down with ⌥↓', async () => {
      const user = await show()
      focus('a')

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      expect(octopus().board.move).toHaveBeenCalledWith('planner', 'backlog/a.md', {
        status: 'backlog',
        index: 1
      })
      await waitFor(() => {
        expect(octopus().board.list).toHaveBeenCalledTimes(2)
      })
    })

    it('keeps the focus on a task it moves', async () => {
      vi.mocked(octopus().board.move).mockResolvedValue(ok('backlog/a.md'))
      const user = await show()
      givenBoard([
        card('backlog/b.md', 'backlog', 1),
        card('backlog/a.md', 'backlog', 3),
        card('in progress/p.md', 'in progress', 1)
      ])
      focus('a')

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      await waitFor(() => {
        expect(button('b').compareDocumentPosition(button('a'))).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING
        )
      })
      expect(button('a')).toHaveFocus()
    })

    it('leaves the focus in a field opened while a loose task was moved', async () => {
      const loose = boardCard({
        ref: 'notes.md',
        title: 'notes',
        loose: true,
        meta: { links: [], runs: [] }
      })
      const answer = held<Result<string>>()
      vi.mocked(octopus().board.move).mockReturnValueOnce(answer.promise)
      const user = await show([...L0.cards, loose])
      givenBoard([
        ...L0.cards,
        { ...loose, ref: 'backlog/notes.md', loose: false, meta: { ...loose.meta, order: 1.5 } }
      ])
      focus('notes')
      await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
      await user.keyboard('cx')

      await act(async () => {
        answer.resolve(ok('backlog/notes.md'))
        await answer.promise
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'notes' })).toHaveAttribute(
          'data-card-ref',
          'backlog/notes.md'
        )
      })
      expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveFocus()
      expect(octopus().board.create).not.toHaveBeenCalled()
    })

    it('leaves the focus on the task it is on when Escape closes another', async () => {
      const user = await show()
      await openPanel(user, 'a')
      focus('b')

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('complementary')).toBeNull()
      expect(button('b')).toHaveFocus()
    })

    it('keeps the focus on a task whose move was refused', async () => {
      vi.mocked(octopus().board.move).mockResolvedValue({
        ok: false,
        error: 'x',
        code: 'cardMissing',
        params: { name: 'a.md' }
      })
      const user = await show()
      focus('a')

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      await waitFor(() => {
        expect(octopus().board.list).toHaveBeenCalledTimes(2)
      })
      expect(button('a')).toHaveFocus()
    })

    it('follows a loose task that ⌥↑ moved into its folder', async () => {
      const loose = boardCard({
        ref: 'notes.md',
        title: 'notes',
        loose: true,
        meta: { links: [], runs: [] }
      })
      vi.mocked(octopus().board.move).mockResolvedValue(ok('backlog/notes.md'))
      const user = await show([...L0.cards, loose])
      givenBoard([
        ...L0.cards,
        { ...loose, ref: 'backlog/notes.md', loose: false, meta: { ...loose.meta, order: 1.5 } }
      ])
      focus('notes')

      await user.keyboard('{Alt>}{ArrowUp}{/Alt}')

      expect(octopus().board.move).toHaveBeenCalledWith('planner', 'notes.md', {
        status: 'backlog',
        index: 1
      })
      await waitFor(() => {
        expect(document.activeElement).toHaveAttribute('data-card-ref', 'backlog/notes.md')
      })
    })

    it('does not move the last ordered task further down', async () => {
      const user = await show()
      focus('b')

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      expect(octopus().board.move).not.toHaveBeenCalled()
    })

    it('asks before deleting with ⌘⌫', async () => {
      const user = await show()
      focus('a')

      await user.keyboard('{Meta>}{Backspace}{/Meta}')

      expect(await screen.findByRole('dialog', { name: 'Delete “a”?' })).toBeInTheDocument()
    })

    it('deletes the open task with ⌘⌫ when nothing is focused', async () => {
      const user = await show()
      await openPanel(user, 'a')
      act(() => {
        button('a').blur()
      })

      await user.keyboard('{Meta>}{Backspace}{/Meta}')

      expect(await screen.findByRole('dialog', { name: 'Delete “a”?' })).toBeInTheDocument()
    })

    it('does nothing to an open task that is no longer listed', async () => {
      const user = await show()
      await openPanel(user, 'a')
      vi.mocked(octopus().board.list).mockResolvedValue(ok(boardListing([])))
      fireEvent.focus(window)
      await waitFor(() => {
        expect(screen.queryByRole('complementary')).toBeNull()
      })

      // Not cancelled: a key the board acted on, even one that threw on the way, would be.
      expect(fireEvent.keyDown(document.body, { key: 'Backspace', metaKey: true })).toBe(true)
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    it('opens the new task field in the focused column with C', async () => {
      const user = await show()
      focus('p')

      await user.keyboard('c')

      expect(
        within(region('In progress')).getByRole('textbox', { name: 'Task title' })
      ).toHaveFocus()
    })

    it('opens the new task field in Backlog when nothing is focused', async () => {
      const user = await show()

      await user.keyboard('c')

      expect(within(region('Backlog')).getByRole('textbox', { name: 'Task title' })).toHaveFocus()
    })

    it('leaves letters alone while a field takes text', async () => {
      const user = await show()

      await user.keyboard('c')
      await user.keyboard('jk')

      const field = screen.getByRole('textbox', { name: 'Task title' })
      expect(field).toHaveValue('jk')
      expect(field).toHaveFocus()
    })

    it('leaves Enter to a button in the panel', async () => {
      const user = await show()
      await openPanel(user, 'a')
      focus('Close')

      await user.keyboard('{Enter}')

      expect(screen.queryByRole('complementary')).toBeNull()
    })

    it("leaves the board's keys to another control", async () => {
      const user = await show()
      await openPanel(user, 'a')
      focus('Close')

      await user.keyboard('j')

      expect(button('Close')).toHaveFocus()
      expect(screen.getByRole('complementary', { name: 'a' })).toBeInTheDocument()
    })

    it('ignores keys while a menu is open', async () => {
      const user = await show()
      const panel = await openPanel(user, 'a')
      await user.click(within(panel).getByRole('button', { name: 'Backlog' }))
      expect(screen.getByRole('menu')).toBeInTheDocument()
      focus('a')

      await user.keyboard('j')

      expect(screen.getByRole('menu')).toBeInTheDocument()
      expect(button('a')).toHaveFocus()
    })

    it('walks the board on a Cyrillic layout', async () => {
      await show()

      fireEvent.keyDown(document.body, { key: 'о', code: 'KeyJ' })

      expect(button('a')).toHaveFocus()
    })

    it('ignores keys while a popover is open', async () => {
      const user = await show()
      await openPanel(user, 'a')
      const popover = document.createElement('div')
      popover.setAttribute('role', 'dialog')
      document.body.append(popover)
      act(() => {
        button('a').blur()
      })

      await user.keyboard('{Escape}')

      popover.remove()
      expect(screen.getByRole('complementary', { name: 'a' })).toBeInTheDocument()
    })

    it('ignores keys while a dialog is open', async () => {
      const user = await show()
      focus('a')
      await user.keyboard('{Meta>}{Backspace}{/Meta}')
      const dialog = await screen.findByRole('dialog')
      // A click on the dialog's text leaves the focus on the body, where the board's keys act.
      act(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      })

      await user.keyboard('j')

      expect(document.body).toHaveFocus()
      expect(dialog).toBeInTheDocument()
    })

    it('ignores the keys while no board is shown', async () => {
      const answer = held<Result<BoardListing>>()
      vi.mocked(octopus().board.list).mockReturnValueOnce(answer.promise)
      const user = userEvent.setup()
      renderScreen()

      await user.keyboard('c')
      await act(async () => {
        answer.resolve(ok(L0))
        await answer.promise
      })

      expect(await screen.findByRole('region', { name: 'Backlog' })).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Task title' })).toBeNull()
    })

    it('moves nowhere on an empty board', async () => {
      const user = await show([])

      await user.keyboard('j')

      expect(document.body).toHaveFocus()
    })
  })

  describe('the filter', () => {
    const FIX = boardCard({
      ref: 'backlog/Fix login.md',
      title: 'Fix login',
      meta: { links: [], runs: [], order: 1, priority: 'high' }
    })
    const NOTES = card('backlog/Notes.md', 'backlog', 2)
    const DEPLOY = card('in progress/Deploy.md', 'in progress', 1)

    async function show(filter: BoardFilter): Promise<{
      readonly user: UserEvent
      readonly rerender: (changes: Partial<BoardScreenProps>) => void
    }> {
      givenBoard([FIX, NOTES, DEPLOY])
      const user = userEvent.setup()
      const { rerender } = renderScreen({ filter })
      await screen.findAllByRole('region')
      return { user, rerender }
    }

    const task = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name })

    it('shows only the tasks that match and how many of how many', async () => {
      await show({ ...EMPTY_BOARD_FILTER, query: 'login' })

      expect(await screen.findByRole('button', { name: /Fix login/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull()
      expect(
        within(screen.getByRole('region', { name: 'Backlog' })).getByText('1 of 2')
      ).toBeInTheDocument()
      const inProgress = within(screen.getByRole('region', { name: 'In progress' }))
      expect(inProgress.getByText('0 of 1')).toBeInTheDocument()
      expect(inProgress.getByText('No tasks match the filter.')).toBeInTheDocument()
    })

    it('finds a task by the label of its tag', async () => {
      givenBoard([
        FIX,
        boardCard({
          ref: 'backlog/Tidy.md',
          title: 'Tidy',
          meta: { links: [], runs: [], order: 3, tag: 'refactor' }
        })
      ])
      renderScreen({ filter: { ...EMPTY_BOARD_FILTER, query: 'refactoring' } })

      expect(await screen.findByRole('button', { name: /Tidy/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Fix login/ })).toBeNull()
    })

    it('does not let a task be dragged while filtered', async () => {
      await show({ ...EMPTY_BOARD_FILTER, priorities: ['high'] })

      expect(task(/Fix login/).closest('li')).toHaveAttribute('draggable', 'false')
    })

    it('does not reorder with ⌥↓ while filtered', async () => {
      const { user } = await show({ ...EMPTY_BOARD_FILTER, query: 'o' })
      act(() => {
        task(/Fix login/).focus()
      })

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')

      expect(task('Notes')).toBeInTheDocument()
      expect(octopus().board.move).not.toHaveBeenCalled()
    })

    it('walks only the tasks the filter shows', async () => {
      const { user } = await show({ ...EMPTY_BOARD_FILTER, query: 'deploy' })

      await user.keyboard('j')

      expect(task('Deploy')).toHaveFocus()
    })

    it('keeps the open task in the panel when the filter hides it', async () => {
      const { user, rerender } = await show(EMPTY_BOARD_FILTER)
      await user.click(task('Notes'))
      await screen.findByRole('complementary', { name: 'Notes' })

      rerender({ filter: { ...EMPTY_BOARD_FILTER, query: 'login' } })

      expect(screen.getByRole('complementary', { name: 'Notes' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Notes' })).toBeNull()
    })
  })
})
