import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { LibraryPreview } from '@core/library.js'
import type { LibraryKind } from '@core/libraryNames.js'

import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { LibraryImport } from './LibraryImport.js'

beforeAll(stubDialogElement)

interface Rendered {
  readonly onImport: ReturnType<typeof vi.fn>
  readonly onInspect: ReturnType<typeof vi.fn>
  readonly onClose: ReturnType<typeof vi.fn>
}

function renderImport(
  options: {
    readonly kind?: LibraryKind
    readonly taken?: readonly string[]
    readonly preview?: LibraryPreview | null
    readonly imported?: boolean
    readonly error?: string | null
  } = {}
): Rendered {
  const onImport = vi.fn().mockResolvedValue(options.imported ?? true)
  const onInspect = vi
    .fn()
    .mockResolvedValue(
      options.preview === undefined
        ? { name: 'ship', description: 'Commits and pushes.', text: 'Commit and push.' }
        : options.preview
    )
  const onClose = vi.fn()

  render(
    <LibraryImport
      kind={options.kind ?? 'command'}
      taken={options.taken ?? []}
      onImport={onImport}
      onInspect={onInspect}
      error={options.error ?? null}
      onClose={onClose}
    />
  )

  return { onImport, onInspect, onClose }
}

/** The paste route, which starts hidden: "from disk" is what the dialog opens on. */
async function pasted(
  user: ReturnType<typeof userEvent.setup>,
  text = 'Commit and push.'
): Promise<void> {
  await user.click(screen.getByRole('radio', { name: 'Paste' }))
  await user.type(screen.getByLabelText('Paste'), text)
}

describe('bringing one in', () => {
  /*
   * Two steps, and the second one is the point: a command names itself nowhere,
   * so what it will be called is not on screen until the document has been read.
   */
  it('reads before it writes', async () => {
    const user = userEvent.setup()
    const { onInspect, onImport } = renderImport()

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    // Nothing written yet, and the name now on screen.
    expect(onImport).not.toHaveBeenCalled()

    expect(await screen.findByDisplayValue('ship')).toBeInTheDocument()
    expect(onInspect).toHaveBeenCalledWith({ kind: 'text', text: 'x' })
  })

  it('cannot read a route that has been given nothing', () => {
    renderImport()

    expect(screen.getByRole('button', { name: 'Read it' })).toBeDisabled()
  })

  /*
   * The document that was read, not the source again: fetching an address a
   * second time could answer differently, and it is the first answer the reader
   * agreed to.
   */
  it('writes the document it showed, rather than reading the source twice', async () => {
    const user = userEvent.setup()
    const { onImport, onInspect, onClose } = renderImport()

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await user.click(await screen.findByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith('ship', 'Commit and push.')
    })
    expect(onInspect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open when the write is refused', async () => {
    const user = userEvent.setup()
    const { onClose } = renderImport({ imported: false })

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await user.click(await screen.findByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  it('offers nothing to write when the read failed', async () => {
    const user = userEvent.setup()
    renderImport({ preview: null })

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    // Still the first step: there is nothing to name and nothing to write.
    expect(await screen.findByRole('button', { name: 'Read it' })).toBeInTheDocument()
  })

  // The section's own banner is behind the modal, so the refusal is drawn here.
  it('shows the store’s last refusal', () => {
    renderImport({ error: 'Something called ship is already here.' })

    expect(screen.getByText('Something called ship is already here.')).toBeInTheDocument()
  })
})

describe('the name it will be filed under', () => {
  it('is what the source suggested, and can be changed', async () => {
    const user = userEvent.setup()
    const { onImport } = renderImport()

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    const field = await screen.findByDisplayValue('ship')
    await user.clear(field)
    await user.type(field, 'gate')
    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(onImport).toHaveBeenCalledWith('gate', 'Commit and push.')
    })
  })

  // Pasted text suggests nothing, which is exactly the case the field is for.
  it('can be empty, and then nothing may be written', async () => {
    const user = userEvent.setup()
    renderImport({ preview: { name: '', description: '', text: 'Commit.' } })

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    expect(await screen.findByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('is refused before the round trip when it cannot be a file', async () => {
    const user = userEvent.setup()
    const { onImport } = renderImport()

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    const field = await screen.findByDisplayValue('ship')
    await user.clear(field)
    await user.type(field, 'Ship It')

    expect(
      screen.getByText('Use lowercase letters, digits, dashes and underscores.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    expect(onImport).not.toHaveBeenCalled()
  })

  it('is refused when something here already has it', async () => {
    const user = userEvent.setup()
    renderImport({ taken: ['ship'] })

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    expect(await screen.findByText('Something of this name is already here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('says so when the document describes itself as nothing', async () => {
    const user = userEvent.setup()
    renderImport({ preview: { name: 'ship', description: '', text: 'Commit.' } })

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    expect(await screen.findByText('It describes itself as nothing.')).toBeInTheDocument()
  })
})

describe('the three routes', () => {
  it('picks one markdown file from disk, never a folder', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().dialog.pickMarkdown).mockResolvedValue({ ok: true, value: '/x/ship.md' })
    const { onInspect } = renderImport()

    await user.click(screen.getByRole('button', { name: 'Choose…' }))

    expect(await screen.findByDisplayValue('/x/ship.md')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    expect(onInspect).toHaveBeenCalledWith({ kind: 'path', path: '/x/ship.md' })
  })

  it('keeps the field as it was when the picker is cancelled', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().dialog.pickMarkdown).mockResolvedValue({ ok: true, value: null })
    renderImport()

    await user.click(screen.getByRole('button', { name: 'Choose…' }))

    expect(screen.getByRole('button', { name: 'Read it' })).toBeDisabled()
  })

  it('fetches an address', async () => {
    const user = userEvent.setup()
    const { onInspect } = renderImport()

    await user.click(screen.getByRole('radio', { name: 'From a link' }))
    await user.type(screen.getByLabelText('Address'), 'https://e.test/ship.md')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    expect(onInspect).toHaveBeenCalledWith({ kind: 'url', url: 'https://e.test/ship.md' })
  })

  // What was read was read about the other route, and so was the name.
  it('forgets what it read when the route changes', async () => {
    const user = userEvent.setup()
    renderImport()

    await pasted(user, 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await screen.findByDisplayValue('ship')

    await user.click(screen.getByRole('radio', { name: 'From a link' }))

    expect(screen.queryByDisplayValue('ship')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read it' })).toBeInTheDocument()
  })

  it('closes without writing anything', async () => {
    const user = userEvent.setup()
    const { onClose, onImport } = renderImport()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
  })
})
