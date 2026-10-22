import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModel } from '@core/chats.js'

import { ModelPicker } from './ModelPicker.js'

/** A catalogue shaped like the CLI's, `Default (recommended)` row and all. */
const CATALOGUE: AgentModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: '',
    supportsEffort: null,
    supportedEffortLevels: null
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: '',
    supportsEffort: null,
    supportedEffortLevels: null
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: '',
    supportsEffort: null,
    supportedEffortLevels: null
  }
]

function renderPicker(overrides: Partial<React.ComponentProps<typeof ModelPicker>> = {}): {
  onChange: ReturnType<typeof vi.fn>
} {
  const onChange = vi.fn()

  render(
    <div>
      <ModelPicker
        models={CATALOGUE}
        model={null}
        planModel={null}
        onChange={onChange}
        display="Opus (1M context)"
        sessionMovedTo={null}
        {...overrides}
      />
      <button type="button">Somewhere else</button>
    </div>
  )

  return { onChange }
}

const chip = (): HTMLElement => screen.getByRole('button', { name: 'Model' })
const planColumn = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Plan and research' })
const codeColumn = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Writing code' })

/**
 * A rect for the chip, since jsdom lays nothing out and answers zeroes.
 *
 * Which means every branch that decides where the panel goes is unreachable
 * without this — the same reason `DropdownMenu.test.tsx` spies on it.
 */
/** What `place` makes the chip, and the room `useAnchoredPanel` leaves beside it. */
const CHIP_HEIGHT = 24
const GAP = 6

function place(element: HTMLElement, at: { top: number; left: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: at.top,
    bottom: at.top + CHIP_HEIGHT,
    left: at.left,
    right: at.left + 120,
    width: 120,
    height: CHIP_HEIGHT,
    x: at.left,
    y: at.top,
    toJSON: () => ({})
  })
}

