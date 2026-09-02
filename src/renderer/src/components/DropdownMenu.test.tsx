import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DropdownMenu, type MenuAction } from './DropdownMenu.js'

function renderMenu(actions: readonly MenuAction[]): void {
  render(
    <div>
      <button type="button">Somewhere else</button>

      {/* Stands for the chat log: something that scrolls beside the trigger
          rather than around it, so scrolling it cannot move the trigger. */}
      <div role="log">A region that scrolls on its own</div>

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

  it('closes the menu when something the trigger sits inside scrolls', async () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    await userEvent.click(triggerButton())
    fireEvent.scroll(document)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  /*
   * Reported from a running app: the chat log pins itself to the bottom on
   * every streamed fragment, and menus opened from the composer shut a few
   * times a second for as long as the agent was answering.
   *
   * Scrolling does not reflow the rest of the page, so a scroll somewhere the
   * trigger does not sit cannot move it by a pixel — and the reason to close
   * is that the trigger moved. The listener is on the window in the capture
   * phase because a scroll event does not bubble; where it happened has to be
   * read from the target rather than assumed.
   */
  it('stays open when something beside the trigger scrolls', async () => {
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    // A scroll that does close it first. The listener is registered by an
    // effect, and a menu that stayed open because nothing was listening looks
    // exactly like one that stayed open on purpose.
    await userEvent.click(triggerButton())
    fireEvent.scroll(document)
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(triggerButton())
    fireEvent.scroll(screen.getByRole('log'))

    expect(screen.getByRole('menu')).toBeInTheDocument()
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

  /*
   * Reported from the running app: the menu on a diff file's header opened and
   * was nowhere to be seen — painted behind the header of the file below it.
   *
   * `z-50` only ever means "above its own siblings". A `sticky` element with a
   * `z-index` starts a stacking context, the diff's file headers are exactly
   * that, and a panel inside one cannot be lifted out of it by any number. So
   * the panel is drawn into the body, and this is the assertion that says so —
   * the alternative is a screenshot nobody will take again.
   */
  it('draws its panel outside whatever the trigger sits inside', async () => {
    const user = userEvent.setup()
    renderMenu([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])

    await user.click(triggerButton())

    expect(screen.getByRole('menu').parentElement).toBe(document.body)
  })

  /*
   * The companion to the portal above, and the thing it would break silently.
   *
   * `useDismiss` asks whether a click landed inside the trigger's container,
   * and once the panel is drawn into the body it is not in that container. Told
   * only about the trigger, the hook would call a click on the menu "outside"
   * and close it on `mousedown` — before the `click` on an item could ever
   * fire. Every item would look inert.
   */
  it('stays open when the panel itself is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderMenu([{ id: 'rename', label: 'Rename', onSelect }])

    // A click that does close it first, for the reason the comment below gives
    // in one direction and this covers in the other: `useDismiss` listens from
    // an effect, so a dead listener leaves the menu open just as convincingly.
    await user.click(triggerButton())
    await user.click(screen.getByRole('button', { name: 'Somewhere else' }))
    expect(screen.queryByRole('menu')).toBeNull()

    await user.click(triggerButton())
    // The panel's own padding rather than an item: an item closes the menu by
    // choosing something, which would pass whether the hook knew or not.
    await user.click(screen.getByRole('menu'))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
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

  /*
   * The room a menu needs is counted before it is drawn, so the count has to
   * know that a second line is worth two more rows. Reserving one row for every
   * item regardless — which is what it did — put the bottom of a described menu
   * below the bottom of the window, out of reach with no way to scroll to it.
   *
   * Asserted as a difference rather than against a number: the trigger sits
   * where a plain menu of one item fits below it and a described one does not,
   * so only a count that reads the descriptions tells the two apart.
   */
  it('reserves room for the second lines when deciding which way to open', async () => {
    async function topOf(description: string | undefined): Promise<number> {
      const user = userEvent.setup()
      render(
        <DropdownMenu
          trigger={({ onClick }) => (
            <button type="button" onClick={onClick}>
              Open
            </button>
          )}
          actions={[
            {
              id: 'a',
              label: 'First',
              ...(description !== undefined && { description }),
              onSelect: vi.fn()
            }
          ]}
        />
      )

      const trigger = screen.getByRole('button', { name: 'Open' })
      const bottom = window.innerHeight - 60
      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        top: bottom - 16,
        bottom,
        left: 10,
        right: 40,
        width: 30,
        height: 16,
        x: 10,
        y: bottom - 16,
        toJSON: () => ({})
      })

      await user.click(trigger)
      const top = Number.parseInt(screen.getByRole('menu').style.top, 10)
      cleanup()

      return top
    }

    const plain = await topOf(undefined)
    const described = await topOf('Efficient for routine tasks')

    // The plain one still has room below the trigger; the described one does not
    // and has to go above it.
    expect(plain).toBeGreaterThan(window.innerHeight - 60)
    expect(described).toBeLessThan(window.innerHeight - 60)
  })

  /*
   * The descriptions come from outside — the agent writes the ones on the
   * models — and "Fable 5 · Most capable for your hardest and longest-running
   * tasks" does not fit a width chosen for one-word commands. Widening every
   * menu to suit them would leave the short ones full of air.
   */
  describe('the width', () => {
    // Rendered fresh each time rather than compared inside one test: two menus
    // in one document are two triggers of the same name, and the query cannot
    // tell them apart.
    async function widthOf(actions: readonly MenuAction[]): Promise<number> {
      const user = userEvent.setup()
      renderMenu(actions)

      await user.click(triggerButton())
      const width = Number.parseInt(screen.getByRole('menu').style.width, 10)
      cleanup()

      return width
    }

    it('grows for a menu whose items carry a second line', async () => {
      const narrow = await widthOf([{ id: 'rename', label: 'Rename', onSelect: vi.fn() }])
      const wide = await widthOf([
        {
          id: 'sonnet',
          label: 'Sonnet',
          description: 'Efficient for routine tasks',
          onSelect: vi.fn()
        }
      ])

      expect(wide).toBeGreaterThan(narrow)
    })

    // One item with a description is enough: the rows share a width, so the
    // menu is as wide as its widest need.
    it('grows for the whole menu when only one item has one', async () => {
      const mixed = await widthOf([
        {
          id: 'disk',
          label: 'From disk',
          description: 'A repository already here',
          onSelect: vi.fn()
        },
        { id: 'github', label: 'From GitHub', onSelect: vi.fn() }
      ])
      const plain = await widthOf([{ id: 'github', label: 'From GitHub', onSelect: vi.fn() }])

      expect(mixed).toBeGreaterThan(plain)
    })
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
