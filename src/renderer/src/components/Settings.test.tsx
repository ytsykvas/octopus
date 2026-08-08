import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'
import type { Config } from '@core/config.js'

import { stubDialogElement } from '../test/dialog.js'
import { disconnectedAccounts } from '../test/octopus.js'
import { Settings } from './Settings.js'

type SettingsProps = React.ComponentProps<typeof Settings>

function config(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    branchPrefix: 'ytsykvas',
    cloneDirectory: '',
    settingSources: 'none',
    theme: 'system',
    language: 'en',
    rightPanelWidth: 360,
    sidebarWidth: 240,
    deviceId: '00000000-0000-4000-8000-000000000000',
    installedAt: '2026-08-08T00:00:00.000Z',
    ...overrides
  }
}

async function renderSettings(overrides: Partial<SettingsProps> = {}): Promise<SettingsProps> {
  const props: SettingsProps = {
    config: config(),
    onChange: vi.fn(() => Promise.resolve()),
    onClose: vi.fn(),
    ...overrides
  }

  render(<Settings {...props} />)
  // The account status is read on mount. Settling it here keeps that update
  // inside the test instead of landing after it has finished.
  await screen.findByRole('dialog')
  return props
}

async function openSection(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: label }))
}

/** What the account tools report, with only the service under test filled in. */
function reportAccounts(overrides: Partial<AccountsStatus>): void {
  vi.mocked(window.octopus.accounts.status).mockResolvedValue({
    ok: true,
    value: { ...disconnectedAccounts(), ...overrides }
  })
}

beforeAll(stubDialogElement)

