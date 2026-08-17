import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentModel } from '@core/chats.js'

import { EffortPicker } from './EffortPicker.js'

const OPUS: AgentModel = {
  value: 'opus',
  resolvedModel: 'claude-opus-5',
  displayName: 'Opus',
  description: '',
  supportsEffort: null,
  supportedEffortLevels: null
}

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof EffortPicker>> = {}
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn()

  render(<EffortPicker value="medium" onChange={onChange} model={OPUS} {...overrides} />)

  return onChange
}

const chip = (): HTMLElement => screen.getByRole('button', { name: 'Effort' })
const scale = (): HTMLElement => screen.getByRole('slider', { name: 'Thinking effort' })

/** The scale's wording, left to right — every notch as someone reads it. */
const ticks = (): string => scale().textContent

/** The whole scale, for a model that rules nothing out. */
const EVERYTHING = 'LowMediumHighVery highMaximumUltracodexhigh + workflows'

describe('the effort chip', () => {
  it('names the choice in force and opens nothing until it is clicked', () => {
    renderPicker({ value: 'xhigh' })

    expect(chip()).toHaveTextContent('Very high')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes again when the chip is clicked a second time', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())
    await user.click(chip())

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Greyed out rather than gone: a control that vanishes as the model changes
  // is harder to make sense of than one that stays and says why.
  it('greys out for a model that takes no effort at all', () => {
    renderPicker({ model: { ...OPUS, supportsEffort: false } })

    expect(chip()).toBeDisabled()
    expect(chip()).toHaveAttribute('title', 'This model does not take an effort setting.')
  })

  it('opens with the octopus of the choice in force', async () => {
    const user = userEvent.setup()
    renderPicker({ value: 'max' })

    await user.click(chip())

    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('max')
    )
  })

  // The picture is the reason to open the panel at all, so it has to follow the
  // marker rather than name the level the panel was opened on.
  it('changes the picture with the choice', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<EffortPicker value="low" onChange={vi.fn()} model={OPUS} />)

    await user.click(chip())
    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('low')
    )

    rerender(<EffortPicker value="ultracode" onChange={vi.fn()} model={OPUS} />)

    expect(screen.getByRole('dialog').querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('ultracode')
    )
  })
})

describe('the scale', () => {
  it('runs from the fastest to the most thorough, ultracode last', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(chip())

    expect(ticks()).toBe(EVERYTHING)
    expect(screen.getByText('Faster')).toBeInTheDocument()
    expect(screen.getByText('Smarter')).toBeInTheDocument()
  })

  it('says where the marker is and what that is called', async () => {
    const user = userEvent.setup()
    renderPicker({ value: 'high' })

    await user.click(chip())

    expect(scale()).toHaveAttribute('aria-valuenow', '2')
    expect(scale()).toHaveAttribute('aria-valuemax', '5')
    expect(scale()).toHaveAttribute('aria-valuetext', 'High')
  })

  it('picks the notch that was pressed', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()

    await user.click(chip())
    await user.click(screen.getByText('Maximum'))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('max')
  })

  // Past the divider and reached the same way as any other notch, whatever the
  // gap before it says about how different a thing it asks for.
  it('picks ultracode from the far end', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()

    await user.click(chip())
    await user.click(screen.getByText('Ultracode'))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('ultracode')
  })

  // The half the control is named for: the marker follows the pointer while the
  // button is down, so the whole scale can be swept without letting go.
  it('follows the pointer while the button is held down', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()

    await user.click(chip())
    fireEvent.pointerDown(screen.getByText('Low'), { buttons: 1 })
    fireEvent.pointerMove(screen.getByText('High'), { buttons: 1 })

    expect(onChange).toHaveBeenNthCalledWith(1, 'low')
    expect(onChange).toHaveBeenNthCalledWith(2, 'high')
  })

  // Passing over the scale on the way somewhere else is not a choice.
  it('ignores a pointer moving across it with nothing held down', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()

    await user.click(chip())
    fireEvent.pointerMove(screen.getByText('Maximum'), { buttons: 0 })

    expect(onChange).not.toHaveBeenCalled()
  })

  // The gap before `ultracode` is part of the scale's argument, and pressing it
  // is pressing nothing — not, as an index of 0 would have it, the fastest tick.
  it('ignores a press that lands between the notches', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()

    await user.click(chip())
    fireEvent.pointerDown(scale(), { buttons: 1 })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('steps with the arrow keys and jumps with Home and End', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker({ value: 'high' })

    await user.click(chip())
    scale().focus()

    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('xhigh')

    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('medium')

    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('low')

    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('ultracode')
  })

  /*
   * Past either end there is no notch, and saying nothing is the honest answer.
   * Clamped instead, `End` on the last tick would report a change to the choice
   * already in force — which the composer would take as something to store.
   */
  it('says nothing at the ends of the scale', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker({ value: 'ultracode' })

    await user.click(chip())
    scale().focus()

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{End}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves keys it has no use for to whatever else wants them', async () => {
    const user = userEvent.setup()
    const onChange = renderPicker()

    await user.click(chip())
    scale().focus()
    await user.keyboard('{ArrowUp}')

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('how long the scale is', () => {
  // Hidden rather than greyed: the scale is only as long as the model can go,
  // and a notch that cannot be reached is a step to nowhere.
  it('drops the levels the model does not take', async () => {
    const user = userEvent.setup()
    renderPicker({
      value: 'high',
      model: { ...OPUS, supportsEffort: true, supportedEffortLevels: ['high', 'max'] }
    })

    await user.click(chip())

    expect(ticks()).toBe('HighMaximum')
  })

  // Silence is not a refusal: a model that says nothing gets the full scale
  // rather than have levels hidden it would in fact accept.
  it('offers everything before any model has been reported', async () => {
    const user = userEvent.setup()
    renderPicker({ model: undefined })

    await user.click(chip())

    expect(ticks()).toBe(EVERYTHING)
  })

  // `ultracode` is `xhigh` with a fleet behind it, so it is offered exactly
  // when `xhigh` is — the SDK asks for a model that can run it.
  it('drops ultracode when the model cannot run xhigh', async () => {
    const user = userEvent.setup()
    renderPicker({
      value: 'high',
      model: { ...OPUS, supportsEffort: true, supportedEffortLevels: ['low', 'high'] }
    })

    await user.click(chip())

    expect(ticks()).toBe('LowHigh')
  })

  /*
   * The choice in force is offered whatever the model says about it. It is what
   * the next message will run with, and a scale whose marker sits on no notch
   * of its own has nothing to draw.
   */
  it('keeps the choice in force even when the model does not offer it', async () => {
    const user = userEvent.setup()
    renderPicker({
      value: 'ultracode',
      model: { ...OPUS, supportsEffort: true, supportedEffortLevels: ['low'] }
    })

    await user.click(chip())

    expect(ticks()).toBe('LowUltracodexhigh + workflows')
    expect(scale()).toHaveAttribute('aria-valuetext', 'Ultracode')
  })
})
