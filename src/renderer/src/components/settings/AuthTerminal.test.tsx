import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalExit } from '@core/terminal.js'

import { octopus } from '../../test/octopus.js'
import {
  openedDirectories,
  sessionId,
  sessionsOpened,
  stubTerminalHost
} from '../../test/terminal.js'
import { AuthTerminal } from './AuthTerminal.js'
import type { AuthSession } from './useAccounts.js'

const claudeSession: AuthSession = {
  kind: 'claude',
  label: 'Claude',
  command: ['claude', 'auth', 'login']
}

/** Every listener hears every exit; a terminal keeps only its own. */
const listeners: ((exit: TerminalExit) => void)[] = []

/** Ends the session the component opened, the way the main process would. */
async function commandExits(exitCode: number | null): Promise<void> {
  await sessionsOpened(1)
  act(() => {
    for (const notify of listeners) notify({ id: sessionId(1), exitCode })
  })
}

describe('AuthTerminal', () => {
  beforeEach(() => {
    stubTerminalHost()
    listeners.length = 0
    vi.mocked(octopus().terminal.onExit).mockImplementation((handler) => {
      listeners.push(handler)
      return vi.fn()
    })
  })

  it('names the service being signed in to and the command doing it', () => {
    render(<AuthTerminal session={claudeSession} onClose={vi.fn()} />)

    expect(screen.getByText('Signing in to Claude')).toBeInTheDocument()
    expect(screen.getByText('claude auth login')).toBeInTheDocument()
  })

  // Neither login belongs to a repository, so any project directory would be
  // an arbitrary choice.
  it('runs the command in the home directory', async () => {
    render(<AuthTerminal session={claudeSession} onClose={vi.fn()} />)

    await sessionsOpened(1)
    expect(openedDirectories()).toEqual(['~'])
    expect(vi.mocked(octopus().terminal.create).mock.calls[0]?.[0].command).toEqual([
      'claude',
      'auth',
      'login'
    ])
  })

  it('says nothing about the outcome while the command is still running', async () => {
    render(<AuthTerminal session={claudeSession} onClose={vi.fn()} />)

    await sessionsOpened(1)
    expect(screen.queryByText(/^Finished/)).not.toBeInTheDocument()
    expect(screen.queryByText(/exited with code/)).not.toBeInTheDocument()
  })

  it('returns to the account list when the terminal is closed', async () => {
    const onClose = vi.fn()
    render(<AuthTerminal session={claudeSession} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('confirms a sign-in that finished', async () => {
    render(<AuthTerminal session={claudeSession} onClose={vi.fn()} />)

    await commandExits(0)

    expect(
      screen.getByText('Finished. Closing this returns to the account list.')
    ).toBeInTheDocument()
  })

  // A signal is not a verdict on the login: the command never got to decide.
  it('distinguishes a command that was killed from one that failed', async () => {
    render(<AuthTerminal session={claudeSession} onClose={vi.fn()} />)

    await commandExits(null)

    expect(screen.getByText('The command was interrupted before it finished.')).toBeInTheDocument()
    expect(screen.queryByText(/exited with code/)).not.toBeInTheDocument()
  })

  it('reports the code a failed sign-in exited with', async () => {
    render(<AuthTerminal session={claudeSession} onClose={vi.fn()} />)

    await commandExits(3)

    expect(screen.getByText('The command exited with code 3.')).toBeInTheDocument()
  })

  it('shows the session of whichever service is signing in', () => {
    render(
      <AuthTerminal
        session={{ kind: 'github', label: 'GitHub', command: ['gh', 'auth', 'login'] }}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByText('Signing in to GitHub')).toBeInTheDocument()
    expect(screen.getByText('gh auth login')).toBeInTheDocument()
  })
})
