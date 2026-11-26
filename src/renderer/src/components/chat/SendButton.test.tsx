import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SendButton } from './SendButton.js'

describe('SendButton', () => {
  it('draws its arrow in dark ink on green', () => {
    render(<SendButton label="Send" onClick={vi.fn()} />)

    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toHaveClass('bg-success', 'text-on-success')
    expect(send).not.toHaveClass('text-on-accent')
  })
})
