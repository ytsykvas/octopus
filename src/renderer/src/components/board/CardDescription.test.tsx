import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CardDescription } from './CardDescription.js'

function renderDescription(description = '# Fix login\n\nThe form forgets the e-mail.\n'): void {
  render(<CardDescription description={description} />)
}

describe('CardDescription', () => {
  it('shows the description without its title line', () => {
    renderDescription('# Fix login\n\nThe form forgets the e-mail.\n')

    expect(screen.getByText('The form forgets the e-mail.')).toBeInTheDocument()
    expect(screen.queryByText('Fix login')).toBeNull()
  })

  it('says there is no description yet', () => {
    renderDescription('# Fix login\n')

    expect(screen.getByText('No description yet.')).toBeInTheDocument()
  })

  it('is a section named Description', () => {
    renderDescription()

    expect(screen.getByRole('region', { name: 'Description' })).toBeInTheDocument()
  })
})
