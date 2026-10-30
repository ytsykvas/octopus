import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { octopus } from '../../test/octopus.js'
import { PromptFan } from './PromptFan.js'

let made = 0

function prompt(title: string, overrides: Partial<Prompt> = {}): Prompt {
  made += 1

  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, '0')}`,
    title,
    text: `${title} text`,
    forPlan: false,
    ...overrides
  }
}

/** Answers by the store asked about, as the real bridge does. */
function answering(project: readonly Prompt[], global: readonly Prompt[]): void {
  vi.mocked(octopus().prompts.list).mockImplementation((store) =>
    Promise.resolve({ ok: true, value: [...(store.kind === 'global' ? global : project)] })
  )
}

interface Rendered {
  readonly onPick: ReturnType<typeof vi.fn>
  readonly onManage: ReturnType<typeof vi.fn>
  readonly container: HTMLElement
  readonly button: () => HTMLElement
}

/** Where the button is, as jsdom measures nothing: the fan is laid out from this. */
function place(button: HTMLElement, at: { top: number; left: number }): void {
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    top: at.top,
    left: at.left,
    right: at.left + 24,
    bottom: at.top + 24,
    width: 24,
    height: 24,
    x: at.left,
    y: at.top,
    toJSON: () => ({})
  })
}

/**
 * The composer's corner: room above and to the left, none for the right quarter
 * — five rungs, from 9 o'clock up to the top of the arc.
 */
const ROOMY = { top: 600, left: 900 }
/** Room all round: the right quarter as well, 12 o'clock to 3, nine rungs in all. */
const OPEN = { top: 600, left: 500 }
/** Too close to the top for a single rung. */
const CRAMPED = { top: 4, left: 700 }

async function renderFan(
  options: {
    readonly planOnly?: boolean
    readonly manage?: boolean
    readonly at?: { top: number; left: number }
    readonly inDialog?: boolean
    /** The colour the pane carries down, as `ChatSession` sets it inline. */
    readonly projectColor?: string
  } = {}
): Promise<Rendered> {
  const onPick = vi.fn()
  const onManage = vi.fn()

  const fan = (
    <PromptFan
      projectId="planner"
      onPick={onPick}
      {...(options.planOnly === true && { planOnly: true })}
      {...(options.manage !== false && { onManage })}
    />
  )
  const inner = options.inDialog === true ? <dialog open>{fan}</dialog> : fan
  const { container } = render(
    options.projectColor === undefined ? (
      inner
    ) : (
      <div style={{ '--project-color': options.projectColor } as React.CSSProperties}>{inner}</div>
    )
  )

  await waitFor(() => {
    expect(octopus().prompts.list).toHaveBeenCalledTimes(2)
  })
  // The lists are drawn a moment after they are read; a button that appears
  // only once there is something to offer has to be waited for.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const button = (): HTMLElement => screen.getByRole('button', { name: 'Saved prompts' })
  if (screen.queryByRole('button', { name: 'Saved prompts' }) !== null) {
    place(button(), options.at ?? ROOMY)
  }

  return { onPick, onManage, container, button }
}

// What a pill is called, as a reader would hear it: the way to settings is a
// circle with a gear on it and says its name by its label.
const pills = (): string[] =>
  screen.getAllByRole('menuitem').map((pill) => pill.getAttribute('aria-label') ?? pill.textContent)

describe('opening the fan', () => {
  it('lays the project’s prompts out first, then the installation’s, in their order', async () => {
    answering([prompt('Review'), prompt('Tests')], [prompt('Explain')])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(screen.getByRole('menu', { name: 'Saved prompts' })).toBeInTheDocument()
    expect(pills()).toEqual(['Review', 'Tests', 'Explain', 'Manage prompts…'])
  })

  it('reads the lists again as it opens, so a prompt just saved is there', async () => {
    answering([], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    answering([prompt('Fresh')], [])
    await user.click(button())

    expect(await screen.findByRole('menuitem', { name: 'Fresh' })).toBeInTheDocument()
    expect(octopus().prompts.list).toHaveBeenCalledTimes(4)
  })

  it('says only the title on a pill, and the whole of it on hover', async () => {
    answering([prompt('Tighten the plan')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    const pill = screen.getByRole('menuitem', { name: 'Tighten the plan' })
    expect(pill).toHaveAttribute('title', 'Tighten the plan')
    expect(pill).not.toHaveTextContent('text')
  })

  // Each pill flies out of the button, a rung after the one above.
  it('sets each pill’s place in the order and its flight from the button', async () => {
    answering([prompt('A'), prompt('B')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    const [first, second] = screen.getAllByRole('menuitem')
    expect(first).toHaveClass('fan-in')
    expect(first?.style.getPropertyValue('--fan-index')).toBe('0')
    expect(second?.style.getPropertyValue('--fan-index')).toBe('1')
    // The button's centre is at (912, 612). The sweep starts at 9 o'clock, the
    // lowest rung, 82 to the left of the button and 28 above it; the next rung
    // up is a little nearer.
    expect(first?.style.getPropertyValue('--fan-from-x')).toBe('82px')
    expect(first?.style.getPropertyValue('--fan-from-y')).toBe('28px')
    expect(second?.style.getPropertyValue('--fan-from-x')).toBe('77px')
  })

  it('closes on a second click on the button', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())
    await user.click(button())

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('has the button say whether it is open', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()
    expect(button()).toHaveAttribute('aria-expanded', 'false')

    await user.click(button())

    expect(button()).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('the order of the pills', () => {
  // From 9 o'clock: the prompts for the plan first, as a group, and the rest after
  // them — each group still the project's own before the installation's, each in
  // the order the settings give.
  it('puts the prompts for the plan first, then the rest, each project before everywhere', async () => {
    answering(
      [prompt('Review'), prompt('Tighten', { forPlan: true })],
      [prompt('Summarise'), prompt('Check edges', { forPlan: true })]
    )
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(pills()).toEqual(['Tighten', 'Check edges', 'Review', 'Summarise', 'Manage prompts…'])
  })

  it('keeps the same order in the list of what did not fit', async () => {
    answering(
      Array.from({ length: 6 }, (_, index) => prompt(`P${String(index + 1)}`)),
      [prompt('Late plan', { forPlan: true })]
    )
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    // Five rungs: three prompts, "more", settings — the plan one leads.
    expect(pills()).toEqual(['Late plan', 'P1', 'P2', 'More… (4)', 'Manage prompts…'])
  })
})

describe('choosing a prompt', () => {
  it('hands over its text and closes', async () => {
    answering([prompt('Review', { text: 'Look it over.' })], [])
    const user = userEvent.setup()
    const { button, onPick } = await renderFan()

    await user.click(button())
    await user.click(screen.getByRole('menuitem', { name: 'Review' }))

    expect(onPick).toHaveBeenCalledWith('Look it over.')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('the way to settings', () => {
  it('goes there and closes', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button, onManage } = await renderFan()

    await user.click(button())
    await user.click(screen.getByRole('menuitem', { name: 'Manage prompts…' }))

    expect(onManage).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('is the only pill when there is nothing saved yet', async () => {
    answering([], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(pills()).toEqual(['Manage prompts…'])
  })

  it('is not there when nobody is told where it goes', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan({ manage: false })

    await user.click(button())

    expect(pills()).toEqual(['A'])
  })
})

describe('more than the fan has room for', () => {
  const many = Array.from({ length: 9 }, (_, index) => `P${String(index + 1)}`)

  it('keeps the first ones, then "more", then the way to settings', async () => {
    answering(
      many.slice(0, 5).map((title) => prompt(title)),
      many.slice(5).map((title) => prompt(title))
    )
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    // Five rungs: three prompts, "more", settings.
    expect(pills()).toEqual(['P1', 'P2', 'P3', 'More… (6)', 'Manage prompts…'])
  })

  it('opens a list of only what did not fit, under the sections they came from', async () => {
    answering(
      many.slice(0, 5).map((title) => prompt(title)),
      many.slice(5).map((title) => prompt(title))
    )
    const user = userEvent.setup()
    const { button, onPick } = await renderFan()

    await user.click(button())
    await user.click(screen.getByRole('menuitem', { name: 'More… (6)' }))

    expect(pills().slice(0, 6)).toEqual(['P4', 'P5', 'P6', 'P7', 'P8', 'P9'])
    expect(screen.getByText('This project')).toBeInTheDocument()
    expect(screen.getByText('Everywhere')).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'P7' }))
    expect(onPick).toHaveBeenCalledWith('P7 text')
  })

  it('names no section that has nothing in the list', async () => {
    answering(
      many.map((title) => prompt(title)),
      []
    )
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())
    await user.click(screen.getByRole('menuitem', { name: /^More/ }))

    expect(screen.getByText('This project')).toBeInTheDocument()
    expect(screen.queryByText('Everywhere')).not.toBeInTheDocument()
  })

  it('names the installation’s only, when the project has none among the rest', async () => {
    answering(
      [prompt('P1')],
      many.slice(1).map((title) => prompt(title))
    )
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())
    await user.click(screen.getByRole('menuitem', { name: /^More/ }))

    expect(screen.queryByText('This project')).not.toBeInTheDocument()
    expect(screen.getByText('Everywhere')).toBeInTheDocument()
  })
})

describe('with no room above the button', () => {
  it('opens the list at once, with everything in it and the way to settings last', async () => {
    answering([prompt('A')], [prompt('B')])
    const user = userEvent.setup()
    const { button, onManage } = await renderFan({ at: CRAMPED })

    await user.click(button())

    expect(pills()).toEqual(['A', 'B', 'Manage prompts…'])
    expect(screen.getByText('This project')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')[0]?.style.getPropertyValue('--fan-index')).toBe('')

    await user.click(screen.getByRole('menuitem', { name: 'Manage prompts…' }))
    expect(onManage).toHaveBeenCalledOnce()
  })
})

describe('in the plan dialog', () => {
  it('offers only what is marked for it, and no way to settings', async () => {
    answering(
      [prompt('Review'), prompt('Tighten', { forPlan: true })],
      [prompt('Cut', { forPlan: true })]
    )
    const user = userEvent.setup()
    const { button } = await renderFan({ planOnly: true })

    await user.click(button())

    expect(pills()).toEqual(['Tighten', 'Cut'])
  })

  it('is not there at all when nothing is marked for it', async () => {
    answering([prompt('Review')], [prompt('Explain')])
    const { container } = await renderFan({ planOnly: true })

    // The lists have been read and there is still nothing to show.
    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledTimes(2)
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows "more" alone when the rest do not fit, and no settings pill beside it', async () => {
    const marked = Array.from({ length: 8 }, (_, index) =>
      prompt(`T${String(index + 1)}`, { forPlan: true })
    )
    answering(marked, [])
    const user = userEvent.setup()
    const { button } = await renderFan({ planOnly: true })

    await user.click(button())

    expect(pills()).toEqual(['T1', 'T2', 'T3', 'T4', 'More… (4)'])
  })
})

describe('in a dialog', () => {
  // `showModal()` makes everything outside the dialog inert, so a fan drawn
  // into the body would be there and could not be reached.
  it('is drawn into the dialog the button is in', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan({ inDialog: true })

    await user.click(button())

    const dialog = document.querySelector('dialog') as HTMLElement
    expect(dialog).toContainElement(screen.getByRole('menu'))
  })

  it('is drawn into the page otherwise', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(document.body).toContainElement(screen.getByRole('menu'))
    expect(document.querySelector('dialog')).toBeNull()
  })
})

describe('the keyboard', () => {
  it('starts on the first pill', async () => {
    answering([prompt('A'), prompt('B')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(screen.getByRole('menuitem', { name: 'A' })).toHaveFocus()
  })

  it('goes down and right to the next, and wraps round', async () => {
    answering([prompt('A'), prompt('B')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'B' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('menuitem', { name: 'Manage prompts…' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'A' })).toHaveFocus()
  })

  it('goes up and left to the one before, and wraps round', async () => {
    answering([prompt('A'), prompt('B')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())

    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Manage prompts…' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('menuitem', { name: 'B' })).toHaveFocus()
  })

  it('leaves the other keys to the browser', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())

    await user.keyboard('a')

    expect(screen.getByRole('menuitem', { name: 'A' })).toHaveFocus()
  })

  it('chooses with Enter', async () => {
    answering([prompt('A', { text: 'Do A.' })], [])
    const user = userEvent.setup()
    const { button, onPick } = await renderFan()
    await user.click(button())

    await user.keyboard('{Enter}')

    expect(onPick).toHaveBeenCalledWith('Do A.')
  })

  it('moves to the list’s first row when "more" opens it', async () => {
    answering(
      Array.from({ length: 9 }, (_, index) => prompt(`P${String(index + 1)}`)),
      []
    )
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())

    await user.click(screen.getByRole('menuitem', { name: /^More/ }))

    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus()
  })
})

describe('closing', () => {
  it('closes on Escape, and only the fan', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan({ inDialog: true })
    await user.click(button())

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    act(() => {
      window.dispatchEvent(escape)
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(escape.defaultPrevented).toBe(true)
  })

  it('closes on a click beside it, and stays on a click inside', async () => {
    answering([prompt('A'), prompt('B')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())

    // On the menu itself rather than on a pill: nothing is chosen.
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  // Its pills are fixed to where the button was.
  it('closes when the window is resized', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())

    fireEvent(window, new Event('resize'))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('starts afresh the next time it opens, on the fan and not the list', async () => {
    answering(
      Array.from({ length: 9 }, (_, index) => prompt(`P${String(index + 1)}`)),
      []
    )
    const user = userEvent.setup()
    const { button } = await renderFan()
    await user.click(button())
    await user.click(screen.getByRole('menuitem', { name: /^More/ }))
    await user.keyboard('{Escape}')

    await user.click(button())

    expect(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: /^More/ })
    ).toBeInTheDocument()
  })
})

describe('how the pills look', () => {
  // A circle with a gear and no words: it is not one of the prompts, and it is
  // the same place however many there are.
  it('draws the way to settings as a circle with a gear and no words', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    const manage = screen.getByRole('menuitem', { name: 'Manage prompts…' })
    expect(manage).toHaveTextContent('')
    expect(manage).toHaveAttribute('title', 'Manage prompts…')
    expect(within(manage).getByTestId('manage-icon')).toBeInTheDocument()
  })

  it('keeps the words on it in the list, where there is a row for it', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: CRAMPED })

    await user.click(button())

    expect(screen.getByRole('menuitem', { name: 'Manage prompts…' })).toHaveTextContent(
      'Manage prompts…'
    )
  })

  it('puts the plan icon on a prompt for the plan, and on no other', async () => {
    answering([prompt('Plain'), prompt('Tighten', { forPlan: true })], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(
      within(screen.getByRole('menuitem', { name: 'Tighten' })).getByTestId('plan-icon')
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('menuitem', { name: 'Plain' })).queryByTestId('plan-icon')
    ).not.toBeInTheDocument()
  })

  it('puts the plan icon on a row of the list too', async () => {
    answering([prompt('Tighten', { forPlan: true })], [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: CRAMPED })

    await user.click(button())

    expect(
      within(screen.getByRole('menuitem', { name: 'Tighten' })).getByTestId('plan-icon')
    ).toBeInTheDocument()
  })

  // Drawn into the body, the fan is no longer inside the pane that sets the
  // colour, so it is read where the button is and carried over.
  it('wears the colour of the project the button sits in', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan({ projectColor: 'rgb(10, 20, 30)' })

    await user.click(button())

    expect(screen.getByRole('menu').style.getPropertyValue('--project-color')).toBe(
      'rgb(10, 20, 30)'
    )
  })

  it('wears the colour in a dialog too, and in the list', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan({
      projectColor: 'rgb(10, 20, 30)',
      inDialog: true,
      at: CRAMPED
    })

    await user.click(button())

    expect(screen.getByRole('menu').style.getPropertyValue('--project-color')).toBe(
      'rgb(10, 20, 30)'
    )
  })

  it('sets no colour of its own where the button sits in no project', async () => {
    answering([prompt('A')], [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    expect(screen.getByRole('menu').style.getPropertyValue('--project-color')).toBe('')
  })
})

// From 9 o'clock to 12 first, and on to 3 when there are more than that holds.
describe('as far round as there are prompts', () => {
  const titles = (count: number): Prompt[] =>
    Array.from({ length: count }, (_, index) => prompt(`P${String(index + 1)}`))

  const items = (): HTMLElement[] => screen.getAllByRole('menuitem')

  it('stays on the left quarter while a few fit there', async () => {
    answering(titles(3), [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: OPEN })

    await user.click(button())

    expect(items()).toHaveLength(4)
    for (const item of items()) {
      expect(item.style.right).not.toBe('')
      expect(item.style.left).toBe('')
    }
  })

  // The button's centre is at (512, 612): the top of the arc is centred over it,
  // and the first rung of the right quarter is 50 to its right, growing away.
  it('goes on round to the right when the left quarter is full', async () => {
    answering(titles(8), [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: OPEN })

    await user.click(button())

    expect(pills()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'Manage prompts…'])
    expect(items()[3]?.style.right).not.toBe('')
    expect(items()[4]?.style.left).toBe('512px')
    expect(items()[5]?.style.left).toBe('562px')
    expect(items()[5]?.style.right).toBe('')
  })

  it('flies a right-hand pill in from the left, out of the button', async () => {
    answering(titles(8), [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: OPEN })

    await user.click(button())

    expect(items()[5]?.style.getPropertyValue('--fan-from-x')).toBe('-50px')
  })

  it('puts the way to settings at the far end', async () => {
    answering(titles(8), [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: OPEN })

    await user.click(button())

    expect(items().at(-1)).toHaveAccessibleName('Manage prompts…')
    expect(items().at(-1)?.style.left).not.toBe('')
  })

  it('falls back to "more" only when the whole half circle is full', async () => {
    answering(titles(12), [])
    const user = userEvent.setup()
    const { button } = await renderFan({ at: OPEN })

    await user.click(button())

    expect(pills()).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'More… (5)',
      'Manage prompts…'
    ])
  })

  it('keeps to the left where the button has no room on its right', async () => {
    answering(titles(8), [])
    const user = userEvent.setup()
    const { button } = await renderFan()

    await user.click(button())

    // Five rungs and no more: three of the eight, "more" for the other five, settings.
    expect(pills()).toEqual(['P1', 'P2', 'P3', 'More… (5)', 'Manage prompts…'])
  })
})
