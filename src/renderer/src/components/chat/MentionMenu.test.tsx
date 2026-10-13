import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MentionFile } from '@core/fileSearch.js'

import { MentionMenu } from './MentionMenu.js'

beforeEach(() => {
  // jsdom has no layout, so there is nothing to scroll and no method to call.
  Element.prototype.scrollIntoView = vi.fn()
})

const NESTED: MentionFile = { path: 'src/core/auth.ts', absolute: '/w/src/core/auth.ts' }
const ROOT: MentionFile = { path: 'README.md', absolute: '/w/README.md' }

describe('the list of files being mentioned', () => {
  // A list of paths all beginning `src/renderer/src/components/` is read from
  // the right, so the name leads and the directory follows, faint.
  it('names each file and says where it is', () => {
    render(<MentionMenu files={[NESTED]} active={0} onActive={vi.fn()} onPick={vi.fn()} />)

    expect(screen.getByText('auth.ts')).toBeInTheDocument()
    expect(screen.getByText('src/core')).toBeInTheDocument()
  })

  it('has no directory to say for a file in the root', () => {
    render(<MentionMenu files={[ROOT]} active={0} onActive={vi.fn()} onPick={vi.fn()} />)

    expect(screen.getByRole('option', { name: 'README.md' })).toBeInTheDocument()
  })

  it('marks the row Enter would take', () => {
    render(<MentionMenu files={[NESTED, ROOT]} active={1} onActive={vi.fn()} onPick={vi.fn()} />)

    expect(screen.getByRole('option', { name: /README\.md/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('option', { name: /auth\.ts/ })).toHaveAttribute(
      'aria-selected',
      'false'
    )
  })

  it('hands the file up on mouse down, so the field keeps its focus', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<MentionMenu files={[NESTED]} active={0} onActive={vi.fn()} onPick={onPick} />)

    await user.click(screen.getByRole('option', { name: /auth\.ts/ }))

    expect(onPick).toHaveBeenCalledExactlyOnceWith(NESTED)
  })
})
