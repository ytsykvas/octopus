import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_COLUMNS } from '@core/boardColumns.js'
import type { AgentEvent } from '@core/events.js'
import { PROPOSE_EDIT_TOOL, PROPOSE_TASKS_TOOL, withEditedTasks } from '@core/taskProposal.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Brainstorm } from '../../hooks/useBrainstorm.js'
import { boardController, cardDetail, refusal } from '../../test/board.js'
import { held } from '../../test/held.js'
import { BrainstormPanel, type BrainstormPanelProps } from './BrainstormPanel.js'

const AT = '2026-11-26T10:00:00.000Z'
const said = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })
const IMPORT = { title: 'Read issues', description: 'Import them.' }
const WRITE_BACK = { title: 'Write issues back', description: 'Then push.', tag: 'feature' }
const proposing = (toolUseId: string, tasks: readonly object[]): ChatEntry =>
  said({
    type: 'tool_use',
    toolUseId,
    name: PROPOSE_TASKS_TOOL,
    input: { summary: 'Two tasks.', tasks }
  })
const PROPOSED = proposing('c1', [IMPORT, WRITE_BACK])
const ASKED = said({
  type: 'permission_request',
  requestId: 'r1',
  toolName: 'AskUserQuestion',
  input: {
    questions: [
      {
        question: 'Both ways?',
        header: 'Sync',
        multiSelect: false,
        options: [{ label: 'Import only' }, { label: 'Both' }]
      }
    ]
  }
})

function brainstorm(overrides: Partial<Brainstorm> = {}): Brainstorm {
  return {
    opening: 1,
    target: { purpose: 'tasks', column: 'backlog' },
    entries: [],
    started: false,
    working: false,
    answerable: new Set(),
    failure: null,
    send: vi.fn(() => Promise.resolve(true)),
    answer: vi.fn(),
    stop: vi.fn(),
    ...overrides
  }
}

function props(overrides: Partial<BrainstormPanelProps> = {}): BrainstormPanelProps {
  return {
    brainstorm: brainstorm(),
    columns: DEFAULT_COLUMNS,
    board: boardController(),
    width: 420,
    onWidth: vi.fn(),
    onClose: vi.fn(),
    onDone: vi.fn(),
    ...overrides
  }
}

function renderPanel(overrides: Partial<BrainstormPanelProps> = {}): {
  readonly all: BrainstormPanelProps
  readonly rerender: (next: Partial<BrainstormPanelProps>) => void
} {
  const all = props(overrides)
  const { rerender } = render(<BrainstormPanel {...all} />)
  return {
    all,
    rerender: (next) => {
      rerender(<BrainstormPanel {...all} {...next} />)
    }
  }
}

const field = (name: string): HTMLElement => screen.getByRole('textbox', { name })

