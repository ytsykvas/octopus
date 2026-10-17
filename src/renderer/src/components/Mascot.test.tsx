import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Mascot } from './Mascot.js'

describe('the mascot', () => {
  // The plain pose signs off the About section and is the app's icon; the one
  // with the magnifying glass belongs to empty panes. A default that drifted
  // to the searching pose would put it in About with nothing else noticing.
  it('stands plain unless asked to search', () => {
    const { container } = render(<Mascot />)
    const src = container.querySelector('img')?.getAttribute('src') ?? ''

    expect(src).toContain('octopus')
    expect(src).not.toContain('searching')
  })

  it('holds the magnifying glass when searching', () => {
    const { container } = render(<Mascot pose="searching" />)

    expect(container.querySelector('img')?.getAttribute('src')).toContain('octopus-searching')
  })

  it('is decoration in either pose', () => {
    const { container } = render(<Mascot pose="searching" className="h-20" />)
    const image = container.querySelector('img')

    expect(image?.getAttribute('alt')).toBe('')
    expect(image?.getAttribute('aria-hidden')).toBe('true')
    expect(image).toHaveClass('h-20')
  })
})
