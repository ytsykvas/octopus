import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { readChange } from './changeSummary.js'
import { DiffPreview } from './DiffPreview.js'

vi.mock('../diff/highlight.js', () => ({ highlight: () => Promise.resolve(null) }))

function changeOf(name: string, input: unknown): NonNullable<ReturnType<typeof readChange>> {
  const change = readChange(name, input)
  if (change === null) throw new Error('not a change')
  return change
}

describe('a change under its row', () => {
  const long = changeOf('Write', {
    file_path: '/a.ts',
    content: Array.from({ length: 12 }, (_, i) => `line ${String(i)}`).join('\n')
  })

  it('shows its first lines and offers the rest', async () => {
    const user = userEvent.setup()
    render(<DiffPreview change={long} context={null} limit={10} />)

    expect(screen.getByText('line 9')).toBeInTheDocument()
    expect(screen.queryByText('line 10')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '2 more lines' }))

    expect(screen.getByText('line 11')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows every line when there is no limit', () => {
    render(<DiffPreview change={long} context={null} limit={null} />)
    expect(screen.getByText('line 11')).toBeInTheDocument()
  })

  // The edits of a MultiEdit land in different places; drawn back to back
  // they would read as one hunk.
  it('separates the edits of a MultiEdit', () => {
    const { container } = render(
      <DiffPreview
        change={changeOf('MultiEdit', {
          file_path: '/a.ts',
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'c', new_string: 'd' }
          ]
        })}
        context={null}
        limit={null}
      />
    )

    expect(container).toHaveTextContent('⋯')
  })
})
