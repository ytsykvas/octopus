import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Combobox } from './Combobox.js'

const branches = ['origin/main', 'origin/develop', 'feature/login']

interface Harness {
  readonly user: UserEvent
  readonly onChange: ReturnType<typeof vi.fn>
}

function setup(props: Partial<ComponentProps<typeof Combobox>> = {}): Harness {
  const user = userEvent.setup()
  const onChange = vi.fn()

  render(<Combobox value="origin/main" options={branches} onChange={onChange} {...props} />)

  return { user, onChange }
}

/**
 * The trigger carries the current value, so once the list is open its label is
 * ambiguous with the matching option. Resolving it while still closed keeps
 * every later query unambiguous.
 */
async function openWith(user: UserEvent, triggerLabel = 'origin/main'): Promise<void> {
  await user.click(screen.getByRole('button', { name: triggerLabel }))
}

function searchBox(): HTMLElement {
  return screen.getByRole('textbox')
}

beforeEach(() => {
  // jsdom does no layout and has no scrollIntoView, which the effect that keeps
  // the highlighted row visible calls on every move.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Combobox', () => {
  it('puts the caret in the search box as soon as it opens', async () => {
    const { user } = setup()

    await openWith(user)

    expect(searchBox()).toHaveFocus()
  })

  it('narrows the list to the options matching what is typed', async () => {
    const { user } = setup()
    await openWith(user)

    await user.type(searchBox(), 'dev')

    expect(screen.getByRole('button', { name: 'origin/develop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'feature/login' })).not.toBeInTheDocument()
  })

  // People type the way they read, not the way the branch is spelled.
  it('matches regardless of case and surrounding spaces', async () => {
    const { user } = setup()
    await openWith(user)

    await user.type(searchBox(), '  LOGIN  ')

    expect(screen.getByRole('button', { name: 'feature/login' })).toBeInTheDocument()
  })

  it('takes the highlighted option when Enter is pressed', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('origin/develop')
  })

  it('closes after a choice is made', async () => {
    const { user } = setup()
    await openWith(user)

    await user.keyboard('{Enter}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('wraps to the last option when ArrowUp leaves the top', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.keyboard('{ArrowUp}{Enter}')

    expect(onChange).toHaveBeenCalledWith('feature/login')
  })

  it('wraps back to the first option when ArrowDown passes the end', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('origin/main')
  })

  // 'feature/login' is the only match but the third option overall, so this
  // fails if Enter reads the position out of the full list.
  it('takes the first match rather than the first option', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.type(searchBox(), 'login')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('feature/login')
  })

  it('wraps within the filtered list rather than the full one', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    // Two of the three options match, so the second step down comes back to
    // the first of them instead of reaching a third row that is not shown.
    await user.type(searchBox(), 'origin')
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('origin/main')
  })

  // The mouse and the keyboard have to agree on which row Enter would take.
  it('hands the highlight to whatever the mouse hovers', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.hover(screen.getByRole('button', { name: 'feature/login' }))
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('feature/login')
  })

  it('chooses the option that is clicked', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.click(screen.getByRole('button', { name: 'origin/develop' }))

    expect(onChange).toHaveBeenCalledWith('origin/develop')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes on Escape without choosing anything', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forgets the query it was closed on, so the next open shows everything', async () => {
    const { user } = setup()
    await openWith(user)
    await user.type(searchBox(), 'dev')

    await user.keyboard('{Escape}')
    await openWith(user)

    expect(searchBox()).toHaveValue('')
    expect(screen.getByRole('button', { name: 'feature/login' })).toBeInTheDocument()
  })

  it('closes when the click lands outside it', async () => {
    const { user } = setup()
    await openWith(user)

    await user.click(document.body)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says nothing was found when the query matches no option', async () => {
    const { user } = setup()
    await openWith(user)

    await user.type(searchBox(), 'release')

    expect(screen.getByText('Nothing found')).toBeInTheDocument()
  })

  it('prefers the wording the caller gives for an empty list', async () => {
    const { user } = setup({ emptyLabel: 'No branches here' })
    await openWith(user)

    await user.type(searchBox(), 'release')

    expect(screen.getByText('No branches here')).toBeInTheDocument()
  })

  it('stays open and reports nothing when Enter finds no match to take', async () => {
    const { user, onChange } = setup()
    await openWith(user)

    await user.type(searchBox(), 'release')
    await user.keyboard('{Enter}')

    expect(onChange).not.toHaveBeenCalled()
    expect(searchBox()).toBeInTheDocument()
  })

  it('shows the shortened label but reports the whole value', async () => {
    const { user, onChange } = setup({ display: (option) => option.replace('origin/', '') })
    await openWith(user, 'main')

    await user.click(screen.getByRole('button', { name: 'develop' }))

    expect(onChange).toHaveBeenCalledWith('origin/develop')
  })

  // Shortening is display only, so the hidden part is still searchable.
  it('still matches the part of the option the shortened label hides', async () => {
    const { user } = setup({ display: (option) => option.replace('origin/', '') })
    await openWith(user, 'main')

    await user.type(searchBox(), 'origin/dev')

    expect(screen.getByRole('button', { name: 'develop' })).toBeInTheDocument()
  })

  it('labels the search box for search when the caller gives no placeholder', async () => {
    const { user } = setup()

    await openWith(user)

    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
  })

  it('labels the search box with the placeholder it is given', async () => {
    const { user } = setup({ placeholder: 'Find a branch' })

    await openWith(user)

    expect(screen.getByPlaceholderText('Find a branch')).toBeInTheDocument()
  })

  it('does not open while disabled', async () => {
    const { user } = setup({ disabled: true })

    await user.click(screen.getByRole('button', { name: 'origin/main' }))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes again when the trigger is clicked a second time', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: 'origin/main' })
    await user.click(trigger)

    await user.click(trigger)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
