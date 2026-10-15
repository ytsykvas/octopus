import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    vi.mocked(octopus().projects.trust).mockResolvedValue({
      ok: true,
      value: {
        approved: false,
        digest: 'digest',
        files: [
          { path: '.claude/settings.json', contents: '"Bash(npm run:*)"' },
          { path: '.claude/hooks/format.sh', contents: '#!/bin/sh\nprettier --write "$1"\n' }
        ]
      }
    })
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByText('.claude/settings.json')).toBeInTheDocument()
    expect(screen.getByText('.claude/hooks/format.sh')).toBeInTheDocument()
    expect(screen.getByText(/prettier --write/)).toBeInTheDocument()
  })

  /*
   * The one entry whose contents are not contents. Reading a link out of the
   * worktree would put whatever it points at into this card, and leaving it out
   * is how a hook came to run unread — so the destination is what the reader
   * gets, and it has to look like a warning rather than like a one-line script.
   */
  it('marks a link leading out of the worktree instead of drawing its contents', async () => {
    vi.mocked(octopus().projects.trust).mockResolvedValue({
      ok: true,
      value: {
        approved: false,
        digest: 'digest',
        files: [{ path: '.claude/hooks/guard.sh', contents: '/elsewhere/id_rsa', link: true }]
      }
    })
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={vi.fn()}
        onClose={vi.fn()}
      />
    )

    const marker = await screen.findByText(/\/elsewhere\/id_rsa/)
    expect(marker).toHaveClass('text-warning')
    expect(marker.tagName).not.toBe('PRE')
  })

  it('says so when the link points at nothing', async () => {
    vi.mocked(octopus().projects.trust).mockResolvedValue({
      ok: true,
      value: {
        approved: false,
        digest: 'digest',
        files: [{ path: '.claude/hooks/broken.sh', contents: '', link: true }]
      }
    })
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByText(/pointing at nothing/)).toBeInTheDocument()
  })

  // A read that failed lists nothing rather than an empty file somebody would
  // read as "this repository ships nothing".
  it('lists nothing when the files could not be read', async () => {
    vi.mocked(octopus().projects.trust).mockResolvedValue({ ok: false, error: 'EACCES' })
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(octopus().projects.trust).toHaveBeenCalled()
    })
    expect(screen.queryByText('.claude/settings.json')).toBeNull()
  })

  /*
   * Allowed under the digest of what is on screen. Approving used to recompute
   * it at the click, so a hook rewritten after the card was drawn was allowed
   * without anybody seeing it.
   */
  it('allows exactly what it showed', async () => {
    vi.mocked(octopus().projects.trust).mockResolvedValue({
      ok: true,
      value: { approved: false, digest: 'shown', files: [{ path: '.mcp.json', contents: '{}' }] }
    })
    const onApproved = vi.fn()
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={onApproved}
        onClose={vi.fn()}
      />
    )

    await screen.findByText('.mcp.json')
    await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

    expect(octopus().projects.approveSettings).toHaveBeenCalledWith('planner', 'anna', 'shown')
    expect(onApproved).toHaveBeenCalled()
  })

  // Refused, it says why and reads again, so what is on screen is what is there.
  it('reads again when what it showed has changed since', async () => {
    vi.mocked(octopus().projects.trust).mockResolvedValue({
      ok: true,
      value: { approved: false, digest: 'old', files: [{ path: '.mcp.json', contents: '{}' }] }
    })
    vi.mocked(octopus().projects.approveSettings).mockResolvedValue({
      ok: false,
      error: 'changed',
      code: 'trustChanged'
    })
    const onApproved = vi.fn()
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={onApproved}
        onClose={vi.fn()}
      />
    )

    await screen.findByText('.mcp.json')
    await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed after it was shown/i)
    expect(onApproved).not.toHaveBeenCalled()
    expect(octopus().projects.trust).toHaveBeenCalledTimes(2)
  })

  // Nothing read yet is nothing to allow.
  it('offers nothing to allow before the files have been read', () => {
    vi.mocked(octopus().projects.trust).mockReturnValue(new Promise(() => undefined))
    render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Allow these' })).toBeDisabled()
  })

  // The answer landing after the dialog has gone belongs to nobody.
  it('drops an answer that arrives after it has closed', async () => {
    const gate: { land: (() => void) | null } = { land: null }
    vi.mocked(octopus().projects.trust).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.land = () => {
            resolve({
              ok: true,
              value: {
                approved: false,
                digest: 'digest',
                files: [{ path: '.claude/settings.json', contents: '{}' }]
              }
            })
          }
        })
    )
    const { unmount } = render(
      <RepoTrustReview
        projectId="planner"
        workspaceId="anna"
        onApproved={vi.fn()}
        onClose={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(gate.land).not.toBeNull()
    })

    unmount()
    gate.land?.()

    expect(screen.queryByText('.claude/settings.json')).toBeNull()
  })
})