describe('the model chip', () => {
  it('names the model in force and opens nothing until it is clicked', () => {
    renderPicker()

    expect(chip()).toHaveTextContent('Opus (1M context)')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers both jobs, each as a group of its own', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())

    // The writing side carries one row more: the one that follows the plan.
    expect(within(planColumn()).getAllByRole('radio')).toHaveLength(2)
    expect(within(codeColumn()).getAllByRole('radio')).toHaveLength(3)
  })

  it('closes again when the chip is clicked a second time', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())
    await user.click(chip())

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the two columns', () => {
  it('lays the plan out first and the writing beside it', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())

    const [first, second] = screen.getAllByRole('radiogroup')
    expect(first).toBe(planColumn())
    expect(second).toBe(codeColumn())
  })

  it('ticks the default for planning and has the writing follow it', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())

    expect(within(planColumn()).getByRole('radio', { name: /Opus \(1M context\)/ })).toBeChecked()
    expect(within(codeColumn()).getByRole('radio', { name: /Same as plan/ })).toBeChecked()
    // Nothing below the first row is the writing's own choice yet.
    expect(
      within(codeColumn()).getByRole('radio', { name: /^Opus \(1M context\)/ })
    ).not.toBeChecked()
  })

  /*
   * The first row of the writing column names what it resolves to rather than
   * leaving the reader to work it out — it is ticked precisely when the
   * question is "so what does writing actually run on".
   */
  it('names the model the writing side follows', async () => {
    const user = userEvent.setup()
    renderPicker({ model: 'sonnet' })

    await user.click(chip())

    expect(within(codeColumn()).getAllByRole('radio')[0]).toHaveTextContent('Same as planSonnet')
  })

  // The writing follows the plan, so with no split the plan's choice is the
  // shared one — and the pair stays unsplit.
  it('moves both jobs when the plan is chosen with no split', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()

    await user.click(chip())
    await user.click(within(planColumn()).getByRole('radio', { name: 'Sonnet' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: 'sonnet', planModel: null })
  })

  it('stores the shared default as no override at all', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ model: 'sonnet' })

    await user.click(chip())
    await user.click(within(planColumn()).getByRole('radio', { name: /Opus \(1M context\)/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: null, planModel: null })
  })

  /*
   * Null is already spoken for on the plan side — it means one model does both
   * jobs — so the agent's own default has to be said with the word there.
   * Stored as null instead, choosing it would silently undo the split.
   */
  it('stores a split plan on the default as the word, not as an absence', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ model: 'sonnet', planModel: 'opus[1m]' })

    await user.click(chip())
    await user.click(within(planColumn()).getByRole('radio', { name: /Opus \(1M context\)by/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: 'sonnet', planModel: 'default' })
  })

  // A writer of its own is what makes the split, and the plan keeps what it
  // was running on — here the agent's default, said with the word.
  it('splits the pair when the writing is given its own model', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()

    await user.click(chip())
    await user.click(within(codeColumn()).getByRole('radio', { name: 'Sonnet' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: 'sonnet', planModel: 'default' })
  })

  it('moves only the writing once the two are split', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ model: 'sonnet', planModel: 'opus[1m]' })

    await user.click(chip())
    await user.click(within(codeColumn()).getByRole('radio', { name: /^Opus \(1M context\)/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: null, planModel: 'opus[1m]' })
  })

  it('takes the split back off with the first row, onto the plan model', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ model: 'sonnet', planModel: 'opus[1m]' })

    await user.click(chip())
    await user.click(within(codeColumn()).getByRole('radio', { name: /Same as plan/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith({ model: 'opus[1m]', planModel: null })
  })

  // The record may hold the full name while the catalogue offers the short one.
  // Compared as text the two read as different models and nothing is ticked.
  it('ticks a row the record names in full', async () => {
    const user = userEvent.setup()
    renderPicker({ model: 'claude-sonnet-5', planModel: 'claude-sonnet-5' })

    await user.click(chip())

    expect(within(codeColumn()).getByRole('radio', { name: 'Sonnet' })).toBeChecked()
    expect(within(planColumn()).getByRole('radio', { name: 'Sonnet' })).toBeChecked()
  })

  // A first run, before any session has reported a catalogue: one row, and it
  // reads as words rather than as the raw `default` it would otherwise print.
  it('offers the default in plain language when no catalogue has arrived', async () => {
    const user = userEvent.setup()
    renderPicker({ models: [] })

    await user.click(chip())

    expect(within(planColumn()).getAllByRole('radio')).toHaveLength(1)
    expect(within(planColumn()).getByRole('radio', { name: 'Default model' })).toBeChecked()
  })

  /*
   * Two answers, so one visit. Closing on the first pick — which every menu in
   * the app does — would make setting both a matter of opening the panel twice.
   */
  it('stays open after a pick', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())
    await user.click(within(codeColumn()).getByRole('radio', { name: 'Sonnet' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

/*
 * `/model` moves the running session and leaves the record alone, because the
 * CLI scopes it to the session. The columns tick the record, so without a line
 * saying otherwise the panel read as the model the next message would run on.
 */
describe('a model chosen by /model for this session only', () => {
  it('says what the session is running above the columns', async () => {
    const user = userEvent.setup()
    renderPicker({ display: 'Sonnet', sessionMovedTo: 'Sonnet' })

    await user.click(chip())

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This session is running Sonnet: /model chose it for this session only.'
    )
    // The record is still what the columns tick.
    expect(within(planColumn()).getByRole('radio', { name: /Opus \(1M context\)/ })).toBeChecked()
  })
})

/*
 * What closes the panel, where it lands when the window is tight, and every
 * edge either of those has, are `useAnchoredPanel`'s and tested with it. What
 * is left here is the part only this component can get wrong: the height it
 * asks for, which it works out from the taller of its two columns.
 */
describe('the room it asks for', () => {
  it('sits under the chip when there is space below', async () => {
    const user = userEvent.setup()
    renderPicker()
    place(chip(), { top: 20, left: 40 })

    await user.click(chip())

    const panel = screen.getByRole('dialog')
    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThan(20)
    expect(panel.style.left).toBe('40px')
  })

  // The composer is at the bottom of the pane, so this is the ordinary case
  // rather than the edge one: a panel opening downwards would be off screen.
  // It only flips in time because the height counts the rows it is about to
  // draw — a fixed guess would be right for one catalogue and wrong for the next.
  it('flips above the chip when its own columns will not fit below', async () => {
    const user = userEvent.setup()
    renderPicker()
    place(chip(), { top: window.innerHeight - 40, left: 40 })

    await user.click(chip())

    // Pinned 6px above the chip by its bottom edge.
    expect(screen.getByRole('dialog')).toHaveStyle({ bottom: '46px' })
  })

  /*
   * The line takes room, and the panel flips on the height it expects to draw.
   * Placed so the columns alone just fit below — the title, the headings, four
   * rows and the padding come to 188px — and the line does not.
   */
  it('counts the line in the room it asks for', async () => {
    const user = userEvent.setup()
    const top = window.innerHeight - CHIP_HEIGHT - GAP - 188

    renderPicker()
    place(chip(), { top, left: 40 })
    await user.click(chip())
    expect(screen.getByRole('dialog').style.bottom).toBe('')
    cleanup()

    renderPicker({ sessionMovedTo: 'Sonnet' })
    place(chip(), { top, left: 40 })
    await user.click(chip())
    expect(screen.getByRole('dialog').style.bottom).not.toBe('')
  })
})
