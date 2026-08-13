import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Markdown } from './Markdown.js'

const CODE = 'type Slots<S> = never\nexport const uk = 1\n'

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * A user, and a clipboard we can watch.
 *
 * The order matters: `userEvent.setup()` installs a clipboard of its own so
 * that `user.copy()` works, so ours has to go on afterwards or the component
 * writes to theirs and every assertion here reads an untouched mock. jsdom
 * itself ships no clipboard at all — this is the platform half, not a stand-in
 * for anything the component does.
 */
function withClipboard(
  options: Parameters<typeof userEvent.setup>[0] = {}
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup(options)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}

const copyButton = (): HTMLElement => screen.getByRole('button', { name: 'Copy' })

describe('a fenced block', () => {
  it('is drawn as a block with a way to copy it', () => {
    const { container } = render(<Markdown text={`\`\`\`ts\n${CODE}\`\`\``} />)

    expect(container.querySelector('pre')?.textContent).toContain('export const uk = 1')
    expect(copyButton()).toBeInTheDocument()
  })

  /*
   * A fence with no language after the backticks reaches the `code` override
   * looking exactly like inline code — verified against the library, not
   * assumed. Keyed off that class, a whole block would be drawn as an inline
   * chip; keyed off `pre`, as it is, both kinds of fence are blocks.
   */
  it('is a block even with no language on the fence', () => {
    const { container } = render(<Markdown text={'```\nplain fence\n```'} />)

    expect(container.querySelector('pre')?.textContent).toContain('plain fence')
    expect(copyButton()).toBeInTheDocument()
  })

  it('leaves inline code alone, with nothing to copy', () => {
    render(<Markdown text={'Look at `en.ts` first.'} />)

    expect(screen.getByText('en.ts').tagName).toBe('CODE')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('copying', () => {
  it('puts exactly what is on screen onto the clipboard', async () => {
    const user = withClipboard()
    render(<Markdown text={`\`\`\`ts\n${CODE}\`\`\``} />)

    await user.click(copyButton())

    expect(writeText).toHaveBeenCalledExactlyOnceWith(CODE)
  })

  it('says it worked', async () => {
    const user = withClipboard()
    render(<Markdown text={`\`\`\`ts\n${CODE}\`\`\``} />)

    await user.click(copyButton())

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  // A button still claiming "copied" a minute later is describing a clipboard
  // that has moved on.
  it('goes back to offering the copy', async () => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<Markdown text={`\`\`\`ts\n${CODE}\`\`\``} />)

    // `fireEvent` rather than `userEvent` here alone: user-event schedules its
    // own work on the timers this test has taken control of, and the two wait
    // on each other until the runner gives up.
    fireEvent.click(copyButton())

    // The write is awaited, so the label changes a microtask after the click.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(copyButton()).toBeInTheDocument()
  })

  // Refused clipboards are real — an unfocused document is enough — and a click
  // that quietly did nothing is worse than one that says so.
  it('says so when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('not allowed'))
    const user = withClipboard()
    render(<Markdown text={`\`\`\`ts\n${CODE}\`\`\``} />)

    await user.click(copyButton())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument()
    })
  })
})
