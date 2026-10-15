import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedScript, ScriptsInWorkspace } from '@core/repoSource.js'
import type { RepositoryTrust } from '@core/repoTrust.js'

import { stubDialogElement } from '../test/dialog.js'
import { octopus } from '../test/octopus.js'
import { RepoTrust } from './RepoTrust.js'

beforeEach(() => {
  octopus()
  stubDialogElement()
})

/** A script the checkout supplies, as `resolveScripts` would report it. */
function fromRepo(from: string): ResolvedScript {
  return { kind: 'setup', source: 'repoOctopus', from, path: `/repo/${from}`, contents: 'npm ci' }
}

function runs(value: ScriptsInWorkspace): void {
  vi.mocked(octopus().projects.scripts).mockResolvedValue({ ok: true, value })
}

function grants(value: RepositoryTrust): void {
  vi.mocked(octopus().projects.trust).mockResolvedValue({ ok: true, value })
}

function renderTrust(
  overrides: Partial<{
    trusted: boolean
    trustedScripts: boolean
    onTrustChange: (trusted: boolean) => void
  }> = {}
): ReturnType<typeof render> {
  return render(
    <RepoTrust
      projectId="planner"
      workspaceId="ws-1"
      trusted={overrides.trusted ?? false}
      trustedScripts={overrides.trustedScripts ?? false}
      onTrustChange={overrides.onTrustChange ?? vi.fn()}
    />
  )
}

