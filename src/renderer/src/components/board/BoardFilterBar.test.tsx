import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type BoardFilter, EMPTY_BOARD_FILTER } from './boardFilter.js'
import { BoardFilterBar } from './BoardFilterBar.js'

function renderBar(
  filter: BoardFilter = EMPTY_BOARD_FILTER,
  beside: React.ReactNode = null
): {
  readonly onChange: ReturnType<typeof vi.fn<(filter: BoardFilter) => void>>
  readonly rerender: (filter: BoardFilter) => void
} {
  const onChange = vi.fn<(filter: BoardFilter) => void>()
  const view = render(
    <>
      {beside}
      <BoardFilterBar filter={filter} onChange={onChange} />
    </>
  )
  return {
    onChange,
    rerender: (next) => {
      view.rerender(
        <>
          {beside}
          <BoardFilterBar filter={next} onChange={onChange} />
        </>
      )
    }
  }
}

const field = (): HTMLElement => screen.getByRole('searchbox', { name: 'Search tasks' })
const button = (name: string): HTMLElement => screen.getByRole('button', { name })

function focus(element: HTMLElement): void {
  act(() => {
    element.focus()
  })
}

describe('BoardFilterBar', () => {
  afterEach(() => {
    document.querySelectorAll('body > dialog').forEach((dialog) => {
      dialog.remove()
    })
  })

  it('passes the typed query up', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()

    await user.type(field(), 'a')

    expect(onChange).toHaveBeenLastCalledWith({ query: 'a', priorities: [], tags: [] })
  })

  it('clears only the query and gives the focus to the board on Escape', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar({ query: 'login', priorities: ['high'], tags: ['fix'] })

    await user.click(field())
    await user.keyboard('{Escape}')

    expect(onChange).toHaveBeenLastCalledWith({ query: '', priorities: ['high'], tags: ['fix'] })
    expect(document.body).toHaveFocus()
  })

  it('puts the focus in the search on slash', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()

    await user.keyboard('/')

    expect(field()).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("takes the slash from a task's button", async () => {
    const user = userEvent.setup()
    renderBar(
      EMPTY_BOARD_FILTER,
      <button type="button" data-card-ref="backlog/a.md">
        a
      </button>
    )
    focus(button('a'))

    await user.keyboard('/')

    expect(field()).toHaveFocus()
  })

  it('leaves every other key to the board', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.keyboard('j')

    expect(field()).not.toHaveFocus()
  })

  it('puts the focus in the search from the slash key of another layout', () => {
    renderBar()

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: '.', code: 'Slash', bubbles: true })
      )
    })

    expect(field()).toHaveFocus()
  })

  it('leaves the question mark to the board', () => {
    renderBar()

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true })
      )
    })

    expect(field()).not.toHaveFocus()
  })

  it('types a slash inside the search', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()

    await user.click(field())
    await user.keyboard('/')

    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_BOARD_FILTER, query: '/' })
  })

  it('leaves slash to another control', async () => {
    const user = userEvent.setup()
    renderBar(EMPTY_BOARD_FILTER, <button type="button">Other</button>)
    focus(button('Other'))

    await user.keyboard('/')

    expect(field()).not.toHaveFocus()
  })

  it.each(['Meta', 'Control', 'Alt'])('leaves %s with slash to the system', async (key) => {
    const user = userEvent.setup()
    renderBar()

    await user.keyboard(`{${key}>}/{/${key}}`)

    expect(field()).not.toHaveFocus()
  })

  it('leaves slash alone behind a dialog', async () => {
    const user = userEvent.setup()
    renderBar()
    document.body.append(Object.assign(document.createElement('dialog'), { open: true }))

    await user.keyboard('/')

    expect(field()).not.toHaveFocus()
  })

  it('leaves slash alone while a menu is open', async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(button('Priority'))
    act(() => {
      screen.getByRole('menuitemradio', { name: 'Urgent' }).blur()
    })
    expect(document.body).toHaveFocus()

    await user.keyboard('/')

    expect(field()).not.toHaveFocus()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('leaves slash alone while a popover is open', async () => {
    const user = userEvent.setup()
    renderBar(EMPTY_BOARD_FILTER, <div role="dialog" aria-label="Accounts" />)

    await user.keyboard('/')

    expect(field()).not.toHaveFocus()
  })

  it('adds a priority from the menu', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar({ ...EMPTY_BOARD_FILTER, query: 'login', tags: ['fix'] })

    await user.click(button('Priority'))
    await user.click(screen.getByRole('menuitemradio', { name: 'High' }))

    expect(onChange).toHaveBeenLastCalledWith({
      query: 'login',
      priorities: ['high'],
      tags: ['fix']
    })
  })

  it('takes a chosen priority back off', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar({ ...EMPTY_BOARD_FILTER, priorities: ['high'] })

    await user.click(button('Priority'))
    const high = screen.getByRole('menuitemradio', { name: 'High' })
    expect(high).toHaveAttribute('aria-checked', 'true')
    await user.click(high)

    expect(onChange).toHaveBeenLastCalledWith(EMPTY_BOARD_FILTER)
  })

  it('filters by having no tag', async () => {
    const user = userEvent.setup()
    const { onChange } = renderBar()

    await user.click(button('Tag'))
    await user.click(screen.getByRole('menuitemradio', { name: 'No tag' }))

    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_BOARD_FILTER, tags: ['none'] })
  })

  it('offers every tag and no tag', async () => {
    const user = userEvent.setup()
    renderBar()

    await user.click(button('Tag'))

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(13)
    expect(screen.getByRole('menuitemradio', { name: 'Bug' })).toBeInTheDocument()
    expect(button('Tag')).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers to clear only while a filter is on', async () => {
    const user = userEvent.setup()
    const { onChange, rerender } = renderBar()
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()

    rerender({ ...EMPTY_BOARD_FILTER, query: 'a' })
    await user.click(button('Clear filters'))

    expect(onChange).toHaveBeenLastCalledWith(EMPTY_BOARD_FILTER)
  })

  it('marks a menu whose filter is on', () => {
    renderBar({ ...EMPTY_BOARD_FILTER, tags: ['fix'] })

    expect(button('Tag')).toHaveAttribute('data-active', 'true')
    expect(button('Priority')).toHaveAttribute('data-active', 'false')
  })
})
