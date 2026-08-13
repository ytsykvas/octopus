import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ComposerPicker } from './ComposerPicker.js'

const OPTIONS = [
  { value: 'low', label: 'Low', description: 'Fastest' },
  { value: 'high', label: 'High' }
] as const

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof ComposerPicker<string>>> = {}
): { onChange: ReturnType<typeof vi.fn> } {
  const onChange = vi.fn()

  render(
    <ComposerPicker
      label="Effort"
      value="low"
      options={OPTIONS}
      onChange={onChange}
      {...overrides}
    />
  )
  return { onChange }
}

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'Effort' })

describe('a setting in the composer row', () => {
  it('shows the current choice and reports a new one', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()

    expect(trigger()).toHaveTextContent('Low')

    await user.click(trigger())
    await user.click(screen.getByRole('menuitemradio', { name: /High/ }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith('high')
  })

  it('marks which option is in force', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(trigger())

    expect(screen.getByRole('menuitemradio', { name: /Low/ })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: /High/ })).not.toBeChecked()
  })

  it('carries the second line of an option that needs one', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(trigger())

    expect(screen.getByText('Fastest')).toBeInTheDocument()
  })

  // The model list is remembered from the last session, so a chat can name a
  // model the list no longer has. Showing nothing would read as "no choice
  // made", which is a different and wrong statement.
  it('shows a value it has no option for as itself', () => {
    renderPicker({ value: 'claude-retired-3' })

    expect(trigger()).toHaveTextContent('claude-retired-3')
  })

  it('opens nothing while it is disabled, and says why', async () => {
    const user = userEvent.setup()
    renderPicker({ disabled: true, title: 'This model does not use effort' })

    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveAttribute('title', 'This model does not use effort')

    await user.click(trigger())
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })
})
