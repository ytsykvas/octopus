import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DisclosureButton, DisclosureChevron } from './Disclosure.js'

const mark = (container: HTMLElement): SVGElement | null => container.querySelector('svg')

describe('the mark on something that folds', () => {
  it('points right while folded', () => {
    const { container } = render(<DisclosureChevron />)

    expect(mark(container)).toHaveClass('lucide-chevron-right')
    expect(mark(container)).not.toHaveClass('rotate-90')
    expect(mark(container)).toHaveAttribute('aria-hidden', 'true')
  })

  // Turned rather than swapped, so a `<details>` can turn it with CSS alone.
  it('turns down while open, as the same icon', () => {
    const { container } = render(<DisclosureChevron open />)

    expect(mark(container)).toHaveClass('lucide-chevron-right', 'rotate-90')
  })

  it('takes the size and classes of where it sits', () => {
    const { container } = render(<DisclosureChevron size={14} className="group-open:rotate-90" />)

    expect(mark(container)).toHaveAttribute('width', '14')
    expect(mark(container)).toHaveClass('group-open:rotate-90')
  })
})

describe('the button that opens a fold', () => {
  it('says whether it is open', () => {
    const { rerender } = render(
      <DisclosureButton open={false} onOpenChange={vi.fn()} className="">
        Tasks
      </DisclosureButton>
    )

    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-expanded', 'false')

    rerender(
      <DisclosureButton open onOpenChange={vi.fn()} className="">
        Tasks
      </DisclosureButton>
    )

    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-expanded', 'true')
  })

  // Controlled: it asks for the other state and leaves holding it to the caller.
  it('hands over the state it is being moved to', async () => {
    const onOpenChange = vi.fn()
    render(
      <DisclosureButton open onOpenChange={onOpenChange} className="">
        Tasks
      </DisclosureButton>
    )

    await userEvent.click(screen.getByRole('button'))

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('takes a name of its own where the text would say too much', () => {
    render(
      <DisclosureButton open={false} onOpenChange={vi.fn()} className="" label="src/a.ts">
        src/a.ts +3 −1
      </DisclosureButton>
    )

    expect(screen.getByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
  })

  it('draws the mark first, faint unless told otherwise, and turned with the fold', () => {
    const { container, rerender } = render(
      <DisclosureButton open={false} onOpenChange={vi.fn()} className="row">
        Tasks
      </DisclosureButton>
    )

    expect(screen.getByRole('button')).toHaveClass('row')
    expect(screen.getByRole('button').firstElementChild).toBe(mark(container))
    expect(mark(container)).toHaveClass('text-ink-faint')
    expect(mark(container)).not.toHaveClass('rotate-90')

    rerender(
      <DisclosureButton
        open
        onOpenChange={vi.fn()}
        className="row"
        chevron={{ size: 11, className: 'text-ink' }}
      >
        Tasks
      </DisclosureButton>
    )

    expect(mark(container)).toHaveClass('rotate-90', 'text-ink')
    expect(mark(container)).not.toHaveClass('text-ink-faint')
    expect(mark(container)).toHaveAttribute('width', '11')
  })
})
