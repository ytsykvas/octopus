import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'

import { stubTerminalHost } from '../../test/terminal.js'
import { ClaudeSection } from './ClaudeSection.js'
import type { AccountsController } from './useAccounts.js'

const status = (claude: Partial<AccountsStatus['claude']> = {}): AccountsStatus => ({
  claude: {
    connected: false,
    email: null,
    authMethod: null,
    subscriptionType: null,
    orgName: null,
    ...claude
  },
  github: { connected: false, login: null, name: null }
})

const signedIn = (): AccountsStatus =>
  status({
    connected: true,
    email: 'someone@example.com',
    authMethod: 'oauth',
    subscriptionType: 'max',
    orgName: 'Acme'
  })

/** The hook the section is driven by, with nothing happening in it. */
function controller(overrides: Partial<AccountsController> = {}): AccountsController {
  return {
    status: null,
    checking: false,
    signingOut: null,
    error: null,
    session: null,
    refresh: vi.fn(() => Promise.resolve()),
    signIn: vi.fn(),
    signOut: vi.fn(() => Promise.resolve()),
    endSession: vi.fn(),
    ...overrides
  }
}

describe('ClaudeSection', () => {
  beforeEach(() => {
    // The section swaps itself for a terminal once a sign-in starts.
    stubTerminalHost()
  })

  // Nothing is known before the first status arrives, and an account that has
  // not answered yet must not look connected.
  it('shows the account as not connected until the tools say otherwise', () => {
    render(<ClaudeSection accounts={controller()} />)

    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows who is signed in, on what plan and for which organisation', () => {
    render(<ClaudeSection accounts={controller({ status: signedIn() })} />)

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('someone@example.com')).toBeInTheDocument()
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('max')).toBeInTheDocument()
    expect(screen.getByText('Organisation')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  // A personal account has no organisation, and an empty row would read as a
  // missing value rather than one that does not apply.
  it('leaves out the details the account does not have', () => {
    render(<ClaudeSection accounts={controller({ status: status({ connected: true }) })} />)

    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Organisation')).not.toBeInTheDocument()
  })

  it('starts a sign-in for the Claude account', async () => {
    const accounts = controller()
    render(<ClaudeSection accounts={accounts} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(accounts.signIn).toHaveBeenCalledExactlyOnceWith('claude', 'Claude')
  })

  it('signs out of the account it is showing', async () => {
    const accounts = controller({ status: signedIn() })
    render(<ClaudeSection accounts={accounts} />)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(accounts.signOut).toHaveBeenCalledExactlyOnceWith('claude', 'Claude')
  })

  // Signing out runs an external command; a second click would run it again.
  it('waits, without offering the action again, while the sign-out runs', () => {
    render(<ClaudeSection accounts={controller({ status: signedIn(), signingOut: 'claude' })} />)

    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  // Signing out of GitHub says nothing about this account.
  it('keeps the Claude account usable while the other service signs out', () => {
    render(<ClaudeSection accounts={controller({ status: signedIn(), signingOut: 'github' })} />)

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled()
  })

  it('re-reads the status when asked to refresh', async () => {
    const accounts = controller()
    render(<ClaudeSection accounts={accounts} />)

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(accounts.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not ask again while a check is already running', () => {
    render(<ClaudeSection accounts={controller({ checking: true })} />)

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  })

  it('shows what went wrong with the last action', () => {
    render(<ClaudeSection accounts={controller({ error: 'Could not sign out of Claude.' })} />)

    expect(screen.getByText('Could not sign out of Claude.')).toBeInTheDocument()
  })

  it('hands the section over to the terminal while signing in to Claude', () => {
    const accounts = controller({
      session: { kind: 'claude', label: 'Claude', command: ['claude', 'auth', 'login'] }
    })
    render(<ClaudeSection accounts={accounts} />)

    expect(screen.getByText('Signing in to Claude')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('ends the session when the terminal is closed', async () => {
    const accounts = controller({
      session: { kind: 'claude', label: 'Claude', command: ['claude', 'auth', 'login'] }
    })
    render(<ClaudeSection accounts={accounts} />)

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(accounts.endSession).toHaveBeenCalledTimes(1)
  })

  // The session is shared with the Git section, which hosts its own terminal.
  it('keeps showing the account while GitHub is the one signing in', () => {
    const accounts = controller({
      status: signedIn(),
      session: { kind: 'github', label: 'GitHub', command: ['gh', 'auth', 'login'] }
    })
    render(<ClaudeSection accounts={accounts} />)

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByText('Signing in to GitHub')).not.toBeInTheDocument()
  })
})
