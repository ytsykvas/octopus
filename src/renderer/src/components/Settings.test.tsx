import { render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'
import type { Config } from '@core/config.js'

import { stubDialogElement } from '../test/dialog.js'
import { disconnectedAccounts, octopus } from '../test/octopus.js'
import { Settings } from './Settings.js'

type SettingsProps = React.ComponentProps<typeof Settings>

function config(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    branchPrefix: 'ytsykvas',
    cloneDirectory: '',
    settingSources: 'none',
    workingMode: 'default',
    effort: 'medium',
    model: null,
    planModel: null,
    alwaysAllowedTools: [],
    theme: 'system',
    language: 'en',
    rightPanelWidth: 360,
    rightPanelTab: 'diff',
    diffView: 'unified',
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

describe('the instruction every project falls back to', () => {
  /*
   * A file rather than a setting, which is why it is read and written through
   * the project channels with a null project rather than through `onChange`:
   * instructions outgrow a text field, are worth reading in a diff, and can be
   * edited outside the app.
   */
  it('reads the installation instruction', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().projects.readInstruction).mockResolvedValue({
      ok: true,
      value: 'Lead with the why.'
    })
    await renderSettings()

    await openSection(user, 'Instructions')

    expect(await screen.findByDisplayValue('Lead with the why.')).toBeInTheDocument()
    expect(octopus().projects.readInstruction).toHaveBeenCalledWith(null, 'pullRequest')
  })

  // Whatever sits in the box is what gets written back, so a file that could not
  // be read leaves it empty rather than holding the error as if it were text.
  it('leaves the editor empty when the file cannot be read', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().projects.readInstruction).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    await renderSettings()

    await openSection(user, 'Instructions')

    expect(await screen.findByRole('textbox')).toHaveValue('')
    expect(screen.queryByText(/EACCES/)).not.toBeInTheDocument()
  })

  it('saves it when the editor loses focus', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().projects.readInstruction).mockResolvedValue({ ok: true, value: 'old' })
    await renderSettings()

    await openSection(user, 'Instructions')
    const editor = await screen.findByDisplayValue('old')
    await user.clear(editor)
    await user.type(editor, 'Say what changed.')
    await user.tab()

    expect(octopus().projects.saveInstruction).toHaveBeenCalledExactlyOnceWith(
      null,
      'pullRequest',
      'Say what changed.'
    )
  })
})

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

  // Sending someone here to connect GitHub is pointless if they land on the
  // theme picker and have to go hunting for the section that matters.
  it('opens on the section it was asked for', async () => {
    await renderSettings({ initialSection: 'git' })

    expect(screen.getByText('Branch prefix')).toBeInTheDocument()
    expect(screen.queryByText('Theme')).not.toBeInTheDocument()
  })

  // The section asked for is a starting point, not a cage. Pinning the rail to
  // it would be the obvious way to "fix" the prop into a controlled value.
  it('still lets the rail move on from the section it opened on', async () => {
    const user = userEvent.setup()
    await renderSettings({ initialSection: 'git' })

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

  // Global rather than per workspace: being asked the same question on every
  // new branch is the friction that gets a setting turned all the way off.
  it('sets what a new chat may do without asking', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Agent')
    await user.click(screen.getByRole('button', { name: /^Accept edits/ }))

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ workingMode: 'acceptEdits' })
  })

  // The composer changes one conversation; this is what every new one starts
  // from, so a working habit does not have to be re-chosen on every branch.
  it('sets the effort a new chat starts on', async () => {
    const user = userEvent.setup()
    const props = await renderSettings()

    await openSection(user, 'Agent')
    await user.click(screen.getByRole('button', { name: /^Very high/ }))

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ effort: 'xhigh' })
  })

  /*
   * The setting names a level and that level is sent, which is the whole of it.
   * "Agent decides" was offered here for a while and stored as null — a control
   * naming a level the agent had never been told about, which is the interface
   * reporting a decision nobody took.
   */
  it('offers no way to leave the level unsaid', async () => {
    const user = userEvent.setup()
    await renderSettings({ config: config({ effort: 'max' }) })

    await openSection(user, 'Agent')

    expect(screen.queryByRole('button', { name: /^Agent decides/ })).not.toBeInTheDocument()
  })

  /*
   * The pair a new conversation starts on. Global for the reason the two
   * settings above it are: which model does which job is a working habit, and
   * answering it again in every conversation is what gets a setting left alone.
   */
  describe('the models a new conversation starts on', () => {
    const CATALOGUE = [
      {
        value: 'default',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Default (recommended)',
        description: '',
        supportsEffort: null,
        supportedEffortLevels: null
      },
      {
        value: 'opus[1m]',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Opus (1M context)',
        description: '',
        supportsEffort: null,
        supportedEffortLevels: null
      },
      {
        value: 'sonnet',
        resolvedModel: 'claude-sonnet-5',
        displayName: 'Sonnet',
        description: '',
        supportsEffort: null,
        supportedEffortLevels: null
      }
    ]

    async function withCatalogue(overrides: Partial<SettingsProps> = {}): Promise<SettingsProps> {
      vi.mocked(octopus().chats.models).mockResolvedValue({ ok: true, value: CATALOGUE })
      const props = await renderSettings(overrides)
      await screen.findByRole('button', { name: 'Agent' })
      return props
    }

    /*
     * The two lists hold the same names, so they are told apart by order —
     * coding above, planning below, which is the order they are read in too.
     */
    async function rowIn(list: 'coding' | 'planning', name: RegExp): Promise<HTMLElement> {
      const [coding, planning] = await screen.findAllByRole('button', { name })
      const found = list === 'coding' ? coding : planning
      if (!found) throw new Error(`no ${list} row matching ${name.source}`)
      return found
    }

    it('sets the model a new conversation writes code with', async () => {
      const user = userEvent.setup()
      const props = await withCatalogue()

      await openSection(user, 'Agent')
      await user.click(await rowIn('coding', /^Sonnet/))

      expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ model: 'sonnet' })
    })

    it('stores the coding default as no override at all', async () => {
      const user = userEvent.setup()
      const props = await withCatalogue({ config: config({ model: 'sonnet' }) })

      await openSection(user, 'Agent')
      await user.click(await rowIn('coding', /^Opus \(1M context\)by default/))

      expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ model: null })
    })

    // Null is already spoken for on the plan side — it is the first row, and
    // means one model does both jobs — so the agent's own default is the word.
    it('stores the planning default as the word rather than an absence', async () => {
      const user = userEvent.setup()
      const props = await withCatalogue({ config: config({ planModel: 'sonnet' }) })

      await openSection(user, 'Agent')
      await user.click(await rowIn('planning', /^Opus \(1M context\)by default/))

      expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ planModel: 'default' })
    })

    it('takes the split back off with the first row of the plan list', async () => {
      const user = userEvent.setup()
      const props = await withCatalogue({ config: config({ planModel: 'sonnet' }) })

      await openSection(user, 'Agent')
      await user.click(await screen.findByRole('button', { name: 'Same as writing code' }))

      expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ planModel: null })
    })
  })

  it('says nothing has been waved through yet', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'Agent')

    expect(screen.getByText('Nothing yet.')).toBeInTheDocument()
  })

  // An answer given once in a chat weeks ago quietly changes what every future
  // session may do. Listing it here is what makes it something to take back.
  it('lists the tools answered "always" and takes one back', async () => {
    const user = userEvent.setup()
    const props = await renderSettings({ config: config({ alwaysAllowedTools: ['Edit', 'Bash'] }) })

    await openSection(user, 'Agent')
    expect(screen.getByText('Edit')).toBeInTheDocument()

    const [first] = screen.getAllByRole('button', { name: 'Ask again' })
    if (!first) throw new Error('no way to take an answer back')
    await user.click(first)

    expect(props.onChange).toHaveBeenCalledExactlyOnceWith({ alwaysAllowedTools: ['Bash'] })
  })

  it('signs off the About section with the mascot', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await openSection(user, 'About')

    const image = screen.getByRole('dialog').querySelector('img')
    expect(image?.getAttribute('src')).toContain('octopus')
    // Decoration: it is hidden from anything reading the screen aloud.
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
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
