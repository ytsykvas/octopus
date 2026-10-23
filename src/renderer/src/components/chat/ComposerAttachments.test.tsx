/*
 * The strip's own two decisions, which the composer's tests do not reach.
 *
 * Everything about a *chip* — its name, its tooltip, taking one back — is
 * covered where it is used, in `Composer.test.tsx`. What is only true of the
 * strip is whether it is drawn at all and in what order, and both are choices
 * the component states in writing and nothing asserted.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ChatNote } from './attachments.js'
import { ComposerAttachments } from './ComposerAttachments.js'

const NOTE: ChatNote = {
  kind: 'diff',
  path: 'src/core/service.ts',
  side: 'new',
  line: 12,
  endLine: 12,
  code: 'const x = 1',
  text: 'why here?'
}

function renderStrip(notes: readonly ChatNote[]): void {
  render(<ComposerAttachments notes={notes} onRemove={vi.fn()} />)
}

describe('the strip riding along with the next message', () => {
  /*
   * Nothing at all rather than an empty strip, the way the attic above it
   * behaves: a rule over the field with nothing on it is chrome asserting that
   * a review exists.
   */
  it('is not drawn when there is nothing to say', () => {
    const { container } = render(<ComposerAttachments notes={[]} onRemove={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('is drawn for a note', () => {
    renderStrip([NOTE])

    expect(screen.getByText('why here?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeInTheDocument()
  })
})
