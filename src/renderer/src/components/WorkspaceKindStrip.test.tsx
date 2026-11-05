import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceKindStrip } from './WorkspaceKindStrip.js'

describe('WorkspaceKindStrip', () => {
  // The strip shows the name, or the start of it when the name is too long for
  // it; a screen reader is told the whole one and that pressing it changes it.
  // The name starts with the word on screen, so saying what you see — "click
  // Resear." — finds it.
  it('shows the kind in a word and names it in full, starting with that word', () => {
    render(<WorkspaceKindStrip kind="research" onChange={vi.fn()} />)

    const strip = screen.getByRole('button', { name: /^Resear\./ })
    expect(strip).toHaveTextContent('Resear.')
    expect(strip).toHaveAccessibleName('Resear. — Research tag. Change')
  })

  it('says it opens a menu, and whether the menu is open', async () => {
    render(<WorkspaceKindStrip kind="feature" onChange={vi.fn()} />)
    const strip = screen.getByRole('button', { name: /^Feature/ })

    expect(strip).toHaveAttribute('aria-haspopup', 'menu')
    expect(strip).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(strip)
    expect(strip).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers every kind, with the current one chosen', async () => {
    render(<WorkspaceKindStrip kind="feature" onChange={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Feature — Feature tag. Change' }))

    const choices = screen.getAllByRole('menuitemradio')
    expect(choices).toHaveLength(12)
    expect(screen.getByRole('menuitemradio', { name: 'Feature' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(choices.filter((choice) => choice.getAttribute('aria-checked') === 'true')).toHaveLength(
      1
    )
  })

  // Said before the choice rather than after it: a pushed branch keeps its
  // name, and the reader should not find that out from the branch.
  it('says the branch follows the tag only until it is pushed', async () => {
    render(<WorkspaceKindStrip kind="feature" onChange={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Feature — Feature tag. Change' }))

    expect(
      screen.getByText('The branch is renamed with the tag until it is pushed.')
    ).toBeInTheDocument()
  })

  it('hands over the kind chosen', async () => {
    const onChange = vi.fn()
    render(<WorkspaceKindStrip kind="feature" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Feature — Feature tag. Change' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Bug' }))

    expect(onChange).toHaveBeenCalledWith('bug')
  })

  // Choosing what is already chosen asks git nothing and rereads no list.
  it('hands over nothing for the kind it already has', async () => {
    const onChange = vi.fn()
    render(<WorkspaceKindStrip kind="feature" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Feature — Feature tag. Change' }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Feature' }))

    expect(onChange).not.toHaveBeenCalled()
  })
})
