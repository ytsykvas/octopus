import { render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from '../test/dialog.js'
import { octopus } from '../test/octopus.js'
import { RepoTrustReview } from './RepoTrustReview.js'

beforeAll(stubDialogElement)
beforeEach(() => {
  octopus()
})

describe('RepoTrustReview', () => {
  /*
   * The whole contents, not a summary: a summary of a file that grants
   * capability is a summary somebody has to trust instead.
   */
  it('shows each file with what it holds', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({
      ok: true,
      value: {
        approved: false,
        files: [
          { path: '.claude/settings.json', contents: '"Bash(npm run:*)"' },
          { path: '.claude/hooks/format.sh', contents: '#!/bin/sh\nprettier --write "$1"\n' }
        ]
      }
    })
    render(<RepoTrustReview workspaceId="anna" onApproved={vi.fn()} onClose={vi.fn()} />)

    expect(await screen.findByText('.claude/settings.json')).toBeInTheDocument()
    expect(screen.getByText('.claude/hooks/format.sh')).toBeInTheDocument()
    expect(screen.getByText(/prettier --write/)).toBeInTheDocument()
  })

  // A read that failed lists nothing rather than an empty file somebody would
  // read as "this repository ships nothing".
  it('lists nothing when the files could not be read', async () => {
    vi.mocked(octopus().workspaces.trust).mockResolvedValue({ ok: false, error: 'EACCES' })
    render(<RepoTrustReview workspaceId="anna" onApproved={vi.fn()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(octopus().workspaces.trust).toHaveBeenCalled()
    })
    expect(screen.queryByText('.claude/settings.json')).toBeNull()
  })

  // The answer landing after the dialog has gone belongs to nobody.
  it('drops an answer that arrives after it has closed', async () => {
    const gate: { land: (() => void) | null } = { land: null }
    vi.mocked(octopus().workspaces.trust).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.land = () => {
            resolve({
              ok: true,
              value: { approved: false, files: [{ path: '.claude/settings.json', contents: '{}' }] }
            })
          }
        })
    )
    const { unmount } = render(
      <RepoTrustReview workspaceId="anna" onApproved={vi.fn()} onClose={vi.fn()} />
    )
    await waitFor(() => {
      expect(gate.land).not.toBeNull()
    })

    unmount()
    gate.land?.()

    expect(screen.queryByText('.claude/settings.json')).toBeNull()
  })
})
