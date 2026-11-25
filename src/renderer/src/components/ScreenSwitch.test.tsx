import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { type Screen, ScreenSwitch } from './ScreenSwitch.js'

function renderSwitch(current: Screen): ReturnType<typeof vi.fn> {
  const onScreen = vi.fn()
  render(<ScreenSwitch screen={current} onScreen={onScreen} />)
  return onScreen
}

describe('ScreenSwitch', () => {
  it.each([
    { current: 'octopus' as const, front: 'Octopus', back: 'Board' },
    { current: 'board' as const, front: 'Board', back: 'Octopus' }
  ])('fills $front with the accent while it is in front', ({ current, front, back }) => {
    renderSwitch(current)

    const group = screen.getByRole('group', { name: 'Screen' })
    expect(group).toContainElement(screen.getByRole('button', { name: front }))
    expect(screen.getByRole('button', { name: front })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: front })).toHaveClass('bg-accent', 'text-on-accent')
    expect(screen.getByRole('button', { name: back })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: back })).not.toHaveClass('bg-accent')
  })

  it.each([
    { current: 'octopus' as const, press: 'Board', to: 'board' },
    { current: 'board' as const, press: 'Octopus', to: 'octopus' }
  ])('switches to $to', async ({ current, press, to }) => {
    const user = userEvent.setup()
    const onScreen = renderSwitch(current)

    await user.click(screen.getByRole('button', { name: press }))

    expect(onScreen).toHaveBeenCalledWith(to)
  })
})
