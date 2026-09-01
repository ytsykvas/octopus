import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Switch } from './Switch.js'

describe('a setting that is on or off', () => {
  /*
   * `role="switch"` rather than a checkbox: what this toggles applies at once,
   * and it is also the only handle a test — or a screen reader — has on the
   * state, since the control carries no text of its own.
   */
  it('announces which state it is in', () => {
    render(<Switch checked onChange={vi.fn()} label="review" />)

    expect(screen.getByRole('switch', { name: 'review' })).toBeChecked()
  })

  it('announces the other one too', () => {
    render(<Switch checked={false} onChange={vi.fn()} label="review" />)

    expect(screen.getByRole('switch', { name: 'review' })).not.toBeChecked()
  })

  it('hands over the state it is being moved to, not the one it is in', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Switch checked onChange={onChange} label="review" />)

    await user.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('does nothing while disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} label="review" disabled />)

    await user.click(screen.getByRole('switch'))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('switch')).toBeDisabled()
  })
})