describe('Settings', () => {
  it('opens on the general section, offering the theme and the language', async () => {
    await renderSettings()

    expect(screen.getByText('Theme')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Follow system' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument()
  })

  it('changes the theme to the one chosen', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await user.click(screen.getByRole('button', { name: 'Dark' }))

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ theme: 'dark' })
  })

  // Starting on the other language makes this a real switch rather than a
  // click on the option that is already in force.
  it('changes the language to the one chosen', async () => {
    const user = userEvent.setup()
    const props = await renderSettings({ config: config({ language: 'uk' }) })

    await user.click(screen.getByRole('button', { name: 'English' }))

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ language: 'en' })
  })

  it('shows one section at a time', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Agent')

    expect(screen.getByText('Instruction sources')).toBeInTheDocument()
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dark' })).not.toBeInTheDocument()
  })

  it('returns to a section already visited', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'About')
    await openSection(user, 'General')

    expect(screen.getByText('Theme')).toBeInTheDocument()
  })

  it('changes what the agent is allowed to load', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Agent')
    await user.click(screen.getByRole('button', { name: /^Everything/ }))

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ settingSources: 'all' })
  })

  // The account sits above the branch prefix and the clone destination because
  // both of those are worthless without it.
  it('offers the GitHub account under Git while nothing is signed in', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Git')

    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('reports the GitHub account the tools say is connected', async () => {
    reportAccounts({ github: { connected: true, login: 'ytsykvas', name: 'Yurii Tsykvas' } })
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Git')

    expect(await screen.findByText('ytsykvas')).toBeInTheDocument()
    expect(screen.getByText('Yurii Tsykvas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('shows the branch prefix and the clone destination under Git', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Git')

    expect(screen.getByDisplayValue('ytsykvas')).toBeInTheDocument()
    expect(screen.getByText('Not set — you will be asked on the first clone.')).toBeInTheDocument()
  })

  it('saves the branch prefix when the field loses focus', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Git')
    const field = screen.getByDisplayValue('ytsykvas')
    await user.clear(field)
    await user.type(field, 'anna')
    await user.tab()

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ branchPrefix: 'anna' })
  })

  // Every workspace branch is named after the prefix, so an empty one would
  // leave the app with no way to name a branch at all.
  it('refuses an empty branch prefix and restores the stored one', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Git')
    const field = screen.getByDisplayValue('ytsykvas')
    await user.clear(field)
    expect(screen.getByText('The prefix cannot be empty.')).toBeInTheDocument()

    await user.tab()

    expect(field).toHaveValue('ytsykvas')
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('writes nothing when the branch prefix is left as it was', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Git')
    await user.click(screen.getByDisplayValue('ytsykvas'))
    await user.tab()

    expect(props.onChange).not.toHaveBeenCalled()
  })

  it('clones into the directory chosen in the picker', async () => {
    vi.mocked(window.octopus.dialog.pickDirectory).mockResolvedValue({
      ok: true,
      value: '/Users/someone/code'
    })
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Git')
    await user.click(screen.getByRole('button', { name: 'Change…' }))

    await waitFor(() => {
      expect(props.onChange).toHaveBeenCalledExactlyOnceWith({
        cloneDirectory: '/Users/someone/code'
      })
    })
  })

  it('keeps the destination when the picker is cancelled', async () => {
    const user = userEvent.setup()
    const props = await renderSettings({
      config: config({ cloneDirectory: '/Users/someone/code' })
    })

    await openSection(user, 'Git')
    await user.click(screen.getByRole('button', { name: 'Change…' }))

    await waitFor(() => {
      expect(window.octopus.dialog.pickDirectory).toHaveBeenCalledWith('Clone destination')
    })
    expect(props.onChange).not.toHaveBeenCalled()
    expect(screen.getByText('/Users/someone/code')).toBeInTheDocument()
  })

  it('shows the Claude account under its own section', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Claude')

    expect(screen.getByText('The agent runs on this account.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('reports an account the tools say is connected', async () => {
    reportAccounts({
      claude: {
        connected: true,
        email: 'someone@example.com',
        authMethod: 'oauth',
        subscriptionType: 'max',
        orgName: null
      }
    })
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Claude')

    expect(await screen.findByText('someone@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('shows what the app knows about this installation under About', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'About')

    expect(screen.getByText('Device id')).toBeInTheDocument()
    expect(screen.getByText('00000000-0000-4000-8000-000000000000')).toBeInTheDocument()
    expect(screen.getByText('First run')).toBeInTheDocument()
    // The wording is whatever the machine's locale makes of the date, so the
    // year is the most that can be asserted without restating the formatting.
    // Asserting the label alone let the value go blank unnoticed.
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('closes when the close button is pressed', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  describe('the Git section', () => {
    it('shows the GitHub account, disconnected by default', async () => {
      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      expect(await screen.findByText('GitHub')).toBeInTheDocument()
      expect(screen.getByText(/Connect GitHub/i)).toBeInTheDocument()
    })

    // Opening the section before the account check has answered is ordinary:
    // it asks two CLIs, which is not instant.
    it('renders while the account status is still being read', async () => {
      vi.mocked(window.octopus.accounts.status).mockReturnValue(new Promise(() => undefined))

      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      expect(await screen.findByText('GitHub')).toBeInTheDocument()
    })

    // A GitHub account need not have a display name set.
    it('shows a connected account that has no display name', async () => {
      reportAccounts({ github: { connected: true, login: 'ytsykvas', name: null } })

      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      expect(await screen.findByText('ytsykvas')).toBeInTheDocument()
    })

    it('shows the login once the account is connected', async () => {
      reportAccounts({ github: { connected: true, login: 'ytsykvas', name: 'Yurii' } })

      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      expect(await screen.findByText('ytsykvas')).toBeInTheDocument()
    })

    it('re-reads the accounts when asked', async () => {
      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      vi.mocked(window.octopus.accounts.status).mockClear()
      await user.click(screen.getByRole('button', { name: /recheck|Refresh|Оновити/i }))

      await waitFor(() => {
        expect(window.octopus.accounts.status).toHaveBeenCalled()
      })
    })

    // A sign-out that fails leaves the account connected, and saying nothing
    // would look like it worked.
    it('reports a failed sign-out', async () => {
      reportAccounts({ github: { connected: true, login: 'ytsykvas', name: null } })
      vi.mocked(window.octopus.accounts.signOut).mockResolvedValue({
        ok: false,
        error: 'gh refused'
      })

      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      await user.click(await screen.findByRole('button', { name: /sign out|Вийти/i }))

      expect(await screen.findByText(/Could not sign out of GitHub/i)).toBeInTheDocument()
    })

    it('signs out of GitHub, then re-reads the accounts', async () => {
      reportAccounts({ github: { connected: true, login: 'ytsykvas', name: 'Yurii' } })
      vi.mocked(window.octopus.accounts.signOut).mockResolvedValue({ ok: true, value: true })

      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      await user.click(await screen.findByRole('button', { name: /sign out|Вийти/i }))

      await waitFor(() => {
        expect(window.octopus.accounts.signOut).toHaveBeenCalledWith('github', 'ytsykvas')
      })
    })

    // Signing in is interactive, so the section hands its terminal the argv
    // rather than running anything behind the user's back.
    it('hosts the sign-in terminal in place of the account card', async () => {
      // Only this case renders a terminal, and the terminal watches its
      // container for resizes — which jsdom has no observer for.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe = vi.fn()
          unobserve = vi.fn()
          disconnect = vi.fn()
        }
      )

      const user = userEvent.setup()
      await renderSettings()
      await openSection(user, 'Git')

      await user.click(screen.getByRole('button', { name: /sign in|Увійти/i }))

      await waitFor(() => {
        expect(screen.queryByText(/Connect GitHub/i)).not.toBeInTheDocument()
      })
    })
  })
})
