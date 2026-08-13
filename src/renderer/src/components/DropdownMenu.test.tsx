import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DropdownMenu, type MenuAction } from './DropdownMenu.js'

function renderMenu(actions: readonly MenuAction[]): void {
  render(
    <div>
      <button type="button">Somewhere else</button>

      <DropdownMenu
        actions={actions}
        trigger={({ onClick, open }) => (
          <button type="button" onClick={onClick} aria-expanded={open}>
            Workspace actions
          </button>
        )}
      />
    </div>
  )
}

function triggerButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Workspace actions' })
}

describe('DropdownMenu', () => {
  it('shows nothing until the trigger is clicked', () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    expect(screen.queryByRole('menu')).toBeNull()
    expect(triggerButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the menu with its actions when the trigger is clicked', async () => {
    renderMenu([
      { id: 'rename', label: 'Rename', description: 'Change the branch name', onSelect: vi.fn() },
      { id: 'open', label: 'Open in editor', onSelect: vi.fn() }
    ])

    await userEvent.click(triggerButton())

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Open in editor/ })).toBeInTheDocument()
    expect(screen.getByText('Change the branch name')).toBeInTheDocument()
    expect(triggerButton()).toHaveAttribute('aria-expanded', 'true')
  })

  it('runs the chosen action and closes the menu', async () => {
    const rename = vi.fn()
    const openInEditor = vi.fn()

    renderMenu([
      { id: 'rename', label: 'Rename', onSelect: rename },
      { id: 'open', label: 'Open in editor', onSelect: openInEditor }
    ])

    await userEvent.click(triggerButton())
    await userEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))

    expect(rename).toHaveBeenCalledTimes(1)
    expect(openInEditor).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  // A destructive item is styled apart from the rest; it still has to be an
  // ordinary, selectable item rather than something the user has to fight.
  it('runs a destructive action like any other', async () => {
    const remove = vi.fn()

    renderMenu([
      { id: 'rename', label: 'Rename', onSelect: vi.fn() },
      { id: 'delete', label: 'Delete workspace', destructive: true, onSelect: remove }
    ])

    await userEvent.click(triggerButton())
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete workspace/ }))

    expect(remove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the trigger is clicked a second time', async () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    await userEvent.click(triggerButton())
    await userEvent.click(triggerButton())

    expect(screen.queryByRole('menu')).toBeNull()
  })

  // The panel is placed at fixed window coordinates taken when it opened, so
  // anything that moves the trigger would leave it floating next to nothing.
  it('closes the menu when the page scrolls', async () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    await userEvent.click(triggerButton())
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.scroll(window)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu when the window is resized', async () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    await userEvent.click(triggerButton())
    fireEvent.resize(window)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu on Escape without running anything', async () => {
    const rename = vi.fn()
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: rename }])

    await userEvent.click(triggerButton())
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(rename).not.toHaveBeenCalled()
  })

  it('closes the menu when something outside it is clicked', async () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    await userEvent.click(triggerButton())
    await userEvent.click(screen.getByRole('button', { name: 'Somewhere else' }))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  // Near the bottom of a tab strip there is no room below, which is most of the
  // time — a panel that opened downwards anyway would be half off screen.
  it('opens above the trigger when the space below runs out', async () => {
    const user = userEvent.setup()
    render(
      <DropdownMenu
        trigger={({ onClick }) => (
          <button type="button" onClick={onClick}>
            Open
          </button>
        )}
        actions={[{ id: 'a', label: 'First', onSelect: vi.fn() }]}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Open' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      top: window.innerHeight - 20,
      bottom: window.innerHeight - 4,
      left: 10,
      right: 40,
      width: 30,
      height: 16,
      x: 10,
      y: window.innerHeight - 20,
      toJSON: () => ({})
    })

    await user.click(trigger)

    const panel = screen.getByRole('menu')
    expect(Number.parseInt(panel.style.top, 10)).toBeLessThan(window.innerHeight - 20)
  })

  // A menu of choices is a different thing from a menu of commands, and the
  // role is what carries that difference to anything reading the screen.
  describe('a menu of choices', () => {
    it('announces the items as a group with one of them current', async () => {
      const user = userEvent.setup()
      renderMenu([
        { id: 'plan', label: 'Plan only', selected: true, onSelect: vi.fn() },
        { id: 'default', label: 'Ask first', selected: false, onSelect: vi.fn() }
      ])

      await user.click(triggerButton())

      expect(screen.getByRole('menuitemradio', { name: 'Plan only' })).toBeChecked()
      expect(screen.getByRole('menuitemradio', { name: 'Ask first' })).not.toBeChecked()
    })

    // Commands and choices live in the same component, and a command that
    // started announcing itself as a radio would be a quiet regression.
    it('leaves an ordinary action an ordinary action', async () => {
      const user = userEvent.setup()
      renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

      await user.click(triggerButton())

      expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
    })
  })
})
