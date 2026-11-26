import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from './Button.js'

describe('Button', () => {
  it('draws dark ink on green, where white sinks into it', () => {
    render(<Button variant="success">Run</Button>)

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toHaveClass('bg-success', 'text-on-success')
    expect(run).not.toHaveClass('text-on-accent')
  })

  it('keeps white on the blue accent', () => {
    render(<Button variant="accent">Save</Button>)

    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-accent', 'text-on-accent')
  })
})