describe('RepoTrust', () => {
  describe('the switch', () => {
    it('hands a change to the dialog, which holds the project', async () => {
      const onTrustChange = vi.fn()
      renderTrust({ onTrustChange })

      await userEvent.click(screen.getByRole('switch', { name: 'Trust this repository' }))

      expect(onTrustChange).toHaveBeenCalledWith(true)
    })

    /*
     * The older switch said "scripts" and nothing more. It still covers them,
     * so nothing starts asking — and the reader is told what it does not cover
     * rather than finding out from a banner on every new workspace.
     */
    it('says what a scripts-only trust from before leaves out', () => {
      renderTrust({ trustedScripts: true })

      expect(screen.getByText(/trusted from before there was one switch/i)).toBeInTheDocument()
    })

    it('says nothing about it once the one switch is on', () => {
      renderTrust({ trusted: true, trustedScripts: true })

      expect(screen.queryByText(/trusted from before/i)).not.toBeInTheDocument()
    })

    it('asks both gates again when the switch moves, because the answer changes with it', async () => {
      const { rerender } = renderTrust()
      await waitFor(() => {
        expect(octopus().projects.trust).toHaveBeenCalledTimes(1)
      })

      rerender(
        <RepoTrust
          projectId="planner"
          workspaceId="ws-1"
          trusted
          trustedScripts={false}
          onTrustChange={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(octopus().projects.trust).toHaveBeenCalledTimes(2)
      })
      expect(octopus().projects.scripts).toHaveBeenCalledTimes(2)
    })
  })

  describe('the scripts', () => {
    it('says nothing runs from here when the checkout supplies none', async () => {
      renderTrust()

      expect(await screen.findByText(/supplies no scripts/i)).toBeInTheDocument()
    })

    it('names each script the checkout supplies and the file it came from', async () => {
      runs({
        approved: true,
        digest: 'd',
        scripts: { setup: fromRepo('.octopus/scripts/setup.sh') }
      })
      renderTrust()

      expect(await screen.findByText('.octopus/scripts/setup.sh')).toBeInTheDocument()
      expect(screen.getByText(/have been read and are allowed/i)).toBeInTheDocument()
    })

    it('leaves the list empty when the checkout could not be read', async () => {
      vi.mocked(octopus().projects.scripts).mockResolvedValue({ ok: false, error: 'broken' })
      renderTrust()

      expect(await screen.findByText(/supplies no scripts/i)).toBeInTheDocument()
    })

    it('leaves out a script the project itself wrote, which is not gated', async () => {
      runs({
        approved: true,
        digest: '',
        scripts: {
          setup: {
            kind: 'setup',
            source: 'project',
            from: '/scripts/setup.sh',
            path: '/scripts/setup.sh',
            contents: '#!/bin/sh\n'
          }
        }
      })
      renderTrust()

      expect(await screen.findByText(/supplies no scripts/i)).toBeInTheDocument()
    })

    /*
     * Shown before allowed, every byte, and allowed under the digest of what
     * was shown — so a pull that rewrote the script in between is refused
     * rather than approved unseen.
     */
    it('shows the scripts before allowing exactly what it showed', async () => {
      runs({
        approved: false,
        digest: 'shown',
        scripts: { setup: fromRepo('.octopus/scripts/setup.sh') }
      })
      renderTrust()

      expect(await screen.findByText(/have not been read yet/i)).toBeInTheDocument()
      expect(screen.queryByText('npm ci')).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Review and allow' }))
      expect(screen.getByText('npm ci')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

      expect(octopus().projects.approveScripts).toHaveBeenCalledWith('planner', 'ws-1', 'shown')
      await waitFor(() => {
        expect(octopus().projects.scripts).toHaveBeenCalledTimes(2)
      })
    })

    it('says so when the scripts changed after they were shown', async () => {
      runs({
        approved: false,
        digest: 'old',
        scripts: { setup: fromRepo('.octopus/scripts/setup.sh') }
      })
      vi.mocked(octopus().projects.approveScripts).mockResolvedValue({
        ok: false,
        error: 'changed',
        code: 'trustChanged'
      })
      renderTrust()

      await userEvent.click(await screen.findByRole('button', { name: 'Review and allow' }))
      await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/changed after it was shown/i)
    })
  })

  describe('the Claude settings', () => {
    it('lists nothing when the settings could not be read', async () => {
      vi.mocked(octopus().projects.trust).mockResolvedValue({ ok: false, error: 'EACCES' })
      renderTrust()

      expect(await screen.findByText(/ships none/i)).toBeInTheDocument()
    })

    // The answer landing after the section has gone belongs to nobody.
    it('drops an answer that arrives after it has gone', async () => {
      const gate: { land: (() => void) | null } = { land: null }
      vi.mocked(octopus().projects.trust).mockImplementation(
        () =>
          new Promise((resolve) => {
            gate.land = () => {
              resolve({
                ok: true,
                value: {
                  approved: false,
                  digest: 'd',
                  files: [{ path: '.claude/settings.json', contents: '{}' }]
                }
              })
            }
          })
      )
      const { unmount } = renderTrust()
      await waitFor(() => {
        expect(gate.land).not.toBeNull()
      })

      unmount()
      gate.land?.()

      expect(screen.queryByText('.claude/settings.json')).toBeNull()
    })

    it('says there is nothing to allow when the repository ships none', async () => {
      renderTrust()

      expect(await screen.findByText(/ships none/i)).toBeInTheDocument()
    })

    it('lists what it ships and says they load once read', async () => {
      grants({
        approved: true,
        digest: 'd',
        files: [{ path: '.claude/settings.json', contents: '{}' }]
      })
      renderTrust()

      expect(await screen.findByText('.claude/settings.json')).toBeInTheDocument()
      expect(screen.getByText(/every session loads them/i)).toBeInTheDocument()
      expect(screen.queryAllByRole('button', { name: 'Review and allow' })).toHaveLength(0)
    })

    it('opens the full review for what is waiting, and asks again once allowed', async () => {
      grants({
        approved: false,
        digest: 'shown',
        files: [{ path: '.claude/hooks/start.sh', contents: 'curl evil' }]
      })
      renderTrust()

      expect(await screen.findByText(/sessions load none of the repository/i)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Review and allow' }))

      expect(await screen.findByText('curl evil')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Allow these' }))

      expect(octopus().projects.approveSettings).toHaveBeenCalledWith('planner', 'ws-1', 'shown')
      await waitFor(() => {
        expect(screen.queryByText('curl evil')).not.toBeInTheDocument()
      })
      expect(octopus().projects.trust).toHaveBeenCalledTimes(3)
    })

    it('closes the review without allowing anything', async () => {
      grants({
        approved: false,
        digest: 'shown',
        files: [{ path: '.claude/hooks/start.sh', contents: 'curl evil' }]
      })
      renderTrust()

      await userEvent.click(await screen.findByRole('button', { name: 'Review and allow' }))
      expect(await screen.findByText('curl evil')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /close/i }))

      expect(screen.queryByText('curl evil')).not.toBeInTheDocument()
      expect(octopus().projects.approveSettings).not.toHaveBeenCalled()
    })
  })
})
