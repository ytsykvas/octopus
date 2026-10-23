import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useFocusKeeper } from './useFocusKeeper.js'

/** A region whose one button removes itself when pressed, beside one that does not. */
function Region({ attached = true }: { readonly attached?: boolean }): React.JSX.Element {
  const region = useRef<HTMLDivElement>(null)
  const [done, setDone] = useState(false)
  useFocusKeeper(region)

  return (
    <>
      <button type="button">Elsewhere</button>
      <p>Plain text beside it</p>
      <div ref={attached ? region : undefined} tabIndex={-1} aria-label="Region" role="region">
        {!done && (
          <button
            type="button"
            onClick={() => {
              setDone(true)
            }}
          >
            Finish
          </button>
        )}
      </div>
    </>
  )
}

describe('useFocusKeeper', () => {
  it('puts focus back on the region when the pressed control goes away', async () => {
    const user = userEvent.setup()
    render(<Region />)

    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Region' })).toHaveFocus()
  })

  it('leaves focus alone once it has moved somewhere else', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Region />)

    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    screen.getByRole('button', { name: 'Elsewhere' }).blur()
    rerender(<Region />)

    expect(document.body).toHaveFocus()
  })

  /* A click on text takes focus to the body without a focus event, and is still
     the reader leaving. */
  it('leaves focus alone after a click on something that cannot take it', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Region />)

    screen.getByRole('region', { name: 'Region' }).focus()
    await user.click(screen.getByText('Plain text beside it'))
    rerender(<Region />)

    expect(document.body).toHaveFocus()
  })

  it('does nothing before the region is drawn', async () => {
    const user = userEvent.setup()
    render(<Region attached={false} />)

    await user.click(screen.getByRole('button', { name: 'Finish' }))

    expect(document.body).toHaveFocus()
  })
})
