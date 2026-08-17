import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ComposerChip } from './ComposerChip.js'

function renderChip(
  overrides: Partial<React.ComponentProps<typeof ComposerChip>> = {}
): ReturnType<typeof vi.fn> {
  const onClick = vi.fn()

  render(
    <ComposerChip
      label="Effort"
      value="Very high"
      onClick={onClick}
      open={false}
      popup="menu"
      {...overrides}
    />
  )

  return onClick
}

const chip = (): HTMLElement => screen.getByRole('button', { name: 'Effort' })

describe('a composer chip', () => {
  /*
   * The row shows no labels — three settings side by side under the field, each
   * saying only what it is set to. So the name has to come from somewhere, and
   * `aria-label` is it: without one the button announces "Very high" and
   * nothing about what is very high.
   */
  it('is named by its setting and says what that setting is', () => {
    renderChip()

    expect(chip()).toHaveTextContent('Very high')
  })

  it('reports what it opens and whether that is open', () => {
    renderChip({ popup: 'dialog', open: true })

    expect(chip()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(chip()).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens what it is for when pressed', async () => {
    const user = userEvent.setup()
    const onClick = renderChip()

    await user.click(chip())

    expect(onClick).toHaveBeenCalledOnce()
  })

  // Greyed out rather than hidden: a control that disappears as the model
  // changes is harder to make sense of than one that stays put and says why.
  it('carries the reason it cannot be used', async () => {
    const user = userEvent.setup()
    const onClick = renderChip({ disabled: true, title: 'This model does not take one.' })

    expect(chip()).toBeDisabled()
    expect(chip()).toHaveAttribute('title', 'This model does not take one.')

    await user.click(chip())
    expect(onClick).not.toHaveBeenCalled()
  })
})
