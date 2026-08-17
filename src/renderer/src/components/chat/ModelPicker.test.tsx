import { render, screen, within } from '@testing-library/react'
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
  onModel: ReturnType<typeof vi.fn>
  onPlanModel: ReturnType<typeof vi.fn>
} {
  const onModel = vi.fn()
  const onPlanModel = vi.fn()

  render(
    <div>
      <ModelPicker
        models={CATALOGUE}
        model={null}
        onModel={onModel}
        planModel={null}
        onPlanModel={onPlanModel}
        display="Opus (1M context)"
        {...overrides}
      />
      <button type="button">Somewhere else</button>
    </div>
  )

  return { onModel, onPlanModel }
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
function place(element: HTMLElement, at: { top: number; left: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: at.top,
    bottom: at.top + 24,
    left: at.left,
    right: at.left + 120,
    width: 120,
    height: 24,
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

    // The plan side carries one row more: the one that says there is no split.
    expect(within(planColumn()).getAllByRole('radio')).toHaveLength(3)
    expect(within(codeColumn()).getAllByRole('radio')).toHaveLength(2)
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
  it('ticks the agent default on both sides of a conversation that chose nothing', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())

    expect(within(codeColumn()).getByRole('radio', { name: /Opus \(1M context\)/ })).toBeChecked()
    expect(within(planColumn()).getByRole('radio', { name: /Same as writing code/ })).toBeChecked()
  })

  /*
   * The first row of the plan column names what it resolves to rather than
   * leaving the reader to work it out — it is ticked precisely when the
   * question is "so what does planning actually run on".
   */
  it('names the model the plan side falls back to', async () => {
    const user = userEvent.setup()
    renderPicker({ model: 'sonnet' })

    await user.click(chip())

    expect(within(planColumn()).getAllByRole('radio')[0]).toHaveTextContent(
      'Same as writing codeSonnet'
    )
  })

  it('stores the coding side default as no override at all', async () => {
    const user = userEvent.setup()
    const { onModel } = renderPicker({ model: 'sonnet' })

    await user.click(chip())
    await user.click(within(codeColumn()).getByRole('radio', { name: /Opus \(1M context\)/ }))

    expect(onModel).toHaveBeenCalledExactlyOnceWith(null)
  })

  /*
   * The whole encoding in one assertion. Null is already spoken for on the plan
   * side — it is the row above, meaning one model does both jobs — so the
   * agent's own default has to be said with the word. Stored as null instead,
   * choosing it would silently undo the split.
   */
  it('stores the plan side default as the word, not as an absence', async () => {
    const user = userEvent.setup()
    const { onPlanModel } = renderPicker()

    await user.click(chip())
    await user.click(within(planColumn()).getByRole('radio', { name: /^Opus \(1M context\)/ }))

    expect(onPlanModel).toHaveBeenCalledExactlyOnceWith('default')
  })

  it('takes the split back off with the first row', async () => {
    const user = userEvent.setup()
    const { onPlanModel } = renderPicker({ planModel: 'sonnet' })

    await user.click(chip())
    await user.click(within(planColumn()).getByRole('radio', { name: /Same as writing code/ }))

    expect(onPlanModel).toHaveBeenCalledExactlyOnceWith(null)
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

    expect(within(codeColumn()).getAllByRole('radio')).toHaveLength(1)
    expect(within(codeColumn()).getByRole('radio', { name: 'Default model' })).toBeInTheDocument()
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

    expect(Number.parseInt(screen.getByRole('dialog').style.top, 10)).toBeLessThan(
      window.innerHeight - 40
    )
  })
})
