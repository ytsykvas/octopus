import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeclaredCarryFiles } from '@core/service.js'

import { octopus } from '../test/octopus.js'
import { DeclaredFiles } from './DeclaredFiles.js'

beforeEach(() => {
  octopus()
})

function declares(files: DeclaredCarryFiles['files']): void {
  vi.mocked(octopus().projects.declaredCarryFiles).mockResolvedValue({
    ok: true,
    value: { path: '.conductor/settings.toml', files }
  })
}

function renderBlock(): { onAdded: ReturnType<typeof vi.fn> } {
  const onAdded = vi.fn()
  render(<DeclaredFiles projectId="planner" onAdded={onAdded} />)
  return { onAdded }
}

describe('what the repository declares', () => {
  /* Every repository that was not set up for Conductor, and most of the ones
     that were. A heading over an empty list would be a section about nothing. */
  it('draws nothing where the checkout declares nothing', async () => {
    renderBlock()

    await waitFor(() => {
      expect(octopus().projects.declaredCarryFiles).toHaveBeenCalledWith('planner')
    })
    expect(screen.queryByText('Declared by the repository')).not.toBeInTheDocument()
  })

  it('names the file the declaration came from', async () => {
    declares([{ glob: '.env', pattern: false, carried: false }])
    renderBlock()

    expect(await screen.findByText(/\.conductor\/settings\.toml/)).toBeInTheDocument()
  })

  it('marks what the list already carries', async () => {
    declares([
      { glob: '.env', pattern: false, carried: true },
      { glob: 'config/master.key', pattern: false, carried: false }
    ])
    renderBlock()

    await screen.findByText('.env')
    expect(screen.getByText('already listed')).toBeInTheDocument()
    // One mark, not one per row: the second is not carried.
    expect(screen.getAllByText('already listed')).toHaveLength(1)
  })

  /*
   * `carryInto` hands each entry to `copyFile`, so a glob in the list names a
   * file that does not exist. Saying the declaration is there and that octopus
   * will not follow it is the honest half of this whole block.
   */
  it('says a pattern is declared and will not be followed', async () => {
    declares([{ glob: 'config/*.key', pattern: true, carried: false }])
    renderBlock()

    expect(await screen.findByText(/copies named files only/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers to add only what is missing and is not a pattern', async () => {
    declares([
      { glob: '.env', pattern: false, carried: true },
      { glob: 'config/master.key', pattern: false, carried: false },
      { glob: 'certs/**', pattern: true, carried: false }
    ])
    renderBlock()

    expect(
      await screen.findByRole('button', { name: 'Add 1 entry to the list above' })
    ).toBeInTheDocument()
  })

  // Appended, not replaced: the list may hold entries with a source that no
  // declaration knows about.
  it('appends to the list rather than replacing it', async () => {
    vi.mocked(octopus().projects.readCarryList).mockResolvedValue({
      ok: true,
      value: '.env = /elsewhere/planner/.env'
    })
    declares([{ glob: 'config/master.key', pattern: false, carried: false }])
    const user = userEvent.setup()
    const { onAdded } = renderBlock()

    await user.click(await screen.findByRole('button', { name: /Add 1 entry/ }))

    await waitFor(() => {
      expect(octopus().projects.saveCarryList).toHaveBeenCalledWith(
        'planner',
        '.env = /elsewhere/planner/.env\nconfig/master.key\n'
      )
    })
    // The box above holds its text from before the write and has to be told.
    expect(onAdded).toHaveBeenCalled()
  })

  // A list already ending in a newline needs no second one, or every append
  // would leave a blank line behind it.
  it('does not double the newline the list already ends with', async () => {
    vi.mocked(octopus().projects.readCarryList).mockResolvedValue({ ok: true, value: '.env\n' })
    declares([{ glob: 'config/master.key', pattern: false, carried: false }])
    const user = userEvent.setup()
    renderBlock()

    await user.click(await screen.findByRole('button', { name: /Add 1 entry/ }))

    await waitFor(() => {
      expect(octopus().projects.saveCarryList).toHaveBeenCalledWith(
        'planner',
        '.env\nconfig/master.key\n'
      )
    })
  })

  // The answer belongs to a dialog that is no longer there.
  it('drops a declaration that arrives after the section has gone', async () => {
    let settle: ((answer: { ok: true; value: DeclaredCarryFiles }) => void) | undefined
    vi.mocked(octopus().projects.declaredCarryFiles).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const { unmount } = render(<DeclaredFiles projectId="planner" onAdded={vi.fn()} />)

    unmount()
    settle?.({
      ok: true,
      value: {
        path: '.conductor/settings.toml',
        files: [{ glob: '.env', pattern: false, carried: false }]
      }
    })

    await waitFor(() => {
      expect(screen.queryByText('.env')).not.toBeInTheDocument()
    })
  })

  it('writes nothing when the list it would append to cannot be read', async () => {
    vi.mocked(octopus().projects.readCarryList).mockResolvedValue({
      ok: false,
      error: 'gone',
      code: 'projectMissing'
    })
    declares([{ glob: '.env', pattern: false, carried: false }])
    const user = userEvent.setup()
    renderBlock()

    await user.click(await screen.findByRole('button', { name: /Add 1 entry/ }))

    await waitFor(() => {
      expect(octopus().projects.declaredCarryFiles).toHaveBeenCalledTimes(2)
    })
    expect(octopus().projects.saveCarryList).not.toHaveBeenCalled()
  })

  it('draws nothing when the read fails', async () => {
    vi.mocked(octopus().projects.declaredCarryFiles).mockResolvedValue({
      ok: false,
      error: 'gone',
      code: 'projectMissing'
    })
    renderBlock()

    await waitFor(() => {
      expect(octopus().projects.declaredCarryFiles).toHaveBeenCalled()
    })
    expect(screen.queryByText('Declared by the repository')).not.toBeInTheDocument()
  })
})
