import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ToolResult } from './logBlocks.js'
import { OUTPUT_PAGE, OutputPreview } from './OutputPreview.js'

function result(overrides: Partial<ToolResult> = {}): ToolResult {
  return { type: 'tool_result', toolUseId: 'c-1', ok: true, content: 'fine', ...overrides }
}

const lines = (count: number): string =>
  Array.from({ length: count }, (_, i) => `line ${String(i)}`).join('\n')

describe('an output in an opened row', () => {
  // A live `Read` of thousands of lines is all here; the document gets a page
  // at a time.
  it('draws a page of a long output and the next on asking', async () => {
    const user = userEvent.setup()
    render(<OutputPreview result={result({ content: lines(OUTPUT_PAGE + 50) })} />)

    const pre = screen.getByText(/line 0/)
    expect(pre).toHaveTextContent(`line ${String(OUTPUT_PAGE - 1)}`)
    expect(pre).not.toHaveTextContent(`line ${String(OUTPUT_PAGE)}`)

    await user.click(screen.getByRole('button', { name: 'Show 50 more lines' }))

    expect(screen.getByText(/line 0/)).toHaveTextContent(`line ${String(OUTPUT_PAGE + 49)}`)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws a failure in the danger colour', () => {
    render(<OutputPreview result={result({ ok: false, content: 'boom' })} />)
    expect(screen.getByText('boom')).toHaveClass('text-danger')
  })

  // Reopened after a restart, only the head was kept — and the head must not
  // pass for the whole.
  it('says when only the start of the output was saved', () => {
    const { unmount } = render(
      <OutputPreview result={result({ truncated: true, lineCount: 900 })} />
    )
    expect(
      screen.getByText('Only the start of this output was saved — 900 lines in all.')
    ).toBeInTheDocument()
    unmount()

    render(<OutputPreview result={result({ truncated: true })} />)
    expect(screen.getByText('Only the start of this output was saved.')).toBeInTheDocument()
  })
})
