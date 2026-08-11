import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Placeholder } from './Placeholder.js'

describe('an empty pane', () => {
  it('says what is missing and what to do about it', () => {
    render(<Placeholder title="Select a project">Pick one from the list on the left.</Placeholder>)

    expect(screen.getByText('Select a project')).toBeInTheDocument()
    expect(screen.getByText('Pick one from the list on the left.')).toBeInTheDocument()
  })

  it('shows the mascot above the words', () => {
    const { container } = render(<Placeholder title="Select a project">Pick one.</Placeholder>)
    const image = container.querySelector('img')

    expect(image).toBeInTheDocument()
    expect(image?.getAttribute('src')).toContain('octopus')
  })

  // Decorative: a screen reader announcing "blue octopus" before "Select a
  // project" would add a word and no information. `getByRole('img')` finding
  // nothing is the assertion — an accessible image here would be the bug.
  it('hides the mascot from anything that reads the screen aloud', () => {
    render(<Placeholder title="Select a project">Pick one.</Placeholder>)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
