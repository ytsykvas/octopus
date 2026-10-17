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
    // The searching pose, not the one that signs off the About section.
    expect(image?.getAttribute('src')).toContain('octopus-searching')
  })

  // The right column is already a panel of its own, and a box inside it reads
  // as a dialog nobody opened.
  it('draws no box of its own in a narrow column', () => {
    const { container } = render(
      <Placeholder compact title="All quiet here">
        Select a workspace.
      </Placeholder>
    )

    expect(screen.getByText('All quiet here')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeInTheDocument()
    expect(container.querySelector('.panel')).toBeNull()
  })

  it('keeps its box in the centre', () => {
    const { container } = render(<Placeholder title="Which project today?">Pick one.</Placeholder>)

    expect(container.querySelector('.panel')).toBeInTheDocument()
  })

  it('leaves the octopus out when told another empty state shares the tab', () => {
    const { container } = render(
      <Placeholder compact art={false} title="Nothing to run yet">
        Select a workspace.
      </Placeholder>
    )

    expect(screen.getByText('Nothing to run yet')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('offers its actions in a narrow column too', () => {
    render(
      <Placeholder
        compact
        title="No build script yet"
        actions={<button type="button">Write</button>}
      >
        It runs in a fresh workspace.
      </Placeholder>
    )

    expect(screen.getByRole('button', { name: 'Write' }).closest('p')).toBeNull()
  })

  // Decorative: a screen reader announcing "blue octopus" before "Select a
  // project" would add a word and no information. `getByRole('img')` finding
  // nothing is the assertion — an accessible image here would be the bug.
  it('hides the mascot from anything that reads the screen aloud', () => {
    render(<Placeholder title="Select a project">Pick one.</Placeholder>)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  // The body renders inside a paragraph, so actions cannot ride along with it:
  // a button inside a `<p>` is markup the browser silently rearranges. That
  // they land outside it is the whole reason the slot exists.
  it('puts the actions beneath the words rather than inside them', () => {
    render(
      <Placeholder title="Start with a repository" actions={<button type="button">Add</button>}>
        Add one from this machine.
      </Placeholder>
    )

    const button = screen.getByRole('button', { name: 'Add' })
    expect(button).toBeInTheDocument()
    expect(button.closest('p')).toBeNull()
  })

  it('offers nothing to click when it was given no actions', () => {
    render(<Placeholder title="Select a project">Pick one.</Placeholder>)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
