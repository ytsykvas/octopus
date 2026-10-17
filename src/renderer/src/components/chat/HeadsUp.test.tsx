import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { HeadsUp } from './HeadsUp.js'

const DETAIL = /commit or stash your work/

function renderHeadsUp(): { onKnown: () => void; onClose: () => void } {
  const onKnown = vi.fn()
  const onClose = vi.fn()
  render(<HeadsUp tip="rewindSkipsCommands" onKnown={onKnown} onClose={onClose} />)
  return { onKnown, onClose }
}

describe('a heads-up', () => {
  it('says the one line and keeps the explanation folded', () => {
    renderHeadsUp()

    expect(screen.getByRole('region', { name: 'Heads up' })).toHaveTextContent(
      'Rewinding files undoes only what the agent changed with its editing tools.'
    )
    expect(screen.queryByText(DETAIL)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Learn more' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('opens the explanation in place, and folds it again', async () => {
    const user = userEvent.setup()
    renderHeadsUp()

    await user.click(screen.getByRole('button', { name: 'Learn more' }))

    expect(screen.getByText(DETAIL)).toBeInTheDocument()
    const fold = screen.getByRole('button', { name: 'Show less' })
    expect(fold).toHaveAttribute('aria-expanded', 'true')

    await user.click(fold)

    expect(screen.queryByText(DETAIL)).not.toBeInTheDocument()
  })

  // The icons are decoration beside words that already say it, so each is
  // hidden from a screen reader and the buttons keep their plain names.
  it('puts an icon in front of each button without renaming it', () => {
    renderHeadsUp()

    for (const [name, icon] of [
      ['Learn more', 'lucide-chevron-down'],
      ['Knew this already', 'lucide-check'],
      ['Dismiss', 'lucide-x']
    ] as const) {
      const svg = screen.getByRole('button', { name }).querySelector('svg')
      expect(svg).toHaveClass(icon)
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })

  // The chevron turns over with the paragraph, so the state shows at a glance.
  it('turns the chevron over once the explanation is open', async () => {
    const user = userEvent.setup()
    renderHeadsUp()

    await user.click(screen.getByRole('button', { name: 'Learn more' }))

    const svg = screen.getByRole('button', { name: 'Show less' }).querySelector('svg')
    expect(svg).toHaveClass('lucide-chevron-up')
  })

  it('tells the two ways out apart', async () => {
    const user = userEvent.setup()
    const { onKnown, onClose } = renderHeadsUp()

    await user.click(screen.getByRole('button', { name: 'Knew this already' }))
    expect(onKnown).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
