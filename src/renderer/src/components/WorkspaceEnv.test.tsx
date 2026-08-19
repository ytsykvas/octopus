import { render, screen } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from '../test/dialog.js'
import { octopus } from '../test/octopus.js'
import { WorkspaceEnv } from './WorkspaceEnv.js'

beforeAll(stubDialogElement)
beforeEach(() => {
  octopus()
})

describe('WorkspaceEnv', () => {
  it('shows the file as it stands', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({ ok: true, value: 'A=1\n' })
    render(<WorkspaceEnv workspaceId="anna" onClose={vi.fn()} />)

    expect(await screen.findByText(/A=1/)).toBeInTheDocument()
  })

  // The ordinary state of a workspace whose project adds nothing.
  it('says so where there is no file at all', async () => {
    vi.mocked(octopus().workspaces.env).mockResolvedValue({ ok: true, value: null })
    render(<WorkspaceEnv workspaceId="anna" onClose={vi.fn()} />)

    expect(await screen.findByText(/no env file yet/)).toBeInTheDocument()
  })

  /*
   * A read that lands after the dialog has gone belongs to a question nobody
   * is waiting on. Writing state then is React's "update on an unmounted
   * component", and the next dialog would open showing the last one's file.
   */
  it('drops an answer that arrives after it has closed', () => {
    const gate: { land: (() => void) | null } = { land: null }
    vi.mocked(octopus().workspaces.env).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.land = () => {
            resolve({ ok: true, value: 'A=1\n' })
          }
        })
    )

    const { unmount } = render(<WorkspaceEnv workspaceId="anna" onClose={vi.fn()} />)
    unmount()
    gate.land?.()

    expect(screen.queryByText(/A=1/)).toBeNull()
  })
})
