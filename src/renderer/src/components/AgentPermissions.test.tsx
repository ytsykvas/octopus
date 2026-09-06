import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliPermission } from '@core/cliPermissions.js'

import { octopus } from '../test/octopus.js'
import { AgentPermissions } from './AgentPermissions.js'

beforeEach(() => {
  octopus()
})

const rule = (overrides: Partial<CliPermission> = {}): CliPermission => ({
  scope: 'project',
  verdict: 'allow',
  rule: { toolName: 'Bash', ruleContent: 'npm run:*' },
  from: '.claude/settings.json',
  ...overrides
})

const answering = (rules: CliPermission[]): void => {
  vi.mocked(octopus().projects.cliPermissions).mockResolvedValue({ ok: true, value: rules })
}

describe('what Claude Code’s own settings allow', () => {
  /* A heading over an empty list would be the interface asserting a thing
     exists, and nothing at all is the ordinary answer. */
  it('draws nothing where the settings say nothing', async () => {
    render(<AgentPermissions projectId="planner" />)

    await waitFor(() => {
      expect(octopus().projects.cliPermissions).toHaveBeenCalledWith('planner')
    })
    expect(screen.queryByText('What those settings allow and refuse')).not.toBeInTheDocument()
  })

  /*
   * A rule in these files is honoured before octopus is consulted at all, so a
   * question that stopped being asked — or a command that stopped running — had
   * no explanation anywhere in the interface.
   */
  it('says what is allowed, and in which words', async () => {
    answering([rule()])
    render(<AgentPermissions projectId="planner" />)

    expect(await screen.findByText('Bash(npm run:*)')).toBeInTheDocument()
    expect(screen.getByText('allows')).toBeInTheDocument()
  })

  /* The half nothing showed at all. A refusal is the one worth catching the
     eye, so it is the one drawn in the danger tone. */
  it('says what is refused, and marks it', async () => {
    answering([rule({ verdict: 'deny', rule: { toolName: 'Read', ruleContent: './.env' } })])
    render(<AgentPermissions projectId="planner" />)

    expect(await screen.findByText('refuses')).toHaveClass('text-danger')
    expect(screen.getByText('Read(./.env)')).toBeInTheDocument()
  })

  it('marks one that only asks', async () => {
    answering([rule({ verdict: 'ask' })])
    render(<AgentPermissions projectId="planner" />)

    expect(await screen.findByText('asks')).toHaveClass('text-warning')
  })

  /* Where to go to change it, which is the whole of what this panel offers:
     the file is somebody else's to edit. */
  it('names the file each rule came from', async () => {
    answering([
      rule({ from: '.claude/settings.json' }),
      rule({ scope: 'user', from: '~/.claude/settings.json' })
    ])
    render(<AgentPermissions projectId="planner" />)

    expect(await screen.findByText('.claude/settings.json')).toBeInTheDocument()
    expect(screen.getByText('~/.claude/settings.json')).toBeInTheDocument()
  })

  it('draws nothing when the read failed', async () => {
    vi.mocked(octopus().projects.cliPermissions).mockResolvedValue({
      ok: false,
      error: 'gone',
      code: 'projectMissing'
    })
    render(<AgentPermissions projectId="planner" />)

    await waitFor(() => {
      expect(octopus().projects.cliPermissions).toHaveBeenCalled()
    })
    expect(screen.queryByText('What those settings allow and refuse')).not.toBeInTheDocument()
  })

  // The answer belongs to a dialog that is no longer there.
  it('drops an answer that arrives after the dialog has gone', async () => {
    let settle: ((value: { ok: true; value: CliPermission[] }) => void) | undefined
    vi.mocked(octopus().projects.cliPermissions).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const { unmount } = render(<AgentPermissions projectId="planner" />)

    unmount()
    settle?.({ ok: true, value: [rule()] })

    await waitFor(() => {
      expect(screen.queryByText('Bash(npm run:*)')).not.toBeInTheDocument()
    })
  })
})