describe('BrainstormPanel', () => {
  it('is a region named for new tasks, says what it does, and closes', async () => {
    const { all } = renderPanel()

    expect(screen.getByRole('complementary', { name: 'New tasks with the agent' })).toBeVisible()
    expect(screen.getByText(/proposes one task or several/)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(all.onClose).toHaveBeenCalledTimes(1)
  })

  it('is named for the card it edits, and asks what should change', () => {
    renderPanel({
      brainstorm: brainstorm({ target: { purpose: 'edit', card: cardDetail() } })
    })

    expect(
      screen.getByRole('complementary', { name: 'Editing with the agent: Fix login' })
    ).toBeVisible()
    expect(screen.getByText(/proposes a new version/)).toBeVisible()
    expect(field('What should change in this task?')).toBeVisible()
  })

  it('asks for a reply once the conversation started, and stops the agent at work', async () => {
    const held = brainstorm({ started: true, working: true, entries: [PROPOSED] })
    renderPanel({ brainstorm: held })

    expect(screen.queryByText(/proposes one task or several/)).toBeNull()
    await userEvent.type(field('Reply, or ask for changes'), 'More{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(held.send).not.toHaveBeenCalled()
    expect(held.stop).toHaveBeenCalledTimes(1)
  })

  it('sends on Enter or Send, keeps a line break on ⇧Enter, and sends nothing blank', async () => {
    const held = brainstorm()
    renderPanel({ brainstorm: held })

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(field('What needs doing?'), '  {Enter}')
    expect(held.send).not.toHaveBeenCalled()
    await userEvent.clear(field('What needs doing?'))
    await userEvent.type(field('What needs doing?'), 'Sync{Shift>}{Enter}{/Shift}issues{Enter}')
    expect(held.send).toHaveBeenLastCalledWith('Sync\nissues')
    await waitFor(() => {
      expect(field('What needs doing?')).toHaveValue('')
    })
    await userEvent.type(field('What needs doing?'), 'Again')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(held.send).toHaveBeenLastCalledWith('Again')
  })

  it('sends nothing on the Enter that confirms an IME candidate', async () => {
    const held = brainstorm()
    renderPanel({ brainstorm: held })

    await userEvent.type(field('What needs doing?'), 'Sync')
    fireEvent.keyDown(field('What needs doing?'), { key: 'Enter', isComposing: true })

    expect(held.send).not.toHaveBeenCalled()
  })

  it('sends a message once, however often Enter is pressed while it goes', async () => {
    const going = held<boolean>()
    const held_ = brainstorm({ send: vi.fn(() => going.promise) })
    renderPanel({ brainstorm: held_ })

    await userEvent.type(field('What needs doing?'), 'Sync{Enter}{Enter}')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await act(async () => {
      going.resolve(true)
      await going.promise
    })

    expect(held_.send).toHaveBeenCalledTimes(1)
    expect(field('What needs doing?')).toHaveValue('')
  })

  it('keeps the text when it did not go, and shows why', async () => {
    const held = brainstorm({
      send: vi.fn(() => Promise.resolve(false)),
      failure: refusal('brainstormGone')
    })
    renderPanel({ brainstorm: held })

    await userEvent.type(field('What needs doing?'), 'Sync{Enter}')

    expect(held.send).toHaveBeenCalledWith('Sync')
    expect(field('What needs doing?')).toHaveValue('Sync')
    expect(
      screen.getByText('This conversation has ended. Close it and start another.')
    ).toBeVisible()
  })

  it('answers the agent’s questions, and a skip as no answer', async () => {
    const held = brainstorm({
      started: true,
      working: true,
      entries: [ASKED],
      answerable: new Set(['r1'])
    })
    renderPanel({ brainstorm: held })

    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await userEvent.click(screen.getByRole('radio', { name: /Both/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }))

    expect(held.answer).toHaveBeenNthCalledWith(1, 'r1', [])
    expect(held.answer).toHaveBeenNthCalledWith(2, 'r1', [
      expect.objectContaining({ question: 'Both ways?' })
    ])
  })

  it('creates every task proposed, each in the column it was opened from, and is done', async () => {
    const board = boardController()
    vi.mocked(board.createMany).mockResolvedValueOnce({ refs: ['a', 'b'], failure: null })
    const { all } = renderPanel({
      board,
      brainstorm: brainstorm({
        target: { purpose: 'tasks', column: 'testing' },
        entries: [PROPOSED]
      })
    })

    expect(screen.getByText('Two tasks.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Create 2 tasks' }))

    expect(board.createMany).toHaveBeenCalledWith([
      { status: 'testing', ...IMPORT },
      { status: 'testing', ...WRITE_BACK }
    ])
    expect(all.onDone).toHaveBeenCalledTimes(1)
  })

  it('stays open when the write did not go through', async () => {
    const board = boardController()
    vi.mocked(board.createMany).mockResolvedValueOnce(null)
    const { all } = renderPanel({ board, brainstorm: brainstorm({ entries: [PROPOSED] }) })

    await userEvent.click(screen.getByRole('button', { name: 'Create 2 tasks' }))

    expect(all.onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Create 2 tasks' })).toBeEnabled()
  })

  it('keeps only what was not written, says why, and forgets it for the next proposal', async () => {
    const board = boardController()
    vi.mocked(board.createMany).mockResolvedValueOnce({
      refs: ['backlog/Read issues.md', null],
      failure: refusal('cardNameTaken', { name: 'Write issues back.md' })
    })
    const { all, rerender } = renderPanel({
      board,
      brainstorm: brainstorm({ entries: [PROPOSED] })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Create 2 tasks' }))

    expect(await screen.findByRole('button', { name: 'Create 1 task' })).toBeEnabled()
    expect(screen.queryByRole('heading', { name: 'Read issues' })).toBeNull()
    expect(screen.getByText('A file named “Write issues back.md” is already there.')).toBeVisible()
    expect(all.onDone).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'No priority' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }))
    expect(screen.getByText(/already there/)).toBeVisible()

    rerender({ brainstorm: brainstorm({ entries: [PROPOSED, proposing('c2', [IMPORT])] }) })

    expect(screen.getByRole('heading', { name: 'Read issues' })).toBeVisible()
    expect(screen.queryByText(/already there/)).toBeNull()
  })

  it('tells the agent about the edits once, and not those of a proposal it replaced', async () => {
    const held = brainstorm({ started: true, entries: [PROPOSED] })
    const { rerender } = renderPanel({ brainstorm: held })
    const reply = field('Reply, or ask for changes')

    await userEvent.click(screen.getAllByRole('button', { name: 'Leave out' })[1]!)
    await userEvent.type(reply, 'Better?{Enter}')
    expect(held.send).toHaveBeenLastCalledWith(withEditedTasks('Better?', [IMPORT]))
    await waitFor(() => {
      expect(reply).toHaveValue('')
    })
    await userEvent.type(reply, 'And now?{Enter}')
    expect(held.send).toHaveBeenLastCalledWith('And now?')

    await userEvent.click(screen.getByRole('button', { name: 'Leave out' }))
    rerender({ brainstorm: { ...held, entries: [PROPOSED, proposing('c2', [WRITE_BACK])] } })
    expect(screen.getByRole('heading', { name: 'Write issues back' })).toBeVisible()
    await userEvent.type(reply, 'Fine.{Enter}')

    expect(held.send).toHaveBeenLastCalledWith('Fine.')
  })

  it('keeps the edits when a message did not go', async () => {
    const held = brainstorm({
      started: true,
      entries: [PROPOSED],
      send: vi.fn(() => Promise.resolve(false))
    })
    renderPanel({ brainstorm: held })

    await userEvent.click(screen.getAllByRole('button', { name: 'Leave out' })[1]!)
    await userEvent.type(field('Reply, or ask for changes'), 'Better?{Enter}')
    await userEvent.keyboard('{Enter}')

    expect(held.send).toHaveBeenNthCalledWith(2, withEditedTasks('Better?', [IMPORT]))
  })

  describe('editing a card', () => {
    const card = cardDetail()
    const editing = said({
      type: 'tool_use',
      toolUseId: 'e1',
      name: PROPOSE_EDIT_TOOL,
      input: {
        summary: 'Sharper.',
        task: { title: 'Fix the login form', description: 'Keep it.', priority: 'high' }
      }
    })

    it('writes the new version over the card as it was read, and is done', async () => {
      const board = boardController()
      vi.mocked(board.rewrite).mockResolvedValueOnce(true)
      const { all } = renderPanel({
        board,
        brainstorm: brainstorm({ target: { purpose: 'edit', card }, entries: [editing] })
      })

      await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))

      expect(board.rewrite).toHaveBeenCalledWith('backlog/Fix login.md', {
        title: 'Fix the login form',
        description: 'Keep it.',
        priority: 'high',
        tag: null,
        base: card.description
      })
      expect(all.onDone).toHaveBeenCalledTimes(1)
    })

    it('stays open when the card could not be written', async () => {
      const board = boardController()
      vi.mocked(board.rewrite).mockResolvedValueOnce(false)
      const { all } = renderPanel({
        board,
        brainstorm: brainstorm({ target: { purpose: 'edit', card }, entries: [editing] })
      })

      await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
      await act(() => Promise.resolve())

      expect(all.onDone).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Apply changes' })).toBeEnabled()
    })
  })
})
